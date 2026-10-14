// 현황판 데이터. 로그인한 사람이 볼 수 있는 공고만 돌려준다.
import { handler, send, fail } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { loadState, boardFor, visibleIds } from "../lib/core.js";

export default handler(async (req, res) => {
  let u = getSession(req);
  if (!u) throw fail(401, "로그인이 필요합니다.");
  const s = await loadState();
  // 열람자 계정이 연결 해제되면 즉시 차단
  if (u.role === "viewer" && !Object.values(s.links).includes(u.id)) throw fail(401, "열람 권한이 없습니다. 다시 로그인해 주세요.");
  // 임시 비밀번호로는 공고를 볼 수 없다. 먼저 본인 비밀번호로 바꿔야 한다.
  if (u.role === "viewer" && s.accounts[u.id]?.mustChange) throw fail(403, "처음 로그인했습니다. 비밀번호를 먼저 바꿔 주세요.");
  const q = new URL(req.url, "http://x").searchParams;
  const id = q.get("id");
  // HR 관리자: 특정 현업 계정이 보는 화면 그대로 미리보기
  const as = (q.get("as") || "").trim().toLowerCase();
  if (as) {
    if (u.role !== "admin") throw fail(403, "관리자만 사용할 수 있습니다.");
    if (!Object.values(s.links).includes(as)) throw fail(404, "연결된 현업 계정이 아닙니다.");
    u = { id: as, role: "viewer" };
  }
  if (id) {
    if (!visibleIds(s, u).includes(id)) throw fail(404, "공고를 찾을 수 없습니다.");
    return send(res, 200, { posting: boardFor(s, u).postings.find((p) => p.id === id) });
  }
  send(res, 200, boardFor(s, u));
});
