'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseDate = s => new Date(s+'T12:00:00');
const seoulToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let todayKey = seoulToday(), today = parseDate(todayKey);
let cursor = new Date(today), selected = todayKey, view = 'month', data = {events:[],sources:[]}, status = null;
// Re-evaluate "today" (Asia/Seoul). If the user was still looking at the old today, follow the new date.
function refreshToday(){const key=seoulToday();if(key===todayKey)return false;const followed=selected===todayKey;todayKey=key;today=parseDate(key);if(followed){selected=key;cursor=new Date(today);}$('#today-label').textContent=displayDate(today);return true;}
// Display groups follow the order supplied by the office; these are UI group labels.
const TEAM_GROUPS = [
  {id:'education',label:'교육·장학',teams:['교육장','교육과장','장학행정','유초등교육(초등)','중등교육(중등)']},
  {id:'administration',label:'행정·학교지원',teams:['행정과장','총무팀','예산팀','재정팀','시설팀','학교지원팀']},
  {id:'support',label:'학생·학부모 지원',teams:['학습종합클리닉센터','보건교육','교육복지센터','Wee센터','특수교육지원센터','학부모지원센터']},
  {id:'personnel',label:'인사·교육지원',teams:['초등인사','중등인사','문화체육특수','인성생활','급식지원','초계종합교육센터']}
];
let activeGroup = '', dayKind = 'monthly';
const groupFor = e => e.kind==='monthly'?'monthly':(TEAM_GROUPS.find(g=>g.teams.includes(e.team))?.id||'other');
const weekStart = d => {const n=new Date(d);n.setDate(n.getDate()-((n.getDay()+6)%7));return n;};
const plus = (d,n) => {const r=new Date(d);r.setDate(r.getDate()+n);return r;};
const displayDate = d => d.toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
const kindLabel = e => e.kind==='monthly'?'월중행사':'주간업무';
const notice = s => {$('#notice').textContent=s;$('#notice').hidden=!s;};
const sourceUrl = e => {const s=data.sources.find(s=>s.id===e.source_id);return s?`${s.url}?range=${encodeURIComponent("'"+e.tab.replaceAll("'","''")+"'!"+e.cell)}`:'#';};
function filterEvents(){const q=$('#search').value.trim().toLowerCase(),kind=$('#kind').value,team=$('#team').value;return data.events.filter(e=>(!activeGroup||groupFor(e)===activeGroup)&&(!kind||kind===e.kind)&&(!team||team===e.team)&&(!q||[e.title,e.description,e.owner,e.place,e.team].join(' ').toLowerCase().includes(q)));}
// Group only identical titles (ignoring whitespace) on the same date; retain every source.
const eventKey = e => JSON.stringify([e.date,e.title.normalize('NFC').replace(/\s+/gu,'').toLowerCase()]);
function groupEvents(events){
  const groups=new Map();
  for(const e of events){const key=eventKey(e);if(!groups.has(key))groups.set(key,{...e,members:[]});groups.get(key).members.push(e);}
  return [...groups.values()];
}
function monthItems(events,date){
  const daily=events.filter(e=>e.date===date);
  return {monthly:groupEvents(daily.filter(e=>e.kind==='monthly')),weekly:groupEvents(daily.filter(e=>e.kind==='weekly'))};
}
function monthChip(e){
  const times=[...new Set(e.members.map(x=>x.time||''))],time=times.length===1?times[0]:'';
  return `<button class="event-chip month-event" data-event="${esc(e.id)}" data-merged="true" title="${esc(e.title)}">${time?`<span class="month-event-time">${esc(time)}</span>`:''}<span class="month-event-title">${esc(e.title)}</span></button>`;
}
function renderMonth(events){
  $('#period-title').textContent=`${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`;
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1),start=plus(first,-first.getDay());
  const cells=Math.ceil((first.getDay()+new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate())/7)*7;
  let html='<p class="month-guide">월중행사는 제목으로, 주간업무는 건수로 확인하세요.<span>달력을 좌우로 밀어 다른 요일을 확인하세요.</span></p><div class="month-scroll" tabindex="0" role="region" aria-label="월간 달력"><div class="weekdays">'+['일','월','화','수','목','금','토'].map(x=>`<span>${x}</span>`).join('')+'</div><div class="month-grid">';
  for(let i=0;i<cells;i++){
    const d=plus(start,i),key=dateKey(d),items=monthItems(events,key);
    html+=`<div class="day ${d.getMonth()!==cursor.getMonth()?'outside':''} ${selected===key?'selected':''}"><button class="day-number ${key===todayKey?'today':''}" data-date="${key}" aria-pressed="${selected===key}" aria-label="${key} 월중행사 ${items.monthly.length}건, 주간업무 ${items.weekly.length}건">${d.getDate()}</button><div class="month-events">${items.monthly.slice(0,2).map(monthChip).join('')}</div><div class="month-day-footer">${items.monthly.length>2?`<button class="more" data-date="${key}" data-day-kind="monthly">행사 +${items.monthly.length-2}건</button>`:'<span class="more-placeholder" aria-hidden="true"></span>'}${items.weekly.length?`<button class="weekly-count" data-date="${key}" data-day-kind="weekly" aria-label="${key} 주간업무 ${items.weekly.length}건 보기"><span>주간업무</span><strong>${items.weekly.length}건</strong><span aria-hidden="true">›</span></button>`:''}</div></div>`;
  }
  $('#calendar').innerHTML=html+'</div></div>';
  return groupEvents(events.filter(e=>e.kind==='monthly'&&e.date.startsWith(dateKey(cursor).slice(0,7))));
}
function render(preserveScroll=false){const monthScroll=preserveScroll?($('.month-scroll')?.scrollLeft||0):0;const previousScroll=preserveScroll&&$('.week-table-scroll')?{left:$('.week-table-scroll').scrollLeft,top:$('.week-table-scroll').scrollTop}:null;$('.app').classList.toggle('is-week',view==='week');$('.app').classList.toggle('is-month',view==='month');document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const events=filterEvents();const month=dateKey(cursor).slice(0,7);let shown=[];
if(view==='month'){shown=renderMonth(events);}
else if(view==='week'){shown=renderWeek(events);}
else{$('#period-title').textContent=`${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`;shown=events.filter(e=>e.date.startsWith(month));$('#calendar').innerHTML=shown.map(e=>`<button class="list-row" data-event="${e.id}"><span class="list-date">${Number(e.date.slice(5,7))}.${Number(e.date.slice(8))}${e.time?'<br>'+esc(e.time):''}</span><span class="list-info"><strong>${esc(e.title)}</strong><small>${esc([e.team,e.place,e.owner].filter(Boolean).join(' · ')||e.tab)}</small></span><span class="badge ${e.kind}">${kindLabel(e)}</span></button>`).join('')||'<div class="empty"><strong>표시할 일정이 없습니다</strong>조회 기간이나 검색 조건을 변경해 주세요.</div>';}
$('#result-count').textContent=view==='month'?`월중행사 ${shown.length}건 · 주간업무 ${groupEvents(events.filter(e=>e.kind==='weekly'&&e.date.startsWith(month))).length}건 · 중복 제목 묶음`:`현재 기간 ${shown.length}건 · 검색 조건 적용`;renderDay(events);if($('.month-scroll'))$('.month-scroll').scrollLeft=monthScroll;if(previousScroll&&$('.week-table-scroll')){$('.week-table-scroll').scrollLeft=previousScroll.left;$('.week-table-scroll').scrollTop=previousScroll.top;}}

