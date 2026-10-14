// 현업 본인 비밀번호 변경 (첫 로그인 때는 필수)
import { handler, send, jsonBody, fail } from "../lib/http.js";
import { getSession, checkPassword, hashPassword } from "../lib/auth.js";
import { loadState, saveState, withLock } from "../lib/core.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") throw fail(405, "허용되지 않는 요청입니다.");
  const u = getSession(req);
  if (u?.role !== "viewer") throw fail(401, "로그인이 필요합니다.");
  const { current = "", next = "" } = await jsonBody(req);
  if (String(next).length < 8) throw fail(400, "새 비밀번호는 8자 이상으로 정해 주세요.");
  if (next === current) throw fail(400, "지금 비밀번호와 다른 비밀번호로 정해 주세요.");
  await withLock(async () => {
    const s = await loadState();
    if (!checkPassword(current, s.accounts[u.id])) throw fail(400, "지금 비밀번호가 맞지 않습니다.");
    s.accounts[u.id] = hashPassword(next);
    await saveState(s);
  });
  send(res, 200, { ok: true });
});
