// 로그인 세션(서명 쿠키)과 비밀번호 해시
import crypto from "node:crypto";

const COOKIE = "rb_session";
const MAX_AGE = 60 * 60 * 12; // 12시간

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.VERCEL) throw Object.assign(new Error("서버 설정(SESSION_SECRET)이 없습니다."), { status: 503 });
  return "local-dev-secret-only-for-testing";
}
const sign = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

export function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString("hex") };
}
// 첫 비밀번호(임시): 헷갈리는 글자(0/O, 1/l/I)를 뺀 10자리
export function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(10), (b) => chars[b % chars.length]).join("");
}
export function checkPassword(pw, rec) {
  if (!rec) return false;
  const h = crypto.scryptSync(String(pw), rec.salt, 32);
  const want = Buffer.from(rec.hash, "hex");
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function setSession(res, user) {
  const body = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`);
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
export function getSession(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  try { const u = JSON.parse(Buffer.from(body, "base64url").toString()); return u.exp > Date.now() ? u : null; } catch { return null; }
}
