# CLAUDE.md — claude-grok-build-plugin

이 파일은 Claude Code가 이 프로젝트에서 세션을 시작할 때 자동으로 읽는 컨텍스트 파일입니다.
사람이 읽는 개요는 `README.md`(영문 기본) 또는 `README.ko.md`(한글), 상세 설계는
`docs/`를 참조하세요.

## 프로젝트 한 줄 요약

Claude Code 플러그인. Claude가 코딩 작업 중 일부를 xAI의 **Grok Build CLI**에 위임할 수 있게
하는 MCP 서버 래퍼. 과금은 **API 종량제가 아니라 사용자의 xAI 구독(SuperGrok / X Premium+)**을
사용하는 것을 최우선 제약 조건으로 한다.

## 현재 상태 (먼저 읽을 것)

- **이 저장소는 아직 설계 문서만 있고 코드는 한 줄도 없다.** `docs/`의 스펙 6개 +
  `README.md`(영문 기본)·`README.ko.md`(한글) + 이 파일이 전부다. `mcp-server/`,
  `commands/`, `hooks/`, `.claude-plugin/`, `.mcp.json`은 아직 존재하지 않는다
  (아래 "컴포넌트 지도"는 만들어야 할 **목표** 구조다).
- **다음 할 일:** `docs/06-roadmap.md`의 Phase 1(MVP)부터 순서대로 구현.
  Phase 1이 끝나기 전에는 다음 Phase로 넘어가지 않는다.
- 아직 git 저장소가 아니다. 첫 커밋 전에 `git init` 필요.

## 절대 원칙 (변경 금지)

1. **Grok Build 프로세스를 실행할 때 `XAI_API_KEY`, `GROK_CODE_XAI_API_KEY` 환경변수를
   절대 전달하지 않는다.** grok CLI는 API 키가 세션 토큰보다 우선순위가 높으므로,
   env에 키가 하나라도 섞여 있으면 구독이 아니라 API 종량제로 과금이 샌다.
2. 인증은 `grok login`(브라우저 OAuth, 사용자가 터미널에서 최초 1회 수동 실행)으로
   생성되는 `~/.grok/auth.json` 세션 토큰에 전적으로 의존한다. 이 플러그인은
   자격증명을 저장하거나 대신 로그인하지 않는다.
3. 자동화 실행에는 항상 `--no-auto-update` 플래그를 붙인다 (헤드리스 환경에서
   업데이트 체크로 인한 행 방지).
4. MCP 서버는 credential을 로깅하거나 파일에 쓰지 않는다.

## 컴포넌트 지도 (목표 구조 — 아직 미구현)

아래는 Phase 1~2에서 만들 파일들이며, 현재는 존재하지 않는다. 상세 배치는
`docs/03-plugin-spec.md` 참조.

- `mcp-server/` — Grok Build CLI를 헤드리스(`-p`, `--output-format streaming-json`)로
  감싸는 MCP 서버. 상세 tool 스펙은 `docs/04-mcp-server-spec.md`.
- `commands/` — 슬래시 커맨드 (`/grok-build:delegate`, `/grok-build:check-auth` 등).
- `hooks/` — 위임 전 인증 사전 체크, 위임 이력 로깅.
- `.claude-plugin/plugin.json` — 플러그인 매니페스트 (이 폴더에는 `plugin.json`만 둔다).
- `.mcp.json` — MCP 서버 등록.

## 개발 명령

**사용자가 사전에 수동으로 해야 하는 것** (플러그인이 대신 하지 않음):

```bash
curl -fsSL https://x.ai/cli/install.sh | bash   # 1. Grok Build CLI 설치
grok login                                        # 2. 구독 계정 OAuth 로그인
grok --no-auto-update -p "Say ok."                # 3. 로그인/구독 인증 스모크 테스트
```

**MCP 서버 빌드/테스트 명령은 아직 없다.** `mcp-server/package.json`이 생기면
(Phase 1) 여기에 build/lint/test 스크립트를 추가한다. 서버는 TypeScript + Node.js +
`@modelcontextprotocol/sdk`로 구현 예정(`tsc` 빌드 → `mcp-server/dist/index.js`).

## 설계 문서 인덱스

| 문서 | 내용 |
|---|---|
| `docs/01-architecture.md` | 전체 아키텍처, Claude ↔ MCP 서버 ↔ grok CLI 흐름 |
| `docs/02-auth-strategy.md` | 구독 기반 인증 전략, env 정제, 만료 처리 |
| `docs/03-plugin-spec.md` | 플러그인 디렉토리 구조, manifest 필드 |
| `docs/04-mcp-server-spec.md` | MCP tool 정의 (요청/응답 스키마) |
| `docs/05-routing-policy.md` | 어떤 작업을 Grok Build에 위임할지 판단 기준 |
| `docs/06-roadmap.md` | 구현 단계 (Phase 1~4) |

## 이 프로젝트가 속한 더 큰 그림

이 플러그인은 별도로 설계 중인 **멀티에이전트 오케스트레이터**(Orchestrator ↔ PM/Dev/
Designer/Tester/Security/Wiki/QA agents) 프로젝트의 한 축으로 편입될 예정이다.
Grok Build는 오케스트레이터 관점에서 "병렬 탐색/저비용 반복 작업"을 처리하는
서브에이전트 워커로 취급하며, QA Agent의 위험도 기반 모델 라우팅(LOW/MEDIUM/HIGH)과
유사한 방식으로 Claude와 Grok Build 사이의 작업 분배 기준을 둔다.
(자세한 기준은 `docs/05-routing-policy.md` 참조.)

## 코딩 컨벤션

- MCP 서버: TypeScript, Node.js. `@modelcontextprotocol/sdk` 사용.
- 서브프로세스 실행은 `spawn` 사용, `exec`/`execSync`로 셸 인젝션 위험 있는 문자열
  조립 금지 — 프롬프트는 반드시 인자 배열로 전달.
- 모든 tool 응답은 구조화된 JSON을 텍스트로 요약해서 반환 (raw streaming-json을
  그대로 Claude에게 넘기지 않는다 — 토큰 낭비 및 파싱 부담).

## Gotchas

- **타깃 OS는 Linux/macOS인데 현재 개발 환경은 Windows다.** `docs/06-roadmap.md`는
  Windows 네이티브 지원을 스코프에서 제외한다. 따라서 이 저장소에서 코드를 작성할 때는
  플랫폼 차이를 주의: 인증 파일 경로가 `~/.grok/auth.json`(POSIX)이지 Windows의
  `%USERPROFILE%\.grok\auth.json`이 아님, `which grok` 대신 `command -v` 사용,
  경로/셸 가정 등. 실제 검증은 Linux/macOS 기준.
- **설계 문서는 `docs/` 안에 있다.** (초기에 저장소 루트에 흩어져 있었으나 `docs/`로
  이동함. CLAUDE.md·README의 모든 `docs/...` 링크는 이제 정상 동작.)
- `docs/`의 `plugin.json`·`.mcp.json` 예시는 **설계 초안**이다. 실제 스키마는
  구현 직전에 사용 중인 Claude Code 버전의 공식 레퍼런스로 재검증할 것
  (버전마다 필드가 바뀔 수 있음 — `docs/03-plugin-spec.md`).
