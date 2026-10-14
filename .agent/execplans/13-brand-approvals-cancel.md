# Phase 13 - Brand Dashboard: Campaign Cancel Wiring and Approval Queue Page

## Goal
브랜드 대시보드에서 사람 개입 루프를 닫는다. "관전 중단"이 서버 캠페인을 실제로 멈추고(세션 6 통합에서 추가된 cancel 엔드포인트), 거버넌스가 사람 뒤로 미룬 에스크로 락(승인 큐)을 사람이 화면에서 승인/거절한다.
`frontend/`만 변경(백엔드 무수정).

## Current Behavior
- `/brand/campaign` "관전 중단"은 EventSource만 닫는다. 프록시가 업스트림 fetch를 abort하지만 백엔드 캠페인 스레드는 끝까지 돈다.
- 같은 프로모션에 캠페인이 이미 돌고 있으면 백엔드가 409 `CAMPAIGN_ALREADY_RUNNING`을 주는데, EventSource는 응답 본문/상태 코드를 읽을 수 없어 "연결하지 못했습니다"로만 보인다.
- SSE `approval_required`를 프론트 타입/리듀서가 모른다(무시됨). 승인 대기 합의가 열에 아무 표시도 없다.
- 승인 API(`GET/POST /api/v1/approvals…`)를 부르는 화면이 없다. 사람이 결정하려면 curl뿐.

## In Scope
- `apiClient.ts`: `cancelCampaign(promotionId, campaignId)`, `listApprovals(status?)`, `getApproval(id)`, `approveApproval(id, idempotencyKey?)`, `rejectApproval(id, reason)`, `runningCampaignIdFromProblem(problem)`, `toApiError` export, 409 문구.
- `campaignTypes.ts`: `ApprovalRequiredEvent`(합집합 + 이름 목록), `CancelCampaignResponse`. `approvalTypes.ts`(신규): `ApprovalDoc`, 상태/규칙 id 라벨.
- `useCampaignStream`: EventSource → **fetch 스트리밍**(409 본문 읽기, 자동 재접속 없음), `createSseParser`, `cancel()`이 취소 엔드포인트를 부르고 `campaign_result`까지 스트림 유지, `cancelRequested`/`cancelError`/`conflict` 상태, `approval_required` 노트, `CANCELED` 라벨(브랜드 취소 vs 목표 도달), `SKIP_REASON_LABEL`.
- 캠페인 페이지: "취소 요청됨 · 결과를 기다리는 중", 409 배너 + "실행 중인 캠페인 취소", 승인 대기 노트 → `/brand/approvals?focus=…` 링크, 결과 배너 `PENDING_APPROVAL`/취소 사유 라벨.
- `/brand/approvals` 페이지(AuthGate BRAND): PENDING/APPROVED/REJECTED 탭, 카드(금액·캠페인 누적·규칙 사유 한국어·프로모션/합의서 링크·생성/결정 시각), 승인(에스크로 요약: LOCKED 서명·Explorer / SKIPPED·FAILED 사유), 거절(사유 입력), 실패한 승인 시도(`lastAttempt`) 표시.
- 라우트 `flow.ts` `/brand/approvals`, 사이드바 "승인 대기".
- 테스트 `tests/campaign-cancel-approvals.test.ts`.

## Out of Scope
- 백엔드 변경(승인 라우트 인증, 승인 알림, 캠페인 결과 영속 조회).
- 승인 상세 페이지(`getApproval`은 클라이언트 메서드만).
- `agents/`, `web/`.

## Files
- `frontend/src/product/apiClient.ts`, `frontend/src/product/campaignTypes.ts`, `frontend/src/product/approvalTypes.ts`(신규)
- `frontend/src/app/brand/campaign/useCampaignStream.ts`, `page.tsx`, `components/NegotiationColumn.tsx`, `components/CampaignResultBanner.tsx`
- `frontend/src/app/brand/approvals/page.tsx`(신규)
- `frontend/src/product/flow.ts`, `frontend/src/components/Sidebar.tsx`
- `frontend/tests/campaign-cancel-approvals.test.ts`(신규), `tests/product-flow.test.ts`

## Milestones
1. [x] 타입 + apiClient(취소·승인 4종·409 파서)
2. [x] 스트림 훅: fetch SSE, 취소 흐름, approval_required, 라벨
3. [x] 캠페인 페이지 UI(취소 요청됨 / 409 배너 / 승인 링크)
4. [x] 승인 큐 페이지 + 라우트/사이드바
5. [x] 테스트·스모크·문서

