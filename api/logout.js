import { handler, send } from "../lib/http.js";
import { clearSession } from "../lib/auth.js";
export default handler(async (req, res) => { clearSession(res); send(res, 200, { ok: true }); });
