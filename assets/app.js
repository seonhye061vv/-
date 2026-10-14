(function(){
"use strict";
const STAGES=["지원서접수","서류전형","인적성전형","실무면접","임원면접","처우협의","평판조회","내부품의진행","최종합격발표"];
const LABEL={done:"완료",ongoing:"진행 중",na:"해당사항 없음",empty:""};
const INTERVALS=Array.from({length:12},(_,i)=>(i+1)*5);
const REPO="https://github.com/seonhye061vv/-";

let me=null;        // {id, role}
let B=null;         // 현황판 데이터 {meta, postings[]}
let A=null;         // 관리자 전체 데이터
let ui={tab:"board",q:"",org:"",stage:"",pending:null,linkTo:{},busy:false,loginErr:"",notice:"",error:"",issued:null,pwForm:false,pwErr:""};
const isAdmin=()=>me&&me.role==="admin";
// 관리자 화면으로 보는 중인지 (현업 화면 미리보기 탭이면 현업과 똑같이 보여 준다)
const adminView=()=>isAdmin()&&ui.tab!=="preview";

/* ---------- 서버 호출 ---------- */
async function api(path,opts={}){
  const r=await fetch(path,{credentials:"same-origin",...opts});
  let body=null; try{body=await r.json()}catch(e){}
  if(r.status===401&&path!=="/api/login"){me=null;B=null;A=null;render();throw new Error((body&&body.error)||"로그인이 필요합니다.")}
  if(!r.ok) throw new Error((body&&body.error)||"요청을 처리하지 못했습니다.");
  return body;
}
const post=(path,data)=>api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});

async function load(){
  if(isAdmin()){
    A=await api("/api/admin");
    B={meta:A.meta,postings:A.order.map(id=>A.postings[id])};
    if(A.pending&&(!ui.pending||ui.pending.id!==A.pending.id)){ui.pending=A.pending;ui.linkTo={}}
    if(!A.pending&&ui.pending&&!ui.pending.errs.length) ui.pending=null;
    if(ui.tab==="preview"){
      const accs=pvAccounts();
      if(!accs.includes(ui.pvAs)) ui.pvAs=accs[0]||"";
      ui.pv=ui.pvAs?await api("/api/board?name="+encodeURIComponent(ui.pvAs)):null;
    }
  }else{
    if(me.mustChange){B=null;return}
    B=await api("/api/board");
  }
}
async function refresh(){try{await load();ui.error=""}catch(e){ui.error=e.message} render()}
async function act(fn){
  if(ui.busy) return; ui.busy=true; ui.error=""; ui.notice="";
  try{await fn()}catch(e){ui.error=e.message}
  ui.busy=false; render();
}

/* ---------- 상태 해석 ---------- */
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
const stCell=k=>k==="empty"?"":`<span class="pill ${k}">${LABEL[k]}</span>`;

