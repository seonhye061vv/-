// 엑셀 받기. PC 동기화 프로그램(동기화 키) 또는 관리자(검증 후 반영 전 확인).
import { handler, send, rawBody, fail } from "../lib/http.js";
import { getSession, safeEqual } from "../lib/auth.js";
import { loadState, saveState, prepare, savePending, logAttempt, syncFromPC, withLock } from "../lib/core.js";

const MAX = 4 * 1024 * 1024;

export default handler(async (req, res) => {
  const key = req.headers["x-sync-key"];
  // PC 동기화 프로그램이 확인 주기를 묻는다
  if (req.method === "GET") {
    if (!(key && process.env.SYNC_KEY && safeEqual(key, process.env.SYNC_KEY))) throw fail(401, "동기화 키가 맞지 않습니다.");
    const s = await loadState();
    return send(res, 200, { intervalM: s.meta.intervalM, lastSuccess: s.meta.lastSuccess });
  }
  if (req.method !== "POST") throw fail(405, "허용되지 않는 요청입니다.");
  const fileName = decodeURIComponent(req.headers["x-file-name"] || "") || "업로드.xlsx";
  const fileModified = req.headers["x-file-modified"] ? new Date(req.headers["x-file-modified"]).toISOString() : null;
  const isPC = key && process.env.SYNC_KEY && safeEqual(key, process.env.SYNC_KEY);
  if (key && !isPC) throw fail(401, "동기화 키가 맞지 않습니다.");
  const u = getSession(req);
  if (!isPC && u?.role !== "admin") throw fail(403, "관리자만 엑셀을 반영할 수 있습니다.");
  const buf = await rawBody(req);
  if (!buf.length) throw fail(400, "파일이 비어 있습니다.");
  if (buf.length > MAX) throw fail(413, "파일이 너무 큽니다 (4MB 이하).");

  if (isPC) return send(res, 200, await syncFromPC(buf, { fileName, fileModified }));

  // 관리자 업로드: 검증 결과를 보여 주고, 반영은 확인 후 /api/apply
  const out = await withLock(async () => {
    const s = await loadState();
    const P = await prepare(s, buf, { fileName, fileModified, source: "upload" });
    if (P.errs.length) { logAttempt(s, P, false); await saveState(s); }
    else await savePending(P);
    return P;
  });
  send(res, 200, { pending: summarize(out) });
});

export function summarize(P) {
  if (!P) return null;
  return { id: P.id, file: P.file, source: P.source, started: P.started, errs: P.errs, warns: P.warns,
    count: P.postings?.length || 0, ongoing: P.postings ? countOngoing(P.postings) : null,
    cands: P.cands?.length || 0, fresh: P.fresh || [], missing: P.missing || [] };
}
function countOngoing(ps) { const c = Array(9).fill(0); ps.forEach((p) => p.statuses.forEach((s, i) => { if (s === "ongoing") c[i]++; })); return c; }
