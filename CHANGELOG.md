# Changelog

이 파일은 **완료된 작업의 서사**용이다. 에이전트가 매 세션 읽는 “지금 상태”는 루트
`CLAUDE.md`와 `docs/06-roadmap.md`를 본다. 제품 본질은 `docs/00-product-vision.md`.

형식: 최신이 위. 날짜는 작업일 기준.

## 2026-07-25

### Feat — Phase 3.5 Slice A (routing skill · presets · setup)

- `skills/grok-routing/SKILL.md`: 엔드유저 세션에서 위임 판단 기준 자동 로드.
- `/grok:tests`, `/grok:migrate`, `/grok:boilerplate` 프리셋 커맨드.
- `/grok:setup` 첫 성공 경로(샘플 위임 · `billing` · 다음 시나리오).
- 설계: `docs/specs/2026-07-25-phase35-routing-skill-design.md`.

### Docs — 제품 본질 · 세션 핸드오프

- `docs/00-product-vision.md` 추가: Grok을 잘 쓰게 / 실력 체감 / Claude↔Grok 협업 경험.
- `CLAUDE.md`: 제품 포인터, 세션 핸드오프 표, “현재 상태”를 Phase 3.5 경험 방향으로 정리.
- `docs/06-roadmap.md`: Phase 3.5(협업 경험) 체크리스트 (Slice A 완료 표시).
- README / README.ko, `docs/01`, `docs/05`에 비전 포인터 정렬.
