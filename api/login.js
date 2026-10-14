import { handler, send, jsonBody, fail } from "../lib/http.js";
import { setSession, checkPassword, safeEqual } from "../lib/auth.js";
import { loadState, codesOf } from "../lib/core.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") throw fail(405, "허용되지 않는 요청입니다.");
  const { id = "", password = "" } = await jsonBody(req);
  const uid = String(id).trim().toLowerCase();
  await new Promise((r) => setTimeout(r, 300)); // 비밀번호 대입 속도 늦추기
  // 테스트용 관리자(test_admin)는 TEST_ADMIN_PASSWORD 환경 변수가 있을 때만 켜진다
  const ADMINS = { admin: "ADMIN_PASSWORD", test_admin: "TEST_ADMIN_PASSWORD" };
  if (ADMINS[uid]) {
    const want = process.env[ADMINS[uid]] || (uid === "admin" && !process.env.VERCEL ? "admin" : null);
    if (!want && uid === "admin") throw fail(503, "관리자 비밀번호(ADMIN_PASSWORD)가 서버에 설정되지 않았습니다.");
    if (!want || !safeEqual(password, want)) throw fail(401, "아이디 또는 비밀번호가 맞지 않습니다.");
    setSession(res, { id: uid, role: "admin" });
    return send(res, 200, { user: { id: uid, role: "admin" } });
  }
  const s = await loadState();
  if (!checkPassword(password, s.accounts[uid]) || !codesOf(s, uid).length) throw fail(401, "아이디 또는 비밀번호가 맞지 않습니다.");
  setSession(res, { id: uid, role: "viewer" });
  send(res, 200, { user: { id: uid, role: "viewer", mustChange: Boolean(s.accounts[uid].mustChange) } });
});
