(function(){
"use strict";
const STAGES=["지원서접수","서류전형","인적성전형","실무면접","임원면접","처우협의","평판조회","내부품의진행","최종합격발표"];
const SHEETS={status:"채용현황",process:"프로세스",perm:"권한부여대상자"};
// 사용자 확인으로 확정된 소속 정정. 이 두 부서에만 적용.
const ORG_FIX={"재무기획부":"경영기획본부","계약관리부":"손님지원본부"};
const LABEL={done:"완료",ongoing:"진행 중",na:"해당사항 없음",empty:""};
const KEY="recruit-board-v1";
const ADMIN="__admin__";

/* ---------- 예시 데이터: PRD 5.2절의 공고와 현재 단계 ---------- */
function exampleState(){
  const rows=[
    ["손님지원본부","계약관리부","계약관리부 계약보전 경력사원 채용","서류전형"],
    ["경영기획본부","재무기획부","재무기획부 세무담당 경력사원 채용","서류전형"],
    ["CEO 임원","감사부","감사부 내부감사인 경력사원 채용","처우협의"],
    ["계리리스크본부","리스크관리부","리스크관리부 경력사원 채용","내부품의진행"],
    ["영업본부","하이브리드사업부","하이브리드사업부 총무 경력사원 채용","처우협의"],
    ["영업본부","하이브리드사업부","하이브리드사업부 지점장 경력사원 채용","처우협의"],
    ["손님지원본부","계약관리부","계약관리부 콜센터 경력사원 채용","지원서접수"],
    ["경영기획본부","재무기획부","재무기획부 재무관리 경력사원 채용","지원서접수"],
    ["CEO 임원","소비자보호부","소비자보호부 민원담당 경력사원 채용","지원서접수"],
  ];
  const s=blankState(); s.meta.mode="example";
  const now=new Date().toISOString();
  rows.forEach(([hq,dept,title,cur])=>{
    const ci=STAGES.indexOf(cur);
    const st=STAGES.map((_,i)=>i<ci?"done":i===ci?"ongoing":"empty");
    if(dept==="감사부") st[2]="na";
    if(dept==="리스크관리부") st[6]="na";
    addPosting(s,{hq,dept,title,statuses:st},now);
  });
  s.candidates=[
    {hq:"계리리스크본부",dept:"계약관리부",codes:["Y","D"],row:0},
    {hq:"영업지원본부",dept:"재무기획부",codes:["I","D"],row:0},
    {hq:"CEO 임원",dept:"감사부",codes:["H","D"],row:0},
    {hq:"영업본부",dept:"하이브리드사업부",codes:["S","D"],row:0},
    {hq:"CEO 임원",dept:"소비자보호관리책임자",codes:["W","D"],row:0},
  ];
  s.meta.lastSuccess=now; s.meta.lastAttempt=now; s.meta.lastChange=now;
  return s;
}
function blankState(){
  return {postings:{},order:[],nextId:1,candidates:[],links:{},grants:{},audit:[],syncLog:[],
    meta:{mode:"none",lastSuccess:null,lastAttempt:null,lastChange:null,fileName:null,fileModified:null,intervalM:5,storage:""}};
}
function addPosting(s,p,now){
  const id="P"+String(s.nextId++).padStart(3,"0");
  s.postings[id]={id,hq:p.hq,dept:p.dept,title:p.title,statuses:p.statuses.slice(),inLastFile:true,createdAt:now,history:[]};
  s.order.push(id); return id;
}
const keyOf=p=>[p.hq,p.dept,p.title].join("|");

/* ---------- 저장 (이 브라우저에만) ---------- */
let S;
try{const raw=localStorage.getItem(KEY); S=raw?JSON.parse(raw):null;}catch(e){S=null}
if(!S||!S.postings) S=exampleState();
// 확인 주기: 5분 단위 (5~60분). 이전 버전의 시간 단위 설정은 5분으로 바꿈
const INTERVALS=Array.from({length:12},(_,i)=>(i+1)*5);
if(!INTERVALS.includes(S.meta.intervalM)){S.meta.intervalM=5;delete S.meta.intervalH;}
function fmtMin(n){return n<60?n+"분":(n%60?Math.floor(n/60)+"시간 "+n%60+"분":n/60+"시간")}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}

let ui={viewer:ADMIN,tab:"board",q:"",org:"",stage:"",pending:null,busy:false,mode:"admin",account:null,loginErr:""};
function readMode(){
  ui.mode=location.hash==="#viewer"?"viewer":"admin";
  if(ui.mode==="viewer"){let a=null;try{a=sessionStorage.getItem(KEY+"-acc")}catch(e){} ui.account=a&&accounts().includes(a)?a:null; ui.viewer=ui.account||"__none__"; ui.tab="board";}
  else ui.viewer=ADMIN;
}

/* ---------- 상태 해석 ---------- */
function normStatus(v){
  if(v==null) return {k:"empty"};
  const t=String(v).trim();
  if(t==="") return {k:"empty"};
  const c=t.replace(/\s+/g,"");
  if(c==="완료") return {k:"done"};
  if(c==="진행중") return {k:"ongoing"};
  if(c==="해당사항없음") return {k:"na"};
  return {k:null,raw:t};
}
function current(p){
  const on=p.statuses.map((s,i)=>s==="ongoing"?i:-1).filter(i=>i>=0);
  if(on.length) return {type:"stages",idx:on};
  if(p.statuses.every(s=>s==="done"||s==="na")) return {type:"allDone"};
  return {type:"check"};
}
function curLabel(p){const c=current(p);return c.type==="stages"?c.idx.map(i=>STAGES[i]).join(", "):c.type==="allDone"?"전체 단계 처리 완료":"현재 단계 확인 필요"}
function curPills(p){
  const c=current(p);
  if(c.type==="stages") return c.idx.map(i=>`<span class="pill cur">${STAGES[i]}</span>`).join(" ");
  if(c.type==="allDone") return `<span class="pill allok">전체 단계 처리 완료</span>`;
  return `<span class="pill chk">현재 단계 확인 필요</span>`;
}
function stCell(k){return k==="empty"?"":`<span class="pill ${k}">${LABEL[k]}</span>`}

/* ---------- 권한 ---------- */
function normOrg(c){return {hq:ORG_FIX[c.dept]||c.hq,dept:c.dept}}
function candidatesFor(p){
  const set=new Set();
  S.candidates.forEach(c=>{const o=normOrg(c); if(o.hq===p.hq&&o.dept===p.dept) c.codes.forEach(x=>set.add(x));});
  return [...set];
}
function allCodes(){
  const m=new Map();
  S.candidates.forEach(c=>{const o=normOrg(c);c.codes.forEach(x=>{if(!m.has(x))m.set(x,[]);m.get(x).push(o.hq+" / "+o.dept+(o.hq!==c.hq?" (원본: "+c.hq+")":""));});});
  Object.keys(S.grants).forEach(x=>{if(!m.has(x))m.set(x,["(권한 시트에 없음, 직접 추가)"])});
  return m;
}
// 열람자가 볼 수 있는 공고: 계정 연결 + 공고별 승인 둘 다 있어야 함
// viewer = 회사 계정 ID. 그 계정에 연결된 모든 코드의 승인 공고를 합침
function codesOf(acc){return Object.keys(S.links).filter(c=>S.links[c]===acc)}
function accounts(){return [...new Set(Object.values(S.links).filter(Boolean))]}
function visibleIds(viewer){
  if(viewer===ADMIN) return S.order.slice();
  const g=new Set(); codesOf(viewer).forEach(c=>(S.grants[c]||[]).forEach(id=>g.add(id)));
  return S.order.filter(id=>g.has(id));
}
// 열람자 응답에서 제외: 내부 ID, 파일 포함 여부, 권한 정보
function publicView(p){return {id:p.id,hq:p.hq,dept:p.dept,title:p.title,statuses:p.statuses,history:p.history}}
function getPostings(viewer){return visibleIds(viewer).map(id=>viewer===ADMIN?S.postings[id]:publicView(S.postings[id]))}
function getPosting(viewer,id){return visibleIds(viewer).includes(id)?(viewer===ADMIN?S.postings[id]:publicView(S.postings[id])):null}

function audit(postingId,code,change){S.audit.unshift({at:new Date().toISOString(),actor:"HR 관리자",posting:postingId,code,account:S.links[code]||"(미연결)",change});}
function grant(code,id){S.grants[code]=S.grants[code]||[]; if(!S.grants[code].includes(id)){S.grants[code].push(id);audit(id,code,"열람 권한 부여");save();render();}}
function revoke(code,id){S.grants[code]=(S.grants[code]||[]).filter(x=>x!==id);audit(id,code,"열람 권한 회수");save();render();}

/* ---------- 엑셀 읽기·검증 ---------- */
const col=i=>XLSX.utils.encode_col(i);
function cellStr(v){return v==null?"":String(v).replace(/\s+/g," ").trim()}
function parseWorkbook(wb){
  const errs=[],warns=[];
  const E=(sheet,cell,val,msg,fix)=>errs.push({sheet,cell,val,msg,fix});
  for(const n of Object.values(SHEETS)) if(!wb.Sheets[n]) E(n,"-","","필수 시트가 없습니다.",`시트 이름을 '${n}'(으)로 맞춰 주세요.`);
  if(errs.length) return {errs,warns};
  // 시트 범위가 A1에서 시작하지 않아도 실제 행·열 번호 그대로 읽음
  const rows=n=>{const ws=wb.Sheets[n];if(!ws["!ref"])return [];const R=XLSX.utils.decode_range(ws["!ref"]).e;const out=[];
    for(let r=0;r<=R.r;r++){const row=[];for(let c=0;c<=Math.max(R.c,11);c++){const x=ws[XLSX.utils.encode_cell({r,c})];row.push(x?(x.w??x.v):null)}out.push(row)}return out;};

  // 프로세스 2행 B~J 단계 정의
  const pr=rows(SHEETS.process); const pRow=(pr[1]||[]);
  const pNames=[]; for(let c=1;c<=9;c++) pNames.push(cellStr(pRow[c]));
  pNames.forEach((n,i)=>{ if(n.replace(/\s/g,"")!==STAGES[i]) E(SHEETS.process,col(i+1)+"2",n,`단계 명칭이 '${STAGES[i]}'와 다릅니다.`,"단계 이름과 순서를 원래 양식대로 맞춰 주세요."); });

  // 채용현황 2행에서 단계 이름으로 열 찾기
  const sr=rows(SHEETS.status); const hdr=(sr[1]||[]).map(cellStr);
  const stageCol=STAGES.map(name=>{const hits=[];hdr.forEach((h,c)=>{if(h.replace(/\s/g,"")===name)hits.push(c)});return hits;});
  stageCol.forEach((hits,i)=>{
    if(hits.length===0) E(SHEETS.status,"2행","",`'${STAGES[i]}' 단계 헤더를 찾을 수 없습니다.`,"2행 단계 헤더 이름을 확인해 주세요.");
    else if(hits.length>1) E(SHEETS.status,hits.map(c=>col(c)+"2").join(", "),STAGES[i],`'${STAGES[i]}' 헤더가 두 번 이상 있습니다.`,"중복된 헤더를 하나만 남겨 주세요.");
  });
  const cols=stageCol.map(h=>h[0]);
  const expectCol=["D","E","F","G","H","I","J","K","L"];
  cols.forEach((c,i)=>{if(c!=null&&col(c)!==expectCol[i]) warns.push(`채용현황: '${STAGES[i]}' 헤더가 ${col(c)}열에 있습니다 (기본 양식은 ${expectCol[i]}열). 이름 기준으로 읽었습니다.`);});
  if(errs.length) return {errs,warns};

  const postings=[],seen=new Map();
  for(let r=2;r<sr.length;r++){
    const row=sr[r]||[];
    const hq=cellStr(row[0]),dept=cellStr(row[1]),title=cellStr(row[2]);
    const any=row.some(v=>cellStr(v)!=="");
    if(!any) continue;
    const R=r+1;
    if(!hq) E(SHEETS.status,"A"+R,"","본부가 비어 있습니다.","A열에 본부를 입력해 주세요.");
    if(!dept) E(SHEETS.status,"B"+R,"","부서가 비어 있습니다.","B열에 부서를 입력해 주세요.");
    if(!title) E(SHEETS.status,"C"+R,"","채용공고명이 비어 있습니다.","C열에 공고명을 입력해 주세요.");
    const st=cols.map((c,i)=>{const n=normStatus(row[c]); if(n.k===null){E(SHEETS.status,col(c)+R,n.raw,`'${STAGES[i]}' 상태값을 알 수 없습니다.`,"완료 / 진행 중 / 해당사항 없음 중 하나로 입력하거나 비워 두세요.");return "empty";} return n.k;});
    if(!hq||!dept||!title) continue;
    const k=[hq,dept,title].join("|");
    if(seen.has(k)){E(SHEETS.status,"A"+R+":C"+R,title,`${seen.get(k)}행과 본부·부서·공고명이 같습니다.`,"공고명을 구분되게 고치거나 중복 행을 지워 주세요.");continue;}
    seen.set(k,R);
    // 비정상 순서 경고 (수정하지 않음)
    let gap=-1; st.forEach((s,i)=>{if(s==="empty"&&gap<0)gap=i;});
    if(gap>=0&&st.slice(gap+1).some(s=>s==="done"||s==="ongoing")) warns.push(`채용현황 ${R}행 '${title}': 공란 단계 뒤에 완료·진행 중 단계가 있습니다. 원본 그대로 반영합니다.`);
    const fo=st.indexOf("ongoing"); if(fo>=0&&st.slice(fo+1).includes("done")) warns.push(`채용현황 ${R}행 '${title}': 진행 중 단계 뒤에 완료 단계가 있습니다. 원본 그대로 반영합니다.`);
    postings.push({hq,dept,title,statuses:st,row:R});
  }
  if(!postings.length&&!errs.length) E(SHEETS.status,"3행~","","공고 행이 하나도 없습니다.","3행부터 공고를 입력해 주세요.");

  // 권한부여대상자: A 본부, B 부서, C~F 대상자 코드
  const pm=rows(SHEETS.perm),cands=[];
  for(let r=1;r<pm.length;r++){
    const row=pm[r]||[]; const hq=cellStr(row[0]),dept=cellStr(row[1]);
    const codes=[2,3,4,5].map(c=>cellStr(row[c])).filter(Boolean);
    if(!hq&&!dept&&!codes.length) continue;
    if(!hq||!dept){warns.push(`권한부여대상자 ${r+1}행: 본부 또는 부서가 비어 있어 권한 후보에서 제외했습니다.`);continue;}
    cands.push({hq,dept,codes,row:r+1});
  }
  return {errs,warns,postings,cands};
}

async function handleFile(file){
  if(ui.busy) return;
  ui.busy=true; const started=new Date().toISOString();
  S.meta.lastAttempt=started;
  let res;
  try{
    if(S.meta.fileModified&&file.lastModified<S.meta.fileModified){
      res={errs:[{sheet:"-",cell:"-",val:file.name,msg:"마지막으로 반영한 파일보다 오래된 파일입니다.",fix:"가장 최근에 저장한 파일을 올려 주세요."}],warns:[]};
    }else{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:"array"});
      res=parseWorkbook(wb);
    }
  }catch(e){res={errs:[{sheet:"-",cell:"-",val:file.name,msg:"엑셀 파일을 열 수 없습니다. 저장이 끝나지 않았거나 다른 형식일 수 있습니다.",fix:"엑셀에서 저장을 마친 뒤 .xlsx 파일로 다시 올려 주세요."}],warns:[]}}
  ui.busy=false;
  if(res.errs.length){
    S.syncLog.unshift({start:started,end:new Date().toISOString(),ok:false,file:file.name,count:0,errors:res.errs.length,how:"업로드"});
    ui.pending={file:file.name,mod:file.lastModified,started,...res};
    save(); render(); return;
  }
  // 신규·누락 비교
  const byKey=new Map(S.order.map(id=>[keyOf(S.postings[id]),id]));
  const fileKeys=new Set(res.postings.map(keyOf));
  const fresh=res.postings.filter(p=>!byKey.has(keyOf(p)));
  const missing=S.order.filter(id=>!fileKeys.has(keyOf(S.postings[id])));
  ui.pending={file:file.name,mod:file.lastModified,started,...res,fresh,missing,linkTo:{}};
  render();
}

