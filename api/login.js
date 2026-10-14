import { handler, send, jsonBody, fail } from "../lib/http.js";
import { setSession, checkPassword, safeEqual } from "../lib/auth.js";
import { loadState, codesOf } from "../lib/core.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") throw fail(405, "허용되지 않는 요청입니다.");
  const { id = "", password = "" } = await jsonBody(req);
  const uid = String(id).trim().toLowerCase();
  await new Promise((r) => setTimeout(r, 300)); // 비밀번호 대입 속도 늦추기
  if (uid === "admin") {
    const want = process.env.ADMIN_PASSWORD || (process.env.VERCEL ? null : "admin");
    if (!want) throw fail(503, "관리자 비밀번호(ADMIN_PASSWORD)가 서버에 설정되지 않았습니다.");
    if (!safeEqual(password, want)) throw fail(401, "아이디 또는 비밀번호가 맞지 않습니다.");
    setSession(res, { id: "admin", role: "admin" });
    return send(res, 200, { user: { id: "admin", role: "admin" } });
  }
  const s = await loadState();
  if (!checkPassword(password, s.accounts[uid]) || !codesOf(s, uid).length) throw fail(401, "아이디 또는 비밀번호가 맞지 않습니다.");
  setSession(res, { id: uid, role: "viewer" });
  send(res, 200, { user: { id: uid, role: "viewer" } });
});
