#!/usr/bin/env python3
"""Read the Goseong schools and their academic calendars from the NEIS open API into docs/schools.json.

Run: python3 build_schools.py [--force]
GitHub Actions runs this next to build_data.py. The NEIS data changes rarely, so the file is
refreshed only when the previous fetch is older than REFRESH_HOURS (or with --force). Schools
whose calendar cannot be read keep their previous events and are listed in `errors`.
Timetables are not collected here; the page reads them from NEIS on demand.
"""
import argparse
import datetime as dt
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'docs' / 'schools.json'
NEIS = 'https://open.neis.go.kr/hub'
# Open-API key carried over from the earlier school_date project (ngryun/school_date); the page uses the same key.
KEY = '0796f4152d8046ecb4c8265f88ba748b'
OFFICE = 'K10'  # 강원특별자치도교육청
REFRESH_HOURS = 6
LEVELS = {'초등학교': 'elementary', '중학교': 'middle', '고등학교': 'high'}
GRADE_FLAGS = ('ONE_GRADE_EVENT_YN', 'TW_GRADE_EVENT_YN', 'THREE_GRADE_EVENT_YN',
               'FR_GRADE_EVENT_YN', 'FIV_GRADE_EVENT_YN', 'SIX_GRADE_EVENT_YN')
CONTENT_KEYS = ('school_year', 'range', 'schools', 'events')


def fetch_json(endpoint, **params):
    """One NEIS request as a dict. Raises ValueError for HTTP or API errors; a 'no data' answer is returned as is."""
    query = dict(KEY=KEY, Type='json', pIndex=1, pSize=1000)
    query.update(params)
    url = f'{NEIS}/{endpoint}?{urllib.parse.urlencode(query)}'
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as ex:
        raise ValueError(f'NEIS {endpoint} 요청에 실패했습니다: {ex}') from ex


def result_code(payload, endpoint):
    """NEIS puts RESULT at the top level for errors/no-data and inside head[1] for success."""
    if not isinstance(payload, dict):
        return 'INVALID'
    if 'RESULT' in payload:
        return payload['RESULT'].get('CODE', '')
    for item in (payload.get(endpoint) or [{}])[0].get('head', []):
        if 'RESULT' in item:
            return item['RESULT'].get('CODE', '')
    return ''


def rows(payload, endpoint):
    """Rows of a NEIS answer; [] when there is no data; ValueError on API errors."""
    code = result_code(payload, endpoint)
    if code == 'INFO-200':
        return []
    if code != 'INFO-000':
        message = payload.get('RESULT', {}).get('MESSAGE', '') if isinstance(payload, dict) else ''
        raise ValueError(f'NEIS {endpoint} 응답 오류 {code or "형식"}: {message}'.rstrip(': '))
    return list(payload[endpoint][1].get('row', []))


def fetch_rows(endpoint, fetch=fetch_json, **params):
    """All pages of a NEIS list."""
    collected, page = [], 1
    while page <= 20:
        payload = fetch(endpoint, pIndex=page, **params)
        got = rows(payload, endpoint)
        collected += got
        if len(got) < 1000:
            break
        page += 1
    return collected


def is_goseong(row):
    """Elementary/middle schools belong to the Goseong office; high schools report to the province, so match the address too."""
    return '고성' in (row.get('JU_ORG_NM') or '') or '고성군' in (row.get('ORG_RDNMA') or '')


def short_name(name):
    return re.sub(r'(초등|중|고등)학교$', lambda m: m[1][0], name.strip())


def normalize_school(row):
    kind = row.get('SCHUL_KND_SC_NM') or ''
    if kind not in LEVELS:
        return None
    homepage = (row.get('HMPG_ADRES') or '').strip()
    if homepage and not homepage.startswith('http'):
        homepage = 'http://' + homepage
    return dict(code=row['SD_SCHUL_CODE'], name=row['SCHUL_NM'].strip(), short=short_name(row['SCHUL_NM']),
                level=LEVELS[kind], level_label=kind, kind=(row.get('HS_SC_NM') or '').strip(),
                address=(row.get('ORG_RDNMA') or '').strip(), tel=(row.get('ORG_TELNO') or '').strip(), homepage=homepage)


