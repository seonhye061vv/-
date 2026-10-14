// 관리자가 확인한 엑셀을 한 번에 반영하거나 버린다
import { handler, send, jsonBody, fail } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { loadState, saveState, loadPending, clearPending, apply, withLock } from "../lib/core.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") throw fail(405, "허용되지 않는 요청입니다.");
  if (getSession(req)?.role !== "admin") throw fail(403, "관리자만 반영할 수 있습니다.");
  const { pendingId, linkTo = {}, discard } = await jsonBody(req);
  const result = await withLock(async () => {
    const P = await loadPending();
    if (!P || P.id !== pendingId) throw fail(409, "반영할 파일이 바뀌었거나 없습니다. 다시 올려 주세요.");
    if (discard) { await clearPending(); return { discarded: true }; }
    const s = await loadState();
    // 같은 기존 공고를 두 번 연결하지 않도록 정리
    const used = new Set(); const links = {};
    for (const [k, v] of Object.entries(linkTo)) if (v && !used.has(v)) { used.add(v); links[k] = v; }
    const changed = apply(s, P, links, "HR 관리자");
    await saveState(s); await clearPending();
    return { applied: true, changed };
  });
  send(res, 200, result);
});
