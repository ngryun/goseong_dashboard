const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/app.js', 'utf8');
const context = vm.createContext({Intl, Date});
vm.runInContext(source.slice(0, source.indexOf('document.addEventListener(')), context);
const run = code => vm.runInContext(code, context);

// 주소: #trend는 날짜 없이도 열리고, 모르는 보기는 버린다.
assert.equal(run('parseRoute("#trend").view'), 'trend');
assert.equal(run('parseRoute("#trend").date'), '');
assert.equal(run('parseRoute("#unknown")'), null);

// 세로 눈금: 학교급마다 시작점은 달라도 폭은 같고, 모든 값이 그 안에 들어간다.
const real = JSON.parse(fs.readFileSync('docs/students.json', 'utf8'));
context.levels = real.county.levels;
const scales = run('levels.map(levelScale(levels))');
assert.equal(new Set(scales.map(s => s.span)).size, 1);
real.county.levels.forEach((l, i) => {
  assert.equal(l.population.length, real.county.years.length, `${l.label} 학령인구 연도 수`);
  assert.equal(l.students.length, real.county.years.length, `${l.label} 재학생 연도 수`);
  for (const v of [...l.population, ...l.students]) assert.ok(v >= scales[i].min && v <= scales[i].min + scales[i].span, `${l.label} ${v}`);
});

// 학교급 카드: 재학생이 학령인구보다 많으면 유입, 적으면 군내 학교에 없는 학생 수와 비율을 적는다.
context.years = [2025, 2026];
context.sample = [
  {label: '가', ages: '만 6~11세', population: [900, 800], students: [950, 860]},
  {label: '나', ages: '만 12~14세', population: [400, 400], students: [310, 300]}
];
const sample = run('sample.map(l=>levelCard(l,years,levelScale(sample)))');
assert.ok(sample[0].includes('860<small>명</small>') && sample[0].includes('2025학년도보다 90명 줄어듦'));
assert.ok(sample[0].includes('800명보다 <b>60명</b> 많음'));
assert.ok(sample[1].includes('400명 중 <b>100명(25%)</b>은 군내 학교에 없음'));

// 실제 자료로 학교급 카드가 만들어진다.
context.years = real.county.years;
const cards = run('levels.map(l=>levelCard(l,years,levelScale(levels))).join("")');
assert.ok(!cards.includes('NaN') && !cards.includes('undefined'));
assert.equal(cards.split('<polyline').length - 1, real.county.levels.length * 2);
console.log('Student trend checks passed');