def school_year(day):
    """Korean school years start on March 1."""
    return day.year if day.month >= 3 else day.year - 1


def date_range(day):
    """This school year plus March of the next one, so the calendar can show the start of the following year."""
    ay = school_year(day)
    return f'{ay}0301', f'{ay + 1}0331'


def iso_date(ymd):
    return f'{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}'


def grades_of(row):
    """Grades an event applies to; [] when it applies to every grade the school has."""
    flags = [row.get(k) or '*' for k in GRADE_FLAGS]
    applicable = [i + 1 for i, f in enumerate(flags) if f != '*']
    chosen = [i + 1 for i, f in enumerate(flags) if f == 'Y']
    return [] if not applicable or chosen == applicable else chosen


def normalize_event(school_code, row):
    title = (row.get('EVENT_NM') or '').strip()
    if not title or '토요휴업일' in title:
        return None
    kind = (row.get('SBTR_DD_SC_NM') or '').strip()
    return dict(school=school_code, date=iso_date(row['AA_YMD']), title=title, content=(row.get('EVENT_CNTNT') or '').strip(),
                type='' if kind in ('', '해당없음') else kind, grades=grades_of(row))


def is_fresh(previous, now):
    checked = previous.get('checked_at')
    if not checked or not previous.get('schools'):
        return False
    try:
        age = dt.datetime.fromisoformat(now) - dt.datetime.fromisoformat(checked)
    except (ValueError, TypeError):
        return False
    return dt.timedelta(0) <= age < dt.timedelta(hours=REFRESH_HOURS)


def _content(data):
    return {k: data.get(k) for k in CONTENT_KEYS}


def build(previous, now=None, today=None, fetch=None):
    """Return the new schools.json content. Failures keep the previous schools/events and are listed in `errors`."""
    fetch = fetch or fetch_json
    now = now or dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    today = today or dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
    start, end = date_range(today)
    errors = []
    try:
        schools = [s for s in (normalize_school(r) for r in fetch_rows('schoolInfo', fetch, ATPT_OFCDC_SC_CODE=OFFICE) if is_goseong(r)) if s]
        if not schools:
            raise ValueError('고성군 학교를 찾지 못했습니다.')
        schools.sort(key=lambda s: (list(LEVELS.values()).index(s['level']), s['name']))
    except Exception as ex:
        errors.append(f'학교 목록: {ex}')
        schools = previous.get('schools', [])
    old_events = {}
    for e in previous.get('events', []):
        old_events.setdefault(e['school'], []).append(e)
    events = []
    for school in schools:
        try:
            got = fetch_rows('SchoolSchedule', fetch, ATPT_OFCDC_SC_CODE=OFFICE, SD_SCHUL_CODE=school['code'],
                             AA_FROM_YMD=start, AA_TO_YMD=end)
            events += [e for e in (normalize_event(school['code'], r) for r in got) if e]
        except Exception as ex:
            errors.append(f'{school["name"]}: {ex}')
            events += old_events.get(school['code'], [])
    events.sort(key=lambda e: (e['date'], e['school'], e['title']))
    data = dict(checked_at=now, updated_at=previous.get('updated_at') or now, school_year=school_year(today),
                range=[iso_date(start), iso_date(end)], errors=errors, schools=schools, events=events)
    if _content(data) != _content(previous):
        data['updated_at'] = now
    return data


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=0) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--output', default=OUTPUT, help='학교 JSON (기본: docs/schools.json)')
    parser.add_argument('--force', action='store_true', help=f'{REFRESH_HOURS}시간이 지나지 않아도 다시 읽습니다')
    args = parser.parse_args()
    output = Path(args.output)
    previous = json.loads(output.read_text(encoding='utf-8')) if output.exists() else {}
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    if not args.force and is_fresh(previous, now):
        print(f'학교 일정은 {previous["checked_at"]}에 확인했습니다. {REFRESH_HOURS}시간 안이라 다시 읽지 않습니다.', flush=True)
        return 0
    data = build(previous, now=now)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(dump(data), encoding='utf-8')
    print(f'학교 {len(data["schools"])}개교 · 학사일정 {len(data["events"])}건 · {data["range"][0]} ~ {data["range"][1]} → {output}', flush=True)
    for message in data['errors']:
        print(f'읽지 못함 · {message}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
