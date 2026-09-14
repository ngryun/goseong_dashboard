import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import importer
import build_data


def workbook(tabs):
    b = io.BytesIO()
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    with zipfile.ZipFile(b, 'w') as z:
        z.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + ''.join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="r{i}"/>' for i, (name, _) in enumerate(tabs, 1)) + '</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships>' + ''.join(f'<Relationship Id="r{i}" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(tabs) + 1)) + '</Relationships>')
        for i, (_, rows) in enumerate(tabs, 1):
            xml = ''
            for rn, row in enumerate(rows, 1):
                xml += f'<row r="{rn}">' + ''.join(f'<c r="{importer.col_name(ci)}{rn}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>' for ci, v in enumerate(row, 1)) + '</row>'
            z.writestr(f'xl/worksheets/sheet{i}.xml', f'<worksheet xmlns="{ns}"><sheetData>{xml}</sheetData></worksheet>')
    return b.getvalue()


MONTH = workbook([('9월 월중행사', [['2026년 9월 월중행사'], [], ['', '일', '요일', '시간', '행사명', '', '장소', '담당자'], ['', '1.0', '화', '0.4166666666666667', '', '취임식', '대회의실', '홍길동'], ['', '', '', '18:30', '', '연수', '회의실', '김담당']])])
WEEK = workbook([('교육과1(9월1주)', [['9월 1주 주간업무'], ['2026. 8. 31. ~ 9. 5.'], ['담당', '교육장', '총무팀'], ['8.31.(월)', '○ 학교방문\n- 10:00, 학교\n- 담당\n○ 협의회\n- 14:00, 회의실', '-'], ['9.1.(화)', '○ 연수\n- 09:00, 연수원', '○\n-']])])
URL = 'https://docs.google.com/spreadsheets/d/' + importer.SEEDS[0] + '/edit'
URL2 = 'https://docs.google.com/spreadsheets/d/' + importer.SEEDS[1] + '/edit'


class ParserTests(unittest.TestCase):
    def test_numeric_dates_time_and_merged_date(self):
        e, w, t = importer.parse_workbook(MONTH)
        self.assertEqual(len(e), 2)
        self.assertEqual([x['date'] for x in e], ['2026-09-01'] * 2)
        self.assertEqual(e[0]['time'], '10:00')
        self.assertEqual(e[0]['owner'], '홍길동')

    def test_weekly_split_month_boundary_and_placeholders(self):
        e, _, _ = importer.parse_workbook(WEEK)
        self.assertEqual(len(e), 3)
        self.assertEqual(e[0]['date'], '2026-08-31')
        self.assertEqual(e[2]['date'], '2026-09-01')
        self.assertIn('- 담당', e[0]['description'])

    def test_weekly_details_time_range_place_and_owner(self):
        rows = [['2026. 9. 14. ~ 9. 18.'], [], ['담당', '문화체육특수', '시설팀', '학교지원팀', 'Wee센터'],
                ['9.15.(화)',
                 '○ 지역연계 찾아가는\n   문화예술교육 (루센앙상블)\n- 11:00~12:20, 대진초\n- 남궁연',
                 '○ 학교시설 점검\n- 8.31(월)~9.03(목), 도학초 외 9교\n- 박구원, 윤동열',
                 '○ 순회 컨설팅\n- 10:00, 거진중, 거진고\n- 담당',
                 '○ 위기학생 상담\n- 위센터\n- 14:00']]
        e, _, _ = importer.parse_workbook(workbook([('주간', rows)]))
        self.assertEqual(len(e), 4)
        arts, facilities, consulting, wee = e
        self.assertEqual(arts['title'], '지역연계 찾아가는 문화예술교육 (루센앙상블)')
        self.assertEqual((arts['time'], arts['place'], arts['owner']), ('11:00~12:20', '대진초', '남궁연'))
        self.assertEqual((facilities['time'], facilities['place'], facilities['owner']), ('', '도학초 외 9교', '박구원, 윤동열'))
        self.assertEqual((consulting['time'], consulting['place'], consulting['owner']), ('10:00', '거진중, 거진고', ''))
        # a lone place-like line is not mistaken for a person; the time line without a place leaves place empty
        self.assertEqual((wee['time'], wee['place'], wee['owner']), ('14:00', '', ''))

    def test_weekly_multiple_time_lines_keep_each_pair(self):
        rows = [['2026. 9. 7. ~ 9. 11.'], [], ['담당', '교육장'],
                ['9.8.(화)', '○ 학교 방문\n- 10:00, 거진초, 거성초\n- 13:30, 광산초, 간성초\n- 박기철']]
        e, _, _ = importer.parse_workbook(workbook([('주간', rows)]))
        self.assertEqual((e[0]['time'], e[0]['place'], e[0]['owner']), ('10:00', '거진초, 거성초, 광산초, 간성초', '박기철'))
        self.assertEqual(e[0]['slots'], [dict(time='10:00', place='거진초, 거성초'), dict(time='13:30', place='광산초, 간성초')])

    def test_time_normalization(self):
        self.assertEqual(importer.normalize_time('9:00, 강당')[0], '09:00')
        self.assertEqual(importer.normalize_time('9:30 - 11:00 회의')[0], '09:30~11:00')
        self.assertEqual(importer.normalize_time('오전 회의')[0], '')
        self.assertTrue(importer.looks_like_names('정명훈, 김강진, 서명원'))
        self.assertFalse(importer.looks_like_names('참석'))
        self.assertFalse(importer.looks_like_names('아야진초'))
        self.assertFalse(importer.looks_like_names('학습종합클리닉센터'))

    def test_monthly_time_range_is_normalized(self):
        rows = [['2026년 9월 월중행사'], [], ['', '일', '요일', '시간', '행사명', '', '장소', '담당자'],
                ['', '3', '목', '9:30~11:00', '', '연수', '대회의실', '김담당']]
        e, _, _ = importer.parse_workbook(workbook([('9월 월중행사', rows)]))
        self.assertEqual(e[0]['time'], '09:30~11:00')

    def test_year_rollover(self):
        b = workbook([('행정과', [['2026. 12. 28. ~ 2027. 1. 2.'], [], ['담당', '총무'], ['12.31.(목)', '○ 회의'], ['1.1.(금)', '○ 신년']])])
        self.assertEqual(importer.parse_workbook(b)[0][1]['date'], '2027-01-01')

    def test_source_validation(self):
        for url in ['http://localhost/x', 'https://docs.google.com.evil/spreadsheets/d/' + importer.SEEDS[0], 'https://docs.google.com@evil/spreadsheets/d/' + importer.SEEDS[0]]:
            with self.assertRaises(ValueError):
                importer.sheet_id(url)