## Tests
- `npm run -s typecheck`, `npx eslint …` 클린(`any` 없음). `npm test` 34 passed(신규 6).
- 리듀서: `approval_required` → "🙋 사람 승인 대기" 노트(금액·누적·한국어 사유·approvalId, 중복 무시); 취소 흐름(`cancel_requested`는 running에서만, `cancel_failed`는 스트림 유지, CANCELED 결과·"브랜드 취소로 중단"/"목표 도달로 취소"/"캠페인 취소로 시작하지 않음"); 409 → `conflict.campaignId`(type URL의 `campaign-already-running`에 속지 않음); SSE 파서 경계/CRLF/다중 data.
- 클라이언트: 승인 4종 + 취소의 경로·메서드·body·Idempotency-Key, 404 → `ProductApiError(NOT_FOUND)`.
- 스모크(2026-10-14, 백엔드 `KNOT_CREATOR_A2A_MODE=local KNOT_MEMORY_SEED_DEMO=1 KNOT_GOV_MAX_AUTO_AGREEMENT_USDC=500 … --port 8180`):
  - `stream?targetCreatorCount=2&ceilingUsdc=700&parallelism=1`: 두 크리에이터 모두 700 즉시 수락(첫 제안이 ceiling으로 기본값) → `approval_required` 2건(`GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT`, 누적 700/1400) → `TARGET_REACHED` 2/2, 에스크로 이벤트 없음.
  - `:approve` → `APPROVED` + `escrow {SKIPPED, WEB3_GATEWAY_REQUIRED}`(로컬 모드), 재호출 멱등. `:reject {reason}` → `REJECTED`, `reason` 저장. `?status=` 목록 분리 확인.
  - 취소: `status` 수신 직후 두 번째 stream → 409 `Campaign campaign-… is already running for this Promotion.`; `:cancel` → 200 `CANCELING`; 다중 라운드 조건(opening 100 / ceiling 150 / maxRounds 5 / target 5)에서 진행 중 2건 ROUND_LIMIT·WALKED_AWAY, 대기 3건 `negotiation_skipped CANCELED`, `campaign_result CANCELED` 0/5. 끝난 뒤 재취소 404. (즉시 수락 조건에서는 로컬 모드가 20ms 안에 목표를 채워 `TARGET_REACHED` + 대기 후보 `CANCELED`로 끝난다.)
  - 프록시(3100): `/brand/approvals` 200, `/api/v1/approvals?status=APPROVED`·`:cancel` 404 패스스루. 페이지 자체는 Firebase 설정이 없는 워크트리라 AuthGate("로그인이 필요합니다")까지만 브라우저/SSR로 확인 — 로그인 뒤 화면은 리듀서·클라이언트 테스트로 대신 검증.

## Progress
- [x] 2026-10-14 전 마일스톤 완료.

## Decisions
- **EventSource → fetch 스트리밍.** 409 본문을 읽어야 "실행 중인 캠페인 취소"를 띄울 수 있고, 끝난 스트림에 자동 재접속해 같은 프로모션 캠페인을 또 띄우는 위험도 사라진다. 파서는 `event:`/`data:`만 본다(id/retry 무시).
- "관전 중단" = 서버 취소 요청. 스트림은 닫지 않고 `campaign_result`(CANCELED, 또는 이미 생긴 합의가 있으면 TARGET_REACHED/PARTIAL)까지 기다린다. campaignId를 아직 모르면(`status` 전) 예전처럼 끊기만 한다.
- 취소 요청 실패(404 = 이미 끝남 등)는 스트림을 끊지 않고 `cancelError`로만 보여준다 — 결과는 곧 온다.
- `CANCELED` 협상 결과 라벨은 `cancelRequested`로 갈린다: 사람이 눌렀으면 "브랜드 취소로 중단", 아니면 "목표 도달로 취소"(러너가 목표 도달 시 진행 중 협상을 취소하는 경우).
- 409의 campaignId는 detail 문장에서 뽑되 uuid 꼴을 우선하고, 문제 문서의 `type` URL(`…/campaign-already-running`)은 제외. 못 찾으면 버튼 대신 "기다려 주세요".
- 승인 페이지 목록 로딩은 `requestKey`(status+reload 카운터)로 파생시켜 effect 안 동기 setState를 피했다(react-hooks/set-state-in-effect).
- 프로모션 제목은 `listBrandPromotions`로 보조 조회(실패해도 id만 표시). 승인 문서에는 id만 있다.

## Risks
- 승인·취소 라우트는 백엔드에 인증이 없다(데모). 프론트는 Authorization을 붙이지만 서버가 검사하지 않는다.
- fetch 스트리밍은 Next 프록시(`route.ts`)의 SSE 패스스루에 의존한다(세션 6b). 서버리스 런타임이면 함수 시간 제한에 걸릴 수 있다.
- 로컬 A2A 모드는 캠페인이 수십 ms 안에 끝나 사람이 "관전 중단"을 누를 틈이 거의 없다. 실제 HTTP/Gemini 모드에서 의미가 있다.
- 거절은 합의를 되돌리지 않는다(`FUNDING_REQUIRED` 유지). 페이지 문구로 "자금은 잠기지 않았습니다"만 알린다.