/* ---------- 공통 ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function fmt(iso){if(!iso)return "-";const d=new Date(iso);const p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`}
function ago(iso){if(!iso)return "";const m=Math.round((Date.now()-new Date(iso))/60000);if(m<1)return "방금";if(m<60)return m+"분 전";const h=Math.floor(m/60);if(h<48)return h+"시간 전";return Math.floor(h/24)+"일 전"}
const fmtMin=n=>n<60?n+"분":(n%60?Math.floor(n/60)+"시간 "+n%60+"분":n/60+"시간");

function renderWho(){
  $("#who").innerHTML=me?`<span class="avatar" aria-hidden="true">${esc((isAdmin()?"HR":me.id).slice(0,2).toUpperCase())}</span><span class="small"><b>${isAdmin()?"HR 관리자":esc(me.id)+" 님"}</b></span>${!isAdmin()&&!me.mustChange?`<button class="btn sm" id="pwOpen">비밀번호 변경</button>`:""}<button class="btn sm" id="logout">로그아웃</button>`:"";
}
function renderFresh(){
  const el=$("#fresh");
  if(!me||!B){el.innerHTML="";return}
  const m=B.meta;
  if(!m.lastSuccess){el.innerHTML=`<span class="muted">아직 반영된 데이터가 없습니다.</span>`;return}
  const mins=(Date.now()-new Date(m.lastSuccess))/60000;
  const stale=mins>m.intervalM*2;
  el.innerHTML=`<span>마지막 정상 반영 <b>${fmt(m.lastSuccess)}</b> <span class="muted">(${ago(m.lastSuccess)})</span></span>`+
    (stale?`<span><span class="dot" style="background:var(--warn)"></span><b>최신성 확인 필요</b> <span class="muted">· ${fmtMin(m.intervalM*2)} 넘게 새 반영 없음</span></span>`
          :`<span><span class="dot" style="background:var(--accent)"></span><b>최신 상태</b></span>`)+
    (adminView()&&m.fileName?`<span class="muted">${m.source==="pc"?"PC 자동 동기화":"엑셀 업로드"} · ${esc(m.fileName)}</span>`:"");
}
function renderSideCard(){
  const el=$("#sideCard");
  el.innerHTML=!me?`<b>채용 진행 현황을 한눈에</b><span>HR이 등록한 이메일로 로그인하면 열람 권한을 받은 공고를 볼 수 있어요.</span>`
    :isAdmin()?`<b>엑셀만 저장하세요</b><span>PC 자동 동기화가 켜져 있으면 지정한 폴더의 엑셀이 현황판에 바로 반영돼요.</span>`
    :`<b>공고가 안 보이나요?</b><span>열람 권한이 필요하면 HR 담당자에게 문의해 주세요.</span>`;
}
function renderBanners(){
  const b=[];
  if(ui.error) b.push(`<div class="banner err"><span>${esc(ui.error)}</span></div>`);
  if(ui.notice) b.push(`<div class="banner info"><span>${esc(ui.notice)}</span></div>`);
  if(isAdmin()&&A&&A.pending&&!A.pending.errs.length&&ui.tab!=="upload") b.push(`<div class="banner ex"><span><b>반영 대기 중인 파일이 있습니다.</b> ${A.pending.source==="pc"?"PC 자동 동기화에서 공고명·조직이 바뀐 것으로 보여 확인을 기다립니다. ":""}<b>엑셀 반영</b> 탭에서 확인해 주세요.</span></div>`);
  $("#banners").innerHTML=b.join("");
}
// 사이드바 메뉴 아이콘 (선 아이콘)
const ICON={board:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',upload:'<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',perm:'<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11l2 2 4-4"/>',sync:'<path d="M20 12a8 8 0 0 1-14 5M4 12a8 8 0 0 1 14-5M18 3v4h-4M6 21v-4h4"/>',log:'<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',preview:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'};
const TABS=[["board","현황판"],["upload","엑셀 반영"],["perm","열람 권한"],["sync","PC 자동 동기화"],["log","반영 기록"],["preview","현업 화면 보기"]];
function renderTabs(){
  if(!isAdmin()) ui.tab="board";
  const t=isAdmin()?TABS:TABS.slice(0,1);
  $("#tabs").innerHTML=t.map(([k,l])=>`<button role="tab" data-tab="${k}" aria-selected="${ui.tab===k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${l}</button>`).join("");
  $("#pageTitle").textContent=(TABS.find(x=>x[0]===ui.tab)||TABS[0])[1];
}

function renderLogin(){
  const bars=[38,62,48,80,56,92,44,70,52];
  return `<div class="landing">
    <section class="hero">
      <span class="eyebrow">채용현황판</span>
      <h2>우리 부서 채용, 지금 어느 단계인지 바로 확인하세요</h2>
      <p class="muted">지원서 접수부터 최종 합격 발표까지 9단계를 HR 엑셀과 같은 기준으로 보여 드려요. 열람 권한을 받은 공고만 보입니다.</p>
      <div class="hero-chart" aria-hidden="true">${bars.map((h,i)=>`<i style="height:${h}%;--i:${i}"${i===5?' class="peak"':""}></i>`).join("")}<span class="tip">처우협의 진행 중</span></div>
      <ul class="feats"><li><b>9</b>단계 진행 현황</li><li><b>1시간</b>마다 자동 반영</li><li><b>공고별</b> 열람 권한</li></ul>
    </section>
    <div class="box login">
      <h2>로그인</h2>
      <p class="small muted">HR 담당자가 등록한 이메일과 비밀번호로 로그인하세요.</p>
      <form id="loginForm" class="panel" style="gap:10px">
        <label for="accId" class="small">로그인 이메일 (관리자는 admin)</label>
        <input type="text" id="accId" autocomplete="username" inputmode="email" required value="${esc(ui.loginId||"")}">
        <label for="accPw" class="small">비밀번호</label>
        <input type="password" id="accPw" autocomplete="current-password" required>
        ${ui.loginErr?`<div class="msg e small">${esc(ui.loginErr)}</div>`:""}
        <button class="btn primary" type="submit" ${ui.busy?"disabled":""}>로그인</button>
      </form>
      <p class="small muted">처음 로그인하면 임시 비밀번호를 본인 비밀번호로 바꾸는 화면이 나와요.</p>
    </div>
  </div>`;
}
function renderPwChange(){
  const first=me.mustChange;
  const f=(id,l,ac)=>`<label for="${id}" class="small">${l}</label><input type="password" id="${id}" autocomplete="${ac}" required minlength="${id==="pwCur"?1:8}" style="border:1px solid var(--line);background:var(--bg);border-radius:6px;padding:6px 10px">`;
  return `<div class="box" style="max-width:420px;margin:24px auto;width:100%">
    <h2>${first?"비밀번호를 새로 정해 주세요":"비밀번호 변경"}</h2>
    <p class="small muted">${first?"처음 로그인하셨습니다. HR 담당자에게 받은 임시 비밀번호를 본인만 아는 비밀번호로 바꾼 뒤 현황판을 볼 수 있습니다.":"지금 비밀번호와 새 비밀번호를 입력해 주세요."} 새 비밀번호는 8자 이상입니다.</p>
    <form id="pwForm" class="panel" style="gap:10px">
      ${f("pwCur",first?"임시 비밀번호":"지금 비밀번호","current-password")}
      ${f("pwNew","새 비밀번호","new-password")}
      ${f("pwNew2","새 비밀번호 확인","new-password")}
      ${ui.pwErr?`<div class="msg e small">${esc(ui.pwErr)}</div>`:""}
      <div class="row-flex"><button class="btn primary" type="submit" ${ui.busy?"disabled":""}>변경</button>${first?"":`<button class="btn" type="button" id="pwCancel">취소</button>`}</div>
    </form>
  </div>`;
}

/* ---------- 현황판 ---------- */
function renderBoard(D=B){
  const every=D?D.postings:[];
  const hiddenN=every.filter(p=>p.expired).length;
  const all=adminView()&&!ui.showExpired?every.filter(p=>!p.expired):every;
  if(!every.length) return `<div class="empty">${adminView()?"등록된 공고가 없습니다. 엑셀 반영 탭에서 파일을 올리거나 PC 자동 동기화를 연결해 주세요.":"열람 가능한 공고가 없습니다."}</div>`;
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
    <div class="kpi"><span class="small muted">${adminView()?"전체 공고":"열람 가능한 공고"}</span><span class="n">${all.length}</span><span class="small muted">건</span></div>
    <div class="sum-side">
      <span class="small muted">현재 단계별 공고 수</span>
      <div class="stagebar">${STAGES.map((s,i)=>`<div class="sb${counts[i]&&counts[i]===max?" peak":""}" title="${s} ${counts[i]}건"><span class="c ${counts[i]?"":"zero"}">${counts[i]}</span><div class="col"><div class="fill" style="height:${Math.max(counts[i]/max*100,counts[i]?8:0)}%;--i:${i}"></div></div><span class="i">${i+1}</span><span class="l">${s}</span></div>`).join("")}</div>
      <span class="sum-note">${allDone?`전체 단계 처리 완료 ${allDone}건 · `:""}${chk?`현재 단계 확인 필요 ${chk}건 · `:""}${multi?`<b>${multi}건이 여러 단계를 동시에 진행 중이라 단계별 합계가 공고 수보다 클 수 있습니다.</b>`:"한 공고가 여러 단계를 동시에 진행하면 단계별 합계가 공고 수보다 클 수 있습니다."}</span>
    </div>
  </section>
  <div class="filters">
    <input type="search" id="q" placeholder="공고명 검색" value="${esc(ui.q)}" aria-label="공고명 검색">
    <select id="fOrg" aria-label="본부·부서"><option value="">본부·부서 전체</option>${orgs.map(o=>`<option ${o===ui.org?"selected":""}>${esc(o)}</option>`).join("")}</select>
    <select id="fStage" aria-label="현재 단계"><option value="">현재 단계 전체</option>${stageOpts.map(o=>`<option ${o===ui.stage?"selected":""}>${o}</option>`).join("")}</select>
    <span class="small muted">${list.length}건</span>
  </div>
  ${adminView()?`<div class="row-flex small"><label for="doneDays" class="muted">완료 공고 표시</label>
    <select id="doneDays">${(A.doneDaysOptions||[0,7,14,30,60,90]).map(d=>`<option value="${d}" ${d==(B.meta.doneDays??7)?"selected":""}>${d?`완료 후 ${d}일까지`:"계속 표시"}</option>`).join("")}</select>
    <span class="muted">모든 단계가 완료·해당사항 없음이 된 공고에 적용됩니다. 기간이 지나면 현업 화면에서 사라지고, 관리자는 아래에서 다시 볼 수 있습니다.</span>
    ${hiddenN?`<label class="row-flex"><input type="checkbox" id="showExpired" ${ui.showExpired?"checked":""}> 기간 지난 완료 공고 ${hiddenN}건 보기</label>`:""}</div>`:""}
  ${list.length?`
  <div class="tbl-main">
    <div class="tbl-wrap"><table>
      <thead><tr><th>본부</th><th>부서</th><th>공고명</th><th>현재 단계</th>${STAGES.map((s,i)=>`<th class="stg"><span class="i">${i+1}</span>${s}</th>`).join("")}</tr></thead>
      <tbody>${list.map(p=>`<tr class="row" data-id="${p.id}" tabindex="0"><td class="org">${esc(p.hq)}</td><td class="org">${esc(p.dept)}</td><td class="title">${esc(p.title)}${isAdmin()&&p.inLastFile===false?'<span class="tag">최근 파일에 없음</span>':""}${isAdmin()&&p.expired?'<span class="tag">표시 기간 지남</span>':""}</td><td>${curPills(p)}</td>${p.statuses.map(s=>`<td class="st">${stCell(s)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
  </div>
  <div class="cards">${list.map(p=>`<button class="card" data-id="${p.id}"><span class="small muted">${esc(p.hq)} · ${esc(p.dept)}</span><span class="t">${esc(p.title)}</span><span>${curPills(p)}</span><div class="track" aria-hidden="true">${p.statuses.map(s=>`<span class="s-${s}"></span>`).join("")}</div></button>`).join("")}</div>
  <p class="note">※ 공란은 아직 해당 단계에 도달하지 않은 상태를 의미합니다.</p>`
  :`<div class="empty">조건에 맞는 공고가 없습니다.</div>`}`;
}

async function openDetail(id){
  let p;
  try{p=(await api("/api/board?id="+encodeURIComponent(id)+(isAdmin()&&ui.tab==="preview"&&ui.pvAs?"&name="+encodeURIComponent(ui.pvAs):""))).posting}catch(e){if($("#dlg").open)$("#dlg").close();ui.error=e.message;await refresh();return}
  $("#dlgBody").innerHTML=`
    <div class="dlg-h"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="small muted">${esc(p.hq)} · ${esc(p.dept)}</span><h2>${esc(p.title)}</h2></div><button class="btn sm" id="dlgClose">닫기</button></div>
    <dl class="kv">
      <dt>본부</dt><dd>${esc(p.hq)}</dd><dt>부서</dt><dd>${esc(p.dept)}</dd>
      <dt>현재 단계</dt><dd>${curPills(p)}</dd>
      <dt>마지막 반영</dt><dd>${fmt((ui.tab==="preview"&&ui.pv?ui.pv:B).meta.lastSuccess)}</dd>
      ${adminView()?`<dt>내부 ID</dt><dd class="mono">${p.id}</dd><dt>최근 파일</dt><dd>${p.inLastFile!==false?"포함":"<span class='tag' style='margin:0'>최근 파일에 없음 · 자동 삭제하지 않음</span>"}</dd>`:""}
    </dl>
    <div class="tbl-wrap"><table class="steps"><thead><tr><th>#</th><th>단계</th><th>상태</th></tr></thead>
    <tbody>${STAGES.map((s,i)=>`<tr class="${p.statuses[i]==="ongoing"?"on":""}"><td class="mono">${i+1}</td><td>${s}</td><td>${stCell(p.statuses[i])}</td></tr>`).join("")}</tbody></table></div>
    <p class="note" style="margin:0">※ 공란은 아직 해당 단계에 도달하지 않은 상태를 의미합니다.</p>
    <div style="display:flex;flex-direction:column;gap:6px"><h3>상태 변경 이력</h3>
    ${p.history.length?`<ul class="small" style="margin:0;padding-left:18px">${p.history.slice(0,30).map(h=>`<li><span class="muted">${fmt(h.at)}</span> ${esc(h.text)}</li>`).join("")}</ul>`:`<p class="small muted">기록이 없습니다.</p>`}</div>`;
  $("#dlg").dataset.id=id;
  if(!$("#dlg").open) $("#dlg").showModal();
}

/* ---------- 관리자: 엑셀 반영 ---------- */
function renderUpload(){
  const P=ui.pending;
  let res="";
  if(P){
    if(P.errs.length){
      res=`<div class="box"><h3>검증 실패 · 반영하지 않았습니다</h3><p class="small muted">${esc(P.file)} · 기존 데이터는 그대로 유지됩니다. 아래 위치를 고친 뒤 다시 올려 주세요.</p>
      <div class="tbl-wrap"><table><thead><tr><th>시트</th><th>셀</th><th>원본 값</th><th>문제</th><th>수정 방법</th></tr></thead><tbody>
      ${P.errs.map(e=>`<tr><td>${esc(e.sheet)}</td><td class="mono">${esc(e.cell)}</td><td>${esc(e.val)}</td><td>${esc(e.msg)}</td><td>${esc(e.fix)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row-flex"><button class="btn" id="pClose">닫기</button></div></div>`;
    }else{
      const firstImport=!A.order.length;
      res=`<div class="box"><h3>검증 통과 · 반영 전 확인</h3>
      <p class="small">${esc(P.file)} ${P.source==="pc"?"(PC 자동 동기화)":""} · 공고 <b>${P.count}</b>건 · 권한 후보 조직 ${P.cands}개</p>
      <p class="small muted">진행 중 단계: ${STAGES.map((s,i)=>P.ongoing[i]?`${s} ${P.ongoing[i]}`:"").filter(Boolean).join(" · ")||"없음"}</p>
      ${!firstImport&&P.fresh.length?`<div class="msgs"><b class="small">새로 보이는 공고 ${P.fresh.length}건</b>${P.fresh.map(f=>`<div class="msg w row-flex"><span style="flex:1 1 260px">${esc(f.hq)} / ${esc(f.dept)} / ${esc(f.title)}</span>
        <select data-link="${esc(f.key)}" aria-label="연결"><option value="">새 공고로 등록 (관리자만 열람)</option>${P.missing.map(id=>A.postings[id]).filter(Boolean).map(o=>`<option value="${o.id}" ${ui.linkTo[f.key]===o.id?"selected":""}>기존 공고와 연결: ${esc(o.title)}</option>`).join("")}</select></div>`).join("")}</div>`:""}
      ${!firstImport&&P.missing.length?`<div class="msgs"><b class="small">이번 파일에 없는 공고 ${P.missing.length}건 · 삭제하지 않고 '최근 파일에 없음'으로 표시합니다</b>${P.missing.map(id=>`<div class="msg w">${esc(A.postings[id]?.title||id)}</div>`).join("")}</div>`:""}
      ${P.warns.length?`<div class="msgs"><b class="small">경고 ${P.warns.length}건 (반영은 가능)</b>${P.warns.map(w=>`<div class="msg w">${esc(w)}</div>`).join("")}</div>`:""}
      <p class="small muted">권한 시트 내용은 '후보'로만 반영됩니다. 이미 부여·회수한 권한은 바뀌지 않습니다. 기존 공고와 연결해야 그 공고의 권한이 이어집니다.</p>
      <div class="row-flex"><button class="btn primary" id="pApply" ${ui.busy?"disabled":""}>한 번에 반영하기</button><button class="btn" id="pDiscard">반영하지 않기</button></div></div>`;
    }
  }
  return `<div class="panel">
    <div class="box">
      <h2>엑셀 직접 올리기</h2>
      <p class="small muted">PC가 꺼져 있을 때 등 직접 반영할 때 씁니다. '채용현황', '프로세스', '권한부여대상자' 3개 시트가 있는 원래 양식 그대로 올려 주세요. 원본 파일은 수정하지 않습니다.</p>
      <label class="drop" id="drop" for="file"><b>${ui.busy?"확인하는 중…":"여기에 엑셀 파일을 끌어 놓거나 눌러서 선택"}</b><span class="small muted">.xlsx</span></label>
      <input type="file" id="file" accept=".xlsx" hidden>
    </div>
    ${res}</div>`;
}
async function handleFile(file){
  await act(async()=>{
    const r=await api("/api/upload",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name),"X-File-Modified":new Date(file.lastModified).toISOString()},body:file});
    ui.pending=r.pending; ui.linkTo={};
    await load();
  });
}

