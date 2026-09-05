# 10. 서비스 감사 — 열린 결함 큐 (2026-09-05 실측)

이 문서는 **지금 열려 있는 코드 결함의 SSOT**다. `docs/09`가 "범위가 끝났다"를 말하는 곳이라면,
여기는 "그 범위 안에서 실제로 무엇이 고장나 있나"를 말한다. 항목을 고치면 여기서 지운다.

> **이 문서가 존재하는 이유:** 2026-09-05 감사는 세션 안에서만 살아 있었다. 결과를 레포에
> 남기지 않으면 다음 세션은 같은 53개 항목을 다시 실행해야 한다.

## 측정 방법 (재현하려면)

배포 번들을 `.mcp.json`이 하는 것과 **똑같이** stdio로 띄워 채점했다 — 세션의 MCP 프로세스는
설치 시점 버전에 고정돼 있어 그걸로 채점하면 엉뚱한 산출물을 채점하게 된다.

```bash
node .claude/tools/mcpcall.mjs list
node .claude/tools/mcpcall.mjs call grok_auth_check '{}'      # serverVersion 으로 대상 확인
GROK_BUILD_AUTH_MODE=api node .claude/tools/mcpcall.mjs call grok_auth_check '{}'
```

53개 항목을 실행하고 각 항목을 **독립 재실행자**가 재측정했다. 결과: PASS 29 · DEGRADED 20 ·
FAIL 4. FAIL 4건은 v0.2.19로 나갔다(`docs/releases/v0.2.19.md`).

⚠️ 실제 위임을 돌리므로 **구독 쿼터를 쓴다**. 시험은 반드시 버릴 디렉터리에서, 프롬프트는
작게, `~/.grok`은 절대 건드리지 않는다(`grok login`/`logout` 금지).

---

## A. 지금 열린 것 — 사용자 피해순

각 항목: **무엇이 사용자에게 보이나** → 최소 수정. 파일은 `mcp-server/src/` 기준.

### A1. 명시 `signals`가 위험 판정을 끌 수 있다 (`routing.ts`)

v0.2.19가 `destructive`·`production`만 OR 병합으로 막았고 **나머지는 그대로**다. 실측:

| 호출 | 판정 |
|---|---|
| `{task: "rotate the OAuth client secret and update the auth middleware"}` | HIGH |
| `+ signals:{security:false}` | **MEDIUM** |
| `+ 전 필드 채운 구조체` | **LOW** |

omitempty 없는 Go `encoding/json`이나 Python `asdict`가 만드는 구조체는 매 호출
`security:false`를 보내 **세션 전체에서 안전망을 끈다**. 소비자는 끄려는 의도조차 없었다.

→ `RISK_RAISING`에 `security`·`regulated`·`architecture`·`monorepoWide`·`finalReview`를 넣는다
(즉 HIGH_KEYS 전부). 낮추는 신호만 명시로 덮을 수 있게 한다.
별건: `meteredBilling`(camelCase)는 오류 없이 무음 폐기된다 — 미지 키는 거부하는 편이 낫다.

### A2. `grok_cli` passthrough에 이력도 hook 게이트도 없다

`grok_cli {"args":["-p","…","--always-approve"]}`는 실제 편집·쿼터 소모 턴인데
`history.jsonl`에 **0건**이고, `hooks/hooks.json` matcher가
`grok_build_(delegate|plan|verify)`뿐이라 PreToolUse도 안 탄다. `/grok:usage`·`/grok:status`가
실사용을 과소보고한다.

→ matcher에 `grok_cli`를 추가하고, `-p`를 포함한 passthrough 런은 `recordDelegation`으로 남긴다.

### A3. `resume`가 caller의 cwd를 조용히 무시한다 (`delegate.ts`)

`cwd=A`로 resume 위임을 했는데 파일은 **원 세션의 디렉터리 B**에 기록되고, 응답은
`completed`·`filesChanged: []`, history의 `cwd`도 A로 잘못 남는다. 아무 신호가 없다.

