# claude-grok-build-plugin

[English](README.md) · **한국어**

Claude Code 플러그인 — Claude가 코딩 작업의 일부를
**[Grok Build](https://x.ai/cli)**(xAI의 터미널 코딩 에이전트)에 위임하고,
그 결과를 세션으로 가져와 검토할 수 있게 해주는 MCP 서버 래퍼입니다.

Claude Code를 다른 터미널 코딩 에이전트(예: OpenAI Codex CLI)에 연결하는 브리지
플러그인과 같은 결입니다 — Claude가 오케스트레이터로 남고, 외부 에이전트가 위임받은
작업을 처리합니다. 이 프로젝트만의 특징은 워커가 xAI의 **Grok Build**라는 점과,
투트랙 인증 모델입니다 — 기본값은 **API 종량제가 아니라 xAI 구독(SuperGrok /
X Premium+)으로 과금**되며, 구독이 없는 사용자를 위한 opt-in 종량제 API 모드도
지원합니다. 아래 [인증 모드](#인증-모드) 참고.

> **상태 — Phase 1(MVP) 구현 완료.** `mcp-server/`(TypeScript, ESM)가 실제로 존재하며
> `grok_auth_check`·`grok_build_delegate`를 stdio로 구현하고, 유닛 테스트 24개가
> 통과합니다. `.claude-plugin/plugin.json`, `.mcp.json`, `commands/`도 존재합니다.
> Hook, 위임 이력 로깅, `grok_build_verify`는 아직 미구현 — Phase 2 이후는
> [`docs/06-roadmap.md`](docs/06-roadmap.md) 참고.

## 왜 만드는가

- **병렬성.** Grok Build는 git worktree 격리와 함께 최대 8개 subagent를 병렬 실행하므로,
  마이그레이션·테스트 백필·보일러플레이트 같은 대량 반복 작업을 Claude 단독보다 빠르게
  처리할 수 있습니다.
- **종량제가 아닌 구독.** 이미 SuperGrok / X Premium+를 구독 중이라면, 이 작업들을
  종량제 API가 아니라 *구독 플랜 안에서* 돌리는 것이 이 프로젝트의 핵심 목적입니다.
- **컨벤션 자동 승계.** Grok Build는 기존 `CLAUDE.md` / `AGENTS.md`와 `.claude/`
  설정(skills, agents, MCP, hooks)을 별도 설정 없이 읽으므로, 기존 프로젝트 컨벤션이
  위임된 작업에도 그대로 적용됩니다.

## 전체 흐름

```
Claude Code (현재 세션)
  └─ MCP tool 호출 ─▶ grok-build MCP 서버 (이 플러그인)
                        └─ `grok` CLI spawn (헤드리스: -p, --always-approve,
                           │                  --output-format json;
                           │                  모드에 따라 env 제거/통과)
                           └─ 모드별로 구독 세션 토큰(~/.grok/auth.json) 또는
                              API 키로 인증
  ◀── Claude가 검토할 구조화된 요약 + diff ──┘
```

전체 아키텍처: [`docs/01-architecture.md`](docs/01-architecture.md).

## 인증 모드

인증 모드는 **서버 레벨에서 한 번만** `.mcp.json`의 `GROK_BUILD_AUTH_MODE`
환경변수로 결정됩니다 — 호출별 오버라이드는 없습니다.

| | `subscription` (기본) | `api` (opt-in) |
|---|---|---|
| 트리거 | 미설정 또는 `GROK_BUILD_AUTH_MODE=subscription` | `GROK_BUILD_AUTH_MODE=api` |
| env 처리 | `grok` spawn 전 `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY` **제거** | 두 키를 그대로 **통과** |
| 인증 근거 | `~/.grok/auth.json` 세션 토큰(`grok login`) | 이미 환경에 있는 API 키 |
| 과금 | xAI 구독 정액 | API 종량제 |
| 응답 `billing` 값 | `"subscription"` | `"metered_api"` |

기본값은 `subscription`이므로 아무 설정도 하지 않으면 기존과 동일하게 동작합니다.
모든 `grok_build_delegate` 응답이 실제 실행된 `mode`·`billing`을 그대로 밝히므로,
어느 쪽으로 과금됐는지 항상 명확합니다.

## 핵심 제약 — 과금 누수 방지 (먼저 읽을 것)

`grok` CLI는 `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY`를 세션 토큰보다 우선하므로,
환경변수에 키가 하나라도 남아 있으면 과금이 조용히 종량제 API로 새어나갈 수
있습니다. **구독 모드**(기본값)에서는 MCP 서버가 `grok`을 spawn하기 전에 이
변수들을 환경에서 제거하므로, 셸 프로파일에 남아 있는 키가 위임 호출로 새지
않습니다. **API 모드**(opt-in)에서는 그 키들을 의도적으로 그대로 통과시킵니다.
어느 모드에서도 MCP 서버는 자격증명을 저장·로깅·읽지 않습니다 — 존재 여부만
확인합니다.

⚠️ **헤드리스 편집의 안전 모델:** 위임은 항상 `--always-approve`를 붙입니다 —
실측 결과 이 플래그 없이는 헤드리스 `grok` 호출이 `stopReason: "Cancelled"`로
끝나고 **아무 편집도 하지 않습니다.** 그래서 `grok`은 대상 `cwd`(또는 격리된
`--worktree`)에서 직접 파일을 편집하되, **자동 커밋은 하지 않습니다** — Claude나
사람이 diff를 검토한 뒤에만 커밋해야 합니다.

근거와 검증 체크리스트: [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md).

## 폴더 구조

```
claude-grok-build-plugin/
├── README.md         # 영문 (기본)
├── README.ko.md      # 이 파일 (한글)
├── CLAUDE.md         # Claude Code가 자동 로드하는 프로젝트 컨텍스트
├── LICENSE           # MIT
├── docs/             # 설계 문서 (구현 내용과 동기화 유지)
│   ├── 01-architecture.md
│   ├── 02-auth-strategy.md
│   ├── 03-plugin-spec.md
│   ├── 04-mcp-server-spec.md
│   ├── 05-routing-policy.md
│   ├── 06-roadmap.md
│   └── specs/        # 날짜별 설계/검증 스펙 (예: grok-cli-contract.md)
├── .claude-plugin/plugin.json   # 플러그인 매니페스트
├── .mcp.json                    # MCP 서버 등록
├── mcp-server/                  # TypeScript MCP 서버 (src/, test/, 빌드 후 dist/)
├── commands/                    # /grok-build:delegate, /grok-build:check-auth
└── hooks/                       # 아직 미구현 (Phase 2)
```

> `hooks/`만 아직 로드맵에 남아 있습니다(Phase 2 —
> [`docs/06-roadmap.md`](docs/06-roadmap.md) 참고). 나머지는 모두 존재합니다.

## 사전 준비 (사용자가 직접)

플러그인은 대신 로그인하지 않고, 사용자 대신 API 키를 발급·저장하지도 않습니다.

**구독 모드(기본) — 별도 설정 불필요:**
```bash
# 1. Grok Build CLI 설치
curl -fsSL https://x.ai/cli/install.sh | bash

# 2. 구독 계정으로 로그인 (브라우저 OAuth) — 최초 1회 수동
grok login

# 3. 로그인 + 구독 인증 확인
grok --no-auto-update -p "Say ok."
```

**API 모드(opt-in, 종량제) — 인증 모드 설정 + 키 export:**
```bash
export XAI_API_KEY="..."   # 본인 소유 키 — 플러그인이 발급/저장하지 않음
# .mcp.json의 grok-build 서버 env에 GROK_BUILD_AUTH_MODE=api 설정
```

## 문서 읽는 순서

1. [`docs/01-architecture.md`](docs/01-architecture.md) — 전체 그림부터
2. [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md) — 가장 중요한 제약 조건 (투트랙 인증)
3. [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md), [`docs/04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — `mcp-server/`를 구성하는 파일들의 스펙
4. [`docs/05-routing-policy.md`](docs/05-routing-policy.md) — 언제 위임할지 판단 기준
5. [`docs/06-roadmap.md`](docs/06-roadmap.md) — 구현 순서 및 현재 진행 상태
6. [`docs/specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) — 구현이 의존하는 `grok` CLI 실측 플래그/출력 스키마

## 라이선스

[MIT](LICENSE) © 2026 xzawed
