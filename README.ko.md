# Grok Build for Claude Code

[English](README.md) · **한국어**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) ![Tests](https://img.shields.io/badge/tests-150%20passing-brightgreen.svg) ![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6.svg) ![Status](https://img.shields.io/badge/status-Phases%201--3%20complete-success.svg)

> Claude가 코딩 작업 일부를 **[Grok Build](https://x.ai/cli)**(xAI의 터미널 코딩 에이전트)에 위임하고 diff를 세션으로 가져와 검토하게 해주는 Claude Code 플러그인 — 과금은 **종량제 API가 아니라 xAI 구독**으로.

**만들고 싶은 것:** 개발자가 **Grok을 잘 쓰게** 하고, 플러그인으로 **Grok의 코딩 실력을 체감**하게 하며, **Claude ↔ Grok 협업**이 자연스럽고 멋지게 느껴지게 하는 것(Claude 지휘 · Grok 실행 · 사람은 품질 게이트). 제품 나침반: [`docs/00-product-vision.md`](docs/00-product-vision.md).

Claude는 오케스트레이터로 남고 Grok Build가 워커입니다. 외부 터미널 에이전트(예: OpenAI Codex CLI)를 감싸는 것과 같은 결이며, 이 프로젝트만의 특징은 xAI 워커와 구독 우선 과금 모델입니다. (레포: `claude-grok-build-plugin`. Phase 1~3 완료, 경험 강화·Phase 4는 [로드맵](docs/06-roadmap.md).)

## ⚡ 빠른 시작

두 부분입니다: 최초 1회 **CLI 설치**(유일한 OS별 단계) → **플러그인 설치**(Claude Code 안에 입력, 모든 OS 동일).

### 1. Grok Build CLI 설치 (최초 1회) — 본인 환경 선택

- **macOS / Linux** — 터미널(bash, zsh 등 아무 셸):
  ```bash
  curl -fsSL https://x.ai/cli/install.sh | bash
  ```
- **Windows — PowerShell** (예: Windows Terminal 탭):
  ```powershell
  irm https://x.ai/cli/install.ps1 | iex
  ```
- **Windows — WSL** (Ubuntu 등): 위 macOS/Linux 명령을 WSL 셸 *안에서* 실행.

> Windows **명령 프롬프트(`cmd.exe`)는 두 설치기 모두 미지원** — PowerShell 또는 WSL을 쓰세요. 두 방식을 섞지 마세요: WSL 설치본은 네이티브 Windows에서 안 보이고 그 반대도 마찬가지이니, 한 경로를 정하고 Claude Code도 같은 쪽에서 실행하세요.

### 2. 로그인 + 스모크 테스트 (브라우저 OAuth, 최초 1회) — 모든 OS 동일

```bash
grok login
grok --no-auto-update -p "Say ok."
```

> **SuperGrok / X Premium+** 구독이 있어야 합니다(또는 [API 모드](#인증-모드)용 API 키). 플러그인은 대신 로그인하거나 키를 저장하지 않습니다.

### 3. 플러그인 설치 — Claude Code 안에서

아래는 **터미널 명령이 아니라 Claude Code 프롬프트**이며, 모든 OS·터미널에서 동일합니다:

```
/plugin marketplace add xzawed/claude-grok-build-plugin
/plugin install grok@grok-marketplace
/reload-plugins
/grok:setup
```

`/grok:setup`이 준비 상태를 확인합니다.

## 무엇인가

- **병렬성.** Grok Build는 git worktree 격리로 최대 8개 subagent를 병렬 실행 — 마이그레이션·테스트 백필·보일러플레이트를 Claude 단독보다 빠르게 처리합니다.
- **종량제가 아닌 구독.** SuperGrok / X Premium+ 구독자라면 위임 작업이 종량제 API가 아니라 *구독 플랜 안에서* 돌아갑니다.
- **컨벤션 자동 승계.** 기존 `CLAUDE.md` / `AGENTS.md`와 `.claude/` 설정(skills·agents·MCP·hooks)을 별도 설정 없이 읽습니다.

내부적으로 `mcp-server/`(TypeScript, ESM)가 8개 MCP tool을 stdio로 제공합니다 — auth, delegate, plan, verify, usage(insights), worktree, **route**(추천만), cli — PreToolUse 인증 hook. 유닛 테스트 150개, 사전 빌드 번들 커밋.

## ⚠️ 과금 안전 — 딱 하나만 기억할 것

`grok` CLI는 **`XAI_API_KEY` / `GROK_CODE_XAI_API_KEY`를 세션 토큰보다 우선**하므로, 환경에 키가 하나만 남아 있어도 과금이 조용히 종량제 API로 샐 수 있습니다. **구독 모드(기본값)**에서는 서버가 `grok`을 spawn하기 전에 이 변수들을 제거하므로, 셸 프로파일의 키가 위임으로 새지 않습니다. 모든 `grok_build_delegate` 응답은 실제 실행된 `mode`·`billing`을 밝힙니다. 서버는 자격증명을 저장·로깅·읽지 않고 존재 여부만 확인합니다.

**헤드리스 편집엔 `--always-approve`가 필수.** 위임은 항상 이 플래그를 붙입니다(없으면 헤드리스 `grok`이 `stopReason: "Cancelled"`로 끝나 *아무 편집도* 안 함). 이 플래그는 파일 편집뿐 아니라 grok의 **모든 tool 사용**(셸 명령·삭제·설치·네트워크·git)을 자동 승인하며, 비파일 부작용은 `filesChanged` diff에 드러나지 않습니다. 그래서 `grok`은 대상 `cwd`에서 직접 편집하되 **자동 커밋은 하지 않고**(사람이 검토 후 커밋), 위험한 작업은 격리된 `--worktree` / `--sandbox`를 권장합니다.

전체 근거와 검증 체크리스트: [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md).

## 인증 모드

**서버 레벨에서 한 번만** `GROK_BUILD_AUTH_MODE`로 결정 — 호출별 오버라이드는 없습니다.

| | `subscription` (기본) | `api` (opt-in) |
|---|---|---|
| 트리거 | 미설정 또는 `=subscription` | `GROK_BUILD_AUTH_MODE=api` |
| env 처리 | spawn 전 API 키 **제거** | 키 **그대로 통과** |
| 인증 근거 | `~/.grok/auth.json` (`grok login`) | 환경에 있는 API 키 |
| 과금 | xAI 구독 정액 | API 종량제 |
| 응답 `billing` | `"subscription"` | `"metered_api"` |

아무 설정도 하지 않으면 기존의 구독 전용 동작이 유지됩니다.

<details>
<summary><b>API 모드 설정 (opt-in, 종량제)</b></summary>

모드는 MCP 서버를 띄우는 환경의 `GROK_BUILD_AUTH_MODE`로 읽힙니다. 두 가지 동등한 방법:

- **프로세스 env (권장)** — Claude Code를 시작하는 환경에 설정하면 플러그인 업데이트가 덮어쓰지 못합니다:
  ```bash
  export XAI_API_KEY="..."          # 본인 소유 키 — 플러그인이 발급/저장하지 않음
  export GROK_BUILD_AUTH_MODE=api
  ```
- **`.mcp.json` env 블록** — `grok-build` 항목에 `env` 추가(플러그인 업데이트 시 덮어쓰일 수 있음):
  ```json
  "grok-build": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"],
    "env": { "GROK_BUILD_AUTH_MODE": "api" }
  }
  ```
</details>

## 커맨드

`/grok:*`로 네임스페이싱됩니다(Claude Code가 플러그인명 `grok`에서 접두어를 도출).

| 커맨드 | 하는 일 |
|---|---|
| `/grok:setup` | grok 설치 + 로그인 확인; 첫 성공 샘플 + 다음 시나리오 |
| `/grok:delegate "<작업>"` | 작업 위임 — grok이 `cwd`에서 직접 편집, 자동 커밋 없음 |
| `/grok:plan "<작업>"` | 읽기전용 계획 미리보기 (편집 없음) |
| `/grok:verify "<작업>"` | 위임 + grok 자기검증 (`--check`) |
| `/grok:tests` | 프리셋: 테스트 백필/확장 |
| `/grok:migrate` | 프리셋: 다파일 기계적 마이그레이션 |
| `/grok:boilerplate` | 프리셋: 스캐폴드/보일러플레이트 |
| `/grok:usage` | 사용량 요약 + insights(성공률·구독 비중) |
| `/grok:worktree` | 격리 worktree list/diff/apply/remove (자동 커밋 없음) |
| `/grok:route` | Claude vs Grok 추천만 (실행·과금 없음) |
| `/grok:cli "<raw grok args>"` | 패스스루: 임의 grok 서브커맨드를 빌링 안전 env로 실행 |

**Skill:** `grok-routing`(플러그인과 함께 자동 로드)이 대량·저리스크 작업에서 Grok 위임을 **먼저 제안**하고, 설계·보안은 Claude에 남기도록 안내합니다.

유틸 동사(`grok_cli` 경유): `sessions`·`export`·`import`·`memory`·`inspect`·`models`·`mcp`·`worktree`·`login`(터미널 로그인 안내)·`logout`·`update`·`version`·`trace`. 비-헤드리스 모드(`dashboard`·`agent`·`leader`·`completions`·`wrap`)와 `login`은 가드됩니다 — tool이 행 대신 "터미널에서 직접 실행" 메시지를 반환합니다.

## 전체 흐름

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

전체 아키텍처: [`docs/01-architecture.md`](docs/01-architecture.md).

## 설치 후 검증

Claude Code 안에서, 설치 + 최초 1회 `grok login` 후:

1. **`/grok:setup`** → 활성 `mode`와 함께 "준비됨"이 나옴; 아니면 무엇을 실행할지 정확히 안내.
2. **`/grok:delegate "create a file hello.txt containing exactly: ok"`** (편집돼도 괜찮은 임시 디렉토리에서) → `filesChanged`에 `hello.txt` 포함 + 핵심 확인 **`billing: "subscription"`**(`metered_api` 아님). 자동 커밋 없음 — diff는 직접 검토.
3. **`/grok:plan "add input validation to the main function"`** → 계획 요약, 변경 파일 없음.
4. **`/grok:models` · `/grok:usage`** → `usage`에 방금 실행한 위임이 구독 vs 종량제로 분리돼 표시.
5. **인증 hook** — 로그인 안 됐으면 `/grok:delegate`가 실행 *전에* 차단되고 "`grok login` 실행" 안내가 나옴.

> ⚠️ `/grok:*` 호출 문자열·마켓플레이스 스키마·스코프 툴명 매처는 Claude Code 버전에 따라 고정이 아닙니다. `/reload-plugins` 후 `/grok:setup`이 안 잡히면 `/help`로 실제 형식을 확인하고 [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md)를 참고하세요.

## 문서

0. [`00-product-vision.md`](docs/00-product-vision.md) — 왜 존재하는가 (잘 쓰기 · 체감 · Claude↔Grok 협업)
1. [`01-architecture.md`](docs/01-architecture.md) — 전체 그림
2. [`02-auth-strategy.md`](docs/02-auth-strategy.md) — 투트랙 인증 제약 (가장 중요)
3. [`03-plugin-spec.md`](docs/03-plugin-spec.md) · [`04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — `mcp-server/` 구성
4. [`05-routing-policy.md`](docs/05-routing-policy.md) — 언제 위임할지
5. [`06-roadmap.md`](docs/06-roadmap.md) — 구현 순서 및 현재 상태
6. [`specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) — 구현이 의존하는 실측 `grok` CLI 플래그/출력 스키마

<details>
<summary><b>폴더 구조</b></summary>

```
claude-grok-build-plugin/
├── README.md · README.ko.md   # 영문 / 이 파일 (한글)
├── CLAUDE.md                  # Claude Code가 자동 로드하는 프로젝트 컨텍스트
├── LICENSE                    # MIT
├── docs/                      # 설계 문서 (구현과 동기화 유지)
│   ├── 00-product-vision.md … 06-roadmap.md
│   └── specs/                 # 날짜별 설계/검증 스펙 (예: grok-cli-contract.md)
├── .claude-plugin/plugin.json        # 플러그인 매니페스트 (name: grok)
├── .claude-plugin/marketplace.json   # 마켓플레이스 엔트리 (grok-marketplace)
├── .mcp.json                         # MCP 서버 등록
├── mcp-server/                       # TS MCP 서버 + hook (사전 빌드 dist/index.js + dist/hook.js 동봉)
├── commands/                         # /grok:* 동사형 커맨드 (+ 프리셋)
├── skills/grok-routing/              # 언제 위임할지 (엔드유저 런타임)
└── hooks/                            # pre-delegate-auth-check PreToolUse hook
```

위 컴포넌트는 모두 존재합니다. 다음은 Phase 3.5(협업 경험)와 Phase 4(오케스트레이터) — [`docs/06-roadmap.md`](docs/06-roadmap.md).
</details>

## 라이선스

[MIT](LICENSE) © 2026 xzawed
