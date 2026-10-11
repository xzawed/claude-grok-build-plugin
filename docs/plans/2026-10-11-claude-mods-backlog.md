# Plan: Claude Code mods — 할 일 목록 (착수 전, 오너 판단 대기)

> **열린 계획 — 2026-10-11 작성.** 오너 지시(원문): "우선 위의 내용은 앞으로 해야할 일 목록으로 남겨주시고". "위의 내용"은
> 같은 날의 요청 "현재 서비스하는 내용중에 claude mods기능을 활용및 사용할수 있는 기능은 어떤것이 있는지 Grok과 함께 논의 하여
> 정리 부탁드립니다"에 대한 Claude·Grok의 제안이다. 범위로는 새 기능(`.claude/skills/repo-scope`의 E)이다. 그래서 아래
> "오너 판단"이 정해지고 완료 기준을 쓰기 전에는 PR을 열지 않는다. 결함 큐(`docs/10` A)와의 순서도 오너가 정한다.
> 항목이 나가면 아래 "나간 것"에 적고, 다 나가거나 버려지면 머리를 "SHIPPED — 이력 문서. 실행하지 말 것."으로 바꾼다.

**나간 것:** 없음.

## mods가 무엇이고, 이 플러그인에서 어디까지 쓰나

mods는 Claude Code의 함수 훅 플러그인이다. 상태줄, 토스트, 패널, 프롬프트 위 띠, 대화 기록 행 다시 그리기(`ui.render`),
`tool.call`·`prompt.submit` 훅 같은 기능을 쓴다. 이 API는 early access다 — 타입 파일 머리말이 "this surface may change between
releases without notice"라고 적는다.

**이 플러그인에서는 사람에게 보이는 표시 층으로만 쓴다.** mod는 MCP 서버가 이미 돌려주는 JSON을 화면에 드러낼 뿐이다. 과금,
인증, 위임 실행, 그리고 모델이 읽는 내용은 지금 자리(MCP 서버, PreToolUse 훅, 스킬)에 그대로 둔다.

## 근거

- 논의는 Claude·Grok 2라운드로 했다. 1라운드에서는 같은 원본을 Grok의 빈 폴더에 그대로 넣고, 서로의 목록을 보지 않은 채
  각자 썼다. 원본은 plugin-authoring 스킬의 `claude-code.d.ts`·`reference.md`·예제와 플러그인 전체다. 2라운드에서는 서로의
  목록을 비판하고 사실 주장을 대조했다. 결론은 부분 합의이고, 이견은 아래에 그대로 둔다.
- Grok 세션은 둘 다 `billing: subscription`이었다. 1라운드는 `b96c014e-f661-40ca-9a5b-5ed7866e7c49`(`grok-4.6-build`, 15턴),
  2라운드는 `a42b43b0-9eb8-4a4f-9392-75e8454ea350`(`grok-4.7-build`, 12턴)이다. 원문이 필요하면 `/grok:export`로 꺼낸다.
- Claude는 Grok이 인용한 타입 줄 13건과 2라운드의 새 주장 10곳을 원문과 대조했다. 전부 맞았다. 이 문서 자체도 독립 검토를 거쳐
  고쳤다(이 문서를 연 PR의 설명).
- **API 줄 번호는 Claude Code 2.1.296의 `claude-code.d.ts` 기준이다.** 이 파일은 plugin-authoring 스킬이 로드될 때 빌드마다
  다시 쓰는 타입 파일이다. 빌드가 바뀌면 줄 번호를 이름으로 다시 찾는다(`'tool.call'`, `status:`처럼).

## 할 일

### P0-1 과금 상태줄 — 합의(선행 조건: A56)

- **선행 조건 — `docs/10` A56을 먼저 고친다.** 구독 모드의 `authMessage`는 지금 `'구독 세션 인증 준비됨.'`이다
  (`mcp-server/src/auth.ts`의 `checkAuth`). 이것을 서버 문구 그대로 띄우면, A56의 틀린 "준비됨"(서버가 손상된 `auth.json`에도
  준비됐다고 한다)을 늘 보이는 자리에 놓게 된다. A56의 최소 수정은 그 문구를 "세션 파일 있음(검증 안 함)"으로 바꾸는 것이다
  (`docs/10` A56). 그 수정이 나간 뒤에야 이 항목을 착수한다.
