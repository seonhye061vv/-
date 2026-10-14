// 공고 데이터, 반영 규칙, 권한 판정. 모든 권한 검사는 서버에서 이 파일을 거친다.
import crypto from "node:crypto";
import { getJSON, setJSON, lock, del } from "./store.js";
import { parseWorkbook, STAGES } from "./parse.js";

const STATE = "rb:state", PENDING = "rb:pending", LOCK = "rb:lock";
// 사용자 확인으로 확정된 소속 정정. 이 두 부서에만 적용 (PRD 5.3)
const ORG_FIX = { "재무기획부": "경영기획본부", "계약관리부": "손님지원본부" };
const LABEL = { done: "완료", ongoing: "진행 중", na: "해당사항 없음", empty: "공란" };
export const INTERVALS = Array.from({ length: 12 }, (_, i) => (i + 1) * 5);
// 모든 단계가 완료·해당사항 없음이 된 공고를 현황판에 보여 줄 기간 (0 = 계속 표시, 기본 7일)
export const DONE_DAYS = [0, 7, 14, 30, 60, 90];
const isAllDone = (p) => p.statuses.every((x) => x === "done" || x === "na");
// 표시 기간이 지난 완료 공고인지
export function expired(s, p) {
  const d = s.meta.doneDays ?? 7;
  return Boolean(d && p.completedAt && Date.now() - new Date(p.completedAt) > d * 86400000);
}

export function blankState() {
  return { postings: {}, order: [], nextId: 1, candidates: [], links: {}, accounts: {}, grants: {}, audit: [], syncLog: [],
    meta: { lastSuccess: null, lastAttempt: null, lastChange: null, fileName: null, fileModified: null, fileHash: null, intervalM: 60, source: null, doneDays: 7 } };
}
export const loadState = () => getJSON(STATE, blankState());
export const saveState = (s) => setJSON(STATE, s);
export const loadPending = () => getJSON(PENDING, null);
export const savePending = (p) => setJSON(PENDING, p);
export const clearPending = () => del(PENDING);

const keyOf = (p) => [p.hq, p.dept, p.title].join("|");
const now = () => new Date().toISOString();
const cap = (arr, n) => { if (arr.length > n) arr.length = n; };

/* ---------- 권한 ---------- */
export const normOrg = (c) => ({ hq: ORG_FIX[c.dept] || c.hq, dept: c.dept });
export function candidatesFor(s, p) {
  const set = new Set();
  s.candidates.forEach((c) => { const o = normOrg(c); if (o.hq === p.hq && o.dept === p.dept) c.codes.forEach((x) => set.add(x)); });
  return [...set];
}
export const codesOf = (s, account) => Object.keys(s.links).filter((c) => s.links[c] === account);
export function visibleIds(s, user) {
  if (user.role === "admin") return s.order.slice();
  const g = new Set();
  (user.codes || codesOf(s, user.id)).forEach((c) => (s.grants[c] || []).forEach((id) => g.add(id)));
  return s.order.filter((id) => g.has(id) && s.postings[id] && !expired(s, s.postings[id]));
}
// 현업에게 보내는 공고 정보: 공개 항목만
const publicPosting = (p) => ({ id: p.id, hq: p.hq, dept: p.dept, title: p.title, statuses: p.statuses, history: p.history.slice(0, 30) });
export function boardFor(s, user) {
  const meta = { lastSuccess: s.meta.lastSuccess, lastChange: s.meta.lastChange, intervalM: s.meta.intervalM, doneDays: s.meta.doneDays ?? 7 };
  const ids = visibleIds(s, user);
  if (user.role === "admin") return { meta: { ...s.meta }, postings: ids.map((id) => ({ ...s.postings[id], expired: expired(s, s.postings[id]) })) };
  return { meta, postings: ids.map((id) => publicPosting(s.postings[id])) };
}
export function audit(s, actor, postingId, code, change) {
  s.audit.unshift({ at: now(), actor, posting: postingId, title: s.postings[postingId]?.title || null, code, account: s.links[code] || "(미연결)", change });
  cap(s.audit, 500);
}

/* ---------- 엑셀 반영 ---------- */
export async function prepare(s, buffer, { fileName, fileModified, source }) {
  const started = now();
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const base = { id: crypto.randomUUID(), file: fileName || "업로드.xlsx", mod: fileModified || null, hash, started, source };
  if (fileModified && s.meta.fileModified && fileModified < s.meta.fileModified && hash !== s.meta.fileHash)
    return { ...base, errs: [{ sheet: "-", cell: "-", val: base.file, msg: "마지막으로 반영한 파일보다 오래된 파일입니다.", fix: "가장 최근에 저장한 파일을 반영해 주세요." }], warns: [] };
  const r = await parseWorkbook(buffer);
  if (r.errs.length) return { ...base, errs: r.errs, warns: r.warns };
  const byKey = new Set(s.order.map((id) => keyOf(s.postings[id])));
  const fileKeys = new Set(r.postings.map(keyOf));
  const fresh = r.postings.filter((p) => !byKey.has(keyOf(p))).map((p) => ({ key: keyOf(p), hq: p.hq, dept: p.dept, title: p.title }));
  const missing = s.order.filter((id) => !fileKeys.has(keyOf(s.postings[id])));
  return { ...base, errs: [], warns: r.warns, postings: r.postings, cands: r.cands, fresh, missing };
}

