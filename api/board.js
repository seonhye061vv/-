// 현황판 데이터. 로그인한 사람이 볼 수 있는 공고만 돌려준다.
import { handler, send, fail } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { loadState, boardFor, visibleIds } from "../lib/core.js";

export default handler(async (req, res) => {
  const u = getSession(req);
  if (!u) throw fail(401, "로그인이 필요합니다.");
  const s = await loadState();
  // 열람자 계정이 연결 해제되면 즉시 차단
  if (u.role === "viewer" && !Object.values(s.links).includes(u.id)) throw fail(401, "열람 권한이 없습니다. 다시 로그인해 주세요.");
  const id = new URL(req.url, "http://x").searchParams.get("id");
  if (id) {
    if (!visibleIds(s, u).includes(id)) throw fail(404, "공고를 찾을 수 없습니다.");
    return send(res, 200, { posting: boardFor(s, u).postings.find((p) => p.id === id) });
  }
  send(res, 200, boardFor(s, u));
});
