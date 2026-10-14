// 관리자 전용: 전체 상태 조회, 계정 연결, 권한 승인·회수, 주기 설정
import { handler, send, jsonBody, fail } from "../lib/http.js";
import { getSession, hashPassword, tempPassword } from "../lib/auth.js";
import { loadState, saveState, loadPending, candidatesFor, normOrg, audit, INTERVALS, DONE_DAYS, expired, withLock } from "../lib/core.js";
import { summarize } from "./upload.js";

function view(s, pending) {
  const codes = {};
  s.candidates.forEach((c) => { const o = normOrg(c); c.codes.forEach((x) => { (codes[x] ||= []).push(o.hq + " / " + o.dept + (o.hq !== c.hq ? ` (원본: ${c.hq})` : "")); }); });
  Object.keys(s.grants).concat(Object.keys(s.links)).forEach((x) => { codes[x] ||= ["(권한 시트에 없음, 직접 추가)"]; });
  return {
    meta: { ...s.meta, doneDays: s.meta.doneDays ?? 7 }, order: s.order,
    postings: Object.fromEntries(s.order.map((id) => [id, { ...s.postings[id], expired: expired(s, s.postings[id]) }])),
    candidates: Object.fromEntries(s.order.map((id) => [id, candidatesFor(s, s.postings[id])])),
    codes, links: s.links, suggest: Object.assign({}, ...s.candidates.map((c) => c.emails || {})), grants: s.grants,
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
  let issued = null;
  const s = await withLock(async () => { const s = await loadState(); issued = change(s, b); await saveState(s); return s; });
  // 임시 비밀번호는 이 응답에서 한 번만 보여 준다 (서버에는 해시만 저장)
  send(res, 200, { ...view(s, await loadPending()), issued: issued || null });
});

function change(s, b) {
  const code = String(b.code || "").trim();
  switch (b.action) {
    case "link": {
      const acc = String(b.account || "").trim().toLowerCase();
      if (!code) throw fail(400, "대상자를 골라 주세요.");
      if (acc && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acc)) throw fail(400, "로그인 계정은 이메일 형식으로 입력해 주세요.");
      const owner = Object.keys(s.links).find((c) => s.links[c] === acc && c !== code);
      if (acc && owner && !b.shareAccount) throw fail(400, `${acc}은(는) 이미 '${owner}'에 연결된 이메일입니다.`);
      if (!acc) { const before = s.links[code]; delete s.links[code]; audit(s, "HR 관리자", null, code, `계정 연결 해제: ${before || "없음"}`); break; }
      if (acc === "admin") throw fail(400, "'admin'은 열람자 계정으로 쓸 수 없습니다.");
      let issued = null;
      // 새 계정은 임시 비밀번호를 자동으로 만든다. 첫 로그인 때 본인이 바꾼다.
      if (!s.accounts[acc]) { const temp = tempPassword(); s.accounts[acc] = { ...hashPassword(temp), mustChange: true }; issued = { name: code, account: acc, temp }; }
      const before = s.links[code]; s.links[code] = acc;
      audit(s, "HR 관리자", null, code, `계정 연결: ${before || "없음"} → ${acc}`);
      return issued;
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
