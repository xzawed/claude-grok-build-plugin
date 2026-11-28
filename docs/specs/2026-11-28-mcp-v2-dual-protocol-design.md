# MCP 2.0(SDK v2) 도입 — 새 프로토콜 2026-07-28을 더하는 설계

상태: **승인됨** — 2026-11-28 오너: "지금 착수하고, 고지 포함, 드리프트 먼저 진행해주세요"(§10의 세 질문에 대한 답).
작성 2026-11-28. 이 문서의 "실측"은 그날 이 레포·설치본·내려받은 패키지에서 잰 것이고, "예측"은 아직 재지 않은
것이다. 예측은 §6.7의 실측 매트릭스가 숫자로 바꾼다. 실행 순서와 단계는 구현 계획(`docs/plans/`)이 원천이다.

## 1. 의도

오너의 말(2026-11-28, 원문):

- "MCP2.0 은 추가지원으로 계획을 잡고 있고 당장 착수하려는 것은 아닙니다. 다만 MCP 2.0 도입시 필요한 부분을 확인하려 합니다."
- "새프로토콜 더하는 뜻입니다. 그리고 그에 따른 Node버전 상향도 새롭게 밝히는것을 수용합니다."
- "실제 동작테스트가 전면 재검증이 되야 하며 반드시 실측 테스트를 요구합니다."
- "ReadMe 품질도 최고급으로 이미지와 표등을 적극활용하여 가독성 가시성이 좋게 부탁드립니다."

즉 지금의 2025년 계열 프로토콜(`initialize` 핸드셰이크)을 그대로 받으면서 **2026-07-28 개정판을 더해** 받는다.
도구 아홉 개의 동작과 계약(인증 투트랙·과금 표기·`isError`)은 어느 쪽으로 접속해도 같아야 한다.

왜 지금 준비하는가(실측):

- `@modelcontextprotocol/sdk` 1.32.2의 README: "This is v1.x of the MCP TypeScript SDK, the maintenance line. It
  implements the MCP spec up to 2025-11-25. Support for the 2026-07-28 spec is not planned for v1.x: it is in v2, the
  current stable release" · "continues to receive bug fixes and security updates for at least six months after the v2
  release (2026-07-27)". 즉 v1로는 새 개정판을 받을 수 없고, 수정 약속은 적어도 2027-01-27까지다.
