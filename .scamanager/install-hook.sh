#!/bin/bash
# SCAManager Hook 설치 스크립트 — 한 번만 실행하면 됩니다
set -euo pipefail
HOOK=".git/hooks/pre-push"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")

cat > "${ROOT}/${HOOK}" << 'HOOK_SCRIPT'
#!/bin/bash
# SCAManager pre-push 코드리뷰 자동 실행
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
CONFIG="${ROOT}/.scamanager/config.json"

[ -f "${CONFIG}" ] || exit 0
command -v python3 &>/dev/null || exit 0

# config.json에서 값 추출 — python3 -c 에 CONFIG를 argv로 전달해 경로 주입 방지
SERVER=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['server'])" "${CONFIG}" 2>/dev/null)
TOKEN=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['token'])" "${CONFIG}" 2>/dev/null)
REPO=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['repo'])" "${CONFIG}" 2>/dev/null)

[ -n "${SERVER}" ] || exit 0

REPO_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "${REPO}")
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${TOKEN}" "${SERVER}/api/hook/verify?repo=${REPO_ENC}" 2>/dev/null)
[ "${STATUS}" = "200" ] || exit 0

read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA < /dev/stdin 2>/dev/null || true
[ -n "${LOCAL_SHA}" ] || LOCAL_SHA="HEAD"
[ -n "${REMOTE_SHA}" ] || REMOTE_SHA="0000000000000000000000000000000000000000"

if [ "${REMOTE_SHA}" = "0000000000000000000000000000000000000000" ]; then
    DIFF=$(git diff HEAD~1 2>/dev/null || git show HEAD 2>/dev/null)
else
    DIFF=$(git diff "${REMOTE_SHA}" "${LOCAL_SHA}" 2>/dev/null)
fi
[ -n "${DIFF}" ] || exit 0

COMMIT_MSG=$(git log --format="%B" -1 "${LOCAL_SHA}" 2>/dev/null)
echo "\n🔍 [SCAManager] 코드리뷰 실행 중..."

# 환경변수로 값 전달 후 python3 로 프롬프트 파일 생성 — heredoc 주입 완전 차단
# Build prompt file via python3 with env vars — eliminates heredoc delimiter injection
# (COMMIT_MSG/DIFF could contain the heredoc terminator on its own line).
TMPFILE=$(mktemp /tmp/scamanager_review.XXXXXX)
SCA_COMMIT_MSG="${COMMIT_MSG}" SCA_DIFF="${DIFF}" python3 -c "
import os, sys
commit_msg = os.environ.get('SCA_COMMIT_MSG', '')
diff_content = os.environ.get('SCA_DIFF', '')
prompt = (
    '다음 변경사항을 분석하고 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.

'
    '코밋 메시지: ' + commit_msg + '

'
    '변경사항:
' + diff_content + '

'
    '채점 유의사항:
'
    '- 일반적으로 양호한 코드는 15~18점 범위입니다.
'
    '- 명확한 문제가 없다면 최소 12점 이상을 부여하세요.

'
    '다음 JSON만 응답:
'
    '{"commit_message_score":<0-20>,"direction_score":<0-20>,"test_score":<0-10>,'
    '"summary":"요약","suggestions":["제안"],"commit_message_feedback":"피드백",'
    '"code_quality_feedback":"피드백","security_feedback":"피드백",'
    '"direction_feedback":"피드백","test_feedback":"피드백","file_feedbacks":[]}'
)
sys.stdout.write(prompt)
" > "${TMPFILE}"

# Anthropic API 직접 호출 — claude -p 대체 (2025-06-15 Agent SDK 크레딧 분리 대응)
# Direct Anthropic API call — replaces claude -p (Agent SDK billing split from 2025-06-15)
[ -n "${ANTHROPIC_API_KEY:-}" ] || {
  echo "⚠️  [SCAManager] ANTHROPIC_API_KEY 환경변수 미설정 — 코드리뷰를 건너뜁니다." >&2
  rm -f "${TMPFILE}"
  exit 0
}
REVIEW_MODEL="${SCAMANAGER_REVIEW_MODEL:-claude-haiku-4-5-20251001}"
RESULT=$(python3 -c "
import json, sys, os, urllib.request
key = os.environ.get('ANTHROPIC_API_KEY', '')
model = sys.argv[2]
with open(sys.argv[1]) as f:
    prompt = f.read()
payload = json.dumps({
    'model': model,
    'max_tokens': 2048,
    'messages': [{'role': 'user', 'content': prompt}]
}).encode()
req = urllib.request.Request(
    'https://api.anthropic.com/v1/messages',
    data=payload,
    headers={
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
    }
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
        print(d['content'][0]['text'])
except Exception:
    pass
" "${TMPFILE}" "${REVIEW_MODEL}" 2>/dev/null) || true
[ -z "${RESULT}" ] && echo "⚠️  [SCAManager] Anthropic API 호출 실패 또는 빈 응답 — 코드리뷰를 건너뜁니다." >&2
rm -f "${TMPFILE}"

if [ -n "${RESULT}" ]; then
    echo "${RESULT}" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(f'\n📊 코드리뷰 결과:')
    print(f'  요약: {d.get("summary","")}')
    print(f'  커밋 메시지: {d.get("commit_message_feedback","")}')
    print(f'  코드 품질: {d.get("code_quality_feedback","")}')
    print(f'  보안: {d.get("security_feedback","")}')
except Exception:
    pass
" 2>/dev/null || true

    # python3에 값을 argv로 전달 — 인라인 스크립트에 변수 삽입 금지
    PAYLOAD=$(python3 -c "
import json, sys
repo, token, sha, msg, result_str = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
try:
    ai = json.loads(result_str)
    print(json.dumps({'repo': repo, 'token': token, 'commit_sha': sha, 'commit_message': msg, 'ai_result': ai}))
except Exception:
    print('{}')
" "${REPO}" "${TOKEN}" "${LOCAL_SHA}" "${COMMIT_MSG}" "${RESULT}" 2>/dev/null) || true

    [ -n "${PAYLOAD}" ] && curl -s -X POST "${SERVER}/api/hook/result"       -H "Content-Type: application/json"       -d "${PAYLOAD}" >/dev/null 2>&1 &
fi

exit 0
HOOK_SCRIPT

chmod +x "${ROOT}/${HOOK}"
echo "✅ SCAManager pre-push 훅 설치 완료: ${ROOT}/${HOOK}"
