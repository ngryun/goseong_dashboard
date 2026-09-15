import json
from pathlib import Path
import sys
import tempfile
import unittest
import datetime as dt
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_schools


def ok(endpoint, items):
    return {endpoint: [{'head': [{'list_total_count': len(items)}, {'RESULT': {'CODE': 'INFO-000', 'MESSAGE': '정상 처리되었습니다.'}}]}, {'row': items}]}


NO_DATA = {'RESULT': {'CODE': 'INFO-200', 'MESSAGE': '해당하는 데이터가 없습니다.'}}
SCHOOLS = [
    dict(SD_SCHUL_CODE='7972013', SCHUL_NM='간성초등학교', SCHUL_KND_SC_NM='초등학교', JU_ORG_NM='강원특별자치도고성교육지원청', ORG_RDNMA='강원특별자치도 고성군 간성읍', ORG_TELNO='033-681-2013', HMPG_ADRES='kansung.gwe.es.kr'),
    dict(SD_SCHUL_CODE='7801111', SCHUL_NM='고성고등학교', SCHUL_KND_SC_NM='고등학교', JU_ORG_NM='강원특별자치도교육청', ORG_RDNMA='강원특별자치도 고성군 간성읍 수성로 125', HS_SC_NM='일반고', HMPG_ADRES='http://goseonggo.gwe.hs.kr'),
    dict(SD_SCHUL_CODE='7801122', SCHUL_NM='동광산업과학고등학교', SCHUL_KND_SC_NM='고등학교', JU_ORG_NM='강원특별자치도교육청', ORG_RDNMA='강원특별자치도 고성군 토성면', HS_SC_NM='특성화고'),
    dict(SD_SCHUL_CODE='7972029', SCHUL_NM='고성중학교', SCHUL_KND_SC_NM='중학교', JU_ORG_NM='강원특별자치도고성교육지원청', ORG_RDNMA='강원특별자치도 고성군 간성읍'),
    dict(SD_SCHUL_CODE='7000001', SCHUL_NM='속초고등학교', SCHUL_KND_SC_NM='고등학교', JU_ORG_NM='강원특별자치도교육청', ORG_RDNMA='강원특별자치도 속초시'),
    dict(SD_SCHUL_CODE='7000002', SCHUL_NM='고성유치원', SCHUL_KND_SC_NM='유치원', JU_ORG_NM='강원특별자치도고성교육지원청', ORG_RDNMA='강원특별자치도 고성군'),
]


def event(ymd, name, kind='해당없음', flags='YYYYYY', content=''):
    row = dict(AA_YMD=ymd, EVENT_NM=name, EVENT_CNTNT=content, SBTR_DD_SC_NM=kind)
    for key, flag in zip(build_schools.GRADE_FLAGS, flags):
        row[key] = flag
    return row


SCHEDULES = {
    '7972013': [event('20260924', '추석', '공휴일'), event('20260905', '토요휴업일', '휴업일'), event('20261012', '현장체험학습', flags='NNYYNN')],
    '7801111': [event('20260924', '추석', '공휴일'), event('20260930', '1회고사', flags='NYY***', content='1·2학년')],
    '7801122': [event('20260924', '추석', '공휴일')],
    '7972029': [],
}


def fake_fetch(endpoint, **params):
    if endpoint == 'schoolInfo':
        return ok(endpoint, SCHOOLS)
    items = SCHEDULES[params['SD_SCHUL_CODE']]
    assert params['AA_FROM_YMD'] == '20260301' and params['AA_TO_YMD'] == '20270331'
    return ok(endpoint, items) if items else NO_DATA


TODAY = dt.date(2026, 9, 15)


