// 채용현황판 백데이터 엑셀(3개 시트)을 읽고 검증한다. PRD 5·7절 규칙.
import ExcelJS from "exceljs";

export const STAGES = ["지원서접수","서류전형","인적성전형","실무면접","임원면접","처우협의","평판조회","내부품의진행","최종합격발표"];
export const SHEETS = { status: "채용현황", process: "프로세스", perm: "권한부여대상자" };
const EXPECT_COL = ["D","E","F","G","H","I","J","K","L"];

export const colName = (c) => { let s = ""; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

// 셀 값을 문자열로. 병합 셀은 대표 셀 값을 따른다.
function cellText(ws, r, c) {
  const cell = ws.getRow(r + 1).getCell(c + 1);
  let v = cell.value;
  if (v && typeof v === "object") {
    if (v.richText) v = v.richText.map((t) => t.text).join("");
    else if ("result" in v) v = v.result;
    else if (v.text) v = v.text;
    else if (v instanceof Date) v = v.toISOString().slice(0, 10);
  }
  return clean(v);
}

export function normStatus(t) {
  if (t === "") return { k: "empty" };
  const c = t.replace(/\s+/g, "");
  if (c === "완료") return { k: "done" };
  if (c === "진행중") return { k: "ongoing" };
  if (c === "해당사항없음") return { k: "na" };
  return { k: null, raw: t };
}

export async function parseWorkbook(buffer) {
  const errs = [], warns = [];
  const E = (sheet, cell, val, msg, fix) => errs.push({ sheet, cell, val, msg, fix });
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); }
  catch { E("-", "-", "", "엑셀 파일을 열 수 없습니다. 저장이 끝나지 않았거나 .xlsx 형식이 아닐 수 있습니다.", "엑셀에서 저장을 마친 뒤 .xlsx 파일로 다시 올려 주세요."); return { errs, warns }; }
  const ws = {};
  for (const n of Object.values(SHEETS)) { ws[n] = wb.getWorksheet(n); if (!ws[n]) E(n, "-", "", "필수 시트가 없습니다.", `시트 이름을 '${n}'(으)로 맞춰 주세요.`); }
  if (errs.length) return { errs, warns };

  // 프로세스 2행 B~J: 단계 정의
  STAGES.forEach((s, i) => {
    const n = cellText(ws[SHEETS.process], 1, i + 1);
    if (n.replace(/\s/g, "") !== s) E(SHEETS.process, colName(i + 1) + "2", n, `단계 명칭이 '${s}'와 다릅니다.`, "단계 이름과 순서를 원래 양식대로 맞춰 주세요.");
  });

  // 채용현황 2행에서 단계 이름으로 열을 찾는다 (열 순서만으로 읽지 않음)
  const st = ws[SHEETS.status];
  const maxCol = Math.max(st.columnCount, 12);
  const hdr = []; for (let c = 0; c < maxCol; c++) hdr.push(cellText(st, 1, c));
  const cols = STAGES.map((name, i) => {
    const hits = []; hdr.forEach((h, c) => { if (h.replace(/\s/g, "") === name) hits.push(c); });
    if (!hits.length) E(SHEETS.status, "2행", "", `'${name}' 단계 헤더를 찾을 수 없습니다.`, "2행 단계 헤더 이름을 확인해 주세요.");
    else if (hits.length > 1) E(SHEETS.status, hits.map((c) => colName(c) + "2").join(", "), name, `'${name}' 헤더가 두 번 이상 있습니다.`, "중복된 헤더를 하나만 남겨 주세요.");
    else if (colName(hits[0]) !== EXPECT_COL[i]) warns.push(`채용현황: '${name}' 헤더가 ${colName(hits[0])}열에 있습니다 (기본 양식은 ${EXPECT_COL[i]}열). 이름 기준으로 읽었습니다.`);
    return hits[0];
  });
  if (errs.length) return { errs, warns };

  const postings = [], seen = new Map();
  for (let r = 2; r < st.rowCount; r++) {
    const R = r + 1;
    const hq = cellText(st, r, 0), dept = cellText(st, r, 1), title = cellText(st, r, 2);
    const vals = cols.map((c) => cellText(st, r, c));
    if (!hq && !dept && !title && vals.every((v) => !v)) continue;
    if (!hq) E(SHEETS.status, "A" + R, "", "본부가 비어 있습니다.", "A열에 본부를 입력해 주세요.");
    if (!dept) E(SHEETS.status, "B" + R, "", "부서가 비어 있습니다.", "B열에 부서를 입력해 주세요.");
    if (!title) E(SHEETS.status, "C" + R, "", "채용공고명이 비어 있습니다.", "C열에 공고명을 입력해 주세요.");
    const statuses = vals.map((v, i) => {
      const n = normStatus(v);
      if (n.k === null) { E(SHEETS.status, colName(cols[i]) + R, n.raw, `'${STAGES[i]}' 상태값을 알 수 없습니다.`, "완료 / 진행 중 / 해당사항 없음 중 하나로 입력하거나 비워 두세요."); return "empty"; }
      return n.k;
    });
    if (!hq || !dept || !title) continue;
    const k = [hq, dept, title].join("|");
    if (seen.has(k)) { E(SHEETS.status, `A${R}:C${R}`, title, `${seen.get(k)}행과 본부·부서·공고명이 같습니다.`, "공고명을 구분되게 고치거나 중복 행을 지워 주세요."); continue; }
    seen.set(k, R);
    const gap = statuses.indexOf("empty");
    if (gap >= 0 && statuses.slice(gap + 1).some((s) => s === "done" || s === "ongoing")) warns.push(`채용현황 ${R}행 '${title}': 공란 단계 뒤에 완료·진행 중 단계가 있습니다. 원본 그대로 반영합니다.`);
    const fo = statuses.indexOf("ongoing");
    if (fo >= 0 && statuses.slice(fo + 1).includes("done")) warns.push(`채용현황 ${R}행 '${title}': 진행 중 단계 뒤에 완료 단계가 있습니다. 원본 그대로 반영합니다.`);
    postings.push({ hq, dept, title, statuses, row: R });
  }
  if (!postings.length && !errs.length) E(SHEETS.status, "3행~", "", "공고 행이 하나도 없습니다.", "3행부터 공고를 입력해 주세요.");

  // 권한부여대상자: A 본부, B 부서, C~F 대상자 코드 (1행은 병합 헤더)
  const pm = ws[SHEETS.perm], cands = [];
  for (let r = 1; r < pm.rowCount; r++) {
    const hq = cellText(pm, r, 0), dept = cellText(pm, r, 1);
    const codes = [2, 3, 4, 5].map((c) => cellText(pm, r, c)).filter(Boolean);
    if (!hq && !dept && !codes.length) continue;
    if (!hq || !dept) { warns.push(`권한부여대상자 ${r + 1}행: 본부 또는 부서가 비어 있어 권한 후보에서 제외했습니다.`); continue; }
    cands.push({ hq, dept, codes, row: r + 1 });
  }
  return { errs, warns, postings, cands };
}