- Claude Code 2.1.332 실행 파일에 `2026-07-28` 40건, `server/discover` 80건, `versionNegotiation` 35건이 들어 있다.
  클라이언트 쪽이 새 개정판을 안다는 정황이다 — 실제 접속에서 쓰는지는 **미측정**(§6.7 #8).

## 2. 목표 · 비목표 · 반목표

**목표**
- G1. 서버가 `@modelcontextprotocol/server` 2.x 위에서 돈다. `@modelcontextprotocol/sdk`는 의존성 트리에서 사라진다.
- G2. stdio 진입점 하나가 두 계열을 모두 받는다 — 2025년 계열(2024-10-07 … 2025-11-25)과 2026-07-28.
- G3. Node 하한을 20으로 올리고, 사용자 문서에 **처음으로** 밝힌다(지금은 `mcp-server/package.json`의 `engines`
  `>=18.0.0`과 `build.mjs`의 `target: 'node18'` — 둘은 `plugin-surface.test.ts`가 맞춘다 — 에만 있고 README·README.ko·`docs/08`에는
  Node 버전 표기가 없다 — 실측).
- G4. 실제 동작을 실측으로 전면 재검증한다(§6.7). 모의(mock) 테스트만으로 녹색인 것은 완료가 아니다.
- G5. README.md·README.ko.md를 이미지와 표 중심으로 새로 쓴다(§6.8).

**비목표**
- HTTP 전송(`createMcpHandler` 등). 이 플러그인은 stdio 전용이다.
- 2026 계열에만 있는 기능의 채택 — `subscriptions/listen`, `requestState`, `input_required` 다중 왕복, 캐시 힌트.
  도구는 두 계열에서 같은 일을 한다. 필요해지면 따로 연다.
- 도구의 의미·인증·과금 정책 변경. CLAUDE.md 절대 원칙은 그대로다.

**반목표 — 돌아가도 실패인 것**
- 오늘 접속되는 Claude Code가 하나라도 접속하지 못하게 되는 것.
- 과금 안전의 후퇴: subscription 모드의 키 제거, 인증 게이트, `mode`/`billing` 표기 중 하나라도 달라지는 것.
- 계열에 따라 같은 호출의 결과가 말없이 달라지는 것(한쪽은 `isError`, 다른 쪽은 JSON-RPC 오류 등).
- 보기 좋지만 코드와 어긋나는 README(문서 어긋남은 결함이다).

## 3. 제약

- 번들 두 개(`dist/index.js`·`dist/hook.js`)는 커밋 대상이고, 번들이 바뀌면 버전 범프·릴리스다(CONTRIBUTING "Release").
- `.claude/tools/*.mjs`는 엔드유저 디스크에 그대로 내려가 `node_modules` 없이 돈다 — SDK를 import할 수 없고
  원시 JSON-RPC 프레임으로만 말한다. 2026 계열 채점도 원시 프레임으로 짜야 한다.
- `accept-release.mjs`는 **설치된 옛 번들**(v0.2.54 이하, 2025 계열만 받음)도 채점한다. 새 검사가 옛 번들을
  실패로 만들면 안 된다 — 옛 번들에서 2026 계열이 안 받아지는 것은 예상된 결과로 표시한다.
- `CHANGELOG.md`가 40,000바이트 한도에 39,937바이트로 차 있었다(`changelog-shape.test.ts`). 릴리스는 CHANGELOG에
  그 버전 줄이 있어야 하므로(`handoff-version.test.ts`) 이관이 먼저였다 — #227로 옮겼다(2026-11-28).
- 설치된 grok은 1.0.92, 계약 스냅샷은 1.0.70이다. `probe:contract`가 드리프트를 보인다(실측 — 플래그 3개 추가
  `--memory-flush`·`--no-memory`·`--system-prompt-file`, 대부분의 도움말 문구 변경, 서브커맨드·모델 변화 없음).
  전면 재검증은 1.0.92에서 하므로 새 플래그 분류(`grok-cli.ts` 표, 프롬프트를 싣는 것은 `prompt-flags.ts`)가 먼저다.
- 실측 환경: Windows 네이티브(이 PC)와 Linux(Docker `node:20`, CI ubuntu). macOS는 잴 수 없다 — 미측정으로 적는다.
  Docker·WSL을 쓰면 전역 규칙의 회수 절차를 따른다(`docker run --rm`, 프로젝트 라벨, 턴 끝 회수).
- 리뷰는 `docs/11` "리뷰 라운드 규율"을 따르고, 리뷰어·Grok을 여러 개 돌리기 전에는 비용을 밝히고 묻는다.

## 4. 접근

| | 방법 | 판단 |
|---|---|---|
| **A** | v2 + `serveStdio(() => buildServer(…))` | **채택.** SDK가 제공하는 stdio 이중 계열 진입점이다. 공장(factory) 하나가 연결마다 서버를 만들고, 첫 교환이 그 연결의 계열을 고정한다. 2025 계열은 기본으로 받는다(`legacy: 'reject'`를 주지 않는 한). |
| B | v1 유지 | 탈락. v1은 2026-07-28 지원 계획이 없고 수정 약속은 적어도 2027-01-27까지다. |
| C | v2 + `server.connect(new StdioServerTransport())` | 탈락(오너 선택). 2025 계열만 받는다 — "upgrading the SDK changes nothing about what it puts on the wire". |
| D | 저수준 `Server`로 계열 협상을 직접 구현 | 탈락. SDK가 이미 하는 협상을 다시 짜는 일이라 위험만 늘고 얻는 것이 없다. |

오너가 고른 것: "새프로토콜 더하는 뜻입니다" → A.

## 5. 오너가 정한 것

- 2026-07-28을 기존 프로토콜에 **더해** 지원한다.
- Node 하한을 올리고 새로 밝힌다.
- 실제 동작을 실측으로 전면 재검증한다.
- README를 이미지·표를 적극 써서 최고 수준으로 다시 쓴다.
- 지금 착수한다. 제3자 라이선스 고지를 2번 PR에 포함한다. grok 1.0.92 드리프트 정리(1번)를 2번보다 먼저 한다.

## 6. 설계

### 6.1 의존성과 런타임

- 실행 의존성: `@modelcontextprotocol/server`(^2.4.0 — 하한은 실측한 판으로), `zod` ^4.6.7은 그대로(v2 요구 ≥4.2.0 충족).
  v2 서버 패키지의 의존성은 `zod`와 `@modelcontextprotocol/core` 둘이고 AJV는 패키지 안에 묶여 있다(실측).
- 개발 의존성: `@modelcontextprotocol/client`(같은 판) — vitest와 저장소 안 검사 스크립트만 쓴다. 배포되는 도구는 쓰지 않는다.
- `@modelcontextprotocol/sdk`를 빼면 그것이 끌어오던 `hono`·`@hono/node-server` 등 HTTP 쪽 패키지가 락파일에서
  빠질 것으로 **예측**한다(락파일 전후 대조로 확인).
- 락파일은 `npx npm@11`로 만든다(npm 10.9.3 함정, CLAUDE.md). 실행 의존성 전후 대조는 필수다.
- `engines`: `>=20`.

### 6.2 서버 코드

- `src/index.ts`: `serveStdio(() => buildServer(mode, defaultServerDeps, { insideWorker }))`. A12의 시작 실패
  한 줄 안내(`formatStartupFailure`)는 그대로 둔다.
- Node 20 미만에서는 SDK 코드가 돌기 전에 **한 줄짜리 안내**로 끝낸다(빌더 판단: 첫 import로 평가되는 작은 모듈).
  v2가 Node 18에서 어떻게 깨지는지는 §6.7 #5에서 잰다. **실측(2026-11-28):** Node 18.20.8은 그 한 줄로 끝난다. 번들을
  파싱하지 못하는 더 오래된 Node는 안내가 돌기 전에 SyntaxError로 끝난다 — 16.0.0이 그렇다(클래스 정적 블록은 Node 16.11부터;
  PR #231 리뷰가 잼, `docs/03`).
- `src/server.ts`: `McpServer`를 `@modelcontextprotocol/server`에서 가져온다. 도구 등록 9곳(`server.registerTool(`
  호출)은 이미 v2의 권장 형태(설정 객체 + `z.object(...).strict()`)라 그대로다(실측).
- 워커 거절 래퍼(`server.ts` 170–172행)의 `Parameters<McpServer['registerTool']>[1]`는 v2에서 **마지막 오버로드,
  즉 폐기 예정인 raw-shape 판**을 잡는다(v2 `.d.mts`의 오버로드 순서). 그래도 v2로 바꾼 코드가 타입체크를 통과했고, `registerTool`은
  실행 시 값의 모양으로 갈리므로 동작이 같다(2026-11-28 실측 — 이전 작업 중). 그대로 두고 그 이유를 주석으로 남긴다.
- 핸들러를 `main()` 안 익명 클로저로 옮기지 않는다(CLAUDE.md). `serveStdio`의 공장은 지금의 `buildServer`를 부른다.
- 서버 시작은 가볍다(인증 모드 읽기 → 워커 여부 → 도구 등록 → 연결; `src/index.ts`). v2 클라이언트는 stdio에서
  계열을 고를 때 같은 명령으로 **짧게 사는 형제 프로세스**를 하나 더 띄워 `server/discover`를 묻는다(SDK 문서
  `protocol-versions.md`). 시작에 부작용이 없어 문제가 없을 것으로 **예측**하고, §6.7 #8에서 실제 기동 횟수를 잰다.

### 6.3 두 계열의 동등성

- 두 계열 모두 같은 도구 아홉 개를 같은 입력 스키마로 보인다. v2는 zod의 `~standard.jsonSchema`로 JSON Schema
  2020-12를 만든다 — v1과 광고되는 스키마의 세부(예: `$schema` 키)가 달라질 수 있다. 계열 간에는 같아야 하고,
  v1 대비 차이는 기록한다. **실측(2026-11-28):** 예측대로 `$schema`만 draft-07 → 2020-12로 바뀌었고, v1이 도구마다 붙이던
  `execution: {"taskSupport": "forbidden"}`이 없다; 그 밖은 아홉 도구 모두 같다(`docs/04`에 기록, 리뷰가 찾았다).
- 모든 도구 호출이 두 계열에서 같은 결과 모양(`content`, `isError`, `mode`, `billing`)을 돌려준다 — §6.7 #2·#6이 잰다.

### 6.4 v2에서 바뀌는 동작과 처리

출처: 위 네 행(프로토콜 목록·없는 도구·검증 실패·읽기 한도)은 v1 설치본과 v2 패키지의 **코드에서 확인**했고,
Node 하한 행은 두 패키지의 `engines`에서 확인했다. 나머지 행은 SDK 이전 안내 문서 기준이다. 어느 행이든 동작은
§6.7에서 잰다.

| 항목 | v1 1.32.1 | v2 2.4.0 | 처리 |
|---|---|---|---|
| 지원 프로토콜 목록 | `2025-11-25`·`2025-06-18`·`2025-03-26`·`2024-11-05`·`2024-10-07` | 2025 계열 목록은 같다(core `schemas.mjs`의 `SUPPORTED_PROTOCOL_VERSIONS`); 2026 계열은 따로 `SUPPORTED_MODERN_PROTOCOL_VERSIONS`(`2026-07-28`) | 하네스의 `2024-11-05` 오프닝 유지 가능 |
| 없는 도구 호출 | `try` 안에서 던져 `isError` 결과 `MCP error -32602: Tool X not found` | `try` 밖에서 던져 **JSON-RPC 오류 -32602** | SDK 동작을 받아들이고 `docs/04`에 적는다 |
| 인자 검증 실패(`.strict()`의 모르는 키 등) | `isError`, `MCP error -32602: Input validation error: … <메시지 at 경로>` 줄바꿈 구분 | `isError`, `Input validation error: … <경로: 메시지>` 쉼표 구분 | A21 판정식을 두 문구 모두 받게(옛 번들 채점 유지). **실측(2026-11-28, 두 계열):** 예측대로다 — 경로가 있는 오류는 `<경로>: <메시지>`, 여럿은 쉼표로 잇고, 앞의 `MCP error -32602: `가 빠진다(경로가 없는 최상위의 모르는 키는 그 앞머리만 다르다 — 처음에는 이것만 재고 "앞머리만"이라고 잘못 일반화했다; 리뷰가 바로잡았다). A21 판정식은 고칠 필요가 없었다 |
| stdio 읽기 한도 | 10MB(`STDIO_DEFAULT_MAX_BUFFER_SIZE`) | 10MB | 변화 없음 — `stdio-limit.test.ts`로 재확인 |
| 연결 끊김 시 처리 중 요청 | 끝까지 돈다 | 핸들러의 신호가 abort되고 응답하지 않는다 | 우리 핸들러는 신호를 쓰지 않는다 → grok 자식의 수명은 같을 것으로 예측, §6.7 #10에서 잰다. **실측(2026-11-28, win32, 두 계열, 가짜 grok과 실제 grok):** 예측대로 수명이 같다 — stdin을 닫아도 서버는 grok이 스스로 끝난 뒤 code 0으로 끝나고 grok을 남기지 않으며 이력도 쓴다. 달라진 것은 그 호출의 답뿐이다 — v1은 썼고 v2는 쓰지 않는다(v2 열의 예측대로). 위임만이 아니라 stdin을 닫을 때 끝나지 않은 호출 모두가 그렇다(리뷰가 `worktree list`로 찾았다) |
| 광고되는 capabilities | `tools.listChanged: true`(sdk `esm/server/mcp.js` — 리뷰에서 확인) | 선언한 도구 capability에 `listChanged: true`가 붙는다(문서) | 이 서버에는 차이가 없을 것으로 예측 — 두 계열의 광고를 테스트로 고정한다 |
| 모양이 틀린 원시 프레임 | 응답 | 답하지 않고 버린다 | `.claude/tools`의 프레임은 정상 모양(실측) — 채점으로 재확인. **실측(2026-11-28):** v1 열이 틀렸다 — v1도 JSON이 아닌 줄, `jsonrpc` 없는 요청, 문자열이 아닌 `method`, 문자열 `params`, 배치를 답 없이 버린다. 둘 다 답하는 `params` 없는 `tools/call`만 −32603 → −32602로 바뀌었다(리뷰가 찾았다; `docs/04`) |
| Node 하한 | `>=18` | `>=20` | §6.2 |

### 6.5 배포되는 검사 도구

- `accept-release.mjs`: 지금의 검사 전부(2026-11-28 실행 16행)를 **계열마다** 돌린다 — 2025 계열은 지금의 `initialize` 오프닝, 2026
  계열은 2026-07-28 명세(<https://modelcontextprotocol.io/specification/2026-07-28>)의 stdio 오프닝을 원시 프레임으로.
  옛 번들에서는 2026 계열 행을 "이 판은 받지 않음"으로 표시하고 실패로 세지 않는다. 쿼터 0 보증은 그대로다.
- 원시 프레임 구현이 틀리면 하네스가 거짓 녹색을 낸다 — vitest에서 v2 `Client`로 같은 검사를 돌려 하네스와
  SDK 클라이언트가 같은 판정을 내는지 대조한다.
- `mcpcall.mjs`: `--era legacy|modern`을 더해 실제 호출을 두 계열로 할 수 있게 한다(실제 쿼터를 쓴다는 머리 경고 유지).

### 6.6 테스트

- `server-tools.test.ts`: v2 `Client`와 `InMemoryTransport`(쌍의 두 쪽을 같은 패키지에서)로 옮긴다.
  메모리 전송은 2025 계열만 잇는다(SDK 문서) — 2026 계열은 아래 번들 테스트가 맡는다.
- 새 번들 테스트: 빌드한 `dist/index.js`를 띄워 v2 `Client`로 두 계열에 접속하고, 쿼터 0인 경로로 도구 아홉
  개를 모두 부른다.
- `dist/index.js`·`dist/hook.js`를 언급하는 기존 테스트 파일 11개(셋은 주석에서만; `stdio-limit`·`tool-surface`·`worker-guard` 등)를
  그대로 다시 통과시킨다.
- CI에 Node 20 잡을 더한다. 브랜치 보호 규칙(PRIMARY)이 필수 체크를 이름으로 `mcp-server (ubuntu-latest)`·`mcp-server
  (windows-latest)` 둘로 고정하고(실측) 잡 이름은 `mcp-server (${{ matrix.os }})`다 — 행렬에 Node 버전을 더하면 두 ubuntu 잡이 같은
  필수 체크 이름을 나눠 갖는다(GitHub의 이름 규칙에서 읽은 것, 재지 않았다). 어느 잡이 그 체크를 채우는지 모호해지므로 Node 20은
  필수가 아닌 별도 잡으로 돌린다(필수로 올릴지는 오너 몫). `ci-workflow.test.ts`는 ci.yml의 `node-version`을 읽지 않는다 — 326행은 테스트 안의 예제다(리뷰가
  바로잡았다).

### 6.7 실측 재검증 매트릭스

각 행은 숫자로 기록한다(릴리스 노트와 `docs/09` §5). 쿼터 열은 예상치다.

| # | 무엇을 | 어떻게 | 어디서 | 쿼터 |
|---|---|---|---|---|
| 1 | 단위·타입·빌드 | `npm test`·`typecheck`·`build` + dist 재현 | win32, CI ubuntu·windows, Node 20·22 | 0 |
| 2 | 전 도구 채점, 두 계열 | `accept-release --repo` | win32, Linux(Docker `node:20`) | 0 |
| 3 | 옛 번들 채점 불변 | `accept-release`(설치 캐시의 이전 릴리스) | win32 | 0 |
| 4 | 최소 런타임 | Node 20 최저판으로 번들 실행·채점 | win32 휴대용 Node, Docker | 0 |
| 5 | Node 20 미만 | Node 18에서 한 줄 안내로 끝나는지 | win32 휴대용 Node 18 | 0 |
| 6 | 실제 위임 | `mcpcall --era`로 delegate·plan·verify·grok_cli(`-p`), 두 계열 | win32, grok 1.0.92 | Grok 약 8턴 |
| 7 | 쿼터 0 도구 | status·auth_check·usage·route·worktree·cli(version) | 두 계열 | 0 |
| 8 | Claude Code 실접속 | 첫 교환을 기록하는 스파이 서버로 Claude Code가 어느 계열로 붙는지, 기동이 몇 번인지 | win32 | Claude 소량 |
| 9 | 설치본 수락 | 새 세션의 `serverVersion`, `/grok:status`, 위임 1회(`docs/09` §5b ②) | win32 | Claude 소량 + Grok 1턴 |
| 10 | 위임 중 연결 끊김 | 클라이언트를 끊었을 때 grok 자식·서버 프로세스의 수명 | 두 계열 | Grok 2턴 |
| 11 | 과금 안전 | subscription 모드 키 제거, 세션 없는 홈 → `auth_error` | 쿼터 0 홈 | 0 |
| 12 | grok 계약 | `probe:contract`(1.0.92), 새 플래그 분류 뒤 | win32 | 0 |
| 13 | 10MB 한도 | `stdio-limit` + 경계 위·아래 실측 | 두 계열 | 0 |

실측(2026-11-28 — 숫자는 릴리스 노트): 예측과 다른 결말은 §6.4의 "모양이 틀린 원시 프레임" 행(v1 열)과 #8뿐이었다 — 검증 문구와
끊긴 연결의 답은 예측대로였다(처음 기록은 이 둘을 "다른 결말"로 셌다; 리뷰가 바로잡았다). #8은 예측보다 단순했다 — Claude Code
2.1.332는 서버를 **한 번** 띄우고 `server/discover`(2026-07-28)를 먼저 보내, v2 번들에는 그 계열로 붙고, v1 번들에는 같은 프로세스에서
`initialize`(2025-11-25)로 돌아간다. 탐색용으로 띄웠다 닫는 형제 프로세스는 두 경우 모두 없었다(Review Focus 1의 테스트는 그런
클라이언트 — `auto` 모드의 SDK v2 클라이언트가 그렇다 — 를 대비해 남긴다).

### 6.8 README 개편

- 구성(영문·한글 같은 뼈대): 머리(이름·한 줄 가치·배지) → 무엇을 하나(구조도) → 빠른 시작(요구 사항 표:
  Claude Code·grok CLI·**Node 20+**·구독) → 명령 표(27개를 목적별로) → 위임이 도는 순서(순서도) → 과금·안전(모드 표)
  → **프로토콜 지원 표**(2025 계열 / 2026-07-28) → 문제 해결 표 → 문서 지도 표 → 라이선스.
- 이미지(빌더 판단): 구조도·순서도는 **Mermaid**로 쓴다 — GitHub가 바로 그리고, 글자라서 diff가 되며 밝은·어두운
  테마를 따른다. 머리 배너 하나는 `docs/images/`의 SVG로 두고 `<picture>`로 밝은·어두운 판을 나눈다. 화면 예시는
  **실제 실행 출력**에서만 만든다(지어낸 화면 금지).
- 정확성: 표의 명령·도구 목록이 `commands/`와 등록된 도구와 어긋나지 않게 테스트로 묶는다(전역 규칙 §5 — 기계로
  검증할 수 있는 사실은 CI에서). 렌더링은 GitHub에서 밝은·어두운 테마로 직접 확인한다(공개 레포라 로그인 없이 볼 수 있다).

### 6.9 고칠 문서

`CLAUDE.md`(코딩 컨벤션의 "`@modelcontextprotocol/sdk` 사용", 컴포넌트 지도), `docs/04`(없는 도구·검증 오류의
응답 모양), `docs/01`(구조), `docs/03`, `CONTRIBUTING.md`·`maintainer-preflight` 스킬(SDK·hono 언급),
`docs/08`(Node 20), README 두 개.

### 6.10 PR 순서

| 순서 | PR | 성격 |
|---|---|---|
| 0 | CHANGELOG 이관 — 완료(#227, 2026-11-28) | 문서 — 릴리스의 전제 |
| 1 | grok 1.0.92 계약 드리프트 정리(새 플래그 분류, 계약 갱신) + 그 재측정이 연 A80·A81 | 릴리스 |
| 2 | **MCP v2 이중 계열**(이 설계의 본체) + 제3자 라이선스 고지 + 실측 기록 | 릴리스 |
| 3 | README 개편(영·한) — 2의 최종 상태 기준 | 문서 |
| 4 | 수락 기록(`docs/09` §5) | 문서 |

## 7. 완료 기준

- 번들이 `@modelcontextprotocol/server` 위에서 빌드되고, 락파일에 `@modelcontextprotocol/sdk`가 없으며 `npm audit` 0.
- §6.7의 열세 행이 모두 숫자로 기록되고 통과한다. 옛 번들 채점 결과는 바뀌지 않는다.
- Claude Code 실접속의 계열과 기동 횟수가 기록된다.
- Node 하한이 `engines`·README 두 개·`docs/08`에 적히고, Node 18에서는 한 줄 안내로 끝난다(실측).
- CI(ubuntu·windows, Node 20 잡 포함) 녹색, Grok 반증 HOLDS, `docs/11` 라운드 규율의 종료 조건 충족.
- README 두 개가 §6.8대로 새로 쓰이고, 표–코드 대조 테스트가 녹색이며, GitHub 렌더링을 두 테마에서 확인했다.
- 릴리스 태그를 머지 직후 끊고 `docs/09` §5 수락의 마지막 칸(새 세션)을 채운다.

## 8. 위험

- v2는 2.0.0(2026-07-27) 뒤 넉 달에 2.4.0까지 왔다 — 변화가 빠르다. 하한을 실측한 판으로 잡고, 올릴 때마다 재측정한다.
- 2026 계열 원시 프레임 하네스의 구현 오류 → §6.5의 SDK 클라이언트 대조로 막는다.
- Claude Code가 2026 계열로 붙으면 사용자 경로 전체가 새 계열로 바뀐다 — #8·#9가 그 경로를 직접 잰다.
- Node 18 사용자는 업데이트 후 플러그인이 시작되지 않는다 — 한 줄 안내와 릴리스 노트로 알린다.

## 9. 빌더에게 맡긴 것

원시 프레임의 정확한 2026 오프닝 모양(명세에서), Node 안내 모듈의 형태, CI 행렬의 정확한 모양, Mermaid 그림의
구성, 새 번들 테스트의 파일 구성, 락파일 하한 판 번호.

## 10. 오너 결정 (2026-11-28)

1. 착수 시점 → **지금 착수.**
2. 제3자 라이선스 고지 → **포함**(2번 PR). v0.2.54 번들은 제3자 패키지 8개(MIT 6·BSD-3-Clause 1·ISC 1)를
   인라인하면서 고지가 0건이다(실측). 고지는 v2로 바뀐 번들 구성을 기준으로 만든다 — `node_modules` 표식에 보이는 패키지만이
   아니라 v2 SDK 패키지가 자기 dist 안에 묶어 둔 제3자 코드(ajv·fast-uri 등, `//#region …/.pnpm/<패키지>@<버전>` 표식 — 리뷰)까지,
   그리고 v2 SDK 자체(Apache-2.0)까지.
3. grok 드리프트 정리 → **먼저**(1번을 2번보다 앞에). 재검증 기준선이 1.0.92여야 한다.
4. 이 계획의 머지 → 오너가 매번 묻지 않아도 되게 정했다(2026-11-28, "같은 기준이면 바로 머지 (Recommended)" 선택): PR마다 리뷰어
   1명(릴리스는 Grok 반증도)으로 BLOCKER·MAJOR 0, 모든 지적 처리, CI 녹색이면 실행자가 squash 머지하고 릴리스는 곧바로 태그한다.
   실제 쿼터를 쓰는 측정은 지금처럼 직전에 따로 묻는다.
