'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseDate = s => new Date(s+'T12:00:00');
const todayKey = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const today = parseDate(todayKey);
let cursor = new Date(today), selected = todayKey, view = 'month', data = {events:[],sources:[]};
// Display groups follow the order supplied by the office; these are UI group labels.
const TEAM_GROUPS = [
  {id:'education',label:'교육·장학',teams:['교육장','교육과장','장학행정','유초등교육(초등)','중등교육(중등)']},
  {id:'administration',label:'행정·학교지원',teams:['행정과장','총무팀','예산팀','재정팀','시설팀','학교지원팀']},
  {id:'support',label:'학생·학부모 지원',teams:['학습종합클리닉센터','보건교육','교육복지센터','Wee센터','특수교육지원센터','학부모지원센터']},
  {id:'personnel',label:'인사·교육지원',teams:['초등인사','중등인사','문화체육특수','인성생활','급식지원','초계종합교육센터']}
];
let activeGroup = '';
const groupFor = e => e.kind==='monthly'?'monthly':(TEAM_GROUPS.find(g=>g.teams.includes(e.team))?.id||'other');
const weekStart = d => {const n=new Date(d);n.setDate(n.getDate()-((n.getDay()+6)%7));return n;};
const plus = (d,n) => {const r=new Date(d);r.setDate(r.getDate()+n);return r;};
const displayDate = d => d.toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
const kindLabel = e => e.kind==='monthly'?'월중행사':'주간업무';
const notice = s => {$('#notice').textContent=s;$('#notice').hidden=!s;};
const sourceUrl = e => {const s=data.sources.find(s=>s.id===e.source_id);return s?`${s.url}?range=${encodeURIComponent("'"+e.tab.replaceAll("'","''")+"'!"+e.cell)}`:'#';};
function filterEvents(){const q=$('#search').value.trim().toLowerCase(),kind=$('#kind').value,team=$('#team').value;return data.events.filter(e=>(!activeGroup||groupFor(e)===activeGroup)&&(!kind||kind===e.kind)&&(!team||team===e.team)&&(!q||[e.title,e.description,e.owner,e.place,e.team].join(' ').toLowerCase().includes(q)));}
function chip(e,weekly=false){return `<button class="event-chip ${e.kind} category-${groupFor(e)}${weekly?' week-card':''}" data-event="${e.id}" title="${esc(e.title)}">${weekly?`<small>${esc(e.time||'시간 미기재')} · ${esc(e.team||kindLabel(e))}</small>`:''}${!weekly&&e.time?esc(e.time)+' ':''}${esc(e.title)}</button>`;}
function renderStats(){const month=dateKey(cursor).slice(0,7),ws=weekStart(cursor),we=plus(ws,7);const sets=[data.events.filter(e=>e.kind==='monthly'&&e.date.startsWith(month)).length,data.events.filter(e=>e.kind==='weekly'&&e.date>=dateKey(ws)&&e.date<dateKey(we)).length,data.events.filter(e=>e.date===todayKey).length,data.sources.length];['month','week','today','sources'].forEach((id,i)=>$('#stat-'+id).innerHTML=sets[i]+`<em>${i===3?'개':'건'}</em>`);$('.stats article:nth-child(1)>span').textContent=`${cursor.getMonth()+1}월 월중행사`;$('.stats article:nth-child(2)>span').textContent=`${ws.getMonth()+1}.${ws.getDate()} ~ ${plus(ws,6).getMonth()+1}.${plus(ws,6).getDate()} 업무`;$('#stat-tabs').textContent=`총 ${data.sources.reduce((n,s)=>n+s.tabs.length,0)}개 탭 연결`;}
function render(preserveScroll=false){const previousScroll=preserveScroll&&$('.week-table-scroll')?{left:$('.week-table-scroll').scrollLeft,top:$('.week-table-scroll').scrollTop}:null;renderStats();$('.app').classList.toggle('is-week',view==='week');document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const events=filterEvents();const month=dateKey(cursor).slice(0,7);let shown=[];
if(view==='month'){$('#period-title').textContent=`${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`;const start=new Date(cursor.getFullYear(),cursor.getMonth(),1);start.setDate(start.getDate()-start.getDay());let html='<div class="weekdays">'+['일','월','화','수','목','금','토'].map(x=>`<span>${x}</span>`).join('')+'</div><div class="month-grid">';const first=new Date(cursor.getFullYear(),cursor.getMonth(),1);const cells=Math.ceil((first.getDay()+new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate())/7)*7;for(let i=0;i<cells;i++){const d=plus(start,i),key=dateKey(d),items=events.filter(e=>e.date===key);html+=`<div class="day ${d.getMonth()!==cursor.getMonth()?'outside':''} ${selected===key?'selected':''}"><button class="day-number ${key===todayKey?'today':''}" data-date="${key}" aria-label="${key} 일정 ${items.length}건">${d.getDate()}</button>${items.slice(0,3).map(e=>chip(e)).join('')}${items.length>3?`<button class="more" data-date="${key}">+ ${items.length-3}건 더보기</button>`:''}</div>`;}$('#calendar').innerHTML=html+'</div>';shown=events.filter(e=>e.date.startsWith(month));}
else if(view==='week'){shown=renderWeek(events);}
else{$('#period-title').textContent=`${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`;shown=events.filter(e=>e.date.startsWith(month));$('#calendar').innerHTML=shown.map(e=>`<button class="list-row" data-event="${e.id}"><span class="list-date">${Number(e.date.slice(5,7))}.${Number(e.date.slice(8))}<br>${esc(e.time||'시간 미기재')}</span><span class="list-info"><strong>${esc(e.title)}</strong><small>${esc([e.team,e.place,e.owner].filter(Boolean).join(' · ')||e.tab)}</small></span><span class="badge ${e.kind}">${kindLabel(e)}</span></button>`).join('')||'<div class="empty"><strong>표시할 일정이 없습니다</strong>조회 기간이나 검색 조건을 변경해 주세요.</div>';}
$('#result-count').textContent=`현재 기간 ${shown.length}건 · 검색 조건 적용`;renderDay(events);if(previousScroll&&$('.week-table-scroll')){$('.week-table-scroll').scrollLeft=previousScroll.left;$('.week-table-scroll').scrollTop=previousScroll.top;}}

