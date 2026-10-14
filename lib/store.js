// 데이터 저장소: Upstash Redis(REST). 로컬 개발에서만 메모리 저장소를 쓴다.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = globalThis.__memStore || (globalThis.__memStore = new Map());

export function storeReady() {
  return Boolean(URL_ && TOKEN) || !process.env.VERCEL;
}

async function cmd(args) {
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
