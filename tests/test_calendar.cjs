const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/app.js', 'utf8');
const context = vm.createContext({Intl, Date});
vm.runInContext(source.slice(0, source.indexOf('document.addEventListener(')), context);
const events = [
  {id:'1',date:'2026-09-18',title:'자체감사 실시',team:'총무팀',time:'09:00'},
  {id:'2',date:'2026-09-18',title:'자체감사실시',team:'월중행사',time:'14:00'},
  {id:'3',date:'2026-09-19',title:'자체감사 실시'},
  {id:'4',date:'2026-09-18',title:'자체감사 결과 보고'}
];
context.input = events;
const grouped = vm.runInContext('groupEvents(input)', context);
assert.equal(grouped.length, 3);
assert.equal(grouped[0].members.length, 2);
assert.equal(grouped[0].members[1].time, '14:00');
assert.equal(events[0].members, undefined, 'raw events must remain unchanged');
assert.equal(vm.runInContext('groupEvents(input.filter(e=>e.team==="총무팀"))[0].members.length',context),1);
context.input = JSON.parse(fs.readFileSync('docs/data.json','utf8')).events;
const result = vm.runInContext('({raw:input.length, grouped:groupEvents(input).length, retained:groupEvents(input).reduce((n,e)=>n+e.members.length,0)})',context);
assert.equal(result.raw,result.retained);
console.log('Calendar grouping checks passed:',result);
context.input = [
  {id:'m1',date:'2026-09-18',kind:'monthly',title:'공동 행사'},
  {id:'w1',date:'2026-09-18',kind:'weekly',title:'공동 행사'},
  {id:'w2',date:'2026-09-18',kind:'weekly',title:'공동행사'},
  {id:'w3',date:'2026-09-19',kind:'weekly',title:'다음날 업무'}
];
const split = vm.runInContext('monthItems(input,"2026-09-18")',context);
assert.equal(split.monthly.length,1);
assert.equal(split.weekly.length,1);
assert.equal(split.monthly[0].members.length,1);
assert.equal(split.weekly[0].members.length,2);
assert.equal(vm.runInContext('monthItems(input.filter(e=>e.kind==="monthly"),"2026-09-18").weekly.length',context),0);
assert.equal(vm.runInContext('monthItems(input,"2026-09-20").monthly.length',context),0);
console.log('Monthly titles and weekly counts stay separate; filters and empty dates verified.');

// Hover previews include hidden events, preserve grouped metadata, and follow active filters.
context.input.push(
  {id:'m2',date:'2026-09-18',kind:'monthly',title:'두 번째 행사'},
  {id:'m3',date:'2026-09-18',kind:'monthly',title:'숨겨진 <행사>',time:'09:00',place:'회의실',owner:'홍길동'},
  {id:'w4',date:'2026-09-18',kind:'weekly',title:'공동 행사',team:'총무팀',slots:[{time:'10:00',place:'간성초'},{time:'14:00',place:'거진초'}]}
);
const controls={search:{value:''},kind:{value:''},team:{value:''}};
context.document={querySelector:selector=>controls[selector.slice(1)]};
vm.runInContext('data.events=input',context);
assert.equal(vm.runInContext('monthPreviewItems("2026-09-18","").length',context),4);
assert.equal(vm.runInContext('monthPreviewItems("2026-09-18","monthly").length',context),3);
assert.equal(vm.runInContext('monthPreviewItems("2026-09-18","weekly")[0].members.length',context),3);
const preview=vm.runInContext('monthPreviewHTML("2026-09-18","monthly",monthPreviewItems("2026-09-18","monthly"))',context);
assert.ok(preview.includes('숨겨진 &lt;행사&gt;')&&preview.includes('09:00 · 회의실 · 홍길동'));
assert.ok(!preview.includes('다음날 업무'));
assert.ok(vm.runInContext('monthPreviewHTML("2026-09-18","weekly",monthPreviewItems("2026-09-18","weekly"))',context).includes('10:00 간성초 / 14:00 거진초'));
controls.search.value='숨겨진';
assert.equal(vm.runInContext('monthPreviewItems("2026-09-18","").length',context),1);
controls.search.value='';controls.kind.value='weekly';
assert.equal(vm.runInContext('monthPreviewItems("2026-09-18","monthly").length',context),0);
controls.kind.value='';controls.team.value='총무팀';
assert.equal(vm.runInContext('monthPreviewItems("2026-09-18","weekly")[0].members.length',context),1);
controls.team.value='';
assert.equal(vm.runInContext('monthPreviewItems("2026-09-20","").length',context),0);
console.log('Hover preview contents, duplicate metadata, escaping, and filters verified.');