function renderWeek(events) {
  const start=weekStart(cursor), end=plus(start,6);
  $('#period-title').textContent=`${cursor.getFullYear()}년 ${start.getMonth()+1}.${start.getDate()} – ${end.getMonth()+1}.${end.getDate()}`;
  const days=Array.from({length:7},(_,i)=>plus(start,i));
  const shown=events.filter(e=>e.date>=dateKey(start)&&e.date<=dateKey(end));
  const allWeek=data.events.filter(e=>e.date>=dateKey(start)&&e.date<=dateKey(end));
  const unknown=[...new Set(allWeek.filter(e=>e.kind==='weekly'&&groupFor(e)==='other').map(e=>e.team||'담당 미기재'))];
  const groups=[...TEAM_GROUPS,...(unknown.length?[{id:'other',label:'기타 담당',teams:unknown}]:[]),{id:'monthly',label:'월중행사',teams:['월중행사']}];
  const controls=`<div class="week-group-controls" role="group" aria-label="업무 묶음 필터"><button data-group="" aria-pressed="${!activeGroup}" class="${!activeGroup?'active':''}">전체 담당</button>${groups.map(g=>`<button data-group="${g.id}" aria-pressed="${activeGroup===g.id}" class="category-${g.id} ${activeGroup===g.id?'active':''}"><span class="category-dot"></span>${esc(g.label)}</button>`).join('')}</div><div class="week-guide"><span>담당별 주간업무</span><span>좌우로 이동 · 담당과 요일 고정</span></div>`;
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
        return `<td class="${dateKey(d)===todayKey?'is-today':''}">${daily.map(e=>`<button class="week-task" data-event="${e.id}" title="${esc(e.title)}">${e.time?`<span class="task-time">${esc(e.time)}</span>`:''}<strong>${esc(e.title)}</strong>${e.place?`<span class="task-place">${esc(e.place)}</span>`:''}</button>`).join('')||'<span class="sr-only">등록된 업무 없음</span>'}</td>`;
      }).join('')+'</tr>';
    }
    html+='</tbody>';
  }
  $('#calendar').innerHTML=controls+(rowCount?html+'</table></div>':'<div class="empty">조건에 맞는 업무가 없습니다. 검색 또는 담당 필터를 변경해 주세요.</div>');
  return shown;
}

