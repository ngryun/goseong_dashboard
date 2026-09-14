# 고성교육지원청 업무 대시보드

Google Sheets에 있는 월중행사·주간업무를 읽어 달력과 담당별 주간 표로 보여주는 정적 웹사이트입니다. 서버는 없습니다. GitHub Actions가 매시 정각에 시트를 읽어 `docs/data.json` 하나로 합쳐 두고, GitHub Pages가 `docs/` 폴더를 그대로 서빙합니다. 방문자의 브라우저는 JSON 파일 하나만 읽습니다.

```
sources.json ──▶ build_data.py ──▶ docs/data.json ──▶ docs/index.html
 (시트 목록)   (GitHub Actions,     (합쳐진 일정)       (GitHub Pages)
                매시 정각 실행)
```

## 구성 파일

- `sources.json`: 읽을 시트 목록. 시트를 추가·제거하는 곳입니다.
- `importer.py`: Google 시트를 XLSX로 받아 월중행사·주간업무 표를 해석합니다. 표준 라이브러리만 사용합니다.
- `build_data.py`: 목록의 시트를 모두 읽어 `docs/data.json`을 만듭니다. 실패한 시트는 마지막 데이터를 유지하고 오류를 기록합니다.
- `.github/workflows/sync.yml`: 매시 정각 실행, 수동 실행, `sources.json` 변경 시 실행.
- `docs/`: 화면(`index.html`, `app.js`, `style.css`, 로고 이미지)과 데이터(`data.json`).
- `tests/test_dashboard.py`: 표 해석 규칙과 빌드 동작 검증.
- `_legacy/`: 이전 Python 서버 방식의 파일. 사용하지 않으며 Git에도 올라가지 않습니다. 확인 후 삭제하세요.

## 처음 배포하기

1. GitHub에서 새 저장소를 만듭니다. Actions와 Pages를 무료·무제한으로 쓰려면 공개(public) 저장소여야 합니다. `data.json`에는 시트의 일정과 담당자 이름이 담기므로 공개해도 되는지 확인하세요.
2. 이 폴더를 저장소에 올립니다.

   ```bash
   git init -b main
   git add .
   git commit -m "정적 대시보드 초기 구성"
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```

3. 저장소 **Settings → Pages**에서 Source를 *Deploy from a branch*, Branch를 `main`, 폴더를 `/docs`로 지정합니다. 1~2분 후 `https://<계정>.github.io/<저장소>/` 주소로 열립니다.
4. **Actions** 탭에서 "시트 동기화" 워크플로를 열고 *Run workflow*를 눌러 첫 동기화를 실행합니다. 이후에는 매시 정각에 자동 실행됩니다.
5. 실행이 `git push` 단계에서 403으로 실패하면 **Settings → Actions → General → Workflow permissions**를 *Read and write permissions*로 바꿉니다.

## 시트 추가·제거

`sources.json`의 `sources` 배열에 한 줄을 추가하고 커밋하면 됩니다. 커밋되는 즉시 동기화가 실행됩니다.

```json
{"url": "https://docs.google.com/spreadsheets/d/…/edit", "label": "2026년 10월 1주", "year": 2026}
```

- `label`을 비우면 첫 두 탭 이름을 사용합니다. `year`는 시트 안에 연도가 없을 때 쓰는 기준 연도입니다.
- 잠시 빼려면 `"active": false`를 추가합니다.
- 시트는 "링크가 있는 모든 사용자 보기 가능" 상태여야 합니다.

GitHub을 다루지 않는 관리자가 시트 목록을 관리해야 한다면 `registry_sheet`에 등록용 Google 시트 주소를 넣으세요. 그 시트 첫 탭의 각 행에서 시트 주소, 표시 이름, 네 자리 기준 연도를 읽으며, `중지` 또는 `제외`라고 적힌 행은 건너뜁니다. 이 시트를 편집할 수 있는 사람이 관리자가 됩니다.

## 동작 기준

- 시트는 매시 정각에 읽습니다. GitHub 사정으로 몇 분에서 수십 분 늦어질 수 있습니다. 즉시 반영하려면 Actions에서 수동 실행합니다.
- 화면은 열려 있는 동안 5분마다 `data.json`을 다시 읽습니다.
- 다운로드·해석에 실패한 시트는 마지막으로 성공한 데이터를 유지하고, 화면 오른쪽 "연결된 업무계획" 아래 확인 사항에 오류를 표시합니다. 실패가 있으면 워크플로 실행이 실패로 표시되어 저장소 소유자에게 GitHub 알림이 갑니다.
- 같은 시트를 두 번 등록하면 한 번만 읽습니다. 월중행사와 주간업무의 동일 업무는 출처별로 각각 표시되며, 숫자는 기재된 항목 수입니다.
- 원본 시트에는 쓰기 작업을 하지 않습니다. 완료·진행 상태는 원본에 없으므로 표시하지 않습니다.
- 60일간 저장소에 아무 커밋이 없으면 GitHub이 예약 실행을 끕니다. 데이터 변경이 매시간 커밋되므로 평소에는 해당되지 않습니다.

## 지원하는 시트 형식

### 월중행사

탭 이름에 `월중`과 `N월`이 포함된 양식입니다. B열 날짜, D열 시간, F열 행사명(E열 대체), G열 장소, H열 담당자를 읽습니다. 날짜가 생략된 다음 행은 앞 날짜를 이어받습니다. 숫자 날짜와 엑셀 시간 소수를 처리합니다.

### 주간업무

A열 `담당` 행을 헤더로 인식하고 B열 이후의 담당 분야를 읽습니다. A열 `9.14.(월)` 같은 날짜마다 각 칸의 업무를 가져옵니다. `○`, `◯`, `●`로 나뉜 업무를 별도 항목으로 저장하고 줄바꿈 원문을 보존합니다. `-`만 있는 빈 칸은 제외합니다. 연도는 상단 기재를 우선하고 없으면 `year`를 사용하며, 12월에서 1월로 넘어가면 연도를 올립니다.

새로운 열 배치나 별도 표 양식은 `importer.py`의 매핑 확장이 필요합니다.

## 로컬에서 확인

```bash
python3 build_data.py
python3 -m http.server -d docs 8080
```

`http://127.0.0.1:8080`에서 확인합니다. `index.html`을 파일로 직접 열면 브라우저 보안 정책 때문에 `data.json`을 읽지 못하므로 위처럼 정적 서버가 필요합니다.

```bash
python3 -m unittest discover -s tests -v
node --check docs/app.js
```

## 담당 분야별 주간 화면

주간업무는 담당 분야를 행, 월~일을 열로 표시합니다. 23개 담당 분야를 네 묶음과 지정 순서로 유지하며, 비어 있는 담당도 표시합니다. 교육·장학(파랑), 행정·학교지원(황갈색), 학생·학부모 지원(초록), 인사·교육지원(보라)은 화면 탐색을 위한 묶음 이름이며 `docs/app.js` 상단에서 수정합니다. 월중행사는 별도 행에 표시합니다.