// School view: same date + same event name across schools is one entry; filters follow level and school.
context.input = {schools:[
  {code:'a',name:'간성초등학교',short:'간성초',level:'elementary'},
  {code:'b',name:'거진중학교',short:'거진중',level:'middle'},
  {code:'c',name:'고성고등학교',short:'고성고',level:'high'}
],events:[
  {school:'a',date:'2026-09-24',title:'추석',type:'공휴일',grades:[]},
  {school:'b',date:'2026-09-24',title:'추 석',type:'공휴일',grades:[]},
  {school:'c',date:'2026-09-24',title:'추석',type:'공휴일',grades:[]},
  {school:'b',date:'2026-09-30',title:'1회고사',type:'',grades:[2,3]},
  {school:'c',date:'2026-09-30',title:'1회고사',type:'',grades:[]}
]};
vm.runInContext('schools=input', context);
const schoolGroups = vm.runInContext('groupSchoolEvents(schools.events)', context);
assert.equal(schoolGroups.length, 2);
assert.equal(schoolGroups[0].members.length, 3, 'whitespace differences in the event name are ignored');
assert.equal(schoolGroups[1].members.length, 2);
assert.equal(JSON.stringify(vm.runInContext('[typeClass("공휴일"),typeClass("휴업일"),typeClass("")]', context)), JSON.stringify(['holiday','closed','event']));
assert.equal(JSON.stringify(vm.runInContext('[gradesText([2,3]),gradesText([]),gradesText(undefined)]', context)), JSON.stringify(['2·3학년','','']));
vm.runInContext('schoolLevel="middle";schoolCode=""', context);
assert.equal(vm.runInContext('schoolsShown().map(s=>s.short).join()', context), '거진중');
vm.runInContext('schoolLevel="";schoolCode="c"', context);
assert.equal(vm.runInContext('schoolsShown().map(s=>s.short).join()', context), '고성고');
vm.runInContext('schoolLevel="";schoolCode=""', context);
assert.equal(vm.runInContext('schoolsShown().length', context), 3);
const real = JSON.parse(fs.readFileSync('docs/schools.json','utf8'));
assert.ok(real.schools.length >= 20 && real.events.every(e => real.schools.some(s => s.code === e.school)), 'every event belongs to a listed school');
assert.ok(real.events.every(e => !e.title.includes('토요휴업일')), 'Saturday closures are not shipped');
console.log('School grouping and filters verified:', {schools: real.schools.length, events: real.events.length});

// Multi-day events (direct input with endDate) cover every day of their range and share lanes within a row.
context.input = [
  {id:'a',date:'2026-10-06',endDate:'2026-10-08',kind:'monthly',title:'컨설팅 주간'},
  {id:'b',date:'2026-10-07',endDate:'2026-10-09',kind:'monthly',title:'직무연수'},
  {id:'c',date:'2026-10-09',endDate:'2026-10-13',kind:'monthly',title:'안전점검'},
  {id:'d',date:'2026-10-08',kind:'monthly',title:'하루 행사'},
  {id:'e',date:'2026-10-08',endDate:'2026-10-08',kind:'weekly',title:'같은 날 종료'}
];
assert.equal(JSON.stringify(vm.runInContext('input.map(isMulti)',context)), JSON.stringify([true,true,true,false,false]), 'an end date equal to the start is a one-day event');
assert.equal(vm.runInContext('monthItems(input,"2026-10-08").monthly.length',context), 3, 'a day lists the multi-day events that cover it');
assert.equal(vm.runInContext('input.filter(e=>overlaps(e,"2026-10-10","2026-10-16")).map(e=>e.id).join()',context), 'c');
const lanes = vm.runInContext('laneBars(input,"2026-10-04","2026-10-10").map(b=>[b.e.id,b.start,b.end,b.lane,b.span].join(":"))',context);
assert.deepEqual([...lanes], ['a:2026-10-06:2026-10-08:0:3','b:2026-10-07:2026-10-09:1:3','c:2026-10-09:2026-10-10:0:2'], 'overlapping bars take separate lanes; a bar is clipped to its week');
assert.equal(vm.runInContext('laneBars(input,"2026-10-11","2026-10-17").map(b=>b.start+"/"+b.span).join()',context), '2026-10-11/3', 'the next week continues the bar from Sunday');
assert.equal(vm.runInContext('rangeText(input[0])',context), '10.6(화) – 10.8(목)');
assert.ok(vm.runInContext('monthPreviewHTML("2026-10-08","monthly",monthItems(input,"2026-10-08").monthly)',context).includes('10.7(수) – 10.9(금)'), 'previews show the range of a multi-day event');
console.log('Multi-day ranges, lanes and week clipping verified.');

