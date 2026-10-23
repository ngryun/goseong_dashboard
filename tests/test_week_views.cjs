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
assert.ok(/data-event="early"[^]*?<span class="task-owner"><svg[^]*?<\/svg><span>김담당<\/span><\/span><\/button>/.test(html),'the owner is shown on the card, not only on hover');
assert.ok(!html.slice(html.indexOf('data-event="late"'),html.indexOf('</button>',html.indexOf('data-event="late"'))).includes('task-owner'),'no empty owner line');
run('weekLayout="list";');
assert.equal(run('weekPresentation()'),'list','an explicit choice overrides the responsive default');

// 시간대 보기
context.input=[
  {id:'span',date:'2026-10-12',endDate:'2026-10-14',kind:'monthly',title:'여러 날 행사',time:''},
  {id:'m1',date:'2026-10-13',kind:'monthly',title:'통합교육이해 증진 연수',time:'15:00',place:'3층 대회의실',owner:'남궁연'},
  {id:'w1',date:'2026-10-13',kind:'weekly',team:'교육과장',title:'통합교육이해증진연수',time:'15:00',place:'대회의실',owner:'남궁연, 김교사'},
  {id:'w2',date:'2026-10-13',kind:'weekly',team:'문화체육특수',title:'통합교육이해 증진연수',time:'15:00~17:00'},
  {id:'later',date:'2026-10-13',kind:'weekly',team:'총무팀',title:'통합교육이해 증진 연수',time:'16:00'},
  {id:'early',date:'2026-10-13',kind:'weekly',team:'총무팀',title:'<새벽 점검>',time:'07:30'},
  {id:'none',date:'2026-10-14',kind:'weekly',team:'총무팀',title:'시간 미정 업무',time:''},
  {id:'eve',date:'2026-10-16',kind:'weekly',team:'총무팀',title:'저녁 행사',time:'19:00',slots:[{time:'19:00',place:'간성초'},{time:'20:00',place:'거진초'}]}
];
run('data.events=input;weekLayout="time";weekCompact=false;compactScreen.matches=false;selected="2026-10-13";cursor=parseDate(selected);');
assert.equal(run('weekPresentation()'),'time');
run('renderWeek(filterEvents());');
html=nodes.calendar.innerHTML;
assert.ok(html.includes('class="week-table time-grid"'),'desktop shows all seven days');
assert.ok(html.includes('data-week-layout="time" aria-pressed="true"')&&html.includes('data-week-density'),'time view has its button and the density toggle');
assert.equal((html.match(/<time>/g)||[]).length,13,'hours run from the earliest start (7시) to the latest (19시)');
assert.ok(html.includes('<time>오전 7시</time>')&&html.includes('<time>오후 7시</time>')&&html.includes('<time>낮 12시</time>'));
assert.ok(html.indexOf('종일·시간 미정')<html.indexOf('오전 7시'),'untimed and multi-day work sits above the hours');
assert.ok(html.includes('data-event="span"')&&html.includes('시간 미정 업무'));
const merged=html.match(/<button class="week-task time-task[^"]*" data-event="m1" data-members="([^"]+)"/);
assert.ok(merged,'the same event written under 월중행사 and two teams becomes one block led by 월중행사');
assert.deepEqual(merged[1].split(' ').sort(),['m1','w1','w2']);
assert.ok(!html.includes('data-event="w1"')&&!html.includes('data-event="w2"'));
assert.ok(html.includes('data-event="later"'),'a different start time stays a separate block');
const block=html.slice(html.indexOf('data-event="m1"'),html.indexOf('</button>',html.indexOf('data-event="m1"')));
assert.ok(block.includes('월중행사')&&block.includes('교육과장')&&block.includes('문화체육특수'),'every team of the merged block is named');
assert.ok(block.includes('<span>남궁연, 김교사</span>'),'merged blocks list each owner once');
assert.ok(block.includes('<span class="task-time">15:00</span>'),'mixed time strings fall back to the shared start');
assert.ok(html.includes('여러 담당에 같은 일정 1건 묶음'));
assert.ok(html.includes('&lt;새벽 점검&gt;')&&!html.includes('<새벽 점검>'),'escape titles in the time view');
assert.ok(html.includes('<b>19:00</b>간성초')&&html.includes('<b>20:00</b>거진초'),'slots stay line by line');
assert.ok(html.includes('data-add-date="2026-10-13" data-add-time="15:00"'),'each hour cell can add work at that hour');
nodes.team.value='총무팀';
run('renderWeek(filterEvents());');
html=nodes.calendar.innerHTML;
assert.ok(!html.includes('data-event="m1"')&&html.includes('data-event="later"'),'filters apply before blocks are formed');
nodes.team.value='';
run('compactScreen.matches=true;renderWeek(filterEvents());');
html=nodes.calendar.innerHTML;
assert.ok(html.includes('time-grid single-day'),'phones show one day at a time');
assert.equal((html.match(/<th scope="col" class="(?!team-column)/g)||[]).length,1,"one day column besides the hour column");
assert.ok(html.includes('aria-label="시간대 보기 날짜 선택"')&&html.includes('data-event="m1"')&&!html.includes('저녁 행사'));
assert.ok(html.includes('2026년 10월 13일 화요일, 4건')||/10월 13일[^"]*, 4건/.test(html),'day buttons count merged blocks and multi-day work');
run('selected="2026-10-16";renderWeek(filterEvents());');
assert.ok(nodes.calendar.innerHTML.includes('저녁 행사')&&!nodes.calendar.innerHTML.includes('data-event="m1"'));
run('selected="2026-10-18";renderWeek(filterEvents());');
assert.ok(nodes.calendar.innerHTML.includes('time-grid single-day'),'an empty day still shows the hours so work can be added');
nodes.search.value='없는 검색어';
run('renderWeek(filterEvents());');
assert.ok(nodes.calendar.innerHTML.includes('조건에 맞는 업무가 없습니다'));
nodes.search.value='';
console.log('Weekly responsive defaults, day selection, filters, ranges, metadata, escaping and compact-table content verified.');
console.log('Time view hours, untimed row, cross-team merging, filters, slots, hour presets and phone single-day verified.');
