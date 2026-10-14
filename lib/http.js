// 요청·응답 도우미
export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
export async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = []; for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
export async function jsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const b = await rawBody(req);
  try { return JSON.parse(b.toString() || "{}"); } catch { return {}; }
}
export function handler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { send(res, e.status || 500, { error: e.status ? e.message : "서버 오류가 발생했습니다." }); if (!e.status) console.error(e); }
  };
}
export const fail = (status, message) => Object.assign(new Error(message), { status });
