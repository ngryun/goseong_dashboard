"""Google Sheets XLSX reader. Standard library only; source cells remain available."""
import datetime as dt
import io
import posixpath
import re
import urllib.request
import urllib.parse
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
SEEDS = ['1apWukc8SJtPT9JPEqk8oLFT__hqlAiAHSxAKHWTVg0Y', '1GdhmAsE6UtmYZ94MOu5GoZcYX1DZLCFEMlUlQLeTgEk', '1Wc-_310VglK05imMLdWoKaEQ8KTSH_XXEuaJXAXX9AA', '1m9jB0Cyky_2tck1H7_4JOeODcQcCsYh8UICoQz6FQ6o']

def sheet_id(url):
    p = urllib.parse.urlparse(url.strip())
    m = re.fullmatch(r'/spreadsheets/d/([A-Za-z0-9_-]{20,100})(?:/.*)?', p.path)
    if p.scheme != 'https' or p.netloc != 'docs.google.com' or not m:
        raise ValueError('https://docs.google.com/spreadsheets/d/… 형식의 시트 주소를 입력하세요.')
    return m[1]

def download(sid):
    url = f'https://docs.google.com/spreadsheets/d/{sid}/export?format=xlsx'
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            blob = r.read(10 * 1024 * 1024 + 1)
    except Exception as e:
        raise ValueError('시트를 가져오지 못했습니다. 링크가 있는 사용자에게 보기 권한이 있는지, 서버의 인터넷 연결을 확인하세요.') from e
    if len(blob) > 10 * 1024 * 1024 or not blob.startswith(b'PK'):
        raise ValueError('읽을 수 있는 XLSX가 아닙니다. 시트 공유 권한 또는 파일 크기(최대 10MB)를 확인하세요.')
    return blob

def read_workbook(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        if sum(i.file_size for i in z.infolist()) > 50 * 1024 * 1024:
            raise ValueError('압축 해제된 시트 크기가 너무 큽니다.')
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(t.text or '' for t in e.findall('.//s:t', NS)) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels = {e.attrib['Id']: e.attrib['Target'] for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        result = []
        for s in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            target = rels[s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            path = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            rows = []
            for row in ET.fromstring(z.read(path)).findall('s:sheetData/s:row', NS):
                cells = {}
                for c in row:
                    ref = c.attrib.get('r', '')
                    col = 0
                    for ch in re.match(r'[A-Z]+', ref)[0]:
                        col = col * 26 + ord(ch) - 64
                    val = c.findtext('s:v', '', NS)
                    if c.attrib.get('t') == 's': val = strings[int(val)] if val else ''
                    elif c.attrib.get('t') == 'inlineStr': val = ''.join(t.text or '' for t in c.findall('.//s:t', NS))
                    cells[col - 1] = val.strip()
                rows.append((int(row.attrib['r']), [cells.get(i, '') for i in range(max(cells, default=0) + 1)]))
            result.append({'name': s.attrib['name'], 'rows': rows})
        return result

def col_name(index):
    out = ''
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out

def parse_workbook(blob, year=None):
    tabs = read_workbook(blob)
    events, warnings, recognized = [], [], 0
    for tab in tabs:
        name, rows = tab['name'], tab['rows']
        context = ' '.join(' '.join(r) for _, r in rows[:3])
        ym = re.search(r'(20\d{2})\s*(?:년|\.)', context)
        yr = int(ym[1]) if ym else year
        if not yr:
            warnings.append(f'{name}: 연도를 확인할 수 없어 제외했습니다.'); continue
        def add(date, title, raw, row, col, kind, team='', time='', place='', owner=''):
            events.append(dict(date=date, title=title.strip(), description=raw, tab=name, cell=f'{col_name(col)}{row}', kind=kind, team=team, time=time, place=place, owner=owner))
        if '월중' in name:
            mm = re.search(r'(\d{1,2})\s*월', name)
            if not mm: continue
            recognized += 1
            day = None
            for rn, r in rows:
                r = r + [''] * max(0, 8-len(r))
                if re.fullmatch(r'\d{1,2}(?:\.0+)?', r[1]): day = int(float(r[1]))
                if not day or not (r[5] or r[4]): continue
                try: date = dt.date(yr, int(mm[1]), day).isoformat()
                except ValueError: warnings.append(f'{name} {rn}행: 날짜 오류'); continue
                title = r[5] or r[4]
                raw = title
                if r[4] and r[5] and r[4] != r[5]:
                    raw += '\n원문 추가 기재: ' + r[4]
                    warnings.append(f'{name} {rn}행: 행사명 앞의 추가 기재를 상세에 보존했습니다.')
                time = r[3]
                if re.fullmatch(r'0?\.\d+', time):
                    mins = round(float(time)*1440); time = f'{mins//60:02}:{mins%60:02}'
                add(date, title, raw, rn, 6 if r[5] else 5, 'monthly', time=time, place=r[6], owner=r[7])
        else:
            header = next(((n, r) for n, r in rows if r and r[0] == '담당'), None)
            if not header:
                warnings.append(f'{name}: 지원하는 표 형식이 아니어서 제외했습니다.'); continue
            recognized += 1
            headings = header[1]
            previous_month = None
            active_year = yr
            for rn, r in rows:
                if rn <= header[0] or not r: continue
                match = re.match(r'\s*(\d{1,2})\s*\.\s*(\d{1,2})', r[0])
                if not match:
                    if any(r): warnings.append(f'{name} {rn}행: 날짜 없는 기재를 가져오지 않았습니다.')
                    continue
                month, day = map(int, match.groups())
                if previous_month == 12 and month == 1: active_year += 1
                previous_month = month
                try: date = dt.date(active_year, month, day).isoformat()
                except ValueError: warnings.append(f'{name} {rn}행: 날짜 오류'); continue
                for ci, content in enumerate(r[1:], 1):
                    if not content.strip() or re.fullmatch(r'[\s\-–—○◯●]+', content): continue
                    team = headings[ci] if ci < len(headings) and headings[ci] else name
                    blocks = [b.strip() for b in re.split(r'(?:^|\n)\s*[○◯●]\s*', content) if b.strip()]
                    for block in blocks:
                        if re.fullmatch(r'[\s\-–—]+', block): continue
                        lines = block.splitlines()
                        title_parts = []
                        for line in lines:
                            if line.strip().startswith('-'): break
                            title_parts.append(line.strip())
                        title = ' '.join(title_parts) or lines[0]
                        tm = re.search(r'(?<!\d)([0-2]?\d:[0-5]\d)', block)
                        add(date, title, block, rn, ci+1, 'weekly', team=team, time=tm[1].zfill(5) if tm else '')
    if not recognized: raise ValueError('지원하는 월중행사 또는 주간업무 표를 찾지 못했습니다. 기존 데이터는 유지됩니다.')
    if not events: raise ValueError('가져올 일정이 없습니다. 빈 시트로 기존 데이터를 덮어쓰지 않았습니다.')
    return events, warnings, [t['name'] for t in tabs]