/* ---------- 관리자: 현업 화면 보기 ---------- */
// 권한부여대상자 전체 (계정 연결 전이라도 승인된 공고 기준으로 미리 볼 수 있다)
const pvAccounts=()=>Object.keys(A.codes||{}).sort((a,b)=>a.localeCompare(b,"ko"));
function renderPreview(){
  const accs=pvAccounts();
  if(!accs.length) return `<div class="empty">권한부여대상자가 없습니다. '열람 권한' 탭에서 명단을 올리면 여기서 대상자별 화면을 볼 수 있습니다.</div>`;
  const n=(A.grants[ui.pvAs]||[]).length;
  return `<div class="panel">
    <div class="banner info" style="align-items:center"><span><b>현업 화면 미리보기</b> · 선택한 사람이 로그인했을 때 보는 화면 그대로입니다. 여기서는 보기만 할 수 있습니다.</span>
      <select id="pvAs" aria-label="미리 볼 대상자" style="margin-left:auto">${accs.map(a=>`<option value="${esc(a)}" ${a===ui.pvAs?"selected":""}>${esc(a)} · ${A.links[a]?esc(A.links[a]):"계정 미연결"} · 승인 ${(A.grants[a]||[]).length}건</option>`).join("")}</select></div>
    ${!A.links[ui.pvAs]?`<div class="banner ex"><span>${esc(ui.pvAs)} 님은 아직 로그인 이메일이 연결되지 않아 실제로는 로그인할 수 없습니다. 아래는 연결 후 보게 될 화면입니다.</span></div>`:""}
    ${!n?`<div class="small muted">${esc(ui.pvAs)} 님에게 승인된 공고가 없어 빈 화면으로 보입니다. '열람 권한' 탭에서 공고별로 승인하면 여기에 나타납니다.</div>`:""}
    ${ui.pv?renderBoard(ui.pv):`<div class="empty">불러오는 중…</div>`}
  </div>`;
}