- **무엇을 보여 주나.** `$.ui.status`(플러그인마다 프롬프트 아래 한 줄, d.ts 2472–2483)에 `grok_build_status`의 `authMessage`,
  `billing`, `serverVersion`을 서버가 준 그대로 보여 준다.
  - `billing: metered_api`는 필드 값 그대로 보여 준다. 서버는 종량제라고 알리는 문장을 따로 주지 않는다 — api 모드의
    `authMessage`는 키가 없으면 키를 설정하라는 문장이고, 키가 있으면 키가 있다는 문장이며, 구독 세션도 있으면 오히려
    "종량제로 청구되지 않을 수 있다"고 한다(`auth.ts`의 `checkAuth`). 다른 문구가 필요하면 스펙에서 아래 설계 규칙 5의 예외로 정한다.
  - `billingCaveat`은 그 `message`를 보여 준다.
  - `billingMismatch`는 지난 이력에 대한 사실이지 지금의 고장이 아니다(`mcp-server/src/status.ts`의 주석과 문구). 서버의 문장을
    쓴다 — `billingMismatch`면 늘 맨 앞에 오는 `tips` 첫 줄, 또는 인증이 됐을 때의 `nextSteps` 문장(`status.ts`).
  - 위임 이력이 0이면 서버 `nextSteps`의 첫 안내를 한 번 보여 준다.
- **데이터를 어떻게 얻나.** `session.start`에서 `$.clock.after`로 **await하지 않고 한 번**
  `$.mcp.call("plugin:grok:grok-build", "grok_build_status", { cwd })`를 부른다(`$.mcp.call`은 d.ts 2699–2724).
  - 쿼터 0이다. `grok_build_status`는 "Read-only — no grok spawn, no file edits"다(`mcp-server/src/server.ts`의 도구 설명).
  - 첫 `session.start`는 첫 프롬프트 전에 await되므로(d.ts 4330–4334), 거기서 기다리면 그 자체가 비용이다.
  - `clock.after`의 `fn`은 그 타이머 자신의 디스패치가 풀린 뒤에 돈다(d.ts 3456–3459·7141–7143). `session.start` 훅은 그
    타이머를 기다리지 않고 바로 `next(e)`를 돌려준다.
  - `session.start`는 플러그인을 켤 때, 워커를 다시 띄울 때, 다시 로드할 때도 또 돈다(d.ts 4335–4336). 그래서 조회는 세션당 한
    번으로 막는다. 어떻게 막을지는 스펙에서 정한다.
  - 그 뒤로는 관찰한 grok 도구 결과로만 갱신한다. 폴링은 하지 않는다.
- **완료 기준(초안).**
  - 새 세션의 첫 프롬프트 지연이 늘지 않는다(측정).
  - 상태줄 문구가 서버 `authMessage`와 같다(A56 수정 뒤의 문구).
  - `metered_api` 결과를 관찰한 턴 안에 그 값이 보인다.
  - grok을 한 번도 쓰지 않은 세션의 추가 비용은 세션당 status 호출 한 번뿐이다.

### P0-2 완료 토스트 — 합의(네이티브 알림 기본값만 이견)

