// 서버 시나리오 테스트 (PRD 10절). 실행: npm test
import { spawn } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";

const PORT = 3911, B = `http://127.0.0.1:${PORT}`;
const dir = new URL(".", import.meta.url).pathname;
const srv = spawn("node", ["dev-server.mjs"], { cwd: dir + "..", env: { ...process.env, PORT, SYNC_KEY: "test-sync-key-123" }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 800));

const jar = {};
async function call(who, path, opts = {}) {
  const r = await fetch(B + path, { ...opts, headers: { ...(opts.headers || {}), ...(jar[who] ? { cookie: jar[who] } : {}) } });
  const c = r.headers.get("set-cookie"); if (c) jar[who] = c.split(";")[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}
const post = (who, path, data) => call(who, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const upload = (who, file, headers = {}) => call(who, "/api/upload", { method: "POST", headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file), ...headers }, body: fs.readFileSync(dir + file) });
const ok = (name) => console.log("  ✓", name);

try {
  assert.equal((await call("anon", "/api/board")).status, 401); ok("로그인하지 않으면 데이터 없음");
  assert.equal((await post("admin", "/api/login", { id: "admin", password: "x" })).status, 401);
  assert.equal((await post("admin", "/api/login", { id: "admin", password: "admin" })).status, 200); ok("관리자 로그인");

  const bad = await upload("admin", "sample_bad.xlsx");
  assert.ok(bad.body.pending.errs.length >= 2); ok(`잘못된 파일: 오류 ${bad.body.pending.errs.length}건 위치 안내`);
  const good = await upload("admin", "sample_ok.xlsx");
  const pend = good.body.pending;
  assert.equal(pend.errs.length, 0); assert.equal(pend.count, 9);
  assert.deepEqual(pend.ongoing, [3, 2, 0, 0, 0, 3, 0, 1, 0]); ok("공고 9건, 지원서접수3·서류전형2·처우협의3·내부품의진행1");
  assert.equal((await post("admin", "/api/apply", { pendingId: pend.id })).status, 200);
  let A = (await call("admin", "/api/admin")).body;
  assert.equal(A.order.length, 9);
  const audit = A.order.find((id) => A.postings[id].dept === "감사부");
  const risk = A.order.find((id) => A.postings[id].dept === "리스크관리부");
  assert.equal(A.postings[audit].statuses[2], "na"); ok("해당사항 없음 유지");
  const matched = A.order.filter((id) => A.candidates[id].length).length;
  assert.equal(matched, 7); assert.equal(A.candidates[risk].length, 0); ok("권한 후보 매칭 7공고, 확인 필요 2공고");

  // 현업 계정: 승인 전 권한 없음
  const lk = (await post("admin", "/api/admin", { action: "link", code: "H", account: "Kim.Audit@hanafn.com" })).body;
  assert.ok(lk.issued && lk.issued.temp.length >= 10); assert.equal(lk.accounts["kim.audit@hanafn.com"].mustChange, true); ok("이메일 연결 시 임시 비밀번호 자동 발급");
  const li = await post("kim", "/api/login", { id: "kim.audit@hanafn.com", password: lk.issued.temp });
  assert.equal(li.status, 200); assert.equal(li.body.user.mustChange, true);
  assert.equal((await call("kim", "/api/board")).status, 403); ok("첫 로그인 후 비밀번호를 바꾸기 전에는 공고 열람 불가");
  assert.equal((await post("kim", "/api/password", { current: "wrong", next: "pass-1234" })).status, 400);
  assert.equal((await post("kim", "/api/password", { current: lk.issued.temp, next: "short" })).status, 400);
  assert.equal((await post("kim", "/api/password", { current: lk.issued.temp, next: "pass-1234" })).status, 200);
  assert.equal((await call("kim", "/api/me")).body.user.mustChange, false);
  assert.equal((await post("kim2", "/api/login", { id: "kim.audit@hanafn.com", password: lk.issued.temp })).status, 401);
  assert.equal((await post("kim", "/api/login", { id: "kim.audit@hanafn.com", password: "pass-1234" })).status, 200); ok("본인이 정한 비밀번호로 변경, 임시 비밀번호는 더 이상 안 됨");
  assert.equal((await call("kim", "/api/board")).body.postings.length, 0); ok("승인 전에는 공고 0건");
  await post("admin", "/api/admin", { action: "grant", code: "H", id: audit });
  const kb = (await call("kim", "/api/board")).body;
  assert.equal(kb.postings.length, 1); assert.equal(kb.postings[0].id, audit);
  assert.equal(kb.meta.fileName, undefined); assert.equal(kb.postings[0].inLastFile, undefined); ok("현업 A는 허용된 공고 1건만, 관리 정보 없음");
  assert.equal((await call("kim", "/api/board?id=" + risk)).status, 404); ok("다른 공고 ID 직접 요청 차단");
  assert.equal((await call("kim", "/api/admin")).status, 403);
  assert.equal((await upload("kim", "sample_ok.xlsx")).status, 403); ok("열람자는 관리 기능·업로드 불가");

  await post("admin", "/api/admin", { action: "revoke", code: "H", id: audit });
  assert.equal((await call("kim", "/api/board?id=" + audit)).status, 404);
  assert.equal((await call("kim", "/api/board")).body.postings.length, 0); ok("권한 회수 후 다음 요청부터 차단");

  // PC 동기화
  assert.equal((await upload("pc", "sample_ok.xlsx", { "x-sync-key": "wrong" })).status, 401);
  let r = await upload("pc", "sample_ok.xlsx", { "x-sync-key": "test-sync-key-123" });
  assert.equal(r.body.status, "unchanged"); ok("같은 파일 반복: 중복 없이 정상 확인 시각만 갱신");
  r = await upload("pc", "sample_bad.xlsx", { "x-sync-key": "test-sync-key-123" });
  assert.equal(r.body.status, "invalid");
  A = (await call("admin", "/api/admin")).body; assert.equal(A.order.length, 9); ok("PC 동기화 실패 시 기존 데이터 유지");
  r = await upload("pc", "sample_moved.xlsx", { "x-sync-key": "test-sync-key-123", "x-file-modified": new Date().toISOString() });
  assert.equal(r.body.status, "applied");
  A = (await call("admin", "/api/admin")).body;
  assert.equal(A.order.length, 9); assert.equal(A.grants.H.length, 0); ok("행 순서 변경 반영: 공고 중복 없음, 회수 권한 재부여 없음");
  r = await upload("pc", "sample_renamed.xlsx", { "x-sync-key": "test-sync-key-123", "x-file-modified": new Date().toISOString() });
  assert.equal(r.body.status, "needs_review"); ok("공고명 변경: 관리자 확인 대기, 자동 반영 안 함");
  r = await upload("pc", "sample_ok.xlsx", { "x-sync-key": "test-sync-key-123", "x-file-modified": "2020-01-01T00:00:00Z" });
  assert.equal(r.body.status, "invalid"); ok("오래된 파일은 최신 데이터를 덮어쓰지 않음");
  const cfg = await call("pc", "/api/upload", { headers: { "x-sync-key": "test-sync-key-123" } });
  assert.equal(cfg.body.intervalM, 60); ok("PC 프로그램이 확인 주기(기본 1시간)를 받아 감");
  // 권한부여대상자 명단만 올리기
  const pf = (await call("admin", "/api/upload", { method: "POST", headers: { "content-type": "application/octet-stream", "x-kind": "perm", "x-file-name": "perm.xlsx" }, body: fs.readFileSync(dir + "sample_perm.xlsx") })).body.perm;
  assert.equal(pf.errs.length, 0); assert.equal(pf.rows, 3); assert.equal(pf.people, 4); assert.equal(pf.warns.length, 1);
  A = (await call("admin", "/api/admin")).body;
  assert.equal(A.suggest["라마바 상무"], "rama.ba@example.com"); assert.equal(A.suggest["차카타 팀장"], undefined);
  assert.deepEqual(A.candidates[audit].sort(), ["가나다 부장", "라마바 상무"]); assert.equal(A.links.H, "kim.audit@hanafn.com");
  ok("명단 파일만 올리면 후보·추천 이메일만 바뀌고 기존 계정 연결은 유지");
  const np = (await call("admin", "/api/upload", { method: "POST", headers: { "content-type": "application/octet-stream", "x-kind": "perm" }, body: fs.readFileSync(dir + "sample_ok.xlsx") })).body.perm;
  assert.equal(np.errs.length, 0); ok("예전 양식(이름만, C~F열) 권한 시트도 읽음");
  // 완료 공고 표시 기간
  const r1 = await post("admin", "/api/admin", { action: "link", code: "S", account: "not-an-email" });
  assert.equal(r1.status, 400); ok("로그인 계정은 이메일 형식만 허용");
  assert.equal((await post("admin", "/api/admin", { action: "doneDays", days: 30 })).status, 200);
  const { expired } = await import("../lib/core.js");
  const st = { meta: { doneDays: 30 } };
  assert.equal(expired(st, { completedAt: new Date(Date.now() - 31 * 86400000).toISOString() }), true);
  assert.equal(expired(st, { completedAt: new Date(Date.now() - 29 * 86400000).toISOString() }), false);
  assert.equal(expired({ meta: { doneDays: 0 } }, { completedAt: "2000-01-01T00:00:00Z" }), false);
  assert.equal(expired(st, {}), false); ok("완료 공고 표시 기간: 30일 지나면 숨김, 진행 중 공고는 영향 없음");
  console.log("\n모든 시나리오 통과");
} finally { srv.kill(); }
