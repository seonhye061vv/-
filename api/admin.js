// 관리자 전용: 전체 상태 조회, 계정 연결, 권한 승인·회수, 주기 설정
import { handler, send, jsonBody, fail } from "../lib/http.js";
import { getSession, hashPassword, tempPassword } from "../lib/auth.js";
import { loadState, saveState, loadPending, candidatesFor, allCands, normOrg, audit, INTERVALS, DONE_DAYS, expired, withLock } from "../lib/core.js";
import { summarize } from "./upload.js";
import ExcelJS from "exceljs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function view(s, pending) {
  const codes = {};
  allCands(s).forEach((c) => { const o = normOrg(c); c.codes.forEach((x) => { (codes[x] ||= []).push(c.manual && !c.dept ? "소속 없음 (직접 추가)" : o.hq + " / " + o.dept + (o.hq !== c.hq ? ` (원본: ${c.hq})` : "") + (c.manual ? " (직접 추가)" : "")); }); });
  Object.keys(s.grants).concat(Object.keys(s.links)).forEach((x) => { codes[x] ||= ["(권한 시트에 없음, 직접 추가)"]; });
  return {
    meta: { ...s.meta, doneDays: s.meta.doneDays ?? 7 }, order: s.order,
    postings: Object.fromEntries(s.order.map((id) => [id, { ...s.postings[id], expired: expired(s, s.postings[id]) }])),
    candidates: Object.fromEntries(s.order.map((id) => [id, candidatesFor(s, s.postings[id])])),
    codes, links: s.links, suggest: Object.assign({}, ...allCands(s).map((c) => c.emails || {})), grants: s.grants,
    manual: [...new Set((s.manual || []).flatMap((c) => c.codes))],
    accounts: Object.fromEntries(Object.entries(s.accounts).map(([id, a]) => [id, { mustChange: Boolean(a.mustChange) }])),
    audit: s.audit.slice(0, 100), syncLog: s.syncLog.slice(0, 100),
    pending: summarize(pending), intervals: INTERVALS, doneDaysOptions: DONE_DAYS,
    syncConfigured: Boolean(process.env.SYNC_KEY),
  };
}

export default handler(async (req, res) => {
  if (getSession(req)?.role !== "admin") throw fail(403, "관리자만 사용할 수 있습니다.");
  if (req.method === "GET") return send(res, 200, view(await loadState(), await loadPending()));
  if (req.method !== "POST") throw fail(405, "허용되지 않는 요청입니다.");
  const b = await jsonBody(req);
  if (b.action === "tempXlsx") return tempXlsx(res, b.rows);
  let r = null;
  const s = await withLock(async () => { const s = await loadState(); r = change(s, b); await saveState(s); return s; });
  // 임시 비밀번호는 이 응답에서 한 번만 보여 준다 (서버에는 해시만 저장)
  send(res, 200, { ...view(s, await loadPending()), issued: r?.temp ? r : null, bulk: r?.bulk || null });
});