/* ---------- 관리자: 열람 권한 ---------- */
// 대상자 = 권한부여대상자 시트 C~F열에 적힌 이름
const people=()=>Object.keys(A.codes).sort((a,b)=>a.localeCompare(b,"ko"));
const personLabel=c=>A.links[c]?`${c} (${A.links[c]})`:`${c} · 계정 미연결`;
function renderPerm(){
  const ppl=people();
  return `<div class="panel">
    <div class="banner info"><span>권한은 엑셀에서 자동으로 주지 않습니다. ① 오른쪽에서 대상자마다 로그인 이메일을 연결하고 ② 공고마다 대상자를 골라 승인해야 현업이 볼 수 있습니다. 재무기획부는 경영기획본부, 계약관리부는 손님지원본부 소속으로 맞춰 후보를 찾습니다.</span></div>
    <div class="grid2">
    <div class="box"><h2>공고별 열람 권한</h2>
      ${A.order.length?A.order.map(id=>{const p=A.postings[id];const cands=A.candidates[id]||[];const granted=Object.keys(A.grants).filter(c=>(A.grants[c]||[]).includes(id));
        const candLeft=cands.filter(c=>!granted.includes(c)), others=ppl.filter(c=>!cands.includes(c)&&!granted.includes(c));
        return `<div style="display:flex;flex-direction:column;gap:6px;padding-bottom:10px;border-bottom:1px solid var(--line)">
        <div><b>${esc(p.title)}</b> <span class="small muted">${esc(p.hq)} / ${esc(p.dept)}</span></div>
        ${cands.length?`<span class="small muted">후보(같은 본부·부서): ${cands.map(esc).join(", ")}</span>`:`<span class="small" style="color:var(--warn)">관리자 확인 필요: 권한 시트에 같은 본부·부서 기록이 없습니다.</span>`}
        <div class="codes">${granted.map(c=>`<span class="code granted"><b>${esc(c)}</b><span class="small muted">${A.links[c]?esc(A.links[c]):"계정 미연결"}</span><span class="small">승인됨</span><button class="btn sm" data-revoke="${esc(c)}" data-id="${id}">회수</button></span>`).join("")}</div>
        <div class="row-flex"><select id="sel-${id}" aria-label="열람 대상자 선택" style="flex:1 1 200px">
          <option value="">대상자 선택</option>
          ${candLeft.length?`<optgroup label="후보">${candLeft.map(c=>`<option value="${esc(c)}">${esc(personLabel(c))}</option>`).join("")}</optgroup>`:""}
          ${others.length?`<optgroup label="그 외 대상자">${others.map(c=>`<option value="${esc(c)}">${esc(personLabel(c))}</option>`).join("")}</optgroup>`:""}
        </select><button class="btn sm primary" data-add="${id}">승인</button></div></div>`}).join(""):`<p class="small muted">공고가 없습니다.</p>`}
    </div>
    <div class="panel">
      <div class="box"><h2>권한부여대상자 명단 올리기</h2>
        <p class="small muted">본부 · 부서 · 권한부여대상자1 · 이메일주소 · 권한부여대상자2 · 이메일주소 … 순서의 엑셀을 올리면 공고별 후보와 대상자 목록이 이 명단으로 바뀝니다. 이미 연결한 계정과 승인한 권한은 그대로 남습니다.</p>
        <label class="btn sm" style="align-self:flex-start">명단 파일 선택<input type="file" id="permFile" accept=".xlsx" hidden></label>
        ${ui.permResult?(ui.permResult.errs.length?`<div class="msg e small">${ui.permResult.errs.map(e=>esc(e.msg+" "+e.fix)).join("<br>")}</div>`:`<div class="msg small">명단을 반영했습니다. ${ui.permResult.rows}개 부서, 대상자 ${ui.permResult.people}명.</div>`)+(ui.permResult.warns.length?`<div class="small" style="color:var(--warn)">${ui.permResult.warns.map(esc).join("<br>")}</div>`:""):""}
      </div>
      <div class="box"><h2>대상자 · 로그인 계정</h2>
        <p class="small muted">대상자마다 로그인 이메일을 입력해 연결하면 임시 비밀번호가 자동으로 만들어집니다. 임시 비밀번호는 한 번만 보여 주니 바로 본인에게 전달하세요. 본인은 처음 로그인할 때 비밀번호를 새로 정합니다. 연결 전에는 승인해도 볼 수 없습니다.</p>
        ${ui.issued?`<div class="banner ex"><span><b>${esc(ui.issued.name)} 님 임시 비밀번호</b> · ${esc(ui.issued.account)} · <code id="tempPw" style="font-size:15px;user-select:all">${esc(ui.issued.temp)}</code> <button class="btn sm" id="copyTemp">복사</button> <button class="btn sm" id="hideTemp">닫기</button><br><span class="small">이 화면을 닫으면 다시 볼 수 없습니다. 잊으면 '임시 비밀번호 재발급'을 누르세요.</span></span></div>`:""}
        <div class="tbl-wrap"><table><thead><tr><th>대상자</th><th>권한 시트 조직</th><th>로그인 이메일</th><th>상태</th></tr></thead><tbody>
        ${ppl.map((c,i)=>{const acc=A.links[c]||"";const sug=(A.suggest||{})[c]||"";const st=acc&&A.accounts&&A.accounts[acc];return `<tr><td style="white-space:nowrap"><b>${esc(c)}</b></td><td class="small">${A.codes[c].map(esc).join("<br>")}</td><td><div class="row-flex">
          <input type="email" id="lk-${i}" value="${esc(acc||sug)}" title="${acc?"":sug?"명단의 이메일입니다. 연결을 눌러야 계정이 만들어집니다.":""}" placeholder="name@hanafn.com" style="width:100%;min-width:230px;border:1px solid var(--line);background:var(--bg);border-radius:6px;padding:6px 10px" autocomplete="off">
          <button class="btn sm" data-link-i="${i}">${acc?"저장":"연결"}</button>${acc?`<button class="btn sm" data-unlink-i="${i}">해제</button>`:""}</div></td>
          <td class="small" style="white-space:nowrap">${!acc?`<span class="muted">미연결</span>`:`${st&&st.mustChange?`<span class="pill chk">첫 로그인 전</span>`:`<span class="pill done">사용 중</span>`} <button class="btn sm" data-reissue-i="${i}">임시 비밀번호 재발급</button>`}</td></tr>`}).join("")||`<tr><td colspan="4" class="small muted">엑셀을 반영하면 권한부여대상자 시트의 이름이 여기에 나옵니다.</td></tr>`}
        </tbody></table></div></div>
      <div class="box"><h2>권한 변경 이력</h2>
        ${A.audit.length?`<div class="tbl-wrap"><table><thead><tr><th>시각</th><th>실행자</th><th>공고</th><th>대상자</th><th>변경</th></tr></thead><tbody>${A.audit.slice(0,50).map(a=>`<tr><td class="small">${fmt(a.at)}</td><td class="small">${esc(a.actor)}</td><td class="small">${esc(a.title||"-")}</td><td class="small">${esc(a.code)} · ${esc(a.account)}</td><td class="small">${esc(a.change)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="small muted">아직 기록이 없습니다.</p>`}
      </div>
    </div></div></div>`;
}

/* ---------- 관리자: PC 자동 동기화 ---------- */
function renderSync(){
  const m=A.meta;
  const lastPC=A.syncLog.find(l=>l.how==="PC 자동");
  return `<div class="panel">
    <div class="box"><h2>PC 자동 동기화</h2>
      <dl class="kv">
        <dt>서버 준비</dt><dd>${A.syncConfigured?'<span class="pill done">동기화 키 설정됨</span>':'<span class="pill chk">동기화 키(SYNC_KEY) 미설정</span>'}</dd>
        <dt>마지막 정상 확인</dt><dd>${fmt(m.lastSuccess)} <span class="muted small">${ago(m.lastSuccess)}</span></dd>
        <dt>마지막 데이터 변경</dt><dd>${fmt(m.lastChange)}</dd>
        <dt>최근 PC 기록</dt><dd>${lastPC?`${fmt(lastPC.end)} · ${lastPC.ok?"성공":"실패"}${lastPC.note?" · "+esc(lastPC.note):""}`:"아직 없음"}</dd>
      </dl>
      <div class="row-flex"><label for="interval" class="small">확인 주기</label>
        <select id="interval">${INTERVALS.map(n=>`<option value="${n}" ${n==m.intervalM?"selected":""}>${fmtMin(n)}</option>`).join("")}</select>
        <span class="small muted">PC 프로그램이 이 주기마다 폴더의 엑셀을 확인합니다. ${fmtMin(m.intervalM*2)} 넘게 정상 확인이 없으면 최신성 경고를 띄웁니다.</span></div>
    </div>
    <div class="box"><h2>윈도우 PC에 연결하기</h2>
      <ol class="plan small">
        <li><a href="${REPO}/archive/refs/heads/main.zip" target="_blank" rel="noopener" style="color:var(--accent)">프로그램 내려받기(zip)</a>를 받아 압축을 풀고, 안의 <b>agent</b> 폴더를 <span class="mono">C:\\RecruitBoard\\agent</span>처럼 한글 없는 경로에 둡니다.</li>
        <li><b>설치.bat</b>을 더블클릭하고 엑셀 폴더, 현황판 주소, 동기화 키를 입력합니다.</li>
        <li>그 뒤로는 폴더의 엑셀을 저장하기만 하면 됩니다. PC가 켜져 있는 동안 위에서 정한 주기(기본 1시간)마다 확인합니다.</li>
      </ol>
      <p class="small muted">PC가 꺼져 있으면 그동안은 반영되지 않습니다. 그럴 때는 '엑셀 반영' 탭에서 직접 올려 주세요. 공고명이나 조직이 바뀐 파일은 자동 반영하지 않고 이 화면에서 확인을 기다립니다.</p>
    </div></div>`;
}

function renderLog(){
  const m=A.meta;
  return `<div class="panel"><div class="box"><h2>반영 기록</h2>
    <dl class="kv"><dt>마지막 시도</dt><dd>${fmt(m.lastAttempt)}</dd><dt>마지막 정상 반영</dt><dd>${fmt(m.lastSuccess)}</dd><dt>마지막 데이터 변경</dt><dd>${fmt(m.lastChange)}</dd></dl>
    <p class="small muted">PC 자동 동기화에서 파일이 바뀌지 않은 확인은 기록하지 않고 '마지막 정상 반영' 시각만 갱신합니다.</p>
    ${A.syncLog.length?`<div class="tbl-wrap"><table><thead><tr><th>시작</th><th>완료</th><th>방식</th><th>결과</th><th>반영 공고</th><th>변경 항목</th><th>오류</th><th>파일</th></tr></thead><tbody>
    ${A.syncLog.map(l=>`<tr><td class="small">${fmt(l.start)}</td><td class="small">${fmt(l.end)}</td><td class="small">${esc(l.how)}</td><td>${l.ok?'<span class="pill done">성공</span>':`<span class="pill chk">${l.note?esc(l.note):"실패"}</span>`}</td><td>${l.count}</td><td>${l.changed??"-"}</td><td>${l.errors}</td><td class="small">${esc(l.file)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="small muted">아직 기록이 없습니다.</p>`}
  </div></div>`;
}

function render(){
  draw();
  // 화면(로그인·탭)이 바뀔 때만 등장 모션을 준다. 자동 새로고침 때는 다시 재생하지 않는다.
  const key=!me?"login":!isAdmin()&&(me.mustChange||ui.pwForm)?"pw":!B?"loading":(isAdmin()?ui.tab:"board")+(ui.tab==="preview"?":"+(ui.pvAs||""):"");
  if(key===lastView) return;
  lastView=key;const v=$("#view");v.classList.remove("enter");void v.offsetWidth;v.classList.add("enter");
  if(!reduceMotion) v.querySelectorAll(".kpi .n").forEach(countUp);
}
let lastView=null;
const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
function countUp(el){
  const n=+el.textContent;if(!(n>1))return;const t0=performance.now(),d=700;
  const step=t=>{const k=Math.min(1,(t-t0)/d);el.textContent=Math.round(n*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(step);else el.classList.add("done")};requestAnimationFrame(step);
}
function draw(){
  renderWho();renderBanners();renderSideCard();
  const v=$("#view");$("#pageTitle").textContent="채용현황판";$("#pageTitle").hidden=!me;
  if(!me){$("#fresh").innerHTML="";$("#tabs").innerHTML="";v.innerHTML=renderLogin();if($("#dlg").open)$("#dlg").close();return}
  if(!isAdmin()&&(me.mustChange||ui.pwForm)){$("#fresh").innerHTML="";$("#tabs").innerHTML="";v.innerHTML=renderPwChange();return}
  renderFresh();renderTabs();
  if(!B){v.innerHTML=`<div class="empty">불러오는 중…</div>`;return}
  v.innerHTML=!isAdmin()||ui.tab==="board"?renderBoard():ui.tab==="upload"?renderUpload():ui.tab==="perm"?renderPerm():ui.tab==="preview"?renderPreview():ui.tab==="sync"?renderSync():renderLog();
  // 권한이 회수된 공고의 상세 화면은 바로 닫는다
  const shown=ui.tab==="preview"&&ui.pv?ui.pv:B;
  if($("#dlg").open&&!shown.postings.some(p=>p.id===$("#dlg").dataset.id)) $("#dlg").close();
}

/* ---------- 이벤트 ---------- */
document.addEventListener("click",e=>{
  const t=e.target.closest("button,tr.row");
  if(!t) return;
  if(t.dataset.tab){ui.tab=t.dataset.tab;ui.error="";ui.notice="";if(ui.tab==="preview"){ui.pv=null;render();act(load)}else render();return}
  if(t.dataset.id&&(t.matches("tr.row")||t.classList.contains("card"))){openDetail(t.dataset.id);return}
  if(t.id==="dlgClose"){$("#dlg").close();return}
  if(t.id==="logout"){act(async()=>{await post("/api/logout",{});me=null;B=null;A=null;ui.tab="board";ui.issued=null;ui.pwForm=false});return}
  if(t.dataset.grant){act(async()=>{A=await post("/api/admin",{action:"grant",code:t.dataset.grant,id:t.dataset.id});await load()});return}
  if(t.dataset.revoke){act(async()=>{A=await post("/api/admin",{action:"revoke",code:t.dataset.revoke,id:t.dataset.id});await load()});return}
  if(t.dataset.add){const c=document.getElementById("sel-"+t.dataset.add).value;if(!c){ui.error="승인할 대상자를 골라 주세요.";render();return}act(async()=>{await post("/api/admin",{action:"grant",code:c,id:t.dataset.add});await load()});return}
  if(t.dataset.linkI!==undefined){const c=people()[+t.dataset.linkI];const acc=document.getElementById("lk-"+t.dataset.linkI).value.trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acc)){ui.error="로그인 이메일을 정확히 입력해 주세요.";render();return}
    act(async()=>{const r=await post("/api/admin",{action:"link",code:c,account:acc});ui.issued=r.issued||null;await load();ui.notice=`${c} 님의 로그인 계정을 ${acc}(으)로 저장했습니다.`});return}
  if(t.dataset.reissueI!==undefined){const c=people()[+t.dataset.reissueI];const acc=A.links[c];
    if(!confirm(`${c} 님(${acc})의 비밀번호를 새 임시 비밀번호로 바꿀까요? 지금 비밀번호는 더 이상 쓸 수 없습니다.`))return;
    act(async()=>{const r=await post("/api/admin",{action:"password",account:acc});ui.issued=r.issued||null;await load()});return}
  if(t.id==="copyTemp"){navigator.clipboard&&navigator.clipboard.writeText(ui.issued.temp).then(()=>{t.textContent="복사됨"},()=>{});return}
  if(t.id==="hideTemp"){ui.issued=null;render();return}
  if(t.id==="pwOpen"){ui.pwForm=true;ui.pwErr="";render();return}
  if(t.id==="pwCancel"){ui.pwForm=false;ui.pwErr="";render();return}
  if(t.dataset.unlinkI!==undefined){const c=people()[+t.dataset.unlinkI];act(async()=>{await post("/api/admin",{action:"link",code:c,account:""});await load()});return}
  if(t.id==="pApply"){act(async()=>{const r=await post("/api/apply",{pendingId:ui.pending.id,linkTo:ui.linkTo});ui.pending=null;ui.linkTo={};await load();ui.tab="board";ui.notice=`반영했습니다. 변경 ${r.changed}건.`});return}
  if(t.id==="pDiscard"){act(async()=>{await post("/api/apply",{pendingId:ui.pending.id,discard:true});ui.pending=null;await load()});return}
  if(t.id==="pClose"){ui.pending=null;render();return}
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("tr.row"))openDetail(e.target.dataset.id)});
document.addEventListener("input",e=>{
  if(e.target.id==="q"){ui.q=e.target.value;const pos=e.target.selectionStart;render();const q=$("#q");if(q){q.focus();q.setSelectionRange(pos,pos)}}
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="pvAs"){ui.pvAs=t.value;ui.pv=null;render();act(load);return}
  if(t.id==="fOrg"){ui.org=t.value;render();return}
  if(t.id==="fStage"){ui.stage=t.value;render();return}
  if(t.id==="doneDays"){act(async()=>{A=await post("/api/admin",{action:"doneDays",days:Number(t.value)});await load()});return}
  if(t.id==="showExpired"){ui.showExpired=t.checked;render();return}
  if(t.id==="interval"){act(async()=>{A=await post("/api/admin",{action:"interval",minutes:Number(t.value)});await load()});return}
  if(t.id==="file"&&t.files[0]){handleFile(t.files[0]);t.value="";return}
  if(t.id==="permFile"&&t.files[0]){const f=t.files[0];t.value="";act(async()=>{const r=await api("/api/upload",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(f.name),"X-Kind":"perm"},body:f});ui.permResult=r.perm;await load()});return}
  if(t.dataset.link!==undefined&&ui.pending){
    const used=Object.entries(ui.linkTo).find(([k,v])=>v===t.value&&k!==t.dataset.link);
    if(used&&t.value){t.value="";return}
    if(t.value) ui.linkTo[t.dataset.link]=t.value; else delete ui.linkTo[t.dataset.link];
  }
});
document.addEventListener("submit",e=>{
  if(e.target.id==="pwForm"){e.preventDefault();
    const current=$("#pwCur").value,next=$("#pwNew").value;
    if(next!==$("#pwNew2").value){ui.pwErr="새 비밀번호 두 칸이 서로 다릅니다.";render();return}
    act(async()=>{
      try{await post("/api/password",{current,next});me.mustChange=false;ui.pwForm=false;ui.pwErr="";await load();ui.notice="비밀번호를 바꿨습니다."}
      catch(err){ui.pwErr=err.message}
    });return}
  if(e.target.id!=="loginForm")return; e.preventDefault();
  const id=$("#accId").value.trim(), password=$("#accPw").value; ui.loginId=id;
  act(async()=>{
    try{const r=await post("/api/login",{id,password});me=r.user;ui.loginErr="";ui.tab="board";await load()}
    catch(err){ui.loginErr=err.message}
  });
});
["dragover","dragenter"].forEach(ev=>document.addEventListener(ev,e=>{const d=e.target.closest&&e.target.closest("#drop");if(d){e.preventDefault();d.classList.add("over")}}));
document.addEventListener("dragleave",e=>{const d=e.target.closest&&e.target.closest("#drop");if(d)d.classList.remove("over")});
document.addEventListener("drop",e=>{const d=e.target.closest&&e.target.closest("#drop");if(d){e.preventDefault();d.classList.remove("over");const f=e.dataTransfer.files[0];if(f)handleFile(f)}});

// 1분마다 새로 불러와 최신 데이터와 권한 변경을 반영 (회수되면 화면에서 사라짐)
setInterval(()=>{if(me&&!ui.busy&&!ui.pwForm&&!me.mustChange&&!(document.activeElement&&document.activeElement.matches("input,select")))refresh()},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&me)refresh()});

(async()=>{
  try{const r=await fetch("/api/me",{credentials:"same-origin"});if(r.ok){me=(await r.json()).user;await load()}}catch(e){ui.error=e instanceof TypeError?"서버에 연결할 수 없습니다.":e.message}
  render();
})();
})();
