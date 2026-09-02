# Grok Build for Claude Code

[English](README.md) · **한국어**

[![CI](https://github.com/xzawed/claude-grok-build-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/xzawed/claude-grok-build-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6.svg)

> Claude가 코딩 작업 일부를 **[Grok Build](https://x.ai/cli)** CLI에 넘길 수 있게 하는
> **Claude Code 플러그인**. 과금은 모르는 사이에 종량제 API로 새지 않고 **xAI 구독**으로
> 갑니다.
>
> Claude가 지휘하고 Grok이 작업 트리에서 실행하며, 품질 게이트는 사용자가 쥡니다 — 대신
> 커밋해 주는 일은 없습니다.

**목표:** Grok을 잘 쓰게 · Grok이 강한 지점을 확인 · Claude ↔ Grok 협업 —
[`docs/00-product-vision.md`](docs/00-product-vision.md).
사람이 읽는 시작 지도는
[`docs/08-getting-started-with-grok.md`](docs/08-getting-started-with-grok.md).

설치 후 **`/grok:tour`** 를 돌리세요 — 15분 가이드로 첫 성공까지, 과금 확인 포함입니다.

## 빠른 시작

1~2단계는 터미널에서 최초 1회만 하고, OS마다 다른 건 설치 명령뿐입니다. 3단계는 Claude Code
안에서 실행하며 모든 환경에서 동일합니다.

### 1. Grok Build CLI 설치 (최초 1회)

- **macOS / Linux** — 아무 셸(bash, zsh 등):
  ```bash
  curl -fsSL https://x.ai/cli/install.sh | bash
  ```
- **Windows — PowerShell** (예: Windows Terminal 탭):
  ```powershell
  irm https://x.ai/cli/install.ps1 | iex
  ```
- **Windows — WSL** (Ubuntu 등): 위 macOS/Linux 명령을 WSL 셸 *안에서* 실행합니다.

> [!IMPORTANT]
> Windows 명령 프롬프트(`cmd.exe`)는 두 설치기 모두 지원하지 않습니다 — PowerShell이나 WSL을
> 쓰세요. 그리고 한쪽을 정했으면 Claude Code도 같은 쪽에서 실행하세요. WSL 설치본은 네이티브
> Windows에서 보이지 않고, 그 반대도 마찬가지입니다.

### 2. 로그인 + 스모크 테스트 (브라우저 OAuth, 최초 1회)

```bash
grok login
grok --no-auto-update -p "Say ok."
```

활성 **SuperGrok / X Premium+** 구독이 필요합니다 — 또는 [종량제 API 모드](#인증-모드)를 쓸
거라면 xAI API 키가 필요합니다. 플러그인이 대신 로그인하거나 키를 저장하는 일은 없습니다.

### 3. 플러그인 설치 — Claude Code 안에서

아래는 **터미널 명령이 아니라 Claude Code 프롬프트**이며, 모든 OS에서 동일합니다:

```
/plugin marketplace add xzawed/claude-grok-build-plugin
/plugin install grok@grok-marketplace
/reload-plugins
/grok:setup
```

`/grok:setup`이 준비 상태를 확인해 줍니다. 이어서 **`/grok:tour`** 가 인증 → 라우트 데모 →
작은 첫 성공 → 다음에 해볼 것까지 안내합니다.

## 무엇인가

- **어떻게가 아니라 언제 위임할지.** Claude 쪽 라우팅(`/grok:route`와 `grok-routing` 스킬)이
  대량·저리스크 작업에는 Grok을 제안하고, 아키텍처와 보안은 Claude에 남깁니다.
- **볼륨 작업을 격리.** 위임을 전용 git worktree에서 돌릴 수 있어, 마이그레이션·테스트
  백필·보일러플레이트가 사용자가 적용하기 전까지 체크아웃을 건드리지 않습니다. Grok Build는
  실행 중 스스로 subagent도 띄웁니다.
- **종량제가 아닌 구독.** 서버는 기본값으로 `grok`을 spawn하기 전에 `XAI_API_KEY` /
  `GROK_CODE_XAI_API_KEY`를 제거하므로, 위임 작업이 종량제 API 요율이 아니라 SuperGrok /
  X Premium+ 플랜 안에서 실행됩니다.
- **컨벤션 자동 승계.** 기존 `CLAUDE.md` / `AGENTS.md`와 `.claude/` 설정(skill·agent·MCP·hook)을
  추가 설정 없이 그대로 읽습니다.

MCP 서버와 hook은 `mcp-server/dist/`에 빌드된 번들로 배포되므로, 설치 후 따로 빌드할 필요가
없습니다.

## 언제 위임하고, 언제 하지 않나

| Grok에 넘길 일 | Claude가 쥘 일 |
|---|---|
| 대량 반복 편집 — 같은 패턴을 여러 파일에, 이름 변경, import 정리 | 아키텍처·설계 판단 |
| 저리스크 볼륨 — 테스트 백필, 문서 동기화, 보일러플레이트 | 보안·규제 — 인증·권한·암호화, 의료·금융 등 규제 도메인 |
| 좁고 독립적인 범위 — 단일 모듈, 명확한 수용 기준 | 모노레포 전체 맥락이 필요한 작업 |
| 어차피 검토할 탐색적 프로토타입 | 최종 리뷰와 품질 게이트 |

`/grok:route` 가 이 기준을 대신 적용해 `nextAction`을 돌려줍니다 — 실행도 과금도 하지
않습니다. 전체 기준은 [`docs/05-routing-policy.md`](docs/05-routing-policy.md).

## 과금·승인 안전

> [!CAUTION]
> **기본값인 구독 모드**에서는 서버가 `grok`을 spawn하기 전에 `XAI_API_KEY`와
> `GROK_CODE_XAI_API_KEY`를 제거하므로, 셸 프로파일의 키가 위임의 자격증명이 될 수
> 없습니다. 이는 프로세스에 **무엇을 넘기느냐**에 대한 보장이지, CLI가 어느 쪽을 고를
> 것인가에 대한 주장이 아닙니다 — grok 1.0.13 실측 기준 유효한 세션 토큰이 이기고 env 키는
> 시도조차 되지 않습니다. env 키는 **세션이 없거나 만료된 순간** 폴백이 되며, 바로 그때
> "구독"으로 시작한 실행이 조용히 종량제로 청구될 수 있습니다. 키를 지우면 그 실행은 조용히
> 과금되는 대신 명시적으로 실패합니다. 상세:
> [`docs/specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) §10.

- 모든 `grok_build_delegate` 응답은 설정된 `mode`와 그 모드가 함의하는 `billing`을 밝힙니다 —
  `GROK_BUILD_AUTH_MODE`에서 파생된 표기이며 xAI가 실제로 청구한 값의 관측치가
  아닙니다(`docs/specs/grok-cli-contract.md` §2).
- 서버는 자격증명을 저장·로깅·읽지 않고 존재 여부만 확인합니다.
- **위임은 로컬에 기록됩니다.** 매 위임마다 `~/.grok-build/history.jsonl`에 한 줄이 추가되며,
  **프롬프트 앞 ~200자**·작업 디렉토리·변경 파일이 담깁니다. `/grok:usage`·`/grok:status`가
  이를 다시 읽으므로 그 미리보기는 이후 Claude 세션으로 되돌아옵니다. 알려진 시크릿 형태는
  기록 전에 마스킹하지만 **패턴 매칭은 완화이지 보장이 아닙니다** — 로그에 남기고 싶지 않은
  것은 프롬프트에도 넣지 마세요. 지우려면 파일을 삭제하면 되고, 다른 기능은 여기 의존하지
  않습니다.

> [!WARNING]
> **모든 위임은 grok의 tool 사용 전체를 자동 승인합니다** — 파일 편집뿐 아니라 셸 명령·삭제·
> 설치·네트워크·git까지이며, 파일이 아닌 부작용은 `filesChanged` diff에 드러나지 않습니다.
> 헤드리스 `grok`은 `--always-approve` 없이는 편집을 못 하므로(없으면 `stopReason:
> "Cancelled"`로 끝나고 아무것도 바꾸지 않습니다) 플러그인이 항상 이 플래그를 붙입니다.
>
> `grok`은 대상 `cwd`에서 직접 편집하며 **자동 커밋은 하지 않습니다** — 사람이 먼저 검토합니다.
> 위험한 작업은 `--worktree` / `--sandbox`로 격리하세요.

전체 근거와 검증 체크리스트: [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md).

## 인증 모드

**서버 레벨에서 한 번만** `GROK_BUILD_AUTH_MODE`로 결정합니다 — 호출별 오버라이드는 없습니다.

| | `subscription` (기본) | `api` (opt-in) |
|---|---|---|
| 트리거 | 미설정 또는 `=subscription` | `GROK_BUILD_AUTH_MODE=api` |
| env 처리 | spawn 전 API 키 **제거** | 키 **그대로 통과** |
| 인증 근거 | `~/.grok/auth.json` (`grok login`) | 환경에 있는 API 키 |
| 과금 | xAI 구독 정액 | API 종량제 |
| 응답 `billing` | `"subscription"` | `"metered_api"` |

`GROK_BUILD_AUTH_MODE`를 설정하지 않으면 모든 위임이 구독 모드로 실행됩니다.

<details>
<summary><b>API 모드 설정 (opt-in, 종량제)</b></summary>

모드는 MCP 서버를 띄우는 환경의 `GROK_BUILD_AUTH_MODE`로 읽힙니다. 두 가지 동등한 방법:

- **프로세스 env (권장)** — Claude Code를 시작하는 환경에 설정하면 플러그인 업데이트가 덮어쓰지
  못합니다:
  ```bash
  export XAI_API_KEY="..."          # 본인 소유 키 — 플러그인이 발급/저장하지 않음
  export GROK_BUILD_AUTH_MODE=api
  ```
- **`.mcp.json` env 블록** — `grok-build` 항목에 `env` 추가(플러그인 업데이트 시 덮어쓰일 수
  있음):
  ```json
  "grok-build": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"],
    "env": { "GROK_BUILD_AUTH_MODE": "api" }
  }
  ```
</details>

## 커맨드

플러그인은 `/grok:*` 커맨드 27개를 배포합니다 — 접두어는 Claude Code가 플러그인명 `grok`에서
도출합니다. 아래 15개가 평소에 직접 치는 것들이고, 나머지 12개는 grok 자체 CLI를 감싼 것으로
표 아래에 접어 두었습니다.

**매일 쓰는 흐름**

| 커맨드 | 하는 일 |
|---|---|
| `/grok:route` | Claude vs Grok 추천 + **`nextAction`** (실행·과금 없음) |
| `/grok:plan "<작업>"` | 읽기전용 계획 미리보기 (편집 없음) |
| `/grok:delegate "<작업>"` | 작업 위임 — grok이 `cwd`에서 직접 편집, 자동 커밋 없음 |
| `/grok:verify "<작업>"` | 위임 + grok 자기검증 (프롬프트 체크리스트) |
| `/grok:review` | 위임 후 품질 게이트 (diff + billing; 자동 커밋 없음) |
| `/grok:worktree` | 격리 worktree list/diff/apply/remove/prune (자동 커밋 없음) |
| `/grok:resume` | 이전 Grok 세션 이어가기 (`lastSession.sessionId`) |
| `/grok:usage` | 사용량 요약 + insights(성공률·구독 비중) |

**설치·프리셋·패스스루**

| 커맨드 | 하는 일 |
|---|---|
| `/grok:setup` | grok 설치 + 로그인 확인; 첫 성공 샘플 + 다음 시나리오 |
| `/grok:status` | **대시보드** — 준비됨?, billing, 사용량, last session, next steps |
| `/grok:tour` | **15분 가이드 투어** — 인증, 라우트 데모, 작은 첫 성공, 다음 레시피 |
| `/grok:tests` | 프리셋: 테스트 백필/확장 |
| `/grok:migrate` | 프리셋: 다파일 기계적 마이그레이션 |
| `/grok:boilerplate` | 프리셋: 스캐폴드/보일러플레이트 |
| `/grok:cli "<raw grok args>"` | 패스스루: 임의 grok 서브커맨드를 빌링 안전 env로 실행 |

<details>
<summary><b>나머지 12개 — grok 자체 CLI 동사</b></summary>

| 커맨드 | 하는 일 |
|---|---|
| `/grok:sessions` | Grok 세션 목록·검색·삭제 (복원은 없음 — `/grok:resume` 사용) |
| `/grok:export` | Grok 세션 트랜스크립트를 Markdown으로 내보내기 |
| `/grok:memory` | Grok 세션 간 메모리 관리 |
| `/grok:inspect` | 이 디렉토리에서 Grok이 발견하는 설정 보기 |
| `/grok:models` | 사용 가능한 Grok 모델 목록 |
| `/grok:mcp` | Grok의 MCP 서버 설정 관리 |
| `/grok:login` | 최초 1회 터미널 로그인 안내 (대신 실행하지는 않음) |
| `/grok:logout` | 로그아웃 및 캐시된 자격증명 삭제 |
| `/grok:update` | Grok 업데이트 확인 또는 설치 |
| `/grok:version` | 설치된 Grok 버전 표시 |
| `/grok:trace` | Grok 세션 트레이스 데이터 내보내기·업로드 |
| `/grok:import` | `blocked`을 반환 — Grok CLI 1.0 서브커맨드가 아닙니다. `/grok:sessions` + `/grok:resume`을 쓰세요 |

이 그룹에서 알아둘 것 두 가지:

- `/grok:worktree`는 여기 **없습니다.** `grok_build_worktree` tool 기반이며, grok 자체
  `worktree` 서브커맨드와는 다른 트래커입니다.
- `/grok:login`과 `/grok:import`는 grok을 아예 띄우지 않습니다. 앞은 터미널에서 칠 명령을
  안내하고, 뒤는 `blocked`을 돌려줍니다. 같은 가드가 grok의 비-헤드리스 모드
  (`dashboard`·`agent`·`leader`·`completions`·`wrap`)도 막습니다 — 안 그러면 세션이 멈춘 채
  기다리게 됩니다.
</details>

**스킬·에이전트 (자동 발견):**

- `grok-routing` — 대량·저리스크에서 Grok 제안, 설계·보안은 Claude
- `grok-first-mile` — 온보딩 / "뭘 먼저 해보지?"
- `grok-worker` agent — 볼륨 작업을 MCP로 실행, Claude가 리뷰

## 위임이 실행되는 경로

```
Claude Code (현재 세션)
  └─ MCP tool 호출 ─▶ grok-build MCP 서버 (이 플러그인)
                        └─ `grok` CLI spawn (헤드리스: -p, --always-approve,
                           │                  --output-format json; 모드에 따라
                           │                  env 제거/통과)
                           └─ 모드별로 구독 세션 토큰(~/.grok/auth.json)
                              또는 API 키로 인증
  ◀── Claude가 검토할 구조화된 요약 + diff ──┘
```

`mcp-server/`(TypeScript, ESM)가 9개 MCP tool을 stdio로 제공합니다 — auth, **status**, delegate,
plan, verify, usage(insights), worktree 라이프사이클, **route**(추천만), cli.
여기에 PreToolUse 인증(auth-check) hook이 더해집니다.

전체 아키텍처: [`docs/01-architecture.md`](docs/01-architecture.md).

## 설치·과금 검증

Claude Code 안에서, 설치 + 최초 1회 `grok login` 후:

1. **`/grok:status`** (또는 `/grok:setup`) → `ready`, `mode`, 기대 `billing`, `serverVersion`.
2. 편집돼도 괜찮은 임시 디렉토리에서
   **`/grok:delegate "create a file hello.txt containing exactly: ok"`** — grok이 거기서 실제로
   편집합니다 → `filesChanged`에 `hello.txt`가 있는지 확인하고, 무엇보다
   **`billing`이 `"subscription"`인지**(`metered_api`가 아닌지) 확인하세요.
   - 커밋된 것은 없습니다. **`/grok:review`** 로 diff를 검토하세요.
3. **`/grok:plan "add input validation to the main function"`** → 계획 요약, 변경 파일 없음.
4. **`/grok:route`** → `nextAction` 추천; **`/grok:usage`** → 이력과 함께
   **`/grok:resume`** 이 이어갈 `lastSession`.

## 문제 해결

| 증상 | 뜻 | 조치 |
|---|---|---|
| `/reload-plugins` 후에도 `/grok:setup`이 안 잡힘 | `/grok:*` 호출 문자열과 마켓플레이스 스키마는 Claude Code 버전에 따라 고정이 아닙니다 | `/help`로 실제 형식을 확인한 뒤 [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md) 참고 |
| `/grok:delegate`가 실행 전에 차단되고 `grok login` 안내가 나옴 | 로그인이 안 된 상태입니다. PreToolUse hook과 서버 자체 인증 확인이 이중으로 막으며, 기본값(env 미설정)에서는 서버가 막습니다 | 터미널에서 `grok login` 후 다시 시도 |
| `/grok:status`가 **`billingMismatch`** 를 보고 | 서버는 구독 모드인데 과거 위임이 종량제로 기록돼 있습니다. 그 위임들은 `api` 모드에서 돌았던 것이며, 키가 샜다는 증거는 아닙니다 — 구독 모드는 키를 제거합니다 | `GROK_BUILD_AUTH_MODE`를 확인해 과금 경로를 정리한 뒤 다시 위임 |
| 플러그인 업데이트 후에도 `serverVersion`이 옛 버전 | MCP 서버 프로세스가 업데이트 이전 것입니다 | Claude Code를 재시작한 뒤 `/grok:status` 재확인 |

## 문서

- [`00-product-vision.md`](docs/00-product-vision.md) — 왜 존재하는가
  (잘 쓰기 · 체감 · Claude↔Grok 협업)
- [`08-getting-started-with-grok.md`](docs/08-getting-started-with-grok.md) —
  **사람용 시작점** (15분 경로 + 레시피)
- [`01-architecture.md`](docs/01-architecture.md) — 전체 그림
- [`02-auth-strategy.md`](docs/02-auth-strategy.md) — 투트랙 인증 제약 (가장 중요)
- [`03-plugin-spec.md`](docs/03-plugin-spec.md) ·
  [`04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — `mcp-server/` 구성
- [`05-routing-policy.md`](docs/05-routing-policy.md) — 언제 위임할지
- [`06-roadmap.md`](docs/06-roadmap.md) — 구현 순서 및 현재 상태
- [`07-orchestrator-integration.md`](docs/07-orchestrator-integration.md) —
  Task Manager ↔ route/`nextAction` 계약
  - 예제: [`examples/orchestrator-consumer.md`](examples/orchestrator-consumer.md)
- [`09-scope-and-residuals.md`](docs/09-scope-and-residuals.md) — 이 레포에서 끝난 것과,
  의도적으로 레포 밖에 두는 것
- [`specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) — 이 플러그인이 기준으로 삼은
  `grok` CLI 플래그·출력 스키마 (전부 실측)

<details>
<summary><b>폴더 구조</b></summary>

```
claude-grok-build-plugin/
├── README.md · README.ko.md   # 영문 / 이 파일 (한글)
├── CLAUDE.md                  # Claude Code가 자동 로드하는 프로젝트 컨텍스트
├── CHANGELOG.md               # 릴리스 이력
├── CONTRIBUTING.md            # 브랜치/PR 규칙, dist·버전 규칙
├── LICENSE                    # MIT
├── docs/                      # 설계 문서 (구현과 동기화 유지)
│   ├── 00-product-vision.md … 09-scope-and-residuals.md
│   ├── specs/                 # 날짜별 설계/검증 스펙 (예: grok-cli-contract.md)
│   └── plans/ · releases/     # 구현 계획, 버전별 릴리스 노트
├── examples/                  # 오케스트레이터 소비자 키트
├── .claude-plugin/plugin.json        # 플러그인 매니페스트 (name: grok)
├── .claude-plugin/marketplace.json   # 마켓플레이스 엔트리 (grok-marketplace)
├── .mcp.json                         # MCP 서버 등록
├── mcp-server/                       # TS MCP 서버 + hook (사전 빌드 dist/index.js + dist/hook.js 동봉)
├── commands/                         # /grok:* (+ tour, 프리셋)
├── skills/                           # grok-routing, grok-first-mile
├── agents/grok-worker.md             # 볼륨 작업 서브에이전트
├── hooks/                            # pre-delegate-auth-check PreToolUse hook
└── .github/workflows/                # CI (ubuntu + windows)
```

**이 레포 제품 범위는 완료.** 외부 오케스트레이터 실배선은 소비자 레포, GUI 클릭은 수동 수락,
ACP는 보류.

참고: [`docs/09-scope-and-residuals.md`](docs/09-scope-and-residuals.md) ·
[`docs/06-roadmap.md`](docs/06-roadmap.md).
</details>

## 라이선스

[MIT](LICENSE) © 2026 xzawed