→ 결과에 `resumedCwd`를 노출하고 요청 cwd와 다르면 경고. 최소한 `filesChanged`를 두 디렉터리
모두에서 계산한다.

### A4. `worktree remove`가 미적용 산출물을 복구 불가하게 지운다 (`worktree.ts`)

apply 전에 remove하면 grok 결과물이 사라지고 응답은 `ok:true`뿐이다. blob·reflog·브랜치
어디에도 남지 않는다(실측). 같은 데이터에 대해 `prune`은 "확실히 깨끗하지 않으면 안 지운다"인데
`remove`는 **무조건 `--force`**다.

→ `--force` 앞에 dirty 프로브를 넣고, 미커밋·untracked가 있으면 거부하거나 명시적
`force: true`를 요구한다.

### A5. `prune`이 진짜 orphan을 절대 수집하지 못한다 (`worktree.ts`)

prune을 돌리는 **유일한 이유**가 안 되는 경우다. 소유 repo가 삭제되면
`git -C <tree> status`가 실패 → `dirty`가 `undefined` → `c.dirty !== false` 가드가
`skippedDirty`로 보낸다. 매번 후보로 뜨고 매번 건너뛴다. 반대로 실제로 삭제되는 유일한 경로는
baseDir 아래 우연히 놓인 독립 repo의 **커밋된 이력**이다.

→ baseDir 안에 있고 소유 repo를 못 찾은 디렉터리를 orphan 후보로 분류하고, `removedOrphan`은
grok이 만든 이름 패턴에만 적용한다.

### A6. promptPreview 마스킹 구멍 (`history.ts`)

프롬프트에 붙여넣은 `DATABASE_URL=postgres://app:PW@…`, `Authorization: Basic …`, 종결 마커
없는 PEM, `sk_live_`, `AIza…`가 원문으로 남고 `usage.recent[]`·`status.lastSession`이 **매
대시보드 호출마다** Claude 컨텍스트로 되돌려준다.

⚠️ 이 규칙은 **프로덕션에서 한 번도 발동한 적이 없다** — 실제 1779행에 `<redacted>` 0건. 즉
동작 주장 전체가 실사용 트래픽으로 검증된 적이 없다.

→ `scheme://user:pass@` 패턴, `DATABASE_URL`/`DB_URL`/`CONNECTION_STRING` 키,
`PRIVATE_KEY_BLOCK`의 `-----END-----` 필수 조건 제거, BEARER 정규식에 `Basic` 추가.

### A7. PreToolUse hook의 subscription deny 분기가 출하 상태에서 죽어 있다 (`hook.ts`)

최종 경험은 정상이다(서버가 1.1초 만에 차단). 그러나 **방어 계층 하나가 무장돼 있지 않다**:
`.mcp.json`에 env 블록이 없어 `GROK_BUILD_AUTH_MODE`가 미설정 → `resolveHookMode`는 `unknown`
→ auth.json 검사 스킵. 코드 주석의 근거("키가 서버 전용 env에 있을 수 있다")는 이 산출물에
해당하지 않는다. hook은 엄격 비교, 서버는 trim+lowercase라 대소문자·공백에서도 어긋난다.

→ `resolveHookMode`가 미설정을 서버와 같이 `subscription`으로 읽게 하고 trim+lowercase를 맞춘다.

### A8. `worktree diff`의 `diffStat`이 untracked를 빠뜨린다 (`worktree.ts`)

한 응답 안에서 `filesChanged: ["tracked.txt","hello.txt"]`와 `diffStat "1 file changed"`가
서로 모순되고, 권위 있어 보이는 쪽이 틀렸다. `--always-approve`에서 grok이 가장 많이 만드는 것이
신규 파일이라 딱 그 케이스가 빠진다.

→ apply와 동일하게 임시 스테이징(`add -A` → `diff --cached --stat` → `reset`)으로 stat을 낸다.

### A9. 확인 프롬프트 취소가 `status ok / exit 0`로 보고된다 (`grok-cli.ts`)

