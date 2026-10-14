# Phase 10 - Brand Dashboard Campaign Page

## Goal
브랜드 사용자가 제품 대시보드(Next.js)에서 캠페인(탐색 → 다중 A2A 협상 → 합의서 → 에스크로 락)을 직접 실행하고 SSE로 관전한다.
`backend/apps/brand_agent/static/campaign.html`(바닐라 JS 관전 페이지)과 같은 UX를 `frontend/`의 디자인 언어로 옮긴다.

## Current Behavior
- 캠페인 API(`POST /api/v1/promotions/{id}/campaigns`, `GET …/campaigns/stream`)는 있지만 프론트에서 호출하는 곳이 없다.
- 프로모션 상세의 "크리에이터 탐색·협상 시작"은 `agent-run`(단일 크리에이터, 동기)만 쓴다.
- `frontend/src/app/api/v1/[...path]/route.ts` 프록시가 응답을 `arrayBuffer()`로 모아서 돌려준다 → SSE가 캠페인이 끝날 때까지 브라우저에 도착하지 않는다.
- 백엔드 CORS는 `http://localhost:3000`만 허용하므로 브라우저가 백엔드에 직접 EventSource를 열 수 없다(프록시 경유가 유일한 경로).

## In Scope
- `apiClient.ts`: `runCampaign(promotionId, body)`, `campaignStreamUrl(promotionId, params)`; 타입은 `campaignTypes.ts`.
- `/brand/campaign?promotionId=…` 페이지: 조건 폼, "캠페인 시작", 탐색 표, 예산 장부 타일, 크리에이터별 대화 열(브랜드/크리에이터 말풍선 + 입력 중 표시), 합의서·에스크로 노트, 최종 결과 배너(합의서 링크).
- `useCampaignStream` 리듀서/훅: 이벤트 → 뷰 상태, `error`·연결 끊김·`campaign_result` 처리(스트림 닫기).
- 프록시: `text/event-stream` 응답은 버퍼링 없이 흘려보내고, 클라이언트가 끊으면 업스트림도 abort.
- 진입점: 프로모션 상세 "여러 크리에이터와 동시 협상" 링크.
- 테스트: 리듀서 리플레이(실제 로컬 캠페인 이벤트 순서), URL 빌더, 폼 변환/검증.

## Out of Scope
- 백엔드 변경(인증, CORS, 이벤트 스키마), `agents/`·`web/`.
- 캠페인 결과의 영속 조회 페이지(새로고침하면 관전 화면은 사라진다 — 결과는 프로모션 상세/합의서로 본다).
- 동기 `runCampaign` UI 노출(클라이언트 메서드만 추가).

## Files
- `frontend/src/product/campaignTypes.ts` — 요청/응답/SSE payload 타입, `CampaignStreamEvent` 판별 합집합.
- `frontend/src/product/apiClient.ts` — `runCampaign`, `campaignStreamUrl`, `compactCampaignRequest`.
- `frontend/src/app/api/v1/[...path]/route.ts` — SSE 패스스루.
- `frontend/src/app/brand/campaign/page.tsx` — 페이지(AuthGate BRAND, `?promotionId=`).
- `frontend/src/app/brand/campaign/useCampaignStream.ts` — 상태/리듀서/훅, 한국어 라벨.
- `frontend/src/app/brand/campaign/components/{CampaignForm,DiscoveryTable,LedgerTiles,NegotiationColumn,CampaignResultBanner}.tsx`
- `frontend/src/features/dashboard/PromotionDetail.tsx` — 진입 링크.
- `frontend/src/product/flow.ts`, `frontend/tests/product-flow.test.ts` — 라우트 목록.
- `frontend/tests/campaign-stream.test.ts` (신규)

## Milestones
1. [x] 타입 + apiClient 메서드
2. [x] 프록시 SSE 패스스루
3. [x] 훅/리듀서 + 컴포넌트 + 페이지
4. [x] 진입점 링크
5. [x] 테스트·스모크·문서

## Tests
- `npm run -s typecheck`, `npx eslint src/app/brand src/product …` 클린(`any` 없음).
- `npm test`: 28 passed (신규 6: 리플레이 → 열/장부/결과, typing 상태, error/연결 끊김(done 이후 무시), 잘못된 이벤트 무시, `campaignStreamUrl`, 폼 변환·검증).
- 스모크(2026-10-14): 백엔드 `KNOT_CREATOR_A2A_MODE=local KNOT_MEMORY_SEED_DEMO=1 … --port 8180`, 프론트 `KNOT_API_BASE_URL=http://127.0.0.1:8180 PORT=3100 npx next dev --webpack`.
  - `curl -N` 백엔드 직접: promotion-001 → status/discovery/negotiation_started/turn×2/negotiation_result/agreement_created/escrow_skipped(WEB3_GATEWAY_REQUIRED)/negotiation_skipped×2/campaign_result TARGET_REACHED 2/2, 확정 1600/2000.
  - `curl -N` 프록시 경유(`localhost:3100/api/v1/...stream`): `content-type: text/event-stream`, `x-accel-buffering: no`, 같은 이벤트 순서.
  - 느린 SSE 모의 서버(1초 간격 3이벤트)를 프록시로 통과시켜 이벤트가 1초 간격으로 도착함을 확인(버퍼링 없음).
  - `/brand/campaign?promotionId=promotion-001` 200, Firebase 설정 없는 환경이라 AuthGate "로그인이 필요합니다"까지 확인. 로그인 뒤 화면은 리듀서 리플레이 테스트로 대신 검증.

## Progress
- [x] 2026-10-14 전 마일스톤 완료.

## Decisions
- EventSource는 프록시(same-origin) 경유. `campaignStreamUrl`은 `apiBaseUrl()`(브라우저: basePath 상대 경로)을 `window.location.origin`으로 절대화한다. 백엔드 CORS를 건드리지 않는다.
- `campaign_result`/`error`를 받으면 즉시 `close()`. 열어 두면 EventSource가 자동 재접속하며 같은 프로모션으로 캠페인을 또 시작한다.
- EventSource 자체 연결 오류도 재접속을 막기 위해 닫고 "연결이 끊겼습니다"로 표시(서버 캠페인은 계속될 수 있음을 문구로 알림).
- 이벤트 payload는 `JSON.parse` 후 이름으로만 좁힌다(스키마 검증 없음). 서버 덤프(by_alias)가 진실이고, 타입은 `campaignTypes.ts`에 1:1로 고정.
- 폼 금액은 빈칸 = 서버 기본값(프로모션 initialOffer / maxPerCreatorUsdc). 상세를 불러오면 상한·라운드를 미리 채운다.
- 1인 상한(`ceilingUsdc`)은 쿼리 파라미터로 브랜드 자신의 API에만 간다. 크리에이터 측 전송은 백엔드가 막는다(프론트는 표시만).

## Risks
- 관전 화면은 메모리 상태다. 새로고침하면 사라진다 → 결과 배너에서 프로모션 상세/합의서로 이어 준다.
- 사용자가 "관전 중단"을 누르면 프록시가 업스트림 fetch를 abort하지만, 백엔드 캠페인 스레드는 끝까지 돈다(결과는 상세에서 확인).
- 프록시가 SSE를 스트리밍하려면 런타임이 Node여야 한다(현재 기본). Vercel/서버리스 배포에서는 함수 실행 시간 제한에 걸릴 수 있다 → Cloud Run 배포에서는 문제 없음.
- Turbopack은 워크트리의 `node_modules` 심링크(프로젝트 루트 밖)를 거부한다. 로컬 검증은 `next dev --webpack`으로 했고 코드와는 무관.
