import { handler, send } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { loadState } from "../lib/core.js";
export default handler(async (req, res) => {
  const u = getSession(req);
  if (!u) return send(res, 401, { error: "로그인이 필요합니다." });
  const mustChange = u.role === "viewer" ? Boolean((await loadState()).accounts[u.id]?.mustChange) : false;
  send(res, 200, { user: { id: u.id, role: u.role, mustChange } });
});
