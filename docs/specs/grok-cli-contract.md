# grok CLI 계약 (실측)

- grok 버전: **0.2.93 (f00f96316d) [stable]**, 플랫폼 Windows 11
- 측정일: 2026-07-12
- 방법: `grok --help`, `grok agent --help`, scratch git 디렉토리에서 실제 `-p` 실행 3회

이 문서는 [Task 0](../plans/2026-07-12-phase1-two-track-mvp.md) 산출물이며, 플랜의
Task 4·6 및 spec의 delegate 설계를 실측으로 정정한다.

## 1. 헤드리스 호출 형태 (정정됨)

**확정 호출:**
```
grok --no-auto-update --always-approve --cwd <DIR> -p "<PROMPT>" --output-format json
```

- `-p, --single <PROMPT>` — 단일턴 헤드리스, stdout에 결과 출력 후 종료. ✓
- `--output-format <plain|json|streaming-json>` [기본 plain]. **`json` 권장** (아래 §2).
- `--cwd <DIR>` — 작업 디렉토리. (`cd` 대신 사용해 셸 이슈 회피.)
- `--no-auto-update` — **헬프에 없지만 에러 없이 수용됨**(exit 0). 붙여도 안전. 절대 원칙 #3 유지 가능.
- **`--always-approve` — 헤드리스 편집에 필수.** 없으면(또는 `--permission-mode acceptEdits`만)
  실행이 `Cancelled`로 끝나고 **파일이 생성되지 않는다**. ⚠️ 이는 기존 설계
  (`docs/01-architecture.md`의 "`--always-approve` 기본 미사용")와 **충돌** — 아래 §5.

## 2. 출력 스키마 (정정됨 — 플랜 가정과 다름)

### `--output-format json` (권장): 단일 JSON 객체
```json
{
  "text": "Creating `hi.txt` ... Created `hi.txt` with the content `hey`.",
  "stopReason": "EndTurn",
  "sessionId": "019f56c1-...",
  "requestId": "071d4a95-...",
  "thought": "The user wants me to create ..."
}
```
- `text` — 어시스턴트 최종 텍스트(요약으로 사용). `thought` — 추론(요약에서 제외).
- **성공 판정은 `stopReason`.** 관측값: `"EndTurn"`(정상 완료), `"Cancelled"`(중단/미실행).
- 파서 = `JSON.parse(stdout)`. 토큰 이어붙이기 불필요.

### `--output-format streaming-json`: JSONL, 토큰 조각
```
{"type":"thought","data":"The"}
{"type":"text","data":"Creating"}
...
{"type":"end","stopReason":"EndTurn","sessionId":"...","requestId":"..."}
```
- 이벤트 타입은 **`thought` / `text` / `end` 뿐**. `data`는 토큰 조각(단어 단위)이라 이어붙여야 함.
- **`tool_use`/`file_edit` 같은 도구·파일 변경 이벤트가 전혀 없다.** (플랜의 `file_edit`/`result`
  가정은 틀림.)

→ 스트리밍이 불필요하므로 **MVP는 `--output-format json`을 쓴다** (파싱 단순, 동일 정보).

## 3. 변경 파일 탐지 (정정됨)

grok 출력(json/streaming-json 어느 쪽도)에 **변경 파일 목록이 없다.** 따라서:

- 변경 파일은 **git으로 도출**한다: 실행 후 `git -C <cwd> status --porcelain` (또는 before/after diff).
- ⚠️ MCP 서버는 grok stdout을 **메모리로만** 캡처해야 한다. stdout을 cwd 안 파일로 리다이렉트하면
  그 파일이 `git status`에 잡혀 오탐이 된다. (현 delegate 설계는 메모리 캡처라 OK.)
- cwd가 git 저장소가 아니면 `filesChanged`는 빈 배열 + 안내로 처리.

## 4. 종료 코드 (정정됨 — 중요)

**exit code는 성공/취소 모두 0이었다.** `--permission-mode acceptEdits`로 아무것도 못 하고
`Cancelled`된 경우에도 exit 0. → **`r.code !== 0`만으로 실패를 판정하면 안 된다.**
성공 여부는 반드시 `stopReason === "EndTurn"`으로 판정한다.

## 5. 안전 모델에 미치는 영향 (사용자 결정 필요)

기존 설계는 "`--always-approve`를 기본으로 쓰지 않는다(안전)"였으나, 실측 결과
**헤드리스로 실제 편집을 하려면 `--always-approve`(혹은 그에 준하는 권한 모드)가 필수**다.
따라서 안전 모델을 다음으로 이동한다(사용자 승인 대상):
- grok은 대상 `cwd`(또는 `--worktree` 격리)에서 편집, **자동 커밋 없음**
- Claude/사람이 diff를 검토한 뒤에만 커밋
- 선택: `--sandbox <PROFILE>`(파일시스템/네트워크 제한), `--worktree`로 작업 격리

## 6. 부수 확인 (기존 미검증 주장 검증됨)

- **`--worktree`(git worktree 격리) 플래그 실재** → README/docs의 "git worktree 격리" 주장 검증됨.
- **`--best-of-n <N>`(병렬 N-way, 헤드리스 전용) 실재** + 서브에이전트(`--agent/--agents`,
  `--no-subagents`) → "병렬 탐색/8 subagent" 결의 근거.
- `--sandbox`(env `GROK_SANDBOX`), `--permission-mode`(default|acceptEdits|auto|dontAsk|
  bypassPermissions|plan), `--check`(자기검증 루프), `grok agent stdio|headless|serve`(ACP류) 존재.

## 7. 플랜에 반영할 정정 요약

- Task 6 delegate 인자: `['--no-auto-update','--always-approve','--cwd',cwd,'-p',prompt,'--output-format','json']`
- Task 4: `summarizeStreamingJson` → `parseGrokResult(stdout): { text, stopReason }` (JSON.parse 기반)
- Task 6: 성공=`stopReason==='EndTurn'`, 실패 분류는 stopReason + stderr 신호; `filesChanged`는
  `git -C cwd status --porcelain`에서 도출
- Global constraint: `streaming-json` → `json`; `--always-approve` 필수(안전 모델 §5)
- 인증 만료 신호(§ auth-error 정규식)는 만료 재현 시 추가 캡처 필요 (미측정 — 별도 확인)