function applyPending(){
  const P=ui.pending; if(!P||P.errs.length||ui.busy) return;
  ui.busy=true;
  const now=new Date().toISOString();
  const byKey=new Map(S.order.map(id=>[keyOf(S.postings[id]),id]));
  const touched=new Set(); let changed=0;
  P.postings.forEach((p,ix)=>{
    let id=byKey.get(keyOf(p));
    const link=P.linkTo[keyOf(p)];
    if(!id&&link){ // 관리자가 기존 공고와 연결 확인
      id=link; const o=S.postings[id];
      o.history.unshift({at:now,text:`공고 정보 변경: ${o.hq} / ${o.dept} / ${o.title} → ${p.hq} / ${p.dept} / ${p.title}`});
      o.hq=p.hq;o.dept=p.dept;o.title=p.title;changed++;
    }
    if(!id){id=addPosting(S,p,now);S.postings[id].history.unshift({at:now,text:"신규 공고 등록 (관리자만 열람)"});changed++;}
    const o=S.postings[id]; touched.add(id);
    p.statuses.forEach((s,i)=>{ if(o.statuses[i]!==s){o.history.unshift({at:now,text:`${STAGES[i]}: ${LABEL[o.statuses[i]]||"공란"} → ${LABEL[s]||"공란"}`});o.statuses[i]=s;changed++;} });
  });
  S.order.forEach(id=>{S.postings[id].inLastFile=touched.has(id)});
  // 권한 시트는 후보로만 반영. 실제 권한(grants)은 건드리지 않음.
  S.candidates=P.cands;
  if(S.meta.mode==="example"){ /* 예시 데이터를 실제 파일로 교체 */
    const keep=new Set(touched); S.order=S.order.filter(id=>keep.has(id));
    Object.keys(S.postings).forEach(id=>{if(!keep.has(id))delete S.postings[id]});
    S.grants={};S.links={};S.audit=[];
  }
  S.meta.mode="upload";S.meta.lastSuccess=now;S.meta.fileName=P.file;S.meta.fileModified=P.mod;
  if(changed) S.meta.lastChange=now;
  S.syncLog.unshift({start:P.started,end:now,ok:true,file:P.file,count:P.postings.length,errors:0,warn:P.warns.length+((P.missing||[]).length?1:0),changed,how:"업로드"});
  ui.pending=null;ui.busy=false;save();ui.tab="board";render();
}

