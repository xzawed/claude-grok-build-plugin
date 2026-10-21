# 2026-10-17 SonarCloud 검토 — 지적별 판정

이 문서가 판정의 원천이다. 요약은 `CHANGELOG.md` 2026-10-17·2026-10-18, 남은 오너 판단은 `docs/09` §4 H, 보강은 #180.

## 무엇을 쟀나

- **SonarCloud**(`xzawed_claude-grok-build-plugin`, 공개 API로 2026-10-17에 읽었다): 마지막 분석은 2026-09-23의 fa0d493(#133),
  미해결 87건. 분석은 2026-08-08과 그날 두 번뿐이고 `api/navigation/component`는 `autoscanEnabled: false`였다.
- **로컬 재측정**: SonarQube 26.10 Community Build에 SonarCloud와 같은 "Sonar way comprehensive" 프로파일. 먼저 fa0d493에서
  SonarCloud의 87건 중 로컬 엔진이 볼 수 있는 80건을 80건 모두 같은 줄·메시지로 재현했다 — 나머지 7건(`jssecurity:S5145` 6,
  `githubactions:S6505` 1)은 Community Build에 없는 엔진이다. 같은 설정으로 eae57ea는 158건.
- **판정**: 등급을 정하는 버그·취약점과 결함을 숨길 수 있는 코드 스멜 56건 — eae57ea의 158건에서 49건, SonarCloud에만 있는
  7건(`S5145` 6·`S6505` 1) — 을 Claude와 Grok이 각자 분류했고(Grok에는 코드를 그대로 줬다) 네 라운드로 맞췄다. 그 56건에는
  실제 결함이 없었다. 나머지 스멜(복잡도·스타일)은 판정하지 않았다. S5145는 응답이 프로브의 출력에 글을 보탤 수 있게 할 뿐
  판정(종료 코드)은 바꾸지 못해 보강으로 분류했다. 결함으로 적은 것은 프로브 자신이 틀리는 경우다 — 과금된 응답, 또는
  `JSON.stringify`로 못 펼 만큼 깊은 JSON 본문의 5xx 뒤 죽어 exit 1("과금 안 됨")로 끝나 돈 드는 재실행을 부르는 A70(깨진
  응답에서만 드러나도), 자기 문구가 아는 상태와 어긋나는 A71(5xx마다, 본문을 못 읽은 4xx에서 — 2026-10-18에 고쳤다). S5145를 재현하다 A70을 찾았고,
  그 5xx는 #180의 2차 코드 검토가 더했다.

## 등급과 게이트는 무엇에서 나오나 (fa0d493의 SonarCloud)

- 신뢰성 D는 `S2871` 3건(CRITICAL)에서, 보안 C는 MAJOR 취약점 둘 — `S2245`(`worktree.ts:105`)와 `S6505`(`ci.yml:33`) — 에서 나온다.
  나머지 취약점(`S4036`·`S5145`)은 MINOR라 B까지다.
- 게이트는 신규 코드(2026-08-08 이후 — 버전을 붙이지 않아 이 날짜가 움직이지 않는다)의 세 조건에서 떨어졌다: 신뢰성 D(같은
  `S2871`), 보안 B(신규 코드의 취약점은 MINOR뿐이다 — 위의 MAJOR 둘은 blame 날짜가 기준일 전), 중복 4.5%. 중복 줄 374 중 308이
  테스트 파일이었고, 테스트를 빼면 66/3,499(1.89%)다(`api/measures/component_tree`의 `new_duplicated_lines`·`new_lines`).

## 버그·취약점 — 규칙별 판정

위치는 eae57ea 기준이다. 아래 키는 fa0d493 분석의 것이고, 다음 분석에서는 옮겨 간 줄을 따라가거나 새 키가 붙는다. 사유는
SonarCloud에 그대로 붙여 넣을 문장이다.

| 규칙 | 위치 (eae57ea) | 판정 | 사유 |
|---|---|---|---|
| `S2871` ×6 | `scripts/nested-subcommands.mjs:19`, `scripts/probe-contract-drift.mjs:132·146·158·250·251` (fa0d493의 키 `AaDORp0l2qw7ls_VY7Zu`·`…Zv`·`…Zw`) | False positive | Sorts ASCII flag, command and model names; the default sort orders by UTF-16 code units, deterministic and locale-free, which the contract snapshot needs (localeCompare would make it depend on the machine's locale). |
| `S3403` | `scripts/worker-marker-probe.mjs:107` | False positive | exitCode defaults to null, but the only caller passes the child's close code: a number, or null when grok was killed at the cap or did not start. The comparison is true exactly when grok exited 0. |
| `S2245` ×2 | `src/worktree.ts:112·122` (122은 fa0d493의 105, 키 `AZ_h5PP7tgUERt43PCns`) | Accepted | Not a security use: a worktree folder name under ~/.grok-build/worktrees (created 0700), or a stand-in path that is never created; only uniqueness matters. |
| `S4036` ×9 | `scripts/probe-contract-drift.mjs:83·101`, `scripts/probe-expired-session.mjs:64`, `scripts/probe-home-lookup.mjs:47·147`, `scripts/probe-unauth-device-flow.mjs:36`, `scripts/worker-marker-probe.mjs:124`, `src/auth.ts:149·154` | Accepted | Running the user's installed grok, or where.exe / sh to find it, through PATH is what the plugin and its maintainer probes are for. |
| `S5145` ×6 | `scripts/probe-metered-billing.mjs` (fa0d493의 160·180·185·187·188·189) | #180에서 보강 — 남아 있으면 False positive | Every value taken from the response or from an error is printed through scripts/printable.mjs (control and format characters shown as escapes, each raw body line behind a prefix); see test/probe-metered-output.test.ts. |
| `S6505` | `.github/workflows/ci.yml` | #180에서 고침 | (CI installs with npm ci --ignore-scripts; the issue should close by itself.) |

## 결함을 숨길 수 있는 코드 스멜 — 참고 (게이트와 무관)

| 규칙 | 건수 | 판정 | 한 줄 |
|---|---|---|---|
| `S2681` | 3 | False positive | 한 줄짜리 `while (…) e -= 1; return …`과 중괄호 안의 무조건 `break` — 의도대로다 |
| `S4123` | 1 | False positive | `Promise.all`은 프로미스가 아닌 값도 받는다 — `null`은 읽지 못한 경로의 자리표시다 |
| `S8786` | 1 | False positive | `/^gitdir:[ \t]*(.*)$/m`의 `.*`는 줄 끝에서 늘 맞는다 — 되돌아 찾는 경로가 없다 |
| `S2310` | 4 | Design choice | argv 파서가 값 토큰을 먹으려고 `i`를 옮긴다 |
| `S9382` | 10 | Design choice | 순서대로가 의도다 — 읽기 예산은 목록 순서로 쓰고, git은 저장소마다 하나씩 돈다 |
| `S5869` | 9 | Style | `/i` 아래의 `A-Z`·`a-z` 중복은 일치를 바꾸지 않는다 — 얼린 v0.2.35 사본의 넷은 이제 분석에서 뺀다 |
| `S1854`·`S4782` | 1·1 | Style | 읽히지 않는 초기값, `?`와 `undefined`의 중복 |
| `S8968` | 1 | #180에서 고침 | Windows 전용 테스트를 `it.skipIf`로 |

56건 밖의 참고(판정하지 않았다): `S7758`(eae57ea에 17 — `fromCharCode` 6·`charCodeAt` 11)은 `String.fromCharCode`·`charCodeAt`
대신 `String.fromCodePoint`·`codePointAt`을 쓰라는 지적이다. `String.fromCharCode`는 eae57ea의 `CLAUDE.md`가 적은 관례였고
그 이유(작성 도구가 역슬래시-u를 푼다)는 `String.fromCodePoint`로도 채워진다 — #180부터 `CLAUDE.md`는 `String.fromCodePoint`를
먼저 적고, `config-keys.ts`(413·429행; 508·509행은 아직 `fromCharCode`)와 #180의 `printable.mjs`가 그쪽을 쓰니 바꿔도 되는
스타일이다. `charCodeAt`은 UTF-16 단위를 일부러 읽는 곳이다(공백·ASCII 대소문자·잘린 자리의 서로게이트처럼 단위 하나를 보는
비교, 단위로 센 길이). #180은 `printable.mjs`에 `charCodeAt` 하나를 더한다.

## 2026-10-18 — `.claude/tools`를 분석에 넣고 생긴 지적

`.sonarcloud.properties`가 점 폴더 안의 파일을 하나씩 이름으로 둔 뒤(오너가 권장안으로 정했다 — `docs/09` §4 H) 같은 로컬
설정으로 다시 쟀다: `.claude/tools`의 세 스크립트가 처음 분석되었고(ncloc `accept-release.mjs` 327 · `mcpcall.mjs` 77 ·
`rpc-timeout.mjs` 14) 그 셋에서 지적 4건이 새로 나왔다. 그 4건을 Claude와 Grok이 각자 판정했고(Grok에는 코드를 그대로 줬다) 넷 다
같았다 — 실제 결함은 없다.

| 규칙 | 위치 | 판정 | 사유 |
|---|---|---|---|
| `S2871` (BUG, CRITICAL) | `.claude/tools/accept-release.mjs:246` | False positive | The default sort orders schema field names by UTF-16 code units so two property sets compare equal independent of locale; localeCompare is not what this check needs. |
| `S6551` | `.claude/tools/accept-release.mjs:231` | False positive | Every value pushed into accepted is a string tool name from the cases table, so join() never stringifies an object. |
| `S7747` | `.claude/tools/mcpcall.mjs:112` | Accepted | The array copy is deliberate: the loop deletes from pending and rejects callbacks while walking it, so it walks a snapshot rather than the live Map. |
| `S9382` | `.claude/tools/accept-release.mjs:222` | Design choice | Each unknown-key probe is awaited in list order on one MCP session so a failure stays tied to that tool; the calls are not meant to run at once. |

`S2871`은 CRITICAL 버그라 해소하기 전까지 신뢰성 D를 지킨다 — 위의 다른 `S2871`처럼 지적마다 False positive로 둔다.

**잃은 것과 메운 것.** 무엇을 잃었고 무엇으로 메웠는지, 그 규칙과 측정은 `docs/09` §4 H가 원천이다(숨은 유니코드를 찾는
규칙은 `S6389` 양방향 제어문자 · `S7628` 태그 문자 · `S8522` 연속 변이 선택자다). 여기에는 그 행에 없는 것만 둔다: 비밀 규칙은
기본값이 `.md`를 건너뛰어 원래 닿지 않았고, 같은 줄에서 닫은 RLO는 `S6389`도 잡지 않았다(유지보수자가 심은 사본으로 쟀다).
검토자가 확인한 `sonar.text.inclusions` 값(기본값에 `**/*.md`를 더한 것)은 로컬에서는 통한다. ⚠️ 잴 트리는 리눅스 안에서
클론한다 — Windows 체크아웃을 마운트하면 컨테이너의 git이 모든 파일을 수정됨으로 보고, 텍스트 분석은 점 이름 아래 파일을 그
이유로 건너뛴다.

## 해소하는 법

자동 분석을 다시 켜고(오너 계정 — `docs/09` §4 H) `.sonarcloud.properties`가 main에 들어간 뒤의 첫 분석에서, 위 판정대로
지적마다 둔다. 판정 칸의 "Design choice"·"Style"은 SonarQube Cloud의 상태가 아니다(상태는 Open·Accepted·False positive·
Confirmed) — 그 지적은 Accepted로 두고 사유는 그대로 적는다. 규칙째로 "Accepted"를 두지 않는다 — 같은 규칙의 새 지적이 진짜일 수
있다.