function renderWeek(events) {
  const start=weekStart(cursor), end=plus(start,6);
  $('#period-title').textContent=`${cursor.getFullYear()}년 ${start.getMonth()+1}.${start.getDate()} – ${end.getMonth()+1}.${end.getDate()}`;
  const days=Array.from({length:7},(_,i)=>plus(start,i));
  const shown=events.filter(e=>e.date>=dateKey(start)&&e.date<=dateKey(end));
  const allWeek=data.events.filter(e=>e.date>=dateKey(start)&&e.date<=dateKey(end));
  const unknown=[...new Set(allWeek.filter(e=>e.kind==='weekly'&&groupFor(e)==='other').map(e=>e.team||'담당 미기재'))];
  const groups=[...TEAM_GROUPS,...(unknown.length?[{id:'other',label:'기타 담당',teams:unknown}]:[]),{id:'monthly',label:'월중행사',teams:['월중행사']}];
  const controls=`<div class="week-group-controls" role="group" aria-label="업무 묶음 필터"><button data-group="" aria-pressed="${!activeGroup}" class="${!activeGroup?'active':''}">전체 담당</button>${groups.map(g=>`<button data-group="${g.id}" aria-pressed="${activeGroup===g.id}" class="category-${g.id} ${activeGroup===g.id?'active':''}"><span class="category-dot"></span>${esc(g.label)}</button>`).join('')}</div><div class="week-guide"><span>담당 분야별로 한 주의 업무를 비교하세요.</span><span>↔ 가로 이동 · 담당명과 요일 고정</span></div>`;
  let html='<div class="week-table-scroll" tabindex="0" role="region" aria-label="담당별 주간업무 표, 가로 스크롤 가능"><table class="week-table"><caption class="sr-only">담당 분야별 주간업무, '+esc($('#period-title').textContent)+'</caption><thead><tr><th scope="col" class="team-column">담당 분야 <small>주간 업무 건수</small></th>';
  html+=days.map(d=>`<th scope="col" class="${dateKey(d)===todayKey?'is-today':''}"><button data-date="${dateKey(d)}" aria-pressed="${selected===dateKey(d)}"><span>${['일','월','화','수','목','금','토'][d.getDay()]}</span><strong>${d.getMonth()+1}.${d.getDate()}</strong>${dateKey(d)===todayKey?'<em>오늘</em>':''}</button></th>`).join('')+'</tr></thead>';
  let rowCount=0;
  for(const g of groups){
    if(activeGroup&&activeGroup!==g.id)continue;
    if($('#kind').value && (g.id==='monthly')!==($('#kind').value==='monthly'))continue;
    const teams=g.teams.filter(t=>!$('#team').value||t===$('#team').value);
    if(!teams.length)continue;
    const groupEvents=shown.filter(e=>groupFor(e)===g.id);
    if($('#search').value.trim()&&!groupEvents.length)continue;
    html+=`<tbody class="category-${g.id}"><tr class="group-divider"><th colspan="8" scope="rowgroup"><span><i class="category-dot"></i>${esc(g.label)}<small>${groupEvents.length}건</small></span></th></tr>`;
    for(const team of teams){
      const items=groupEvents.filter(e=>g.id==='monthly'||(e.team||'담당 미기재')===team);
      if($('#search').value.trim()&&!items.length)continue;
      rowCount++;
      html+=`<tr class="team-row"><th scope="row" class="team-column"><span class="team-name">${esc(team)}</span><small>${items.length}건</small></th>`;
      html+=days.map(d=>{
        const daily=items.filter(e=>e.date===dateKey(d));
        return `<td class="${dateKey(d)===todayKey?'is-today':''}">${daily.map(e=>`<button class="week-task" data-event="${e.id}"><span class="task-time">${esc(e.time||'시간 미기재')}</span><strong>${esc(e.title)}</strong>${e.place?`<span class="task-place">${esc(e.place)}</span>`:''}</button>`).join('')||'<span class="no-task" aria-label="등록된 업무 없음">—</span>'}</td>`;
      }).join('')+'</tr>';
    }
    html+='</tbody>';
  }
  $('#calendar').innerHTML=controls+(rowCount?html+'</table></div>':'<div class="empty">조건에 맞는 업무가 없습니다. 검색 또는 담당 필터를 변경해 주세요.</div>');
  return shown;
}

