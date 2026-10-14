// 데이터 저장소: Upstash Redis(REST) 또는 Redis 접속 주소(REDIS_URL). 로컬 개발에서만 메모리 저장소를 쓴다.
// Vercel 연동 방식에 따라 변수 이름 앞에 접두어가 붙을 수 있어 끝부분으로 찾는다 (예: STORAGE_KV_REST_API_URL).
const env = process.env;
const findEnv = (...ends) => { for (const e of ends) { if (env[e]) return env[e]; const k = Object.keys(env).find((k) => k.endsWith("_" + e) && env[k]); if (k) return env[k]; } return ""; };
const URL_ = findEnv("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL");
const TOKEN = findEnv("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
const REDIS_URL = URL_ && TOKEN ? "" : findEnv("REDIS_URL", "KV_URL");
const mem = globalThis.__memStore || (globalThis.__memStore = new Map());

export const storeKind = () => (URL_ && TOKEN ? "upstash" : REDIS_URL ? "redis" : env.VERCEL ? "none" : "memory");
export function storeReady() { return storeKind() !== "none"; }

// Redis 접속 주소 방식: 함수가 살아 있는 동안 연결을 재사용
async function redisCmd(args) {
  if (!globalThis.__redis) {
    const { createClient } = await import("redis");
    const c = createClient({ url: REDIS_URL, socket: { connectTimeout: 5000 } });
    c.on("error", () => {});
    globalThis.__redis = c.connect().then(() => c);
  }
  try { return await (await globalThis.__redis).sendCommand(args.map(String)); }
  catch (e) { globalThis.__redis = null; throw e; }
}

async function cmd(args) {
  if (REDIS_URL) return redisCmd(args);
  if (!URL_ || !TOKEN) {
    if (process.env.VERCEL) throw Object.assign(new Error("데이터 저장소가 연결되지 않았습니다. Vercel의 Storage에서 Upstash Redis를 연결해 주세요."), { status: 503 });
    const [op, key, val, ...rest] = args;
    if (op === "GET") return mem.has(key) ? mem.get(key) : null;
    if (op === "SET") {
      if (rest.includes("NX") && mem.has(key)) return null;
      mem.set(key, val);
      const ex = rest.indexOf("EX"); if (ex >= 0) setTimeout(() => mem.get(key) === val && mem.delete(key), Number(rest[ex + 1]) * 1000).unref?.();
      return "OK";
    }
    if (op === "DEL") return mem.delete(key) ? 1 : 0;
    throw new Error("unsupported " + op);
  }
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(args) });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

export async function getJSON(key, fallback) { const v = await cmd(["GET", key]); return v == null ? fallback : JSON.parse(v); }
export async function setJSON(key, value) { await cmd(["SET", key, JSON.stringify(value)]); }
export async function del(key) { await cmd(["DEL", key]); }
// 동시 반영 방지용 잠금
export async function lock(key, seconds = 60) { return (await cmd(["SET", key, "1", "NX", "EX", String(seconds)])) === "OK"; }
