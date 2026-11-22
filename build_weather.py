#!/usr/bin/env python3
"""Read the KMA short-term forecast (기상청 단기예보) for Goseong into docs/weather.json.

Run: KMA_SERVICE_KEY=... python3 build_weather.py
GitHub Actions runs this next to build_data.py, with the data.go.kr key from the repository secret
KMA_SERVICE_KEY. The key never reaches the page: the browser only reads the generated JSON.
Without the key nothing is written and the page simply shows no weather. A failed request writes
an empty forecast with the reason in `errors`, and never fails the workflow.

The forecast is issued eight times a day and reaches about four days ahead. Each run reads the latest
issue, plus today's 02:00 issue: later issues no longer carry today's low/high or the hours already past.
"""
import argparse
import collections
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'docs' / 'weather.json'
API = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst'
KEY_ENV = 'KMA_SERVICE_KEY'
PLACE = '고성군 간성읍'
GRID = (85, 145)  # KMA 5km grid cell of 간성읍 (군청·교육지원청), from the guide's Lambert conversion of 38.38N 128.47E
KST = dt.timezone(dt.timedelta(hours=9))
BASE_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)
PUBLISH_DELAY = dt.timedelta(minutes=15)  # an issue is served about ten minutes after its base time
PAGE_SIZE = 1000
# Working hours decide the summary of a day: an outdoor event cares about 06-18, not about rain at 3 a.m.
AM_HOURS, PM_HOURS = range(6, 12), range(12, 19)
WET = {'1': 'rain', '2': 'sleet', '3': 'snow', '4': 'shower'}
DRY = {'1': 'clear', '3': 'cloudy', '4': 'overcast'}
WET_ORDER = ('snow', 'sleet', 'rain', 'shower')
DRY_ORDER = ('clear', 'cloudy', 'overcast')


def fetch_page(key, base_date, base_time, page, attempts=3):
    """One page of one forecast issue as a dict. Raises ValueError; the message never contains the key."""
    query = urllib.parse.urlencode(dict(serviceKey=key, pageNo=page, numOfRows=PAGE_SIZE, dataType='JSON',
                                        base_date=base_date, base_time=base_time, nx=GRID[0], ny=GRID[1]))
    problem = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(2 * attempt)
        try:
            with urllib.request.urlopen(f'{API}?{query}', timeout=30) as r:
                body = r.read().decode('utf-8', 'replace')
        except Exception as ex:
            problem = f'{type(ex).__name__}: {getattr(ex, "reason", None) or getattr(ex, "code", "") or "요청 실패"}'
            continue
        try:
            return json.loads(body)
        except ValueError:
            # data.go.kr answers key and quota errors as XML even when JSON was asked for.
            problem = 'JSON이 아닌 응답: ' + ' '.join(body.split())[:160]
    raise ValueError(f'기상청 단기예보 요청에 실패했습니다 ({problem})')


def latest_base(now):
    """The newest issue already served at `now` (KST)."""
    t = now.astimezone(KST) - PUBLISH_DELAY
    hours = [h for h in BASE_HOURS if h <= t.hour]
    if not hours:
        t, hours = t - dt.timedelta(days=1), [BASE_HOURS[-1]]
    return t.replace(hour=hours[-1], minute=0, second=0, microsecond=0)


def fetch_issue(base, fetch):
    """Every item of the issue with base time `base`."""
    items, page = [], 1
    while page <= 10:
        payload = fetch(base.strftime('%Y%m%d'), base.strftime('%H%M'), page)
        response = payload.get('response', {}) if isinstance(payload, dict) else {}
        header = response.get('header', {})
        if header.get('resultCode') != '00':
            raise ValueError(f'기상청 응답 오류 {header.get("resultCode", "형식")}: {header.get("resultMsg", "")}'.rstrip(': '))
        body = response.get('body') or {}
        got = (body.get('items') or {}).get('item') or []
        items += got
        if not got or len(items) >= int(body.get('totalCount') or 0):
            break
        page += 1
    return items


def number(value):
    try:
        return round(float(value))
    except (TypeError, ValueError):
        return None