function renderDay(events){
  const daily=events.filter(e=>e.date===selected&&(view!=='month'||e.kind===dayKind)),items=view==='month'?groupEvents(daily):daily;
  const counts=monthItems(events,selected);
  $('#day-kind-controls').hidden=view!=='month';
  $('#day-kind-controls').innerHTML=view==='month'?['monthly','weekly'].map(kind=>`<button data-day-kind="${kind}" aria-pressed="${dayKind===kind}">${kind==='monthly'?'월중행사':'주간업무'} <strong>${counts[kind].length}</strong></button>`).join(''):'';
  $('#selected-title').textContent=displayDate(parseDate(selected));
  $('#selected-count').textContent=`${view==='month'?(dayKind==='weekly'?'주간업무':'월중행사'):(selected===todayKey?'오늘의 업무':'선택한 날의 업무')} · ${items.length}건${view==='month'&&items.length<daily.length?' · 중복 묶음':''}`;
  $('#day-events').innerHTML=items.map(e=>{
    const members=e.members||[e],values=fn=>[...new Set(members.map(fn).filter(Boolean))].join(' · ');
    const teams=values(x=>x.team||kindLabel(x)),times=values(x=>x.time),places=values(x=>x.place),owners=values(x=>x.owner);
    return `<button class="day-event category-${groupFor(e)}" data-event="${esc(e.id)}" ${view==='month'?'data-merged="true"':''}><span class="badge ${e.kind} category-badge">${esc(teams)}</span><h3>${esc(e.title)}</h3>${(meta=>meta?`<div class="event-meta">${meta}</div>`:'')([times&&'◷ '+esc(times),places&&'⌖ '+esc(places),owners&&esc(owners),members.length>1&&'원본 '+members.length+'건 보기'].filter(Boolean).join('<br>'))}</button>`;
  }).join('')||'<div class="empty">등록된 일정이 없습니다.</div>';
}
const fmtTime=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const sourceStatus=s=>status?.sources?.[s.id]||null;
function renderSources(){$('#source-links').innerHTML=data.sources.map(s=>{const st=sourceStatus(s);return `<a class="source-link${st&&st.ok===false?' has-error':''}" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗<small>${s.tabs.length}개 탭 · ${s.count}건 · 일정 최종 변경 ${esc(fmtTime(s.data_at)||'미상')}${st&&st.ok===false?' · <b>최근 수집 실패</b>':''}</small></a>`;}).join('')||'<div class="empty">등록된 시트가 없습니다.<br>sources.json에 시트 주소를 추가하세요.</div>';const problems=[...(status?.failures||[]),...data.sources.flatMap(s=>(s.warnings||[]).map(w=>s.label+' · '+w))];$('#sync-warnings').hidden=!problems.length;$('#sync-warnings').innerHTML=problems.length?`<details><summary>확인 사항 ${problems.length}건</summary><ul>${problems.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:'';const checked=status?.checked_at,updated=data.updated_at;$('#sync-label').textContent=!data.sources.length?'연결된 시트가 없습니다':(checked?`마지막 동기화 ${fmtTime(checked)} · `:'')+`일정 최종 변경 ${fmtTime(updated)||'미상'}`;}
function staleHours(){if(!status?.checked_at)return 0;return (Date.now()-new Date(status.checked_at).getTime())/36e5;}
async function load(){try{const stamp=Date.now();const [r,rs]=await Promise.all([fetch('data.json?t='+stamp,{cache:'no-store'}),fetch('status.json?t='+stamp,{cache:'no-store'}).catch(()=>null)]);if(!r.ok)throw Error();data=await r.json();status=rs&&rs.ok?await rs.json().catch(()=>null):null;refreshToday();const old=$('#team').value;$('#team').innerHTML='<option value="">전체 담당</option>'+TEAM_GROUPS.map(g=>`<optgroup label="${esc(g.label)}">${g.teams.map(t=>`<option>${esc(t)}</option>`).join('')}</optgroup>`).join('')+[...new Set(data.events.map(e=>e.team).filter(t=>t&&!TEAM_GROUPS.some(g=>g.teams.includes(t))))].map(t=>`<option>${esc(t)}</option>`).join('');if([...$('#team').options].some(o=>o.value===old))$('#team').value=old;const hours=staleHours();notice(!data.sources.length?'아직 연결된 시트가 없습니다. sources.json에 업무계획 시트 주소를 등록하세요.':hours>3?`마지막 자동 확인은 ${fmtTime(status.checked_at)}입니다. 그 뒤 원본 시트에 생긴 변경은 아직 반영되지 않았을 수 있습니다.`:status&&status.ok===false?'일부 시트의 최근 수집에 실패했습니다. 해당 시트는 마지막 성공 데이터를 표시합니다. 자세한 내용은 연결된 계획표에서 확인하세요.':'');render(true);renderSources();}catch{notice('데이터를 불러오지 못했습니다. 네트워크 연결을 확인한 후 새로고침해 주세요.');}}
function showDetail(id,merged=false){const e=data.events.find(e=>e.id===id);if(!e)return;$('#detail-kind').textContent=kindLabel(e);$('#detail-kind').className='badge '+e.kind;$('#detail-title').textContent=e.title;$('#detail-meta').innerHTML=[displayDate(parseDate(e.date))+(e.time?' · '+e.time:''),e.team&&'담당 분야: '+e.team,e.place&&'장소: '+e.place,e.owner&&'담당자: '+e.owner,'출처: '+e.tab+' · '+e.cell].filter(Boolean).map(v=>`<div>${esc(v)}</div>`).join('');$('#detail-body').textContent=e.description;$('#detail-source').href=sourceUrl(e);const members=merged?filterEvents().filter(x=>x.kind===e.kind&&eventKey(x)===eventKey(e)):[e];
const multiple=members.length>1;
$('#detail-related').hidden=!multiple;$('#detail-body').hidden=multiple;$('#detail-source').hidden=multiple;
if(multiple){
  $('#detail-kind').textContent=[...new Set(members.map(kindLabel))].join(' · ');
  $('#detail-meta').textContent=displayDate(parseDate(e.date))+' · 같은 제목의 원본 '+members.length+'건';
  $('#detail-related').innerHTML=members.map(x=>`<article class="related-event"><h3>${esc(x.team||kindLabel(x))}</h3><p>${esc([x.time,x.place,x.owner].filter(Boolean).join(' · '))}</p><pre>${esc(x.description||x.title)}</pre><a href="${esc(sourceUrl(x))}" target="_blank" rel="noopener">${esc(x.tab)} · ${esc(x.cell)} 원문 보기 ↗</a></article>`).join('');
}else $('#detail-related').innerHTML='';
$('#detail').showModal();}
document.addEventListener('click',e=>{const dayControl=e.target.closest('[data-day-kind]');if(dayControl){dayKind=dayControl.dataset.dayKind;if(dayControl.dataset.date)selected=dayControl.dataset.date;render(true);$('#day-events').scrollTop=0;if(dayControl.dataset.date){$('#selected-title').focus({preventScroll:true});if(window.matchMedia('(max-width:850px)').matches)$('.day-panel').scrollIntoView({behavior:'smooth',block:'start'});}return;}const group=e.target.closest('[data-group]');if(group){activeGroup=group.dataset.group;$('#team').value='';$('#kind').value='';render();return;}const ev=e.target.closest('[data-event]');if(ev)return showDetail(ev.dataset.event,ev.dataset.merged==='true');const d=e.target.closest('[data-date]');if(d){selected=d.dataset.date;dayKind=$('#kind').value||'monthly';render(true);return;}const v=e.target.closest('[data-view]');if(v){view=v.dataset.view;activeGroup='';dayKind=$('#kind').value||'monthly';render();}});
$('#prev').onclick=()=>move(-1);$('#next').onclick=()=>move(1);
function move(n){if(view==='week')cursor=plus(cursor,n*7);else cursor=new Date(cursor.getFullYear(),cursor.getMonth()+n,1,12);selected=dateKey(cursor);render();}
$('#today').onclick=()=>{cursor=new Date(today);selected=todayKey;render();};$('#refresh').onclick=load;['search','kind','team'].forEach(id=>$('#'+id).addEventListener('input',()=>{if(id!=='search')activeGroup='';if(id==='kind')dayKind=$('#kind').value||'monthly';render();}));$('#open-sources').onclick=()=>$('#sources').showModal();document.querySelectorAll('dialog').forEach(d=>{d.querySelector('.close-dialog').onclick=()=>d.close();d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});});
function theme(dark){document.body.classList.toggle('dark',dark);$('#gwe-bi').src='gwe_bi_symbol_typo'+(dark?'_white':'')+'.png';localStorage.setItem('goseong-theme',dark?'dark':'light');}$('#theme').onclick=()=>theme(!document.body.classList.contains('dark'));theme(localStorage.getItem('goseong-theme')==='dark');$('#today-label').textContent=displayDate(today);load();setInterval(()=>{if(!document.hidden)load();},300000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&refreshToday())render();});
