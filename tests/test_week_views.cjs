const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/app.js','utf8');
const nodes={search:{value:''},kind:{value:''},team:{value:''},calendar:{innerHTML:''},'period-title':{textContent:''}};
const context=vm.createContext({Intl,Date,document:{querySelector:selector=>nodes[selector.slice(1)]}});
const run=code=>vm.runInContext(code,context);
run(source.slice(0,source.indexOf('document.addEventListener(')));
run('const compactScreen={matches:true};cursor=parseDate("2026-10-13");selected="2026-10-13";');
context.input=[
  {id:'span',date:'2026-10-12',endDate:'2026-10-14',kind:'monthly',title:'여러 날 행사',time:''},
  {id:'late',date:'2026-10-13',kind:'weekly',team:'총무팀',title:'오후 업무',time:'14:00',place:'회의실'},
  {id:'early',date:'2026-10-13',kind:'weekly',team:'총무팀',title:'<오전 업무>',time:'09:00',owner:'김담당',slots:[{time:'09:00',place:'간성초'},{time:'11:00',place:'거진초'}]},
  {id:'next',date:'2026-10-14',kind:'weekly',team:'총무팀',title:'다음 날 업무',time:'10:00'},
  {id:'outside',date:'2026-10-20',kind:'weekly',team:'총무팀',title:'다음 주 업무',time:'10:00'}
];
run('data.events=input;');
assert.equal(run('weekPresentation()'),'list','phones default to the date list');
assert.equal(run('renderWeek(filterEvents()).length'),4,'the weekly total counts each multi-day event once');
let html=nodes.calendar.innerHTML;
assert.equal((html.match(/class="agenda-day/g)||[]).length,1,'show the selected day, without forcing a long scroll');
assert.equal((html.match(/data-date=/g)||[]).length,8,'seven day choices plus the current day heading');
assert.ok(html.includes('여러 날 행사')&&html.includes('10.12(월) – 10.14(수)'));
assert.ok(html.includes('&lt;오전 업무&gt;')&&!html.includes('<오전 업무>'),'escape titles in the agenda');
assert.ok(html.includes('09:00 간성초')&&html.includes('11:00 거진초'),'retain all time/place pairs');
assert.ok(html.indexOf('data-event="early"')<html.indexOf('data-event="late"'),'events are ordered by time');
assert.ok(!html.includes('다음 날 업무')&&!html.includes('다음 주 업무'));
run('selected="2026-10-14";renderWeek(filterEvents());');
assert.ok(nodes.calendar.innerHTML.includes('여러 날 행사')&&nodes.calendar.innerHTML.includes('다음 날 업무'));
nodes.team.value='총무팀';
run('renderWeek(filterEvents());');
assert.ok(!nodes.calendar.innerHTML.includes('여러 날 행사'),'team filtering applies to both counts and list');
run('selected="2026-10-18";renderWeek(filterEvents());');
assert.ok(nodes.calendar.innerHTML.includes('등록된 일정이 없습니다.'));
assert.ok(nodes.calendar.innerHTML.includes('data-add-date="2026-10-18"'),'empty days still allow adding an event');
nodes.team.value='';
run('compactScreen.matches=false;');
assert.equal(run('weekPresentation()'),'table','desktop defaults to the team table');
run('weekCompact=true;renderWeek(filterEvents());');
html=nodes.calendar.innerHTML;
assert.ok(html.includes('week-table-scroll is-compact'));
assert.ok(html.includes('data-event="span"')&&html.includes('data-event="early"'),'compact density retains event detail links');
assert.ok(html.includes('간성초')&&html.includes('거진초'),'compact styling does not discard metadata');
run('weekLayout="list";');
assert.equal(run('weekPresentation()'),'list','an explicit choice overrides the responsive default');
console.log('Weekly responsive defaults, day selection, filters, ranges, metadata, escaping and compact-table content verified.');
