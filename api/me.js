import { handler, send } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
export default handler(async (req, res) => {
  const u = getSession(req);
  send(res, u ? 200 : 401, u ? { user: { id: u.id, role: u.role } } : { error: "로그인이 필요합니다." });
});