아무것도 안 한 파괴적 명령이 성공으로 보고되고, 구분 근거는 4000자 tail 안에서 잘릴 수 있는
`Cancelled.` 문자열뿐이다. 완화책이 산문(`commands/cli.md`)에만 있어 프로그램 소비자는
"clear됨"으로 보고한다. 안전 자체는 정상(stdin 없음 → 기본 N).

→ 프롬프트/취소 마커를 감지해 `cancelled: true` 구조화 필드를 추가한다.

### A10. `blocked`가 `isError: false`로 나간다 (`server.ts`)

`docs/07`을 따르는 오케스트레이터가 `isError`만 보면 **거부된 명령을 "출력 없는 성공"으로**
읽는다. 취소된 파괴적 명령도 같은 모양이다. 반대 방향도 있다 — api 모드에서 키 없이 `status`를
읽으면 `isError: true`인데 대시보드 페이로드는 완전히 채워져 나온다(정상 데이터를 버리게 된다).

→ `blocked`는 `isError: true`로, 읽기 전용 진단은 페이로드가 유효하면 `false`로 정렬한다.

### A11. 지정되지 않은 단일 토큰이 전체 timeout을 태운다 (`grok-cli.ts`)

`grok sesions` 같은 한 단어 오타가 기본 60초를 통째로 잡아먹고 `stderrTail`은 읽을 수 없는
ANSI TUI 프레임이다. 2토큰 오타는 969ms에 정상 실패한다. 쿼터·파일·프로세스 피해는 없다(실측).
`import`가 바로 이 메커니즘 때문에 막혀 있는데 나머지가 전부 열려 있는 비일관성이다.

→ 첫 위치 인자가 알려진 1.0 서브커맨드나 플래그가 아니면 spawn 없이 `blocked` + 안내
(현 `import` 가드의 일반화). `commands/cli.md`에도 기록.

### A12. 잘못된 `GROK_BUILD_AUTH_MODE` = 전 표면 소멸 + 스택 트레이스 (`index.ts`)

9개 도구와 모든 `/grok:*`가 한꺼번에 사라지고 클라이언트에는 일반 연결 실패만 보인다(실측 240초
initialize timeout). 정확한 한 줄 진단은 stderr의 7프레임 스택 안에 묻혀 있다. 안전 측면(조용한
기본값 없음)은 정확하다.

→ `main()`에서 잡아 스택 없이 한 줄만 출력하고 exit 1.

### A13. api 모드 `auth_check`가 아무 문자열이나 통과 (`auth.ts`)

오타·폐기·만료 키에도 "API 키 인증 준비됨"이 뜨고, **죽은 키로도 위임이 `completed`로 끝나며
`metered_api`로 라벨된다**(작업은 구독 세션을 탔다). 방향은 보수적이지만 라벨이 사실이 아니고
`billingMismatch` 경보를 오염시킨다.

→ 메시지를 "키가 설정돼 있습니다 — 유효성은 검증하지 않았습니다"로 낮추거나 저비용 검증 1회.

### A14. `plan`이 강화 필드를 조용히 버린다 (`server.ts`)

스키마는 `additionalProperties: false`를 광고하는데 zod가 `resume`/`continue`/`model`/`effort`/
`worktree`/`sandbox`를 조용히 벗겨낸다 — 양방향으로 자기 계약 위반. 실사용 영향은 "plan에
resume/worktree를 걸 수 없다" 수준.

→ plan 등록에 `...strengthFields`를 펼치거나 명시적으로 거부한다.

### A15. `inspect`가 꼬리만 남고 잘린다 (`grok-cli.ts`)

`inspect`의 가치는 머리(grok home·모델·auth·설정 출처)에 있는데 정확히 그 부분이 버려지고,
유일한 기계 판독 형식은 `JSON.parse` 실패(48781자 중 4000자 = 8%).

→ `inspect` 계열은 tail 대신 head를 남기거나 `head`/`max_chars` 옵션을 노출한다.

### A16~A20. 문서·문구 (코드 무변경)