export function logAttempt(s, P, ok, extra = {}) {
  s.meta.lastAttempt = P.started;
  s.syncLog.unshift({ start: P.started, end: now(), ok, file: P.file, how: P.source === "pc" ? "PC 자동" : "업로드", count: P.postings?.length || 0, errors: P.errs?.length || 0, ...extra });
  cap(s.syncLog, 200);
}

export function apply(s, P, linkTo = {}, actor = "HR 관리자") {
  const t = now();
  const byKey = new Map(s.order.map((id) => [keyOf(s.postings[id]), id]));
  const touched = new Set(); let changed = 0;
  for (const p of P.postings) {
    let id = byKey.get(keyOf(p));
    const link = linkTo[keyOf(p)];
    if (!id && link && s.postings[link] && P.missing.includes(link) && ![...touched].includes(link)) {
      id = link; const o = s.postings[id];
      o.history.unshift({ at: t, text: `공고 정보 변경: ${o.hq} / ${o.dept} / ${o.title} → ${p.hq} / ${p.dept} / ${p.title}` });
      o.hq = p.hq; o.dept = p.dept; o.title = p.title; changed++;
    }
    if (!id) {
      id = "P" + String(s.nextId++).padStart(3, "0");
      s.postings[id] = { id, hq: p.hq, dept: p.dept, title: p.title, statuses: p.statuses.slice(), inLastFile: true, createdAt: t, history: [{ at: t, text: "공고 등록" }] };
      s.order.push(id); changed++;
    }
    const o = s.postings[id]; touched.add(id);
    p.statuses.forEach((st, i) => {
      if (o.statuses[i] !== st) { o.history.unshift({ at: t, text: `${STAGES[i]}: ${LABEL[o.statuses[i]]} → ${LABEL[st]}` }); o.statuses[i] = st; changed++; }
    });
    // 마지막 단계까지 처리된 시각 (표시 기간 계산용)
    if (isAllDone(o)) { if (!o.completedAt) o.completedAt = t; } else delete o.completedAt;
    cap(o.history, 100);
  }
  // 파일에서 빠진 공고는 삭제하지 않고 표시만 한다
  s.order.forEach((id) => { s.postings[id].inLastFile = touched.has(id); });
  // 권한 시트는 후보로만 반영. 실제 권한(grants)은 바꾸지 않는다.
  if (P.cands) s.candidates = P.cands;
  Object.assign(s.meta, { lastSuccess: t, fileName: P.file, fileModified: P.mod, fileHash: P.hash, source: P.source });
  if (changed) s.meta.lastChange = t;
  logAttempt(s, P, true, { changed, warn: P.warns.length + (P.missing.length ? 1 : 0), by: actor });
  return changed;
}

// PC 동기화 프로그램이 보낸 파일 처리
export async function syncFromPC(buffer, info) {
  if (!(await lock(LOCK, 60))) return { status: "busy", message: "다른 반영이 진행 중입니다. 다음 주기에 다시 시도합니다." };
  try {
    const s = await loadState();
    // 같은 파일이면 정상 확인 시각만 갱신
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    if (hash === s.meta.fileHash) { s.meta.lastSuccess = now(); s.meta.lastAttempt = s.meta.lastSuccess; await saveState(s); return { status: "unchanged", message: "변경 없음. 정상 확인 시각을 갱신했습니다." }; }
    const P = await prepare(s, buffer, { ...info, source: "pc" });
    if (P.errs.length) { logAttempt(s, P, false); await saveState(s); return { status: "invalid", message: `검증 실패 ${P.errs.length}건. 기존 데이터를 유지합니다.`, errors: P.errs }; }
    // 공고명·조직이 바뀐 것으로 보이면 관리자 확인 전까지 반영하지 않는다 (PRD 5.4)
    if (s.order.length && P.fresh.length && P.missing.length) {
      await savePending(P); logAttempt(s, P, false, { note: "공고 연결 확인 필요" }); await saveState(s);
      return { status: "needs_review", message: "새 공고와 빠진 공고가 함께 있어 관리자 확인을 기다립니다." };
    }
    const changed = apply(s, P, {}, "PC 자동 동기화");
    await saveState(s);
    return { status: "applied", message: `반영 완료. 공고 ${P.postings.length}건, 변경 ${changed}건.` };
  } finally { await del(LOCK); }
}

export async function withLock(fn) {
  if (!(await lock(LOCK, 60))) throw Object.assign(new Error("다른 반영이 진행 중입니다. 잠시 후 다시 시도해 주세요."), { status: 409 });
  try { return await fn(); } finally { await del(LOCK); }
}
