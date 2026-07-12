# claude-grok-build-plugin

[English](README.md) · **한국어**

Claude Code 플러그인 — Claude가 코딩 작업의 일부를
**[Grok Build](https://x.ai/cli)**(xAI의 터미널 코딩 에이전트)에 위임하고,
그 결과를 세션으로 가져와 검토할 수 있게 해주는 MCP 서버 래퍼입니다.

Claude Code를 다른 터미널 코딩 에이전트(예: OpenAI Codex CLI)에 연결하는 브리지
플러그인과 같은 결입니다 — Claude가 오케스트레이터로 남고, 외부 에이전트가 위임받은
작업을 처리합니다. 이 프로젝트만의 특징은 워커가 xAI의 **Grok Build**라는 점과, 한 가지
확고한 제약 — 작업이 **API 종량제가 아니라 xAI 구독(SuperGrok / X Premium+)으로
과금**된다는 점입니다.

> **상태 — 설계 단계.** 현재 이 저장소에는 [`docs/`](docs/)의 설계 문서만 있고 코드는
> 없습니다. [`docs/06-roadmap.md`](docs/06-roadmap.md)의 Phase 1부터 시작하세요.

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
                        └─ `grok` CLI spawn (헤드리스: -p, streaming-json;
                           │                  env에서 API 키 제거)
                           └─ 구독 세션 토큰으로 인증 (~/.grok/auth.json)
  ◀── Claude가 검토할 구조화된 요약 + diff ──┘
```

전체 아키텍처: [`docs/01-architecture.md`](docs/01-architecture.md).

## 핵심 제약 — 구독 인증 (먼저 읽을 것)

인증은 `grok login`(브라우저 OAuth)으로 만들어진 구독 세션에 전적으로 의존하며,
**API 키를 절대 쓰지 않습니다.** `grok` CLI는 `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY`를
세션 토큰보다 우선하므로, 환경변수에 키가 하나라도 남아 있으면 과금이 조용히 종량제
API로 새어나갑니다. 그래서 MCP 서버는 **`grok`을 spawn하기 전에 이 변수들을 환경에서
제거**하고, 자격증명을 저장·로깅·읽지 않도록 **설계**돼 있습니다 — 아직 코드는 없으며,
이는 구현 시 지켜야 할 설계 원칙입니다.

근거와 검증 체크리스트: [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md).

## 폴더 구조

```
claude-grok-build-plugin/
├── README.md         # 영문 (기본)
├── README.ko.md      # 이 파일 (한글)
├── CLAUDE.md         # Claude Code가 자동 로드하는 프로젝트 컨텍스트
├── LICENSE           # MIT
├── docs/             # 설계 문서 (구현 전 확정)
│   ├── 01-architecture.md
│   ├── 02-auth-strategy.md
│   ├── 03-plugin-spec.md
│   ├── 04-mcp-server-spec.md
│   ├── 05-routing-policy.md
│   └── 06-roadmap.md
├── .claude-plugin/plugin.json   # (구현 단계에서 생성)
├── .mcp.json                    # (구현 단계에서 생성)
├── mcp-server/                  # (구현 단계에서 생성)
├── commands/                    # (구현 단계에서 생성)
└── hooks/                       # (구현 단계에서 생성)
```

> 현재는 설계 문서만 존재합니다. [`docs/06-roadmap.md`](docs/06-roadmap.md) Phase 1부터
> 실제 코드를 채워 넣으세요.

## 사전 준비 (사용자가 직접)

플러그인은 대신 로그인하지 않습니다 — `grok login`은 브라우저가 필요하며 최초 1회 수동
단계로 남깁니다.

```bash
# 1. Grok Build CLI 설치
curl -fsSL https://x.ai/cli/install.sh | bash

# 2. 구독 계정으로 로그인 (브라우저 OAuth)
grok login

# 3. 로그인 + 구독 인증 확인
grok --no-auto-update -p "Say ok."
```

## 문서 읽는 순서

1. [`docs/01-architecture.md`](docs/01-architecture.md) — 전체 그림부터
2. [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md) — 가장 중요한 제약 조건
3. [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md), [`docs/04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — 실제로 만들 파일들의 스펙
4. [`docs/05-routing-policy.md`](docs/05-routing-policy.md) — 언제 위임할지 판단 기준
5. [`docs/06-roadmap.md`](docs/06-roadmap.md) — 구현 순서

## 라이선스

[MIT](LICENSE) © 2026 xzawed
