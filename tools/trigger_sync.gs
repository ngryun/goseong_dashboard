/**
 * 고성교육지원청 대시보드 · 외부 타이머 (Google Apps Script)
 *
 * GitHub Actions의 예약 실행(schedule)이 늦거나 누락될 때를 대비해, Google Apps Script의
 * 시간 트리거가 15분마다 GitHub에 "시트 동기화" 워크플로 실행(workflow_dispatch)을 요청합니다.
 * 최근 10분 안에 이미 실행된 기록이 있으면 요청하지 않으므로, GitHub 예약이 정상 동작하는
 * 시간대에도 중복 실행이 생기지 않습니다.
 *
 * 설정 방법 (약 5분)
 * 1. GitHub 토큰 만들기
 *    GitHub → 프로필 → Settings → Developer settings → Personal access tokens
 *    → Fine-grained tokens → Generate new token
 *    - Token name: goseong-dashboard-trigger
 *    - Expiration: 1년 (만료 전 새 토큰으로 교체)
 *    - Repository access: Only select repositories → ngryun/goseong_dashboard
 *    - Permissions → Repository permissions → Actions: Read and write
 *      (다른 권한은 모두 No access로 둡니다)
 *    생성된 토큰 문자열을 복사합니다. 이 화면을 벗어나면 다시 볼 수 없습니다.
 * 2. script.google.com → 새 프로젝트 → 기본 코드를 지우고 이 파일 내용을 붙여넣기 → 저장
 * 3. 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성 → 속성 추가
 *    - 속성: GITHUB_TOKEN   값: 1에서 복사한 토큰
 *    토큰은 여기에만 저장하고 코드에는 절대 적지 않습니다.
 * 4. 편집기 상단에서 함수 installTrigger 선택 → 실행 → 권한 승인(1회)
 * 5. 왼쪽 시계 아이콘(트리거)에서 triggerSync 15분 간격 트리거가 보이면 완료
 *
 * 확인: 함수 triggerSync 를 직접 실행하면 GitHub 저장소 Actions 탭에
 * "시트 동기화 · workflow_dispatch" 실행이 즉시 생깁니다.
 * 중지: 함수 removeTrigger 실행.
 */

const OWNER = 'ngryun';
const REPO = 'goseong_dashboard';
const WORKFLOW_FILE = 'sync.yml';
const BRANCH = 'main';
const SKIP_IF_RUN_WITHIN_MINUTES = 10;

function githubHeaders_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('스크립트 속성 GITHUB_TOKEN 이 없습니다. 설정 방법 3번을 확인하세요.');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function minutesSinceLastRun_() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`;
  const response = UrlFetchApp.fetch(url, { headers: githubHeaders_(), muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return Infinity;
  const runs = JSON.parse(response.getContentText()).workflow_runs || [];
  if (!runs.length) return Infinity;
  return (Date.now() - new Date(runs[0].created_at).getTime()) / 60000;
}

function triggerSync() {
  const since = minutesSinceLastRun_();
  if (since < SKIP_IF_RUN_WITHIN_MINUTES) {
    console.log(`최근 ${since.toFixed(1)}분 전에 실행된 기록이 있어 이번에는 요청하지 않습니다.`);
    return;
  }
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: githubHeaders_(),
    payload: JSON.stringify({ ref: BRANCH }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code !== 204) {
    throw new Error(`GitHub 응답 ${code}: ${response.getContentText().slice(0, 200)}`);
  }
  console.log('시트 동기화 워크플로 실행을 요청했습니다.');
}

function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('triggerSync').timeBased().everyMinutes(15).create();
  console.log('15분 간격 트리거를 설치했습니다.');
}

function removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'triggerSync')
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log('기존 triggerSync 트리거를 제거했습니다.');
}
