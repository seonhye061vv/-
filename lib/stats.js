// 채용 통계: 공고별 변경 이력에서 단계별 시작·종료 시각을 되살려 소요 일수를 계산한다.
// 이력은 시스템에 처음 등록된 뒤의 변경만 담고 있으므로, 등록 시점에 이미 진행 중이던 단계는 시작일을 알 수 없다.
import { STAGES } from "./parse.js";
import { expired } from "./core.js";

const LABEL_TO = { "완료": "done", "진행 중": "ongoing", "해당사항 없음": "na", "공란": "empty" };
const DAY = 86400000;
const isEnd = (x) => x === "done" || x === "na";
const days = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / DAY);
const round1 = (n) => Math.round(n * 10) / 10;

// 공고 하나의 단계별 구간 [{start, end, knownStart}] (없으면 null)
export function stageSpans(p, now = new Date().toISOString()) {
  // 이력(최신순)을 거꾸로 되돌려 등록 시점 상태를 구한다
  const events = [];
  for (const h of p.history || []) {
    const m = /^(.+?): (.+?) → (.+)$/.exec(h.text || "");
    const i = m ? STAGES.indexOf(m[1]) : -1;
    if (i < 0 || !(m[2] in LABEL_TO) || !(m[3] in LABEL_TO)) continue;
    events.push({ at: h.at, i, from: LABEL_TO[m[2]], to: LABEL_TO[m[3]] });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const state = p.statuses.slice();
  for (let k = events.length - 1; k >= 0; k--) state[events[k].i] = events[k].from;
  const created = p.createdAt || events[0]?.at || now;
  const spans = STAGES.map((_, i) => (state[i] === "ongoing" ? { start: created, end: null, knownStart: false } : null));
  for (const e of events) {
    const sp = spans[e.i];
    if (e.to === "ongoing" && (!sp || sp.end)) spans[e.i] = { start: e.at, end: null, knownStart: true };
    else if (isEnd(e.to) && spans[e.i] && !spans[e.i].end) spans[e.i].end = e.at;
  }
  return spans;
}

export function buildStats(s, now = new Date().toISOString()) {
  const ids = s.order.filter((id) => s.postings[id]);
  const P = ids.map((id) => s.postings[id]);
  const done = P.filter((p) => p.statuses.every(isEnd));
  const stage = STAGES.map((name) => ({ name, durations: [], current: [] }));
  const rows = [];
  for (const p of P) {
    const spans = stageSpans(p, now);
    spans.forEach((sp, i) => {
      if (!sp) return;
      if (sp.end && sp.knownStart) stage[i].durations.push(days(sp.start, sp.end));
      else if (!sp.end && p.statuses[i] === "ongoing") stage[i].current.push(days(sp.start, now));
    });
    rows.push({ id: p.id, hq: p.hq, dept: p.dept, title: p.title, statuses: p.statuses, completedAt: p.completedAt || null, expired: expired(s, p),
      doneN: p.statuses.filter(isEnd).length,
      spans: spans.map((sp) => sp && { start: sp.start, end: sp.end, knownStart: sp.knownStart, days: round1(days(sp.start, sp.end || now)) }) });
  }
  const avg = (a) => (a.length ? round1(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const byOrg = {};
  for (const p of P) {
    const k = p.hq + " / " + p.dept;
    const o = (byOrg[k] ||= { hq: p.hq, dept: p.dept, total: 0, ongoing: 0, done: 0 });
    o.total++; p.statuses.every(isEnd) ? o.done++ : o.ongoing++;
  }
  const byMonth = {};
  for (const p of done) if (p.completedAt) { const m = p.completedAt.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; }
  return {
    at: now,
    total: P.length, ongoing: P.length - done.length, done: done.length,
    progress: P.length ? Math.round((P.reduce((n, p) => n + p.statuses.filter(isEnd).length, 0) / (P.length * STAGES.length)) * 100) : 0,
    since: P.reduce((m, p) => (p.createdAt && (!m || p.createdAt < m) ? p.createdAt : m), null),
    stages: stage.map((x) => ({ name: x.name, avgDays: avg(x.durations), n: x.durations.length, nowN: x.current.length, nowAvg: avg(x.current), nowMax: x.current.length ? round1(Math.max(...x.current)) : null })),
    orgs: Object.values(byOrg).sort((a, b) => b.total - a.total || (a.hq + a.dept).localeCompare(b.hq + b.dept, "ko")),
    months: Object.entries(byMonth).sort().map(([month, n]) => ({ month, n })),
    rows,
  };
}
