const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/app.js','utf8');
const nodes={search:{value:''},kind:{value:''},team:{value:''},calendar:{innerHTML:''},'period-title':{textContent:''},'selected-title':{innerHTML:''},'day-weather':{innerHTML:'',hidden:true}};
const context=vm.createContext({Intl,Date,document:{querySelector:selector=>nodes[selector.slice(1)]}});
const run=code=>vm.runInContext(code,context);
run(source.slice(0,source.indexOf('document.addEventListener(')));
run('const compactScreen={matches:false};todayKey="2026-11-22";today=parseDate(todayKey);cursor=parseDate(todayKey);selected=todayKey;');
const hoursAgo=n=>new Date(Date.now()-n*36e5).toISOString();
const forecast=(over={})=>({checked_at:hoursAgo(0),base:'2026-11-22T08:00+09:00',place:'고성군 간성읍',errors:[],days:[
  {date:'2026-11-21',tmin:0,tmax:5,sky:'snow',pop:80,am:{sky:'snow',pop:80},pm:{sky:'snow',pop:60}},
  {date:'2026-11-22',tmin:-4,tmax:7,sky:'clear',pop:0,am:{sky:'clear',pop:0},pm:{sky:'clear',pop:0}},
  {date:'2026-11-23',tmin:2,tmax:11,sky:'rain',pop:60,am:{sky:'overcast',pop:30},pm:{sky:'rain',pop:60}},
  {date:'2026-11-24',tmin:null,tmax:4.4,sky:'cloudy',pop:20},
  {date:'2026-11-25',tmin:1,tmax:3,sky:'<b>',pop:0}
],...over});
// 발표 시각은 화면에 그대로 적히므로 고정해 두고, '하루가 넘은 예보' 판정에는 테스트 시계를 쓴다.
const issued=new Date('2026-11-22T08:00+09:00').getTime();
const clock=hours=>{context.Date=class extends Date{static now(){return issued+hours*36e5;}};};
clock(2);
context.input=forecast();run('setWeather(input)');

// 짧은 표시: 아이콘 + 최저/최고, 자세한 내용은 title과 낭독용 글자.
let tag=run('weatherTag("2026-11-23")');
assert.ok(tag.includes('class="weather-tag is-wet"'),'rain, snow and showers are emphasized');
assert.ok(tag.includes('title="오전 흐림 · 오후 비 · 최저 2° · 최고 11° · 강수확률 60%"'));
assert.ok(tag.includes('<span class="wx-temp" aria-hidden="true"><span class="wx-low">2° / </span>11°</span>')&&tag.includes('<span class="sr-only">오전 흐림'),'the low can be hidden separately in narrow cells');
tag=run('weatherTag("2026-11-22")');
assert.ok(tag.includes('class="weather-tag"')&&tag.includes('title="맑음 · 최저 -4° · 최고 7°"'),'same sky all day is written once; a 0% chance is left out');
assert.ok(run('weatherTag("2026-11-24")').includes('<span class="wx-temp" aria-hidden="true">4°</span>'),'a missing low is left out and values are rounded');
assert.equal(run('weatherTag("2026-11-21")'),'','past days show no forecast');
assert.equal(run('weatherTag("2026-11-25")'),'','an unknown sky code is dropped');
assert.equal(run('weatherTag("2026-11-26")'),'','days beyond the forecast show nothing');

// 월간 달력: 예보가 있는 날짜 칸에만 붙는다.
run('renderMonth([])');
let html=nodes.calendar.innerHTML;
assert.equal((html.match(/class="weather-tag/g)||[]).length,3);
assert.ok(/data-day="2026-11-23"[^]*?<div class="day-head">[^]*?weather-tag is-wet[^]*?<\/div><button type="button" class="day-add"/.test(html),'the tag sits in the day head');

// 주간 표: 예보가 있는 주의 머리글만 두 줄이 된다. (월요일 시작: 11.16–22, 11.23–29)
run('data.events=[{id:"a",date:"2026-11-23",kind:"weekly",team:"총무팀",title:"업무",time:""},{id:"b",date:"2026-12-01",kind:"weekly",team:"총무팀",title:"업무",time:""}];weekLayout="table";cursor=parseDate("2026-11-23");renderWeek(filterEvents());');
html=nodes.calendar.innerHTML;
assert.equal((html.match(/<th scope="col" class="[^"]*has-weather/g)||[]).length,7);
assert.equal((html.match(/class="weather-tag/g)||[]).length,2,'only the 23rd and 24th of that week are forecast');
run('cursor=parseDate("2026-12-01");renderWeek(filterEvents());');
assert.ok(!nodes.calendar.innerHTML.includes('has-weather')&&!nodes.calendar.innerHTML.includes('weather-tag'),'weeks beyond the forecast keep the one-line header');
run('weekLayout="list";cursor=parseDate("2026-11-23");selected="2026-11-23";renderWeek(filterEvents());');
assert.ok(/<small>1건<span class="weather-tag is-wet"/.test(nodes.calendar.innerHTML),'the day list shows the forecast next to the count');

// 옆 패널: 선택한 날의 날씨와 출처·발표 시각.
run('selected="2026-11-23";setDayTitle();');
assert.equal(nodes['day-weather'].hidden,false);
assert.ok(nodes['day-weather'].innerHTML.includes('<strong>오전 흐림 · 오후 비</strong><span>2° / 11°</span><span>강수확률 60%</span>'));
assert.ok(nodes['day-weather'].innerHTML.includes('<small>고성군 간성읍 · 기상청 단기예보 · 11.22 8시 발표</small>'));
run('selected="2026-12-01";setDayTitle();');
assert.equal(nodes['day-weather'].hidden,true);
assert.equal(nodes['day-weather'].innerHTML,'');
context.input=forecast({place:'<img src=x onerror=alert(1)>'});
run('setWeather(input);selected="2026-11-22";setDayTitle();');
assert.ok(nodes['day-weather'].innerHTML.includes('&lt;img')&&!nodes['day-weather'].innerHTML.includes('<img'),'escape values read from weather.json');

// 오래된 예보와 잘못된 파일.
clock(25);
assert.equal(run('weatherTag("2026-11-23")'),'','a forecast issued more than a day ago is not shown');
clock(2);
context.input={days:null};run('setWeather(input)');
assert.ok(run('weatherTag("2026-11-23")'),'a malformed file keeps the last forecast');
context.input={checked_at:hoursAgo(0),base:null,place:'고성군 간성읍',errors:['기상청 응답 오류 30'],days:[]};run('setWeather(input)');
assert.equal(run('weatherTag("2026-11-23")'),'','a failed collection clears the forecast');
assert.equal(run('weatherInfo.errors.length'),1,'the reason stays available to the status dialog');
console.log('Weather tags, week header, day panel, staleness and escaping verified.');