class SchoolTests(unittest.TestCase):
    def test_school_list_filters_goseong_elementary_middle_high_and_orders_by_level(self):
        data = build_schools.build({}, now='2026-09-15T00:00:00+00:00', today=TODAY, fetch=fake_fetch)
        self.assertEqual([s['short'] for s in data['schools']], ['간성초', '고성중', '고성고', '동광산업과학고'])
        first = data['schools'][0]
        self.assertEqual((first['level'], first['level_label'], first['homepage'], first['tel']), ('elementary', '초등학교', 'http://kansung.gwe.es.kr', '033-681-2013'))
        self.assertEqual(data['schools'][2]['kind'], '일반고')
        self.assertEqual((data['school_year'], data['range']), (2026, ['2026-03-01', '2027-03-31']))
        self.assertEqual(data['errors'], [])

    def test_events_are_normalized_sorted_and_saturday_closures_dropped(self):
        data = build_schools.build({}, now='t1', today=TODAY, fetch=fake_fetch)
        self.assertEqual([(e['date'], e['school'], e['title']) for e in data['events']],
                         [('2026-09-24', '7801111', '추석'), ('2026-09-24', '7801122', '추석'), ('2026-09-24', '7972013', '추석'),
                          ('2026-09-30', '7801111', '1회고사'), ('2026-10-12', '7972013', '현장체험학습')])
        exam = data['events'][3]
        self.assertEqual((exam['type'], exam['grades'], exam['content']), ('', [2, 3], '1·2학년'))
        self.assertEqual(data['events'][0]['type'], '공휴일')
        self.assertEqual(data['events'][4]['grades'], [3, 4])
        self.assertEqual(data['events'][0]['grades'], [])

    def test_unchanged_content_keeps_updated_at(self):
        first = build_schools.build({}, now='t1', today=TODAY, fetch=fake_fetch)
        again = build_schools.build(first, now='t2', today=TODAY, fetch=fake_fetch)
        self.assertEqual((again['checked_at'], again['updated_at']), ('t2', 't1'))
        changed = build_schools.build(first, now='t3', today=dt.date(2027, 2, 27), fetch=lambda ep, **p: fake_fetch(ep, **dict(p, AA_FROM_YMD='20260301', AA_TO_YMD='20270331')) if ep == 'SchoolSchedule' and p['SD_SCHUL_CODE'] != '7972029' else fake_fetch(ep, **p) if ep == 'schoolInfo' else ok(ep, [event('20270301', '입학식')]))
        self.assertEqual((changed['updated_at'], changed['school_year'], len(changed['events'])), ('t3', 2026, len(first['events']) + 1))

    def test_failures_keep_previous_data_and_are_reported(self):
        first = build_schools.build({}, now='t1', today=TODAY, fetch=fake_fetch)

        def flaky(endpoint, **params):
            if endpoint == 'SchoolSchedule' and params['SD_SCHUL_CODE'] == '7972013':
                raise ValueError('timeout')
            if endpoint == 'SchoolSchedule' and params['SD_SCHUL_CODE'] == '7801111':
                return {'RESULT': {'CODE': 'ERROR-290', 'MESSAGE': '인증키가 유효하지 않습니다.'}}
            return fake_fetch(endpoint, **params)
        second = build_schools.build(first, now='t2', today=TODAY, fetch=flaky)
        self.assertEqual(len(second['errors']), 2)
        self.assertIn('간성초등학교: timeout', second['errors'])
        self.assertTrue(second['errors'][1].startswith('고성고등학교: NEIS SchoolSchedule 응답 오류 ERROR-290'))
        self.assertEqual(second['events'], first['events'])

        def down(endpoint, **params):
            raise ValueError('offline')
        third = build_schools.build(first, now='t3', today=TODAY, fetch=down)
        self.assertEqual(third['schools'], first['schools'])
        self.assertEqual(third['events'], first['events'])
        self.assertEqual(third['errors'][0], '학교 목록: offline')

    def test_pagination_collects_every_page(self):
        calls = []

        def paged(endpoint, **params):
            calls.append(params.get('pIndex'))
            if endpoint == 'schoolInfo':
                return ok(endpoint, SCHOOLS[:1])
            if params['pIndex'] == 1:
                return ok(endpoint, [event('20260401', f'행사{i}') for i in range(1000)])
            return ok(endpoint, [event('20260402', '마지막')])
        data = build_schools.build({}, now='t1', today=TODAY, fetch=paged)
        self.assertEqual(len(data['events']), 1001)
        self.assertEqual(calls, [1, 1, 2])

    def test_freshness_window(self):
        previous = dict(checked_at='2026-09-15T00:00:00+00:00', schools=[{}])
        self.assertTrue(build_schools.is_fresh(previous, '2026-09-15T05:59:00+00:00'))
        self.assertFalse(build_schools.is_fresh(previous, '2026-09-15T06:00:00+00:00'))
        self.assertFalse(build_schools.is_fresh(previous, '2026-09-14T23:00:00+00:00'))
        self.assertFalse(build_schools.is_fresh(dict(checked_at='2026-09-15T00:00:00+00:00'), '2026-09-15T01:00:00+00:00'))
        self.assertFalse(build_schools.is_fresh({}, '2026-09-15T01:00:00+00:00'))
        self.assertFalse(build_schools.is_fresh(dict(checked_at='bad', schools=[{}]), '2026-09-15T01:00:00+00:00'))

    def test_helpers(self):
        self.assertEqual(build_schools.short_name('거진중학교'), '거진중')
        self.assertEqual(build_schools.short_name('동광산업과학고등학교'), '동광산업과학고')
        self.assertEqual(build_schools.school_year(dt.date(2027, 2, 28)), 2026)
        self.assertEqual(build_schools.date_range(dt.date(2027, 3, 1)), ('20270301', '20280331'))
        self.assertEqual(build_schools.rows(NO_DATA, 'SchoolSchedule'), [])
        with self.assertRaises(ValueError):
            build_schools.rows({'unexpected': True}, 'SchoolSchedule')

    def test_main_writes_file_and_skips_when_fresh(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / 'site' / 'schools.json'
            build_schools.fetch_json, original = fake_fetch, build_schools.fetch_json
            try:
                sys.argv = ['build_schools.py', '--output', str(out)]
                self.assertEqual(build_schools.main(), 0)
                written = json.loads(out.read_text(encoding='utf-8'))
                self.assertEqual(len(written['schools']), 4)
                mtime = out.stat().st_mtime_ns
                self.assertEqual(build_schools.main(), 0)
                self.assertEqual(out.stat().st_mtime_ns, mtime, 'a fresh file is not rewritten')
                sys.argv = ['build_schools.py', '--output', str(out), '--force']
                self.assertEqual(build_schools.main(), 0)
                self.assertNotEqual(out.stat().st_mtime_ns, mtime, '--force rewrites the file')
            finally:
                build_schools.fetch_json = original


if __name__ == '__main__':
    unittest.main()