// 공휴일 come from NEIS: a 공휴일 shared by more than half of the schools, never a school's own 재량휴업일.
context.input = {schools:[{code:'a'},{code:'b'},{code:'c'}],events:[
  {school:'a',date:'2026-10-09',title:'한글날',type:'공휴일'},{school:'b',date:'2026-10-09',title:'한글날',type:'공휴일'},
  {school:'a',date:'2026-05-04',title:'학교장재량휴업일',type:'공휴일'},{school:'b',date:'2026-05-04',title:'학교장재량휴업일',type:'공휴일'},
  {school:'a',date:'2026-10-20',title:'개교기념일',type:'공휴일'},
  {school:'a',date:'2026-10-21',title:'1회고사',type:''},{school:'b',date:'2026-10-21',title:'1회고사',type:''}
]};
assert.equal(JSON.stringify([...vm.runInContext('buildHolidays(input)',context)]), JSON.stringify([['2026-10-09','한글날']]));
context.input = real;
const realHolidays = vm.runInContext('buildHolidays(input)', context);
assert.equal(realHolidays.get('2026-10-03'), '개천절');
assert.equal(realHolidays.get('2026-10-05'), '대체공휴일');
assert.equal(realHolidays.get('2026-10-09'), '한글날');
assert.ok(!realHolidays.has('2026-05-04'), 'school-chosen closures are not public holidays');
console.log('Holidays from NEIS verified:', realHolidays.size);

// The address keeps the view, the day and (관내 학교) the school or level; anything else is ignored.
assert.deepEqual({...vm.runInContext('parseRoute("#week/2026-10-05")',context)}, {view:'week',date:'2026-10-05',extra:''});
assert.deepEqual({...vm.runInContext('parseRoute("#school/2026-10-03/7801234")',context)}, {view:'school',date:'2026-10-03',extra:'7801234'});
assert.deepEqual({...vm.runInContext('parseRoute("#month/2026-02-30/x")',context)}, {view:'month',date:'',extra:''}, 'impossible dates and extras outside 관내 학교 are dropped');
assert.equal(vm.runInContext('parseRoute("#calendar")',context), null);
for(const hash of ['#month/%', '#school/%E0%A4%A', '#week/%FF']){
  context.hash=hash;
  assert.equal(vm.runInContext('parseRoute(hash)',context),null,'malformed shared links must not stop initialization');
}
assert.deepEqual({...vm.runInContext('parseRoute("#week%2F2026-10-05")',context)}, {view:'week',date:'2026-10-05',extra:''});
assert.equal(vm.runInContext('routeHash("school","2026-10-03","elementary")+" "+routeHash("month","2026-10-03","")',context), '#school/2026-10-03/elementary #month/2026-10-03');
console.log('Routes verified.');

// Search results list every matching day in date order; untimed items first, duplicates grouped per kind.
context.input = [
  {id:'1',date:'2026-10-02',kind:'weekly',title:'감사 준비',time:'14:00'},
  {id:'2',date:'2026-09-16',kind:'monthly',title:'자체감사 실시',time:''},
  {id:'3',date:'2026-09-16',kind:'weekly',title:'자체감사실시',time:'09:00'},
  {id:'4',date:'2026-09-16',kind:'weekly',title:'자체감사 실시',time:'10:00'},
  {id:'5',date:'2026-10-02',kind:'monthly',title:'감사 결과 보고',time:'09:30'}
];
const found = vm.runInContext('searchDays(input).map(([d,items])=>d+"="+items.map(e=>e.id+(e.members.length>1?"x"+e.members.length:"")).join(","))',context);
assert.deepEqual([...found], ['2026-09-16=2,3x2','2026-10-02=5,1']);
console.log('Search grouping verified.');
