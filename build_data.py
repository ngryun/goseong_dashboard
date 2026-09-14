#!/usr/bin/env python3
"""Read the registered Google Sheets and write docs/data.json and docs/status.json.

Run: python3 build_data.py
GitHub Actions runs this on a schedule, commits data.json only when the schedule
content changed, and deploys docs/ to GitHub Pages. status.json is written on
every run and is not committed.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path
from importer import download, parse_workbook, read_workbook, sheet_id

ROOT = Path(__file__).resolve().parent
SOURCES_FILE = ROOT / 'sources.json'
OUTPUT = ROOT / 'docs' / 'data.json'
STATUS = ROOT / 'docs' / 'status.json'
STOP_WORDS = {'중지', '제외', '사용안함', '사용 안함', 'N', 'no', 'false'}
SHEET_URL = re.compile(r'https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{20,100}\S*')
CONTENT_KEYS = ('id', 'url', 'label', 'year', 'tabs', 'warnings', 'count')


def registry_from_sheet(blob):
    """Read sheet registrations from the first tab of a workbook.

    Each row needs one Google Sheets address; the next filled cell is the label and
    a four-digit year cell is the base year. Rows containing 중지 or 제외 are skipped.
    """
    entries = []
    for tab in read_workbook(blob)[:1]:
        for _, row in tab['rows']:
            cells = [c for c in row if c]
            if any(c in STOP_WORDS for c in cells):
                continue
            url = next((c for c in cells if SHEET_URL.fullmatch(c)), None)
            if not url:
                continue
            rest = [c for c in cells if c != url]
            year = next((int(c) for c in rest if re.fullmatch(r'20\d{2}', c)), None)
            label = next((c for c in rest if not re.fullmatch(r'20\d{2}', c)), '')
            entries.append(dict(url=url, label=label, year=year))
    return entries


def load_registry(path=SOURCES_FILE, fetch=download):
    config = json.loads(Path(path).read_text(encoding='utf-8'))
    entries = [e for e in config.get('sources', []) if e.get('active', True)]
    if config.get('registry_sheet'):
        entries += registry_from_sheet(fetch(sheet_id(config['registry_sheet'])))
    return entries


def _content(source):
    return {k: source.get(k) for k in CONTENT_KEYS}


def _events_by_tab(events):
    grouped = {}
    for e in events:
        grouped.setdefault(e['tab'], []).append(e)
    return grouped


def collect(sid, blob, year, previous_events):
    """Parse one workbook. Tabs that used to hold schedules but now yield nothing keep
    their previous events, with a warning, so a changed tab layout cannot silently drop data."""
    parsed, warnings, tabs = parse_workbook(blob, year)
    items = [dict(e, id=hashlib.sha256(f'{sid}:{e["tab"]}:{e["cell"]}:{i}'.encode()).hexdigest()[:24], source_id=sid)
             for i, e in enumerate(parsed)]
    now_by_tab, old_by_tab = _events_by_tab(items), _events_by_tab(previous_events)
    for tab, old_items in old_by_tab.items():
        if tab in now_by_tab:
            continue
        reason = '이번 수집에서 일정을 찾지 못해' if tab in tabs else '탭이 사라져'
        warnings.append(f'{tab}: {reason} 이전 데이터 {len(old_items)}건을 유지했습니다. 탭 양식 변경 여부를 확인하세요.')
        items += old_items
        if tab not in tabs:
            tabs.append(tab)
    return items, warnings, tabs


def build(entries, previous, fetch=download, now=None):
    """Return (data, status).

    data: schedule content plus data_at/updated_at stamps; equals `previous` when nothing changed.
    status: this run's check time and per-source ok/error, never persisted in git.
    A source that fails to download, parse, or validate keeps its previous data and is reported in status.
    """
    now = now or dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    old_sources = {s['id']: s for s in previous.get('sources', [])}
    old_events = {}
    for e in previous.get('events', []):
        old_events.setdefault(e.get('source_id'), []).append(e)
    sources, events, seen = [], [], set()
    status = dict(checked_at=now, ok=True, failures=[], sources={})

    def fail(sid, label, message):
        status['ok'] = False
        status['failures'].append(f'{label or sid}: {message}')
        if sid:
            status['sources'][sid] = dict(ok=False, error=message)

    def keep_previous(sid, url, label, year):
        prev = old_sources.get(sid)
        kept = old_events.get(sid, [])
        if prev is None:
            prev = dict(id=sid, url=url, label=label or sid, year=year, tabs=[], warnings=[], count=0, data_at=None)
        sources.append(dict(prev, label=label or prev.get('label') or sid, count=len(kept)))
        events.extend(kept)

    for entry in entries:
        label = str(entry.get('label') or '').strip()
        try:
            sid = sheet_id(str(entry.get('url', '')))
        except ValueError as ex:
            fail(None, label or str(entry.get('url', '')), str(ex))
            continue
        if sid in seen:
            continue
        seen.add(sid)
        url = f'https://docs.google.com/spreadsheets/d/{sid}/edit'
        try:
            year = entry.get('year')
            year = int(year) if year not in (None, '') else None
            if year is not None and not 2000 <= year <= 2100:
                raise ValueError('기준 연도를 확인하세요.')
        except (ValueError, TypeError):
            fail(sid, label, f'기준 연도 설정이 올바르지 않습니다: {entry.get("year")!r}. 이전 데이터를 유지했습니다.')
            keep_previous(sid, url, label, old_sources.get(sid, {}).get('year'))
            continue
        try:
            items, warnings, tabs = collect(sid, fetch(sid), year, old_events.get(sid, []))
        except Exception as ex:
            fail(sid, label, str(ex))
            keep_previous(sid, url, label, year)
            continue
        source = dict(id=sid, url=url, label=label or ' · '.join(tabs[:2]), year=year, tabs=tabs,
                      warnings=warnings, count=len(items))
        prev = old_sources.get(sid)
        same = prev is not None and _content(prev) == _content(source) and old_events.get(sid, []) == items
        source['data_at'] = prev.get('data_at') if same and prev.get('data_at') else now
        sources.append(source)
        events.extend(items)
        status['sources'][sid] = dict(ok=True, error=None)

    events.sort(key=lambda e: (e['date'], e['time'], e['title']))
    unchanged = ([_content(s) for s in previous.get('sources', [])] == [_content(s) for s in sources]
                 and previous.get('events', []) == events)
    if unchanged and previous.get('updated_at'):
        return previous, status
    return dict(updated_at=now, sources=sources, events=events), status


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=0) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--sources', default=SOURCES_FILE, help='등록 파일 (기본: sources.json)')
    parser.add_argument('--output', default=OUTPUT, help='일정 JSON (기본: docs/data.json)')
    parser.add_argument('--status', default=None, help='상태 JSON (기본: 일정 JSON 옆의 status.json)')
    args = parser.parse_args()
    output = Path(args.output)
    status_file = Path(args.status) if args.status else output.with_name('status.json')
    previous = json.loads(output.read_text(encoding='utf-8')) if output.exists() else {}
    try:
        entries = load_registry(args.sources)
    except Exception as ex:
        print(f'등록 목록을 읽지 못했습니다: {ex}', file=sys.stderr)
        return 1
    data, status = build(entries, previous)
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = dump(data)
    changed = not output.exists() or output.read_text(encoding='utf-8') != serialized
    if changed:
        output.write_text(serialized, encoding='utf-8')
    status_file.write_text(dump(status), encoding='utf-8')
    for s in data['sources']:
        st = status['sources'].get(s['id'], {})
        print(f'{"성공" if st.get("ok") else "실패"} · {s["label"]} · {s["count"]}건' + (f' · {st["error"]}' if st.get('error') else ''), flush=True)
    print(f'총 {len(data["events"])}건 · data.json {"변경" if changed else "변경 없음"} → {output}', flush=True)
    if status['failures']:
        print(f'{len(status["failures"])}개 시트를 새로 읽지 못해 마지막 데이터를 유지했습니다.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