- **어떻게 관찰하나.** `tool.call` 훅이 grok 도구를 관찰한다. 항상 `await next(e)`로 실행을 넘기고, `next(e)`가 준 객체를 그대로
  돌려준다 — 훅이 돌려준 결과가 모델이 읽는 결과이기 때문이다(d.ts 12726–12750). 결과의 `text`(d.ts 12752–12755, "the result
  as the model reads it" — 이 서버에서는 `JSON.stringify` 결과)를 파싱한다.
- **무엇을 토스트로 알리나**(`$.ui.toast`, d.ts 2437–2453).
  - `billing: "metered_api"`, `billingCaveat`.
  - `committed: true` — 서버의 `message`(움직인 폴더와 이전 커밋, A49)를 함께 보여 준다.
  - `planWroteFiles: true`, 완료가 아닌 `status`와 그 `message`.
  - `resumedCwd`는 "resume 대상 세션이 속한 폴더"로만 보여 준다(`delegate.ts`의 `annotateResumedCwd` — grok의 `--resume`이
    `--cwd`를 덮어쓴다). mod의 말로 "그 폴더에서 작업했다"고 하지 않는다 — 시작도 못 한 resume에도 그 말이 붙는 결함이 A55다.
    상태를 보고 숨기지도 않는다 — 부분 편집을 남긴 timeout·취소에는 안내가 필요하다고 A55가 적는다.
  - 실패 `message`에는 A55가 고쳐지기 전까지 서버의 그 문장("그 디렉터리에서 작업했습니다")이 섞여 올 수 있다. mod는 서버
    문장을 고쳐 쓰지 않는다 — 고치는 곳은 A55다.
- **실행 중에는** 상태줄을 "Grok 실행 중"으로 바꾼다. P0-1과 한 줄을 같이 쓴다.
- **경과 시간·캡 표시는 하지 않는다.** 이유는 셋이다.
  - 턴 스피너가 이미 시간을 센다(d.ts 10108–10118).
  - 캡 숫자는 호출의 `timeout_ms`가 아니면 추측이다.
  - 지금 서버는 grok의 JSON 하나를 기다릴 뿐 진행을 보내지 않는다(아래 "관련").
- **이견 — 네이티브 알림 `$.ui.notify`(d.ts 2454–2471)의 기본값.**
  - Grok: 로컬에서 잰 대기가 N초를 넘을 때만 울린다.
  - Claude: 기본은 꺼 두고 설정으로 켠다. 위임은 보통 Claude 턴 안에서 끝나고, 턴이 끝나면 Claude Code 자체 알림이 울릴 수
    있다. 다만 오너의 Windows 터미널에서 그 알림이 실제로 울리는지는 재지 않았다 — 알림 채널은 터미널마다 다르다(d.ts의
    `preferredNotifChannel` 문서).

### P1 Grok 작업 패널 — 이견

- **무엇을 보여 주나.** 관찰한 마지막 위임 결과 — 설계 규칙 5의 경고 필드 전부와 `filesChanged`·`worktreePath`·`sessionId` —
  와 `grok_build_worktree`의 `list`/`diff`(읽기 전용)를 패널에 보여 준다(`$.ui.open`, d.ts 2484–2506).
- **버튼.** `$.prompt.fill`로 `/grok:review`를 입력창에 채우는 버튼과 세션 id 복사 버튼만 둔다. apply·remove·prune·`force`
  버튼은 두지 않는다.
- **이름.** `/grok:review`와 헷갈리지 않게 짓는다(예: `grok-files`). 아니면 토스트 버튼으로만 연다.
  `$.command.register`는 플러그인 마크다운 명령을 거절하지 않으므로, 비슷한 이름이면 둘 다 자동완성에 뜬다.
- **이견.**
  - Grok: P1로 둔다.
  - Claude: P0의 토스트와 상태줄이 생긴 뒤에 필요한지 다시 본다.

### P1~P2 결과 카드 — 이견, 측정이 먼저

- **무엇.** `ui.render`의 `ToolResult`(d.ts 9949–9992)로 grok 결과 JSON을 카드로 그린다. 다시 그려도 바뀌는 것은 화면뿐이고,
  모델이 읽는 저장된 결과는 그대로다(d.ts 9953–9955). 파싱에 실패하거나 모르는 필드가 있으면 `next(e)`로 엔진 표시에 맡긴다.
- **먼저 잴 것.** MCP 도구의 `ToolResult.output` 모양. 아직 재지 않았다.
- **이견.**
  - Claude: 측정한 뒤 P1이다. 토스트는 사라지지만 카드는 리뷰할 때 다시 보는 자리에 남는다.
  - Grok: P2다. 모양을 재지 않았고, 잘못 그리면 원문보다 나쁘다.

### P2

- **리뷰 제안.** 변경이 생긴 위임이 있었던 턴이 끝난 뒤(`turn.complete`)에 `$.prompt.suggest({ text: "/grok:review" })`를
  띄운다. Tab으로 받는다. 턴이 도는 동안에는 제안이 보이지 않는다(d.ts 2983–2991) — 그래서 `tool.call` 훅에서 바로 띄우지 않는다.
  - "미검토 N개" 띠를 리뷰할 때까지 남기는 안은 기각했다. 과거에 기각된 'PostToolUse force review hook'
    (`docs/specs/2026-07-28-ops-surface-claude-grok-design.md`)과 같은 게이트이기 때문이다.
- **라우팅 Tab 힌트.** `grok_build_route` 결과를 관찰한 턴이 끝난 뒤에만 `nextAction`을 사람이 읽는 문장으로 제안한다.
  `handle_with_claude`면 아무것도 제안하지 않는다.
- **사용량 패널.** `grok_build_usage`가 주는 집계를 그대로 보여 준다: 누적 위임 수, 상태별 수, 구독 비중, `recent`(기본 10개).
  일별 데이터는 그 도구에 없다(`mcp-server/src/usage.ts`의 `UsageSummary`).

### 보류

- **세션 재개 선택기.** `docs/10` A53을 고치기 전에는 만들지 않는다 — 시작도 못 한 실행의 id를 누르기 쉬운 형태로 권하게 된다.

## 설계 규칙 — 어기면 안 되는 것

1. **mod는 grok을 직접 띄우지 않는다.**
   - `$.process.run`의 자식은 세션 환경변수를 물려받는다. `env`는 그 위에 덮어쓰는 것일 뿐이다(d.ts 3500–3503·3588–3589·8014–8015).
   - 키 제거(`buildGrokEnv`)와 `--no-auto-update`는 서버 안에만 있다 — 절대 원칙 #1·#3.
2. **`$.mcp.call`은 권한 확인을 거치지 않는다**(d.ts 2708).
   - 그래서 쿼터 0인 읽기 도구만 부른다: status, usage, route, worktree `list`/`diff`.
   - delegate·plan·verify·`grok_cli`와 worktree apply·remove·prune·`force`는 부르지 않는다. 필요하면 `$.prompt.fill`로 채워
     사람이 제출하게 한다.
3. **모델이 읽는 것을 바꾸지 않는다.** 다음은 모두 금지한다:
   - `prompt.compose`·`prompt.section`(d.ts 4155–4191)
   - `prompt.context` — 첫 메시지의 컨텍스트 블록을 바꾼다(d.ts 4171–4182)
   - `tool.call`의 `context`(d.ts 12736–12743), `prompt.submit`의 `context`
   - `session.append` 재작성(d.ts 4356–4361)
4. **grok 도구를 막거나 늦추거나 바꾸지 않는다.**
   - 관찰 훅은 항상 `next(e)`를 부르고, 그것이 준 객체를 그대로 돌려준다(d.ts 12726–12750).
   - `/grok:*`를 관찰하는 `command.run` 훅도 `next`를 부른다. 없이 답하면 원래 명령이 실행되지 않는다(d.ts 1835–1838).
5. **서버가 말하지 않은 것을 말하지 않고, 서버가 말한 경고를 빠뜨리지 않는다.**
   - 위임 결과를 그리는 카드·토스트·패널은 경고 필드(`billing`, `committed`와 그 `message`, `billingCaveat`, `planWroteFiles`,
     `resumedCwd`, 실패 `message`)를 빠짐없이 보여 준다. 파싱 실패와 모르는 필드는 엔진 표시에 맡긴다.
   - "ready"·"준비됨"을 mod의 말로 쓰지 않는다(A56).
   - `resumedCwd`를 "그 폴더에서 작업했다"고 말하지 않는다(A55).
   - `planWroteFiles: false`를 "읽기 전용 확인"이라고 하지 않는다(A60).
   - 잘린 프롬프트에 "전문 전달" 표시를 하지 않는다(A59).
   - `lastSession`이 항상 이어갈 수 있다고 하지 않는다(A53).
6. **자격증명과 `rawStderrTail`은 화면에도 `$.store`에도 싣지 않는다**(절대 원칙 #4). `auth.json` 내용을 읽지 않는다.
   **프롬프트 전문도 싣지 않는다** — 이것은 이 계획의 규칙이다. 원칙 #4는 프롬프트 미리보기를 덮지 않는다고 스스로 적는다.
7. **`~/.grok-build/history.jsonl`을 mod가 직접 파싱하지 않는다.** 두 번째 파서는 `usage.ts`와 어긋난다 — `grok_build_usage`를 부른다.
8. **로그인, 인증 모드 전환, 커밋, PR, apply를 하지 않는다**(절대 원칙 #1·#2, `docs/00` "의도적으로 하지 않는 것").
9. **코어 `hooks/hooks.json`을 건드리지 않는다**(`CLAUDE.md` Gotchas의 CRITICAL).

## 배포

- **결정(합의).**
  - **별도 opt-in 플러그인**으로 낸다. 코어 `grok`의 `hooks/hooks.json`에는 넣지 않는다.
  - 먼저 오너 로컬(`claude --plugin-dir <폴더>`)을 측정 하네스로 쓰고, 측정이 끝난 뒤 마켓플레이스에 올린다.
- **위치는 정해지지 않았다 — 스펙에서 정한다.** 코어의 마켓플레이스 소스는 `./`(레포 전체)다(`.claude-plugin/marketplace.json`,
  `CLAUDE.md` 컴포넌트 지도). 그러니 `./mods/<이름>`처럼 레포 안에 두면 두 가지가 따라온다.
  - 그 파일들이 모든 코어 설치에 함께 실려 간다. 코어가 로드하지는 않는다.
  - mod를 고치면 코어 트리가 바뀐다. 코어 캐시는 버전 키다.

  고를 길은 둘이다.
  - 별도 저장소 또는 별도 마켓플레이스 소스.
  - 함께 실려 가는 것을 받아들이고, 버전과 수락을 어떻게 셀지 정한다.
- **실측(2026-10-11, Claude Code 2.1.296).** `claude plugin validate`로 두 프로브를 잰 결과, 둘 다 통과했다(exit 0).
  - classic `hooks` 블록과 `modules`를 한 `hooks.json`에 둔 플러그인
  - `modules`만 둔 플러그인

  validate는 두 키를 받아들였다. 다만 결합 프로브의 출력은 모듈의 훅만 적고 classic PreToolUse 블록은 말하지 않았다. 런타임에
  둘이 함께 도는지는 재지 않았다. 그러니 "합칠 수 없다"는 근거가 없고, "합치지 않는다"는 아래 세 이유 때문이다.
  - early access다.
  - 코어 `hooks.json`이 로드에 실패하면 `/grok:*`가 전부 사라진다.
  - grok은 설치된 플러그인의 hooks까지 워커에 로드한다(계약 §14).
- **마켓플레이스에 올리기 전에 잴 것.**
  1. grok 워커가 `modules`만 있는 `hooks.json`을 실행하는지, 무시하는지, 오류를 내는지, 시간이 얼마나 드는지 —
     계약 §14와 같은 방식으로 잰다.
  2. 실제 세션에서 `$.mcp.call("plugin:grok:grok-build", …)`이 되는지. d.ts 5912–5913이 서버 이름을 "usually
     `plugin:<plugin>:<server>`"라고 적지만, 타입이 말하는 형식일 뿐 실제 목록은 재지 않았다.
  3. MCP 도구의 `ToolResult.output` 모양(결과 카드의 전제).
  4. 터미널·데스크톱·VS Code 각각에서, 그리고 144열 미만에서 패널이 놓이는지(`isPlaced`).
  5. mod를 지원하지 않는 Claude Code 빌드에서 opt-in 플러그인이 조용히 실패하는지.
  6. CI에서 `claude plugin validate`·`claude plugin test`를 돌리려면 `claude` 실행 파일이 있어야 한다 — 새 CI 의존이다.
  7. P0-1의 지연 조회가 첫 프롬프트를 늦추지 않는지, 그리고 세션당 한 번으로 막히는지.

## 둘 다 기각한 것 — 다시 꺼내기 전에 이유부터

| 기각 | 이유 |
|---|---|
| 시스템 프롬프트에 grok 상태 주입 | 매 턴 토큰이 들고, `prompt.section`의 답이 흔들리면 캐시를 버린다 |
| `session.start`에서 await로 상태 조회, 또는 주기 폴링 | 과거 기각된 'SessionStart status hook'과 같다. 상태줄은 await 없는 한 번으로 대신한다 |
| 키워드 자동 위임, 매 프롬프트마다 뜨는 라우팅 띠 | 구독을 쓰고 소음이 된다 — `docs/00` "모든 작업을 Grok에 강제" 금지 |
| 커밋 차단·강제 리뷰 훅, 리뷰할 때까지 남는 띠 | ops-surface 설계 문서의 기각과 같다(잘못된 층, 잘못된 표면) |
| PreToolUse 인증 게이트를 함수 훅으로 다시 구현 | 핵심 경로를 early access API로 옮기는 일이다 |
| grok 세션 로그(`events.jsonl`) 꼬리 읽기로 진행률 표시 | grok의 내부 형식은 스스로 바뀐다(계약 §14) |
| mod가 grok 실행(`--version`·`models`·login) | 설계 규칙 1 — 키 제거와 `--no-auto-update`를 건너뛴다 |
| 두 번째 리뷰어 에이전트 | Claude가 게이트다(ops-surface의 기각) |
| 따로 두는 상태 명령(`/grok-hud`) | 상태줄과 겹친다 |

## 오너 판단 — 착수 전에 정할 것

1. 채택 범위: P0만 할지, P1까지 할지.
2. 세션마다 status 조회를 한 번 해도 되는지(서버 기동 포함). 아니면 첫 grok 도구 호출 뒤부터 상태줄을 보여 준다.
3. 결과 카드의 순위.
4. 네이티브 알림의 기본값.
5. 작업 패널의 이름과 필요성.
6. 배포 위치: 별도 저장소인지, 레포 안에 함께 실려 가는지(위 "배포").
7. `docs/10` 열린 결함과의 순서.
   - A56은 P0-1의 선행 조건이다.
   - A53은 재개 선택기의 선행 조건이다.

## 관련 — 다른 일과 만나는 곳

- grok 1.0.44의 `--help`는 `--output-format`의 값으로 두 스트리밍 형식을 적는다.
  - `streaming-json`: "one ACP session update per line".
  - `streaming-messages-json`: "NDJSON in the Anthropic Messages API wire format". `--include-partial-messages`는 이 형식에만
    작용하며, 텍스트·생각 델타 줄을 더한다.

  그런데 서버의 위임 경로는 `--output-format json`으로 JSON 하나만 받는다(`mcp-server/src/delegate.ts`의 인자 목록).
  - 그래서 P0-2가 경과 시간·캡 표시를 뺀 세 이유 가운데 "진행을 보내지 않는다"는 **현재 서버**에만 해당한다. 서버가 진행을
    흘리게 되면 그 결정은 다시 본다. 나머지 두 이유(스피너가 이미 시간을 센다, 캡은 추측이다)는 서버와 상관없다.
  - 어느 형식이 실제로 진행(도구 호출 같은)을 싣는지는 재지 않았다. 계약 §2의 옛 캡처에는 `thought`/`text`/`end`만 있었다.
    같은 문서 90–92행은 1.0 `streaming-json`에 `tool_call`이 올 수 있다고만 적는다. `streaming-messages-json`은 한 번도 재지 않았다.
  - 서버가 진행을 흘리게 바꾸는 일은 이 문서의 범위 밖이다.

## 승인 뒤 진행 순서

1. 완료 기준을 쓴다.
2. `docs/specs/`에 스펙을 쓰고 `docs/00`과 대조한다. 위치(배포)와 세션당 한 번 막는 방법도 여기서 정한다.
3. 오너 로컬에서 P0 시제품을 만든다. 선행 조건은 A56 수정이다.
4. 위 "잴 것"을 잰다.
5. 별도 플러그인 PR을 연다. 테스트는 `claude plugin validate`·`claude plugin test`이고, fixture는 실제 서버 응답 그대로다.
6. 수락은 `docs/09` §5의 형식을 따른다. 코어와 따로 셀 수 있는지는 배포 위치에 달렸다.