| # | 무엇 | 최소 수정 |
|---|---|---|
| A16 | git repo 밖에서 `filesChanged: []` — tour/setup의 첫 성공이 항상 빈 목록 | `tour.md`·`setup.md`에 한 문장(“`git init`된 디렉터리를 쓰거나, 밖에서는 비어 있다”) |
| A17 | cwd 스코프 headline이 데이터 손실처럼 읽힌다(“아직 위임 이력이 없습니다”) | cwd가 주어지면 “이 디렉터리 기준”을 명시 |
| A18 | `/grok:logout`이 경고 없는 일방통행 — `/grok:login`은 blocked라 되돌릴 수 없다 | `logout.md`에 경고 한 줄 + 명시적 확인 단계 |
| A19 | 배포 표면 6곳이 맨 상대 경로(`docs/08-…`)를 가리킨다 — 사용자 repo엔 없다 | `${CLAUDE_PLUGIN_ROOT}/docs/…`로 교체(`hooks.json`·`.mcp.json`은 이미 그렇게 쓴다) |
| A20 | 커맨드 문서 드리프트: `sessions.md`가 grok 1.0.5 고정, `mcp.md`에 enable/disable 누락, `plan.md`·`verify.md`가 cwd에 “absolute”를 안 씀 | 편집 3곳 |

> **A19는 오너 판단이 필요하다** — URL로 바꿀지, `tour.md`처럼 fallback을 넣을지, 아니면
> `${CLAUDE_PLUGIN_ROOT}`로 갈지. 마켓플레이스 공개 여부에 달렸다.

---

## B. 측정 불가 — 무엇이 있어야 재나

| # | 항목 | 필요한 것 |
|---|---|---|
| B1 | 편집 런이 캡까지 매달리는가 | 오너 corpus는 timeout 310/1769 = **17.5%**인데 감사의 모든 런은 15~30초에 정상 종료. 편집 위임 20~30회를 배치로 돌려 `durationMs`와 실제 파일 mtime을 대조 |
| B2 | 만료 세션 (대기 vs 폐기) | v0.2.18에서 합성 auth.json으로 닫았다. 실계정 만료 순간의 캡처는 여전히 없음 |
| B3 | `billing`이 xAI 쪽에서 실제로 무엇인가 | 모든 값이 `billingFor(mode)` 파생이고 관측이 아니다. xAI 계정 사용량 페이지 — 이 머신 밖 |
| B4 | GUI 슬래시 커맨드 경로 | 설치본 갱신 후 Claude Code 재시작 → `/grok:status` 1회 |
| B5 | win32 손자 프로세스 정리 | timeout kill은 직계 자식만 죽인다. 장시간 손자를 띄우는 위임을 캡으로 죽인 뒤 `Win32_Process` 확인 |

---

## C. 손대지 말 것 (실측으로 견고함)

과금 보장(`buildGrokEnv` — `grok models` 판별자로 메커니즘 수준 증명) · 자동 커밋 금지(6중 확인) ·
spawn 이전 입력 검증(2~4ms 거부) · worktree 격리와 baseDir 봉쇄 가드(우회 10종 전부 거부) ·
timeout 처리(고아 프로세스 0) · denylist 무spawn 거부(대조 실험으로 직접 증명) ·
집계 산술(1779행 독립 재계산 전부 일치) · `billingMismatch`(4×2 전부 정확) ·
커맨드 27/스킬 2/에이전트 1 집합(unknown 도구 참조 0).

**래퍼 오버헤드는 사실상 0이다** — `grok models` 직접 10.8~13.4초 vs 플러그인 경유 11.0~14.7초.
체감 지연은 전부 모델 호출이다. 최적화할 층을 착각하지 말 것.

---

## D. 감사가 남긴 잔여물 (2026-09-05 처리)

- `history.jsonl`에 감사가 주입한 **조작된 시크릿 문자열 3행**을 제거했다
  (백업 `~/.grok-build/history.jsonl.pre-audit-cleanup`).
- `~/.grok-build/worktrees/`에 08-26~09-05 사이 **7개가 남아 있다.** 그중 하나는 SCAManager
  소유의 dirty 트리다 — 오너 작업물일 수 있어 손대지 않았다. A5를 고치기 전에는 `prune`이
  수집하지 못한다.