/* ---------- 화면 ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function fmt(iso){if(!iso)return "-";const d=new Date(iso);const p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`}
function ago(iso){if(!iso)return "";const m=Math.round((Date.now()-new Date(iso))/60000);if(m<1)return "방금";if(m<60)return m+"분 전";const h=Math.floor(m/60);if(h<48)return h+"시간 전";return Math.floor(h/24)+"일 전"}

function renderViewer(){
  const w=$("#who");
  if(ui.mode==="viewer"){
    w.innerHTML=ui.account?`<span class="small"><b>${esc(ui.account)}</b> 님</span><button class="btn sm" id="logout">로그아웃</button>`:"";
    return;
  }
  if(ui.viewer!==ADMIN&&!accounts().includes(ui.viewer)) ui.viewer=ADMIN;
  w.innerHTML=`<label for="viewer" class="small muted">미리보기</label><select id="viewer"><option value="${ADMIN}">HR 관리자</option>${accounts().map(a=>`<option value="${esc(a)}" ${a===ui.viewer?"selected":""}>현업 · ${esc(a)} (코드 ${codesOf(a).map(esc).join(", ")})</option>`).join("")}</select><a class="btn sm" href="#viewer" style="text-decoration:none">현업 화면 열기</a>`;
}
function renderLogin(){
  return `<div class="box" style="max-width:420px;margin:24px auto;width:100%">
    <h2>현업 담당자 로그인</h2>
    <p class="small muted">로그인하면 본인에게 열람 권한이 부여된 공고만 볼 수 있습니다.</p>
    <form id="loginForm" class="panel" style="gap:10px">
      <label for="accId" class="small">회사 계정 ID</label>
      <input type="text" id="accId" autocomplete="username" placeholder="예: kim.audit">
      ${ui.loginErr?`<div class="msg e small">${esc(ui.loginErr)}</div>`:""}
      <button class="btn primary" type="submit">로그인</button>
    </form>
    <p class="small muted">데모 로그인입니다. HR 관리자가 '열람 권한' 탭에서 대상자 코드와 연결한 계정 ID로 들어올 수 있습니다. 실제 운영에서는 사내 로그인으로 바뀝니다.</p>
    <a class="small" href="#" style="color:var(--accent)">HR 관리자 화면으로</a>
  </div>`;
}
function renderFresh(){
  const m=S.meta; const el=$("#fresh");
  if(!m.lastSuccess){el.innerHTML=`<span class="muted">아직 반영된 데이터가 없습니다.</span>`;return}
  const hrs=(Date.now()-new Date(m.lastSuccess))/36e5;
  let state;
  if(m.mode==="example") state=`<span><span class="dot" style="background:var(--warn)"></span><b>예시 데이터</b></span>`;
  else if(m.mode==="upload") state=hrs*60>m.intervalM*2
    ?`<span><span class="dot" style="background:var(--warn)"></span><b>최신성 확인 필요</b> <span class="muted">· ${fmtMin(m.intervalM*2)} 넘게 새 반영 없음</span></span>`
    :`<span><span class="dot" style="background:var(--accent)"></span><b>최신 상태</b></span>`;
  el.innerHTML=`<span>마지막 정상 반영 <b>${fmt(m.lastSuccess)}</b> <span class="muted">(${ago(m.lastSuccess)})</span></span>${state}`+
    (ui.viewer===ADMIN?`<span class="muted">반영 방식: 엑셀 업로드${m.fileName?" · "+esc(m.fileName):""}</span>`:"");
}
function renderBanners(){
  const b=[];
  if(S.meta.mode==="example") b.push(`<div class="banner ex"><span><b>예시 화면입니다.</b> PRD에 적힌 공고 9건과 현재 단계를 바탕으로 만든 예시이며, 앞 단계 '완료'와 뒤 단계 공란은 예시로 채운 값입니다. ${ui.viewer===ADMIN?"<b>엑셀 반영</b> 탭에서 실제 백데이터 엑셀을 올리면 그 내용으로 바뀝니다.":""}</span></div>`);
  if(ui.mode==="admin"&&ui.viewer!==ADMIN) b.push(`<div class="banner info"><span>${esc(ui.viewer)} 님이 보는 화면을 미리 보는 중입니다. 권한을 받은 공고만 보입니다.</span></div>`);
  if(ui.mode==="viewer"&&!ui.account&&S.meta.mode==="example") b.length=0;
  $("#banners").innerHTML=b.join("");
}
function renderTabs(){
  if(ui.mode==="viewer"){$("#tabs").innerHTML="";ui.tab="board";return}
  const t=ui.viewer===ADMIN?[["board","현황판"],["upload","엑셀 반영"],["perm","열람 권한"],["log","반영 기록"],["guide","구축 안내"]]:[["board","현황판"]];
  if(!t.find(x=>x[0]===ui.tab)) ui.tab="board";
  $("#tabs").innerHTML=t.map(([k,l])=>`<button role="tab" data-tab="${k}" aria-selected="${ui.tab===k}">${l}</button>`).join("");
}

function renderBoard(){
  const all=getPostings(ui.viewer);
  if(!all.length) return `<div class="empty">${ui.viewer===ADMIN?"등록된 공고가 없습니다. 엑셀 반영 탭에서 파일을 올려 주세요.":"열람 가능한 공고가 없습니다."}</div>`;
  // 필터 선택지도 허용된 공고 기준
  const orgs=[...new Set(all.map(p=>p.hq+" / "+p.dept))];
  const q=ui.q.trim();
  const list=all.filter(p=>(!q||p.title.includes(q))&&(!ui.org||p.hq+" / "+p.dept===ui.org)&&(!ui.stage||curLabel(p).split(", ").includes(ui.stage)));
  const counts=STAGES.map((_,i)=>all.filter(p=>p.statuses[i]==="ongoing").length);
  const allDone=all.filter(p=>current(p).type==="allDone").length, chk=all.filter(p=>current(p).type==="check").length;
  const multi=all.filter(p=>p.statuses.filter(s=>s==="ongoing").length>1).length;
  const max=Math.max(1,...counts);
  const stageOpts=[...STAGES,"전체 단계 처리 완료","현재 단계 확인 필요"];
  return `
  <section class="sum" aria-label="요약">
    <div class="kpi"><span class="small muted">${ui.viewer===ADMIN?"전체 공고":"열람 가능한 공고"}</span><span class="n">${all.length}</span><span class="small muted">건</span></div>
    <div class="sum-side">
      <span class="small muted">현재 단계별 공고 수</span>
      <div class="stagebar">${STAGES.map((s,i)=>`<div class="sb" title="${s} ${counts[i]}건"><span class="c ${counts[i]?"":"zero"}">${counts[i]}</span><div class="col"><div class="fill" style="height:${counts[i]/max*100}%"></div></div><span class="i">${i+1}</span><span class="l">${s}</span></div>`).join("")}</div>
      <span class="sum-note">${allDone?`전체 단계 처리 완료 ${allDone}건 · `:""}${chk?`현재 단계 확인 필요 ${chk}건 · `:""}${multi?`<b>${multi}건이 여러 단계를 동시에 진행 중이라 단계별 합계가 공고 수보다 클 수 있습니다.</b>`:"한 공고가 여러 단계를 동시에 진행하면 단계별 합계가 공고 수보다 클 수 있습니다."}</span>
    </div>
  </section>
  <div class="filters">
    <input type="search" id="q" placeholder="공고명 검색" value="${esc(ui.q)}" aria-label="공고명 검색">
    <select id="fOrg" aria-label="본부·부서"><option value="">본부·부서 전체</option>${orgs.map(o=>`<option ${o===ui.org?"selected":""}>${esc(o)}</option>`).join("")}</select>
    <select id="fStage" aria-label="현재 단계"><option value="">현재 단계 전체</option>${stageOpts.map(o=>`<option ${o===ui.stage?"selected":""}>${o}</option>`).join("")}</select>
    <span class="small muted">${list.length}건</span>
  </div>
  ${list.length?`
  <div class="tbl-main">
    <div class="tbl-wrap"><table>
      <thead><tr><th>본부</th><th>부서</th><th>공고명</th><th>현재 단계</th>${STAGES.map((s,i)=>`<th class="stg"><span class="i">${i+1}</span>${s}</th>`).join("")}</tr></thead>
      <tbody>${list.map(p=>`<tr class="row" data-id="${p.id}" tabindex="0"><td class="org">${esc(p.hq)}</td><td class="org">${esc(p.dept)}</td><td class="title">${esc(p.title)}${ui.viewer===ADMIN&&!S.postings[p.id].inLastFile?'<span class="tag">최근 파일에 없음</span>':""}</td><td>${curPills(p)}</td>${p.statuses.map(s=>`<td class="st">${stCell(s)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
  </div>
  <div class="cards">${list.map(p=>`<button class="card" data-id="${p.id}"><span class="small muted">${esc(p.hq)} · ${esc(p.dept)}</span><span class="t">${esc(p.title)}</span><span>${curPills(p)}</span><div class="track" aria-hidden="true">${p.statuses.map(s=>`<span class="s-${s}"></span>`).join("")}</div></button>`).join("")}</div>
  <p class="note">※ 공란은 아직 해당 단계에 도달하지 않은 상태를 의미합니다.</p>`
  :`<div class="empty">조건에 맞는 공고가 없습니다.</div>`}`;
}

function openDetail(id){
  const p=getPosting(ui.viewer,id);
  if(!p){$("#dlg").open&&$("#dlg").close();return}
  const admin=ui.viewer===ADMIN, full=S.postings[id];
  $("#dlgBody").innerHTML=`
    <div class="dlg-h"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="small muted">${esc(p.hq)} · ${esc(p.dept)}</span><h2>${esc(p.title)}</h2></div><button class="btn sm" id="dlgClose">닫기</button></div>
    <dl class="kv">
      <dt>본부</dt><dd>${esc(p.hq)}</dd><dt>부서</dt><dd>${esc(p.dept)}</dd>
      <dt>현재 단계</dt><dd>${curPills(p)}</dd>
      <dt>마지막 반영</dt><dd>${fmt(S.meta.lastSuccess)}</dd>
      ${admin?`<dt>내부 ID</dt><dd class="mono">${p.id}</dd><dt>최근 파일</dt><dd>${full.inLastFile?"포함":"<span class='tag' style='margin:0'>최근 파일에 없음 · 자동 삭제하지 않음</span>"}</dd>`:""}
    </dl>
    <div class="tbl-wrap"><table class="steps"><thead><tr><th>#</th><th>단계</th><th>상태</th></tr></thead>
    <tbody>${STAGES.map((s,i)=>`<tr class="${p.statuses[i]==="ongoing"?"on":""}"><td class="mono">${i+1}</td><td>${s}</td><td>${stCell(p.statuses[i])}</td></tr>`).join("")}</tbody></table></div>
    <p class="note" style="margin:0">※ 공란은 아직 해당 단계에 도달하지 않은 상태를 의미합니다.</p>
    <div style="display:flex;flex-direction:column;gap:6px"><h3>상태 변경 이력</h3>
    ${p.history.length?`<ul class="small" style="margin:0;padding-left:18px">${p.history.slice(0,30).map(h=>`<li><span class="muted">${fmt(h.at)}</span> ${esc(h.text)}</li>`).join("")}</ul>`:`<p class="small muted">반영 이후 바뀐 상태가 없습니다.</p>`}</div>`;
  $("#dlg").dataset.id=id;
  if(!$("#dlg").open) $("#dlg").showModal();
}

function renderUpload(){
  const P=ui.pending, m=S.meta;
  let res="";
  if(P){
    if(P.errs.length){
      res=`<div class="box"><h3>검증 실패 · 반영하지 않았습니다</h3><p class="small muted">${esc(P.file)} · 기존 데이터는 그대로 유지됩니다. 아래 위치를 고친 뒤 다시 올려 주세요.</p>
      <div class="tbl-wrap"><table><thead><tr><th>시트</th><th>셀</th><th>원본 값</th><th>문제</th><th>수정 방법</th></tr></thead><tbody>
      ${P.errs.map(e=>`<tr><td>${esc(e.sheet)}</td><td class="mono">${esc(e.cell)}</td><td>${esc(e.val)}</td><td>${esc(e.msg)}</td><td>${esc(e.fix)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row-flex"><button class="btn" id="pCancel">닫기</button></div></div>`;
    }else{
      const cnt=STAGES.map((_,i)=>P.postings.filter(p=>p.statuses[i]==="ongoing").length);
      const missingOpts=(P.missing||[]).map(id=>S.postings[id]);
      res=`<div class="box"><h3>검증 통과 · 반영 전 확인</h3>
      <p class="small">${esc(P.file)} · 공고 <b>${P.postings.length}</b>건 · 권한 후보 조직 ${P.cands.length}개</p>
      <p class="small muted">진행 중 단계: ${STAGES.map((s,i)=>cnt[i]?`${s} ${cnt[i]}`:"").filter(Boolean).join(" · ")||"없음"}</p>
      ${S.meta.mode!=="example"&&P.fresh.length?`<div class="msgs"><b class="small">새로 보이는 공고 ${P.fresh.length}건</b>${P.fresh.map(p=>`<div class="msg w row-flex"><span style="flex:1 1 260px">${esc(p.hq)} / ${esc(p.dept)} / ${esc(p.title)}</span>
        <select data-link="${esc(keyOf(p))}" aria-label="연결"><option value="">새 공고로 등록 (관리자만 열람)</option>${missingOpts.map(o=>`<option value="${o.id}" ${P.linkTo[keyOf(p)]===o.id?"selected":""}>기존 공고와 연결: ${esc(o.title)}</option>`).join("")}</select></div>`).join("")}</div>`:""}
      ${S.meta.mode!=="example"&&P.missing.length?`<div class="msgs"><b class="small">이번 파일에 없는 공고 ${P.missing.length}건 · 삭제하지 않고 '최근 파일에 없음'으로 표시합니다</b>${P.missing.map(id=>`<div class="msg w">${esc(S.postings[id].title)}</div>`).join("")}</div>`:""}
      ${S.meta.mode==="example"?`<div class="msg w small">반영하면 예시 데이터는 지워지고 이 파일의 공고로 바뀝니다.</div>`:""}
      ${P.warns.length?`<div class="msgs"><b class="small">경고 ${P.warns.length}건 (반영은 가능)</b>${P.warns.map(w=>`<div class="msg w">${esc(w)}</div>`).join("")}</div>`:""}
      <p class="small muted">권한 시트 내용은 '후보'로만 반영됩니다. 이미 부여·회수한 권한은 바뀌지 않습니다.</p>
      <div class="row-flex"><button class="btn primary" id="pApply">한 번에 반영하기</button><button class="btn" id="pCancel">취소</button></div></div>`;
    }
  }
  return `<div class="panel">
    <div class="box">
      <h2>엑셀 업로드</h2>
      <p class="small muted">'채용현황', '프로세스', '권한부여대상자' 3개 시트가 있는 원래 양식 그대로 올려 주세요. 원본 파일은 수정하지 않으며, 파일 내용은 이 브라우저 안에서만 읽습니다.</p>
      <label class="drop" id="drop" for="file"><b>여기에 엑셀 파일을 끌어 놓거나 눌러서 선택</b><span class="small muted">.xlsx</span></label>
      <input type="file" id="file" accept=".xlsx,.xlsm,.xls" hidden>
    </div>
    ${res}
    <div class="box">
      <h2>자동 동기화</h2>
      <div class="row-flex"><label for="interval" class="small">확인 주기</label>
        <select id="interval">${INTERVALS.map(n=>`<option value="${n}" ${n==m.intervalM?"selected":""}>${fmtMin(n)}</option>`).join("")}</select>
        <span class="small muted">5분 단위로 고를 수 있습니다. ${fmtMin(m.intervalM*2)} 넘게 정상 반영이 없으면 화면 상단에 최신성 경고를 띄웁니다.</span></div>
      <div class="row-flex"><span class="small">연동 저장소</span><span class="pill chk">미정 · 연결 안 됨</span><button class="btn sm" disabled>지금 동기화</button></div>
      <p class="small muted">자동 동기화는 브라우저를 닫아도 돌아가는 서버가 있어야 합니다. 엑셀 저장 위치(공유폴더, SharePoint/OneDrive 등)와 운영 서버가 정해지면 연결합니다. 지금은 업로드로만 반영됩니다.</p>
    </div></div>`;
}

function renderPerm(){
  const codes=allCodes();
  return `<div class="panel">
    <div class="banner info"><span>권한은 엑셀에서 자동으로 주지 않습니다. ① 대상자 코드를 실제 회사 계정과 연결하고 ② 공고별로 승인해야 현업이 볼 수 있습니다. 재무기획부는 경영기획본부, 계약관리부는 손님지원본부 소속으로 맞춰 후보를 찾습니다.</span></div>
    <div class="grid2">
    <div class="box"><h2>공고별 열람 권한</h2>
      ${S.order.map(id=>{const p=S.postings[id];const cands=candidatesFor(p);const granted=Object.keys(S.grants).filter(c=>(S.grants[c]||[]).includes(id));const show=[...new Set([...cands,...granted])];
        return `<div style="display:flex;flex-direction:column;gap:6px;padding-bottom:10px;border-bottom:1px solid var(--line)">
        <div><b>${esc(p.title)}</b> <span class="small muted">${esc(p.hq)} / ${esc(p.dept)}</span></div>
        ${cands.length?"":`<span class="small" style="color:var(--warn)">관리자 확인 필요: 권한 시트에 같은 본부·부서 기록이 없습니다.</span>`}
        <div class="codes">${show.map(c=>{const g=granted.includes(c);return `<span class="code ${g?"granted":""}"><span class="mono">${esc(c)}</span><span class="small muted">${S.links[c]?esc(S.links[c]):"계정 미연결"}</span>${g?`<span class="small">승인됨</span><button class="btn sm" data-revoke="${esc(c)}" data-id="${id}">회수</button>`:`<span class="small muted">후보</span><button class="btn sm" data-grant="${esc(c)}" data-id="${id}">승인</button>`}</span>`}).join("")}
          <span class="row-flex"><input type="text" placeholder="코드" aria-label="코드 직접 추가" style="width:70px" id="add-${id}"><button class="btn sm" data-add="${id}">직접 부여</button></span></div></div>`}).join("")}
    </div>
    <div class="panel">
      <div class="box"><h2>대상자 코드 · 계정 연결</h2>
        <p class="small muted">코드는 로그인 정보가 아닙니다. 실제 회사 계정 ID를 입력해 연결하세요. 연결 전에는 승인해도 권한이 적용되지 않습니다. 여러 조직에 나오는 코드도 관리자 권한으로 보지 않습니다.</p>
        <div class="tbl-wrap"><table><thead><tr><th>코드</th><th>권한 시트 조직</th><th>회사 계정</th></tr></thead><tbody>
        ${[...codes].map(([c,orgs])=>`<tr><td class="mono">${esc(c)}</td><td class="small">${orgs.map(esc).join("<br>")}</td><td><span class="row-flex"><input type="text" id="lk-${esc(c)}" value="${esc(S.links[c]||"")}" placeholder="계정 ID" style="width:120px"><button class="btn sm" data-link-code="${esc(c)}">${S.links[c]?"변경":"연결"}</button></span></td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="box"><h2>권한 변경 이력</h2>
        ${S.audit.length?`<div class="tbl-wrap"><table><thead><tr><th>시각</th><th>실행자</th><th>공고</th><th>대상</th><th>변경</th></tr></thead><tbody>${S.audit.slice(0,50).map(a=>`<tr><td class="small">${fmt(a.at)}</td><td class="small">${esc(a.actor)}</td><td class="small">${esc(S.postings[a.posting]?.title||a.posting||"-")}</td><td class="small">${esc(a.code)} · ${esc(a.account)}</td><td class="small">${esc(a.change)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="small muted">아직 기록이 없습니다.</p>`}
      </div>
    </div></div></div>`;
}

function renderLog(){
  const m=S.meta;
  return `<div class="panel"><div class="box"><h2>반영 기록</h2>
    <dl class="kv"><dt>마지막 시도</dt><dd>${fmt(m.lastAttempt)}</dd><dt>마지막 정상 반영</dt><dd>${fmt(m.lastSuccess)}</dd><dt>마지막 데이터 변경</dt><dd>${fmt(m.lastChange)}</dd></dl>
    ${S.syncLog.length?`<div class="tbl-wrap"><table><thead><tr><th>시작</th><th>완료</th><th>방식</th><th>결과</th><th>반영 공고</th><th>변경 항목</th><th>오류</th><th>파일</th></tr></thead><tbody>
    ${S.syncLog.slice(0,50).map(l=>`<tr><td class="small">${fmt(l.start)}</td><td class="small">${fmt(l.end)}</td><td class="small">${l.how}</td><td>${l.ok?'<span class="pill done">성공</span>':'<span class="pill chk">실패</span>'}</td><td>${l.count}</td><td>${l.changed??"-"}</td><td>${l.errors}</td><td class="small">${esc(l.file)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="small muted">아직 업로드 기록이 없습니다. 지금 보이는 데이터는 예시입니다.</p>`}
  </div></div>`;
}

function renderGuide(){
  const S2=(t,c)=>`<span class="s pill ${c}">${t}</span>`;
  return `<div class="panel"><div class="box"><h2>구현 순서와 현재 범위</h2>
  <p class="small muted">이 페이지는 PRD의 화면과 엑셀 규칙을 먼저 확인하기 위한 미리보기(MVP 1단계)입니다. 데이터와 권한 설정은 지금 보고 있는 브라우저에만 저장됩니다.</p>
  <ol class="plan small">
    <li>데이터 구조·화면·권한 구조 정리 ${S2("완료","done")}</li>
    <li>실제 엑셀 3개 시트 읽기, 메인·상세 화면 ${S2("이 페이지에서 확인 가능","done")}</li>
    <li>로그인, 코드-계정 연결, 공고별 권한 승인 ${S2("화면만 구현 · 서버 검사 필요","chk")}</li>
    <li>엑셀 업로드·검증·한 번에 반영 ${S2("이 페이지에서 확인 가능","done")}</li>
    <li>저장소 연결과 서버 스케줄러로 자동 동기화 ${S2("서버 필요","chk")}</li>
    <li>권한 차단·반영·실패 복구 시나리오 검증 ${S2("서버 구축 후","chk")}</li>
    <li>실행 방법·관리자 사용법·운영 설정 전달 ${S2("서버 구축 후","chk")}</li>
  </ol>
  <p class="small"><b>주의:</b> 지금 열람자 미리보기는 화면에서 가려 보여 주는 방식입니다. PRD 기준의 실제 권한 차단(주소·ID 직접 입력 차단, 로그인 필수)은 사내 서버에서 구현해야 완료로 볼 수 있습니다.</p>
  </div>
  <div class="box"><h2>연동 전에 정해야 할 것</h2>
  <ul class="small" style="margin:0;padding-left:18px">
    <li>엑셀 저장 위치 (사내 공유폴더, SharePoint/OneDrive 등)</li><li>대상자 코드와 실제 회사 계정 연결</li>
    <li>리스크관리부·소비자보호부 공고의 실제 열람 대상자</li><li>프로세스 시트 3행 '해당사항없음'의 업무상 의미</li>
    <li>사내 로그인 연동 가능 여부, 설치할 서버와 사내 네트워크</li><li>운영 자동 갱신 주기, 회사 데이터 저장·처리 기준</li>
  </ul></div></div>`;
}

function render(){
  renderViewer();renderBanners();
  const v=$("#view");
  if(ui.mode==="viewer"&&!ui.account){$("#fresh").innerHTML="";$("#tabs").innerHTML="";v.innerHTML=renderLogin();if($("#dlg").open)$("#dlg").close();return}
  renderFresh();renderTabs();
  v.innerHTML=ui.tab==="upload"?renderUpload():ui.tab==="perm"?renderPerm():ui.tab==="log"?renderLog():ui.tab==="guide"?renderGuide():renderBoard();
  // 권한이 회수되면 열린 상세도 즉시 닫음
  if($("#dlg").open){const id=$("#dlg").dataset.id; if(!getPosting(ui.viewer,id)) $("#dlg").close(); else openDetail(id);}
}

/* ---------- 이벤트 ---------- */
document.addEventListener("click",e=>{
  const t=e.target.closest("button,tr.row");
  if(!t) return;
  if(t.dataset.tab){ui.tab=t.dataset.tab;render();return}
  if(t.dataset.id&&(t.matches("tr.row")||t.classList.contains("card"))){openDetail(t.dataset.id);return}
  if(t.id==="dlgClose"){$("#dlg").close();return}
  if(t.dataset.grant){grant(t.dataset.grant,t.dataset.id);return}
  if(t.dataset.revoke){revoke(t.dataset.revoke,t.dataset.id);return}
  if(t.dataset.add){const inp=$("#add-"+t.dataset.add);const c=inp.value.trim();if(c)grant(c,t.dataset.add);return}
  if(t.dataset.linkCode!==undefined){const c=t.dataset.linkCode;const inp=document.getElementById("lk-"+c);const v=inp.value.trim();const before=S.links[c]||"";if(v!==before){S.links[c]=v;audit(null,c,v?`계정 연결: ${before||"없음"} → ${v}`:"계정 연결 해제");if(!v)delete S.links[c];save();render();}return}
  if(t.id==="logout"){try{sessionStorage.removeItem(KEY+"-acc")}catch(e){} ui.account=null;ui.viewer="__none__";ui.q="";ui.org="";ui.stage="";render();return}
  if(t.id==="pApply"){applyPending();return}
  if(t.id==="pCancel"){ui.pending=null;render();return}
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("tr.row"))openDetail(e.target.dataset.id)});
document.addEventListener("input",e=>{
  if(e.target.id==="q"){ui.q=e.target.value;const pos=e.target.selectionStart;render();const q=$("#q");if(q){q.focus();q.setSelectionRange(pos,pos)}}
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="viewer"){ui.viewer=t.value;ui.q="";ui.org="";ui.stage="";render();return}
  if(t.id==="fOrg"){ui.org=t.value;render();return}
  if(t.id==="fStage"){ui.stage=t.value;render();return}
  if(t.id==="interval"){S.meta.intervalM=parseInt(t.value,10);save();render();return}
  if(t.id==="file"&&t.files[0]){handleFile(t.files[0]);t.value="";return}
  if(t.dataset.link!==undefined&&ui.pending){
    const used=Object.entries(ui.pending.linkTo).find(([k,v])=>v===t.value&&k!==t.dataset.link);
    if(used&&t.value){t.value="";return}
    ui.pending.linkTo[t.dataset.link]=t.value||undefined;render();
  }
});
["dragover","dragenter"].forEach(ev=>document.addEventListener(ev,e=>{const d=e.target.closest&&e.target.closest("#drop");if(d){e.preventDefault();d.classList.add("over")}}));
document.addEventListener("dragleave",e=>{const d=e.target.closest&&e.target.closest("#drop");if(d)d.classList.remove("over")});
document.addEventListener("drop",e=>{const d=e.target.closest&&e.target.closest("#drop");if(d){e.preventDefault();d.classList.remove("over");const f=e.dataTransfer.files[0];if(f)handleFile(f)}});
document.addEventListener("submit",e=>{
  if(e.target.id!=="loginForm")return; e.preventDefault();
  const v=$("#accId").value.trim();
  if(!v){ui.loginErr="계정 ID를 입력해 주세요.";render();return}
  if(!accounts().includes(v)){ui.loginErr="등록되지 않은 계정입니다. HR 담당자에게 열람 권한을 요청해 주세요.";render();return}
  ui.loginErr="";ui.account=v;ui.viewer=v;try{sessionStorage.setItem(KEY+"-acc",v)}catch(e){}
  render();
});
window.addEventListener("hashchange",()=>{readMode();ui.q="";ui.org="";ui.stage="";render()});
// 다른 탭에서 관리자가 권한을 바꾸면 현업 화면에 바로 반영 (회수 시 화면 데이터 제거)
window.addEventListener("storage",e=>{if(e.key!==KEY)return;try{const n=JSON.parse(e.newValue);if(n&&n.postings)S=n}catch(_){} if(ui.mode==="viewer"&&ui.account&&!accounts().includes(ui.account)){ui.account=null;ui.viewer="__none__"} render()});
setInterval(()=>{if(ui.mode==="admin"||ui.account)renderFresh()},60000);
readMode();
render();
})();