def summarize(slots):
    """Sky and highest chance of rain over some forecast hours; None when no hour has a usable sky."""
    wet = {WET.get(str(s.get('PTY'))) for s in slots} - {None}
    if wet:
        sky = next(k for k in WET_ORDER if k in wet)
    else:
        counts = collections.Counter(DRY[str(s['SKY'])] for s in slots if str(s.get('SKY')) in DRY)
        if not counts:
            return None
        # The most frequent sky; a tie goes to the cloudier one.
        sky = max(counts, key=lambda k: (counts[k], DRY_ORDER.index(k)))
    pops = [p for p in (number(s.get('POP')) for s in slots) if p is not None]
    return dict(sky=sky, pop=max(pops) if pops else None)


def days_of(issues):
    """Daily summaries from forecast issues given oldest first; a newer issue replaces the hours it also covers."""
    hours, lows, highs = {}, {}, {}
    for items in issues:
        fresh = collections.defaultdict(dict)
        for item in items:
            date, hour, category, value = item.get('fcstDate'), item.get('fcstTime'), item.get('category'), item.get('fcstValue')
            if not (isinstance(date, str) and len(date) == 8 and isinstance(hour, str) and hour[:2].isdigit()):
                continue
            if category == 'TMN':
                lows[date] = number(value)
            elif category == 'TMX':
                highs[date] = number(value)
            else:
                fresh[date, int(hour[:2])][category] = value
        hours.update(fresh)
    days = []
    for date in sorted({d for d, _ in hours}):
        part = lambda wanted: summarize([slot for (d, h), slot in hours.items() if d == date and h in wanted])
        am, pm, whole = part(AM_HOURS), part(PM_HOURS), part(range(AM_HOURS[0], PM_HOURS[-1] + 1))
        # The last day of an issue often has only its first hours; a day needs both halves to be summarized.
        if not (am and pm):
            continue
        days.append(dict(date=f'{date[:4]}-{date[4:6]}-{date[6:]}', tmin=lows.get(date), tmax=highs.get(date),
                         sky=whole['sky'], pop=whole['pop'], am=am, pm=pm))
    return days


def build(now, fetch):
    """The weather.json content for `now`. Raises ValueError when the latest issue cannot be read."""
    now = now.astimezone(KST)
    latest = latest_base(now)
    today = now.date()
    errors, issues = [], []
    # Before the day's 02:00 issue is out, the latest one (yesterday 23:00) still covers the whole day.
    morning = dt.datetime.combine(today, dt.time(2), KST)
    if morning < latest:
        try:
            issues.append(fetch_issue(morning, fetch))
        except Exception as ex:
            errors.append(f'오늘 02시 발표분: {ex}')
    issues.append(fetch_issue(latest, fetch))
    days = [d for d in days_of(issues) if d['date'] >= today.isoformat()]
    if not days:
        raise ValueError('예보 항목이 비어 있습니다.')
    return dict(checked_at=now.astimezone(dt.timezone.utc).isoformat(timespec='seconds'), base=latest.isoformat(timespec='minutes'),
                place=PLACE, grid=list(GRID), errors=errors, days=days)


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=0) + '\n'


def main(argv=None, fetch=None, now=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--output', default=OUTPUT, help='날씨 JSON (기본: docs/weather.json)')
    args = parser.parse_args(argv)
    output = Path(args.output)
    key = os.environ.get(KEY_ENV, '').strip()
    if not key and fetch is None:
        print(f'{KEY_ENV}가 없어 날씨를 읽지 않습니다. 화면은 날씨 없이 표시됩니다.', flush=True)
        return 0
    fetch = fetch or (lambda base_date, base_time, page: fetch_page(key, base_date, base_time, page))
    now = now or dt.datetime.now(KST)
    try:
        data = build(now, fetch)
    except Exception as ex:
        data = dict(checked_at=now.astimezone(dt.timezone.utc).isoformat(timespec='seconds'), base=None, place=PLACE,
                    grid=list(GRID), errors=[str(ex)], days=[])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(dump(data), encoding='utf-8')
    if data['days']:
        print(f'날씨 {PLACE} · {data["base"]} 발표 · {data["days"][0]["date"]} ~ {data["days"][-1]["date"]} → {output}', flush=True)
    for message in data['errors']:
        # A GitHub Actions warning annotation; the run still succeeds and the calendar is deployed.
        print(f'::warning title=날씨 수집::{message}', flush=True)
        print(f'읽지 못함 · {message}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
