const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/app.js', 'utf8');
const context = vm.createContext({Intl, Date});
vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('click'")), context);
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