function renderDay(events){const items=events.filter(e=>e.date===selected);$('#selected-title').textContent=displayDate(parseDate(selected));$('#selected-count').textContent=`${selected===todayKey?'오늘의 업무':'선택한 날의 업무'} · ${items.length}건`;$('#day-events').innerHTML=items.map(e=>`<button class="day-event category-${groupFor(e)}" data-event="${e.id}"><span class="badge ${e.kind} category-badge">${esc(e.team||kindLabel(e))}</span><h3>${esc(e.title)}</h3><div class="event-meta">◷ ${esc(e.time||'시간 미기재')}${e.place?'<br>⌖ '+esc(e.place):''}${e.owner||e.team?'<br>'+esc(e.owner||e.team):''}</div></button>`).join('')||'<div class="empty">등록된 일정이 없습니다.</div>';}
function renderSources(){$('#source-links').innerHTML=data.sources.map(s=>`<a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗<small>${s.tabs.length}개 탭 · ${s.count}건${s.error?' · 동기화 오류':''}</small></a>`).join('')||'<div class="empty">등록된 시트가 없습니다.<br>sources.json에 시트 주소를 추가하세요.</div>';const synced=data.generated_at||data.sources.map(s=>s.synced_at).filter(Boolean).sort().at(-1);const problems=data.sources.flatMap(s=>[...(s.error?[s.label+': '+s.error]:[]),...(s.warnings||[]).map(w=>s.label+' · '+w)]);$('#sync-warnings').hidden=!problems.length;$('#sync-warnings').innerHTML=problems.length?`<details><summary>확인 사항 ${problems.length}건</summary><ul>${problems.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:'';$('#sync-label').textContent=synced?'최근 동기화 '+new Date(synced).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'연결된 시트가 없습니다';}
async function load(){try{const r=await fetch('data.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error();data=await r.json();const old=$('#team').value;$('#team').innerHTML='<option value="">전체 담당</option>'+TEAM_GROUPS.map(g=>`<optgroup label="${esc(g.label)}">${g.teams.map(t=>`<option>${esc(t)}</option>`).join('')}</optgroup>`).join('')+[...new Set(data.events.map(e=>e.team).filter(t=>t&&!TEAM_GROUPS.some(g=>g.teams.includes(t))))].map(t=>`<option>${esc(t)}</option>`).join('');if([...$('#team').options].some(o=>o.value===old))$('#team').value=old;notice(data.sources.some(s=>s.error)?'일부 시트의 최근 동기화에 실패했습니다. 마지막으로 저장된 데이터를 표시합니다.':data.sources.length?'':'아직 연결된 시트가 없습니다. sources.json에 업무계획 시트 주소를 등록하세요.');render(true);renderSources();}catch{notice('데이터를 불러오지 못했습니다. 네트워크 연결을 확인한 후 새로고침해 주세요.');}}
function showDetail(id){const e=data.events.find(e=>e.id===id);if(!e)return;$('#detail-kind').textContent=kindLabel(e);$('#detail-kind').className='badge '+e.kind;$('#detail-title').textContent=e.title;$('#detail-meta').innerHTML=[displayDate(parseDate(e.date))+' · '+(e.time||'시간 미기재'),e.team&&'담당 분야: '+e.team,e.place&&'장소: '+e.place,e.owner&&'담당자: '+e.owner,'출처: '+e.tab+' · '+e.cell].filter(Boolean).map(v=>`<div>${esc(v)}</div>`).join('');$('#detail-body').textContent=e.description;$('#detail-source').href=sourceUrl(e);$('#detail').showModal();}
document.addEventListener('click',e=>{const group=e.target.closest('[data-group]');if(group){activeGroup=group.dataset.group;$('#team').value='';$('#kind').value='';render();return;}const ev=e.target.closest('[data-event]');if(ev)return showDetail(ev.dataset.event);const d=e.target.closest('[data-date]');if(d){selected=d.dataset.date;render(true);return;}const v=e.target.closest('[data-view]');if(v){view=v.dataset.view;activeGroup='';render();}});
$('#prev').onclick=()=>move(-1);$('#next').onclick=()=>move(1);
function move(n){if(view==='week')cursor=plus(cursor,n*7);else cursor=new Date(cursor.getFullYear(),cursor.getMonth()+n,1,12);selected=dateKey(cursor);render();}
$('#today').onclick=()=>{cursor=new Date(today);selected=todayKey;render();};$('#refresh').onclick=load;['search','kind','team'].forEach(id=>$('#'+id).addEventListener('input',()=>{if(id!=='search')activeGroup='';render();}));$('#open-sources').onclick=()=>$('#sources').showModal();document.querySelectorAll('dialog').forEach(d=>{d.querySelector('.close-dialog').onclick=()=>d.close();d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});});
function theme(dark){document.body.classList.toggle('dark',dark);$('.brand img').src='gwe_bi_symbol_typo'+(dark?'_white':'')+'.png';localStorage.setItem('goseong-theme',dark?'dark':'light');}$('#theme').onclick=()=>theme(!document.body.classList.contains('dark'));theme(localStorage.getItem('goseong-theme')==='dark');$('#today-label').textContent=displayDate(today);load();setInterval(()=>{if(!document.hidden)load();},300000);