function change(s, b) {
  const code = String(b.code || "").trim();
  switch (b.action) {
    case "link": {
      const acc = String(b.account || "").trim().toLowerCase();
      if (!code) throw fail(400, "대상자를 골라 주세요.");
      if (acc && !EMAIL.test(acc)) throw fail(400, "로그인 계정은 이메일 형식으로 입력해 주세요.");
      const owner = Object.keys(s.links).find((c) => s.links[c] === acc && c !== code);
      if (acc && owner && !b.shareAccount) throw fail(400, `${acc}은(는) 이미 '${owner}'에 연결된 이메일입니다.`);
      if (!acc) { const before = s.links[code]; delete s.links[code]; audit(s, "HR 관리자", null, code, `계정 연결 해제: ${before || "없음"}`); break; }
      if (acc === "admin" || acc === "test_admin") throw fail(400, `'${acc}'은 열람자 계정으로 쓸 수 없습니다.`);
      let issued = null;
      // 새 계정은 임시 비밀번호를 자동으로 만든다. 첫 로그인 때 본인이 바꾼다.
      if (!s.accounts[acc]) { const temp = tempPassword(); s.accounts[acc] = { ...hashPassword(temp), mustChange: true }; issued = { name: code, account: acc, temp }; }
      const before = s.links[code]; s.links[code] = acc;
      audit(s, "HR 관리자", null, code, `계정 연결: ${before || "없음"} → ${acc}`);
      return issued;
    }
    // 명단의 이메일로 아직 연결되지 않은 대상자를 한 번에 연결
    case "linkAll": {
      const sug = Object.assign({}, ...allCands(s).map((c) => c.emails || {}));
      const issued = [], skipped = []; let linked = 0;
      for (const [name, raw] of Object.entries(sug)) {
        if (s.links[name]) continue;
        const acc = String(raw || "").trim().toLowerCase();
        if (!EMAIL.test(acc)) { skipped.push(`${name}: 이메일 형식이 아님`); continue; }
        const owner = Object.keys(s.links).find((c) => s.links[c] === acc);
        if (owner) { skipped.push(`${name}: ${acc}은(는) 이미 '${owner}'에 연결됨`); continue; }
        if (!s.accounts[acc]) { const temp = tempPassword(); s.accounts[acc] = { ...hashPassword(temp), mustChange: true }; issued.push({ name, account: acc, temp }); }
        s.links[name] = acc; linked++;
        audit(s, "HR 관리자", null, name, `계정 연결(일괄): 없음 → ${acc}`);
      }
      return { bulk: { kind: "linkAll", linked, skipped, issued } };
    }
    // 같은 본부·부서 후보를 공고에 한 번에 승인 (id가 있으면 그 공고만)
    case "grantAll": {
      const ids = b.id ? [b.id] : s.order.filter((id) => !expired(s, s.postings[id]));
      if (b.id && !s.postings[b.id]) throw fail(400, "공고를 확인해 주세요.");
      let granted = 0;
      for (const id of ids) for (const c of candidatesFor(s, s.postings[id])) {
        const list = new Set(s.grants[c] || []);
        if (list.has(id)) continue;
        list.add(id); s.grants[c] = [...list]; granted++;
        audit(s, "HR 관리자", id, c, "열람 권한 부여(일괄)");
      }
      return { bulk: { kind: "grantAll", granted } };
    }
    // 명단에 없는 사람을 직접 추가 (소속을 고르면 그 부서 공고의 후보가 됨)
    case "addPerson": {
      const name = String(b.name || "").trim().replace(/\s+/g, " ");
      const acc = String(b.email || "").trim().toLowerCase();
      const hq = String(b.hq || "").trim(), dept = String(b.dept || "").trim();
      if (!name || name.length > 40) throw fail(400, "이름을 입력해 주세요. (40자 이내)");
      if (acc && !EMAIL.test(acc)) throw fail(400, "이메일 형식을 확인해 주세요.");
      s.manual ||= [];
      if (s.manual.some((c) => c.codes.includes(name) && c.hq === hq && c.dept === dept)) throw fail(400, `${name} 님은 이미 같은 소속으로 추가되어 있습니다.`);
      s.manual.push({ hq, dept, codes: [name], emails: acc ? { [name]: acc } : {}, manual: true });
      audit(s, "HR 관리자", null, name, `대상자 직접 추가: ${dept ? hq + " / " + dept : "소속 없음"}${acc ? " · " + acc : ""}`);
      if (acc && b.link && !s.links[name]) return change(s, { action: "link", code: name, account: acc });
      break;
    }
    // 직접 추가한 대상자 삭제 (계정 연결과 승인도 함께 정리)
    case "removePerson": {
      const name = String(b.name || "").trim();
      if (!(s.manual || []).some((c) => c.codes.includes(name))) throw fail(400, "직접 추가한 대상자만 삭제할 수 있습니다.");
      s.manual = s.manual.filter((c) => !c.codes.includes(name));
      const inList = (s.candidates || []).some((c) => c.codes.includes(name));
      if (!inList) { delete s.links[name]; delete s.grants[name]; }
      audit(s, "HR 관리자", null, name, inList ? "직접 추가 소속 삭제 (명단에는 남아 있음)" : "대상자 삭제 (계정 연결·승인 함께 정리)");
      break;
    }
    case "password": {
      const acc = String(b.account || "").trim().toLowerCase();
      if (!s.accounts[acc]) throw fail(404, "없는 계정입니다.");
      const temp = tempPassword();
      s.accounts[acc] = { ...hashPassword(temp), mustChange: true };
      const name = Object.keys(s.links).find((c) => s.links[c] === acc) || "-";
      audit(s, "HR 관리자", null, name, "임시 비밀번호 재발급");
      return { name, account: acc, temp };
    }
    case "grant": case "revoke": {
      if (!code || !s.postings[b.id]) throw fail(400, "코드와 공고를 확인해 주세요.");
      const list = new Set(s.grants[code] || []);
      if (b.action === "grant") { if (list.has(b.id)) break; list.add(b.id); } else { if (!list.has(b.id)) break; list.delete(b.id); }
      s.grants[code] = [...list];
      audit(s, "HR 관리자", b.id, code, b.action === "grant" ? "열람 권한 부여" : "열람 권한 회수");
      break;
    }
    case "doneDays": {
      const d = Number(b.days);
      if (!DONE_DAYS.includes(d)) throw fail(400, "표시 기간을 목록에서 골라 주세요.");
      s.meta.doneDays = d; break;
    }
    case "interval": {
      const m = Number(b.minutes);
      if (!INTERVALS.includes(m)) throw fail(400, "확인 주기는 5분 단위로 골라 주세요.");
      s.meta.intervalM = m; break;
    }
    default: throw fail(400, "알 수 없는 요청입니다.");
  }
}

// 이번에 발급한 임시 비밀번호 목록을 엑셀 파일로 돌려준다 (서버에 저장하지 않음)
async function tempXlsx(res, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw fail(400, "내려받을 임시 비밀번호가 없습니다.");
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("임시 비밀번호");
  ws.columns = [{ header: "대상자", key: "name", width: 22 }, { header: "로그인 이메일", key: "account", width: 34 }, { header: "임시 비밀번호", key: "temp", width: 22 }, { header: "안내", key: "note", width: 50 }];
  rows.forEach((r) => ws.addRow({ name: String(r.name || ""), account: String(r.account || ""), temp: String(r.temp || ""), note: "첫 로그인 때 본인 비밀번호(8자 이상)로 바꿔야 합니다." }));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=temp-passwords.xlsx");
  res.setHeader("Cache-Control", "no-store");
  res.end(Buffer.from(buf));
}
