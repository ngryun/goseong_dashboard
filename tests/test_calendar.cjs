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
