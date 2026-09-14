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

    def test_year_rollover(self):
        b = workbook([('행정과', [['2026. 12. 28. ~ 2027. 1. 2.'], [], ['담당', '총무'], ['12.31.(목)', '○ 회의'], ['1.1.(금)', '○ 신년']])])
        self.assertEqual(importer.parse_workbook(b)[0][1]['date'], '2027-01-01')

    def test_source_validation(self):
        for url in ['http://localhost/x', 'https://docs.google.com.evil/spreadsheets/d/' + importer.SEEDS[0], 'https://docs.google.com@evil/spreadsheets/d/' + importer.SEEDS[0]]:
            with self.assertRaises(ValueError):
                importer.sheet_id(url)


class BuildTests(unittest.TestCase):
    def test_build_is_deterministic_and_failure_keeps_previous_data(self):
        entries = [dict(url=URL, label='9월', year=2026)]
        first, failures = build_data.build(entries, {}, fetch=lambda sid: MONTH, now='t1')
        self.assertEqual(failures, [])
        self.assertEqual(len(first['events']), 2)
        self.assertEqual(first['sources'][0]['count'], 2)
        self.assertTrue(all(e['source_id'] == importer.SEEDS[0] and e['id'] for e in first['events']))
        self.assertEqual(first, build_data.build(entries, first, fetch=lambda sid: MONTH, now='t1')[0])

        def broken(sid):
            raise ValueError('network')
        second, failures = build_data.build(entries, first, fetch=broken, now='t2')
        self.assertEqual(len(failures), 1)
        self.assertEqual(second['events'], first['events'])
        source = second['sources'][0]
        self.assertEqual((source['error'], source['synced_at'], source['count']), ('network', 't1', 2))
        unsupported, _ = build_data.build(entries, first, fetch=lambda sid: workbook([('unsupported', [['nothing']])]), now='t3')
        self.assertEqual(unsupported['events'], first['events'])
        self.assertTrue(unsupported['sources'][0]['error'])

    def test_invalid_entries_and_duplicates_are_reported(self):
        entries = [dict(url='http://localhost/x'), dict(url=URL, year=2026), dict(url=URL + '#gid=5', year=2026), dict(url=URL2, year=1999)]
        data, failures = build_data.build(entries, {}, fetch=lambda sid: MONTH, now='t')
        self.assertEqual(len(data['sources']), 1)
        self.assertEqual(len(failures), 2)

    def test_registry_sheet_rows(self):
        reg = workbook([('등록', [['주소', '표시 이름', '기준 연도', '사용'], [URL, '9월 1주', '2026', ''], [URL2, '옛 시트', '2025', '중지'], ['메모만 있는 행']])])
        self.assertEqual(build_data.registry_from_sheet(reg), [dict(url=URL, label='9월 1주', year=2026)])

    def test_load_registry_merges_file_and_sheet(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'sources.json'
            p.write_text(json.dumps(dict(registry_sheet=URL, sources=[dict(url=URL, label='파일'), dict(url=URL2, label='꺼짐', active=False)])), encoding='utf-8')
            reg = workbook([('등록', [[URL2, '시트', '2026']])])
            self.assertEqual([e['label'] for e in build_data.load_registry(p, fetch=lambda sid: reg)], ['파일', '시트'])

    def test_main_writes_output_for_empty_registry(self):
        with tempfile.TemporaryDirectory() as d:
            p, out = Path(d) / 'sources.json', Path(d) / 'site' / 'data.json'
            p.write_text('{"sources": []}', encoding='utf-8')
            sys.argv = ['build_data.py', '--sources', str(p), '--output', str(out)]
            self.assertEqual(build_data.main(), 0)
            self.assertEqual(json.loads(out.read_text(encoding='utf-8'))['events'], [])


if __name__ == '__main__':
    unittest.main()