class BuildTests(unittest.TestCase):
    ENTRIES = [dict(url=URL, label='9월', year=2026)]
    FETCH_MONTH = staticmethod(lambda sid: MONTH)

    def test_unchanged_content_returns_previous_and_stamps_only_on_change(self):
        first, status = build_data.build(self.ENTRIES, {}, fetch=self.FETCH_MONTH, now='t1')
        self.assertTrue(status['ok'])
        self.assertEqual(status['checked_at'], 't1')
        self.assertEqual(len(first['events']), 2)
        self.assertEqual((first['updated_at'], first['sources'][0]['data_at'], first['sources'][0]['count']), ('t1', 't1', 2))
        self.assertTrue(all(e['source_id'] == importer.SEEDS[0] and e['id'] for e in first['events']))
        again, status = build_data.build(self.ENTRIES, first, fetch=self.FETCH_MONTH, now='t2')
        self.assertIs(again, first)
        self.assertEqual(status['checked_at'], 't2')

    def test_download_failure_keeps_previous_data_and_reports_status(self):
        first, _ = build_data.build(self.ENTRIES, {}, fetch=self.FETCH_MONTH, now='t1')

        def broken(sid):
            raise ValueError('network')
        second, status = build_data.build(self.ENTRIES, first, fetch=broken, now='t2')
        self.assertIs(second, first)
        self.assertFalse(status['ok'])
        self.assertEqual(status['sources'][importer.SEEDS[0]], dict(ok=False, error='network'))
        self.assertEqual(status['failures'], ['9월: network'])
        third, status = build_data.build(self.ENTRIES, first, fetch=lambda sid: workbook([('unsupported', [['nothing']])]), now='t3')
        self.assertIs(third, first)
        self.assertFalse(status['ok'])

    def test_config_error_keeps_previous_data(self):
        first, _ = build_data.build(self.ENTRIES, {}, fetch=self.FETCH_MONTH, now='t1')
        bad = [dict(url=URL, label='9월', year=1999)]
        second, status = build_data.build(bad, first, fetch=self.FETCH_MONTH, now='t2')
        self.assertEqual(second['events'], first['events'])
        self.assertEqual(second['sources'][0]['data_at'], 't1')
        self.assertFalse(status['ok'])
        self.assertIn('기준 연도', status['sources'][importer.SEEDS[0]]['error'])
        second, status = build_data.build([dict(url=URL, label='9월', year='abc')], first, fetch=self.FETCH_MONTH, now='t3')
        self.assertEqual(second['events'], first['events'])
        self.assertFalse(status['ok'])

    def test_tab_that_stops_yielding_events_keeps_previous_events_with_warning(self):
        both = workbook([('9월 월중행사', [['2026년 9월 월중행사'], [], ['', '일', '요일', '시간', '행사명', '', '장소', '담당자'], ['', '1', '화', '10:00', '', '취임식', '대회의실', '홍길동']]),
                         ('교육과', [['2026. 8. 31. ~ 9. 5.'], [], ['담당', '교육장'], ['9.1.(화)', '○ 연수']])])
        first, _ = build_data.build(self.ENTRIES, {}, fetch=lambda sid: both, now='t1')
        self.assertEqual(sorted(e['tab'] for e in first['events']), ['9월 월중행사', '교육과'])
        # 교육과 tab now has a header the importer no longer recognizes
        changed = workbook([('9월 월중행사', [['2026년 9월 월중행사'], [], ['', '일', '요일', '시간', '행사명', '', '장소', '담당자'], ['', '1', '화', '10:00', '', '취임식', '대회의실', '홍길동']]),
                            ('교육과', [['2026. 8. 31. ~ 9. 5.'], [], ['부서', '교육장'], ['9.1.(화)', '○ 연수']])])
        second, status = build_data.build(self.ENTRIES, first, fetch=lambda sid: changed, now='t2')
        self.assertTrue(status['ok'])
        self.assertEqual(sorted(e['tab'] for e in second['events']), ['9월 월중행사', '교육과'])
        self.assertTrue(any('교육과' in w and '이전 데이터 1건을 유지' in w for w in second['sources'][0]['warnings']))
        # tab removed entirely: still kept, different wording, tab listed
        removed = workbook([('9월 월중행사', [['2026년 9월 월중행사'], [], ['', '일', '요일', '시간', '행사명', '', '장소', '담당자'], ['', '1', '화', '10:00', '', '취임식', '대회의실', '홍길동']])])
        third, _ = build_data.build(self.ENTRIES, first, fetch=lambda sid: removed, now='t3')
        self.assertIn('교육과', third['sources'][0]['tabs'])
        self.assertTrue(any('탭이 사라져' in w for w in third['sources'][0]['warnings']))

    def test_invalid_url_and_duplicates_are_reported(self):
        entries = [dict(url='http://localhost/x'), dict(url=URL, year=2026), dict(url=URL + '#gid=5', year=2026)]
        data, status = build_data.build(entries, {}, fetch=self.FETCH_MONTH, now='t')
        self.assertEqual(len(data['sources']), 1)
        self.assertEqual(len(status['failures']), 1)
        self.assertFalse(status['ok'])

    def test_registry_sheet_rows(self):
        reg = workbook([('등록', [['주소', '표시 이름', '기준 연도', '사용'], [URL, '9월 1주', '2026', ''], [URL2, '옛 시트', '2025', '중지'], ['메모만 있는 행']])])
        self.assertEqual(build_data.registry_from_sheet(reg), [dict(url=URL, label='9월 1주', year=2026)])

    def test_load_registry_merges_file_and_sheet(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'sources.json'
            p.write_text(json.dumps(dict(registry_sheet=URL, sources=[dict(url=URL, label='파일'), dict(url=URL2, label='꺼짐', active=False)])), encoding='utf-8')
            reg = workbook([('등록', [[URL2, '시트', '2026']])])
            self.assertEqual([e['label'] for e in build_data.load_registry(p, fetch=lambda sid: reg)], ['파일', '시트'])

    def test_registry_url_is_recorded_and_changes_count_as_content(self):
        first, _ = build_data.build(self.ENTRIES, {}, fetch=self.FETCH_MONTH, now='t1', registry='')
        self.assertEqual(first['registry_sheet'], '')
        again, _ = build_data.build(self.ENTRIES, first, fetch=self.FETCH_MONTH, now='t2', registry=URL2)
        self.assertEqual((again['registry_sheet'], again['updated_at']), (URL2, 't2'))
        same, _ = build_data.build(self.ENTRIES, again, fetch=self.FETCH_MONTH, now='t3', registry=URL2)
        self.assertIs(same, again)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'sources.json'
            p.write_text(json.dumps(dict(registry_sheet=URL + '?gid=0#gid=0', sources=[])), encoding='utf-8')
            self.assertEqual(build_data.registry_url(p), URL)
            p.write_text('{"sources": []}', encoding='utf-8')
            self.assertEqual(build_data.registry_url(p), '')

    def test_main_writes_status_every_run_and_data_only_on_change(self):
        with tempfile.TemporaryDirectory() as d:
            p, out = Path(d) / 'sources.json', Path(d) / 'site' / 'data.json'
            p.write_text('{"sources": []}', encoding='utf-8')
            sys.argv = ['build_data.py', '--sources', str(p), '--output', str(out)]
            self.assertEqual(build_data.main(), 0)
            self.assertEqual(json.loads(out.read_text(encoding='utf-8'))['events'], [])
            first_mtime = out.stat().st_mtime_ns
            status = json.loads((out.parent / 'status.json').read_text(encoding='utf-8'))
            self.assertTrue(status['ok'])
            self.assertEqual(build_data.main(), 0)
            self.assertEqual(out.stat().st_mtime_ns, first_mtime)


if __name__ == '__main__':
    unittest.main()
