// 관리자 전용: 전체 상태 조회, 계정 연결, 권한 승인·회수, 주기 설정
import { handler, send, jsonBody, fail } from "../lib/http.js";
import { getSession, hashPassword } from "../lib/auth.js";
import { loadState, saveState, loadPending, candidatesFor, normOrg, audit, INTERVALS, DONE_DAYS, expired, withLock } from "../lib/core.js";
import { summarize } from "./upload.js";

function view(s, pending) {
  const codes = {};
  s.candidates.forEach((c) => { const o = normOrg(c); c.codes.forEach((x) => { (codes[x] ||= []).push(o.hq + " / " + o.dept + (o.hq !== c.hq ? ` (원본: ${c.hq})` : "")); }); });
  Object.keys(s.grants).concat(Object.keys(s.links)).forEach((x) => { codes[x] ||= ["(권한 시트에 없음, 직접 추가)"]; });
  return {
    meta: { doneDays: 0, ...s.meta }, order: s.order,
    postings: Object.fromEntries(s.order.map((id) => [id, { ...s.postings[id], expired: expired(s, s.postings[id]) }])),
    candidates: Object.fromEntries(s.order.map((id) => [id, candidatesFor(s, s.postings[id])])),
    codes, links: s.links, grants: s.grants,
    accounts: Object.keys(s.accounts).map((id) => ({ id, hasPassword: true })),
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
  const s = await withLock(async () => { const s = await loadState(); change(s, b); await saveState(s); return s; });
  send(res, 200, view(s, await loadPending()));
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
      if (!s.accounts[acc] && !b.password) throw fail(400, "새 계정은 처음 비밀번호를 함께 정해 주세요.");
      if (b.password) { if (String(b.password).length < 8) throw fail(400, "비밀번호는 8자 이상으로 정해 주세요."); s.accounts[acc] = hashPassword(b.password); }
      const before = s.links[code]; s.links[code] = acc;
      audit(s, "HR 관리자", null, code, `계정 연결: ${before || "없음"} → ${acc}`);
      break;
    }
    case "password": {
      const acc = String(b.account || "").trim().toLowerCase();
      if (!s.accounts[acc]) throw fail(404, "없는 계정입니다.");
      if (String(b.password || "").length < 8) throw fail(400, "비밀번호는 8자 이상으로 정해 주세요.");
      s.accounts[acc] = hashPassword(b.password);
      audit(s, "HR 관리자", null, "-", `비밀번호 재설정: ${acc}`);
      break;
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
