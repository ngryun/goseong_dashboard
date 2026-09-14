#!/usr/bin/env python3
"""Read the registered Google Sheets and write docs/data.json.

Run: python3 build_data.py
GitHub Actions runs this on a schedule; the page only reads the JSON file.
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
STOP_WORDS = {'중지', '제외', '사용안함', '사용 안함', 'N', 'no', 'false'}
SHEET_URL = re.compile(r'https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{20,100}\S*')


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


def build(entries, previous, fetch=download, now=None):
    """Return (data, failures). A failed source keeps its previous events and records the error."""
    now = now or dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    old_sources = {s['id']: s for s in previous.get('sources', [])}
    old_events = {}
    for e in previous.get('events', []):
        old_events.setdefault(e.get('source_id'), []).append(e)
    sources, events, failures, seen = [], [], [], set()
    for entry in entries:
        label = str(entry.get('label') or '').strip()
        try:
            sid = sheet_id(str(entry.get('url', '')))
            year = entry.get('year')
            year = int(year) if year not in (None, '') else None
            if year is not None and not 2000 <= year <= 2100:
                raise ValueError('기준 연도를 확인하세요.')
        except (ValueError, TypeError) as ex:
            failures.append(f'{label or entry.get("url", "")}: {ex}')
            continue
        if sid in seen:
            continue
        seen.add(sid)
        url = f'https://docs.google.com/spreadsheets/d/{sid}/edit'
        try:
            parsed, warnings, tabs = parse_workbook(fetch(sid), year)
            items = [dict(e, id=hashlib.sha256(f'{sid}:{e["tab"]}:{e["cell"]}:{i}'.encode()).hexdigest()[:24], source_id=sid)
                     for i, e in enumerate(parsed)]
            sources.append(dict(id=sid, url=url, label=label or ' · '.join(tabs[:2]), year=year, synced_at=now,
                                error=None, warnings=warnings, tabs=tabs, count=len(items)))
            events += items
        except Exception as ex:
            prev = old_sources.get(sid, {})
            kept = old_events.get(sid, [])
            sources.append(dict(id=sid, url=url, label=label or prev.get('label') or sid, year=year,
                                synced_at=prev.get('synced_at'), error=str(ex), warnings=prev.get('warnings', []),
                                tabs=prev.get('tabs', []), count=len(kept)))
            events += kept
            failures.append(f'{label or sid}: {ex}')
    events.sort(key=lambda e: (e['date'], e['time'], e['title']))
    return dict(generated_at=now, sources=sources, events=events), failures


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--sources', default=SOURCES_FILE, help='등록 파일 (기본: sources.json)')
    parser.add_argument('--output', default=OUTPUT, help='결과 JSON (기본: docs/data.json)')
    args = parser.parse_args()
    output = Path(args.output)
    previous = json.loads(output.read_text(encoding='utf-8')) if output.exists() else {}
    try:
        entries = load_registry(args.sources)
    except Exception as ex:
        print(f'등록 목록을 읽지 못했습니다: {ex}', file=sys.stderr)
        return 1
    data, failures = build(entries, previous)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=0) + '\n', encoding='utf-8')
    for s in data['sources']:
        print(f'{"실패" if s["error"] else "성공"} · {s["label"]} · {s["count"]}건' + (f' · {s["error"]}' if s['error'] else ''), flush=True)
    print(f'총 {len(data["events"])}건 → {output}', flush=True)
    if failures:
        print(f'{len(failures)}개 시트를 새로 읽지 못해 마지막 데이터를 유지했습니다.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
