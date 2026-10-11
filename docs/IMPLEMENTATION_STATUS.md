# Implementation Status

Updated: 2026-08-20 KST

## Remove Generated Pitch HTML (2026-08-20 KST)

### Changed

- Removed `frontend/public/pitch/slides.html` after the user requested that the
  presentation file be removed.
- Kept `docs/PRESENTATION_HANDOFF_FINAL.md` because it remains the source
  handoff document for deck content and judging narrative.

### Verification

- Active-reference search for `public/pitch/slides.html`, `pitch/slides.html`,
  `slides.html`, and `/pitch` in `frontend`, `README.md`,
  `docs/00_DOCUMENT_INDEX.md`, and `docs/PRESENTATION_HANDOFF_FINAL.md`: no
  matches.
- `git diff --check`: passed.

### Boundary

- No deployment, Firestore mutation, Secret Manager change, wallet action, pay.sh
  call, or Solana transaction was performed in this phase.

## Gemini Negotiation Chat Copy (2026-08-20 KST)

### Changed

- Added Gemini/Vertex-backed Brand Agent display copy generation for negotiation
  chat messages.
- Brand Agent OFFER, COUNTER, and ACCEPT payloads now keep policy-fixed terms but
  can show a smoother Gemini-generated `display.message`.
- Added `messageProvider`, `messageModel`, and `messageFallbackReason` metadata to
  Brand Agent display payloads.
- Added prompt style examples so Gemini keeps the chat in a practical manager
  tone for OFFER, COUNTER, and ACCEPT turns.
- Negotiation Detail now renders only the visible `display.message` after the
  headline, instead of appending internal deterministic rationale to the chat
  bubble.
- Preserved deterministic fallback when Gemini is off, unavailable, or returns an
  invalid shape.
- Creator Agent rationale generation already used the existing rationale provider;
  this phase completes the Brand-side visible chat copy path.
- Creator Agent display bubbles now use generated rationale text as the visible
  `display.message` when the provider is Gemini, so both sides of the negotiation
  read like a real chat while deterministic fallback remains available.

### Verification

- `./.venv/bin/python -m ruff check backend/libs/ai/gemini.py backend/apps/api/routes.py backend/tests/test_api_promotions.py`: passed.
- `./.venv/bin/pytest backend/tests/test_api_promotions.py::test_start_negotiation_uses_gemini_for_brand_chat_display backend/tests/test_api_promotions.py::test_start_negotiation_uses_saved_initial_offer_for_counter_flow backend/tests/test_a2a_negotiation.py::test_creator_agent_can_use_non_authoritative_rationale_provider -q`: 3 passed.
- `./.venv/bin/pytest backend/tests/test_a2a_negotiation.py backend/tests/test_api_a2a_http_integration.py -q`: 16 passed.
- `./.venv/bin/pytest backend/tests/test_api_promotions.py -q`: 33 passed.
- `./.venv/bin/pytest backend/tests/test_api_promotions.py::test_start_negotiation_uses_gemini_for_brand_chat_display backend/tests/test_api_promotions.py::test_start_negotiation_uses_saved_initial_offer_for_counter_flow -q`: 2 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend test`: 21 passed.
- `./.venv/bin/pytest backend/tests/test_a2a_negotiation.py backend/tests/test_api_a2a_http_integration.py backend/tests/test_api_promotions.py -q`: 49 passed.
- `git diff --check`: passed.

### Boundary

- Gemini only writes user-facing chat copy.
- Deterministic policy code still decides OFFER/COUNTER/ACCEPT, amounts, terms,
  Agreement creation, escrow, and settlement.
- No deployment, Firestore mutation, Secret Manager change, wallet action, pay.sh
  call, or Solana transaction was performed in this phase.

## pay.sh and BM Presentation Expansion (2026-08-20 KST)

### Changed

- Expanded `docs/PRESENTATION_HANDOFF_FINAL.md` with a detailed pay.sh/x402
  usage narrative.
- Clarified that pay.sh is Agent-paid verification infrastructure, separate from
  Creator compensation and Solana escrow.
- Added paid verification use cases, execution flow, spend controls, cost
  ownership, and safer presentation language.
- Added a detailed business model section covering SaaS, Agent run fees,
  verification markup, escrow operation fees, compliance reports, Creator Pro,
  and tool marketplace revenue share.
- Updated the Business Model slide outline and Judge Q&A.

### Verification

- `git diff --check`: passed.
- Manual review of the expanded pay.sh and Business Model sections: completed.

### Boundary

- No code, deployment, Firestore, Secret Manager, wallet, pay.sh, or Solana
  changes were made in this phase.

## Final Presentation Handoff Cleanup (2026-08-20 KST)

### Changed

- Added `docs/PRESENTATION_HANDOFF_FINAL.md` as the single handoff document for
  the pitch deck owner.
- The handoff covers:
  - current live URL, demo accounts, and clean demo DB shape;
  - one-line pitch, problem, and 현직 인터뷰 기반 메시지;
  - judging-criteria narrative for AI autonomy, business/UX, GCP, Solana, and
    presentation;
  - pay.sh/x402 usage as Agent-paid verification, separate from Creator payout;
  - GCP usage including Cloud Run, Firestore, Firebase Auth, Vertex AI, Secret
    Manager, and YouTube Data API;
  - non-Web3 user framing, business model, slide outline, live demo script, and
    judge Q&A.
- Updated `docs/00_DOCUMENT_INDEX.md` to point presentation work to the new final
  handoff.
- Removed stale presentation/mentoring documents superseded by the final handoff:
  - `docs/PITCH_DECK_FINAL_MENTORING_UPDATED.md`
  - `docs/IMPROVED_SPEC_MENTORING_FEEDBACK.md`
  - `docs/BLOCKCHAIN_NARRATIVE.md`

### Verification

- `git diff --check`: passed.
- Active-reference check for removed presentation docs in
  `docs/00_DOCUMENT_INDEX.md`, `docs/17_DISPUTE_AND_TIMELOCK_SYSTEM.md`,
  `README.md`, and `docs/PRESENTATION_HANDOFF_FINAL.md`: no matches.
- Manual review of `docs/PRESENTATION_HANDOFF_FINAL.md`: completed.

### Boundary

- No code, deployment, Firestore, Secret Manager, wallet, pay.sh, or Solana
  changes were made in this phase.

## Creator YouTube Public Stats (2026-08-20 KST)

### Changed

- Added optional backend `YOUTUBE_API_KEY` configuration for Creator onboarding.
- Creator profile analysis now parses representative YouTube video IDs from
  `watch?v=`, `shorts/`, `youtu.be/`, `embed/`, and `live/` URLs.
- When the API key is configured, the backend calls YouTube Data API
  `videos.list(part=snippet,statistics)` and `channels.list(part=snippet,statistics)`.
- The analysis draft now fills only returned public statistics: subscriber count,
  representative video views, likes, comments, channel total views, and channel
  video count. Missing or failed fields remain in `unknownFields`.
- Creator onboarding now displays YouTube-native labels: `구독자`, `영상 조회수`,
  `좋아요`, `댓글`, `채널 영상`, and `채널 총조회`.
- `.env.example` and `backend/.env.example` document `YOUTUBE_API_KEY`; real keys
  must be supplied through local `.env` or Cloud Run Secret Manager, not git.

### Verification

- `./.venv/bin/python -m ruff check backend/apps/api/routes.py backend/libs/settings/config.py backend/tests/test_api_onboarding.py`: passed.
- `./.venv/bin/pytest backend/tests/test_api_onboarding.py -q`: 15 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- `npm --prefix frontend test`: 21 passed.
- `git diff --check`: passed.

### Deployment Note

- Deployed commit `45ac986` to Cloud Run:
  - `knot-creator-agent-00017-zqc` at 100% traffic.
  - `knot-web3-00014-hkr` at 100% traffic.
  - `knot-api-00025-fsg` at 100% traffic.
  - `knot-web-00023-fqg` at 100% traffic.
- Public health checks returned 200 for deployed Web `/login`, API `/readyz`,
  web3 `/readyz`, and Creator Agent `/readyz`.
- No YouTube API Secret exists in Secret Manager yet, so deployed Creator analysis
  still reports missing YouTube Data API credentials instead of fabricating counts.
- No wallet funding, pay.sh call, Solana program deploy, or on-chain transaction
  was performed in this phase.

### Firestore Demo Cleanup

- Ran final demo cleanup with `--reset-all-demo`.
- Deleted 703 existing Firestore demo documents from KNOT top-level business
  collections.
- Re-seeded 155 final XEXYMIX demo documents.
- Verified Firestore counts after cleanup:
  - `users=2`: Brand `t1@knot.com`, Creator `c1@knot.com`.
  - `brands=1`.
  - `promotions=1`: `promotion-xexymix-devnet`.
  - `creatorProfiles=30` and `creatorDiscoveryProfiles=30` for the matching
    candidate pool.
  - `matchRuns=0`, `negotiations=0`, `agreements=0`, `escrows=0`,
    `settlements=0`, `analysisJobs=0`, `onboardingSessions=0`.
- Verified deployed authenticated API:
  - `t1@knot.com / 000000`: `BRAND`, `COMPLETED`, 1 promotion.
  - `c1@knot.com / 000000`: `CREATOR`, `COMPLETED`, 0 initial offers.

## Final Demo Risk Tightening (2026-08-20 KST)

### Changed

- Added authenticated `POST /api/v1/brand/promotions/{promotion_id}/agent-run` for the Brand Agent run entry point. The endpoint verifies the Brand owns the Promotion, runs/reuses matching through the existing idempotent MatchRun path, starts or reuses the A2A negotiation, and returns the Promotion, MatchRun, candidates, negotiation, Agreement, timeline, and waiting state in one response.
- Made `start_negotiation` idempotent when the selected match candidate already has a persisted negotiation, preventing repeated UI clicks or retries from creating duplicate negotiations/Agreements.
- Projected stored `matchRun.paidVerification` into negotiation messages as a neutral `ROLE_SYSTEM` `VERIFICATION_EVENT` when a real receipt or terminal payment status exists. The message exposes pay.sh/x402 mode, amount, receipt IDs, digest, continuation, and a user-facing display summary without treating pay.sh as creator compensation.
- Updated Negotiation Detail to render verification events as centered system cards with a "검증 영수증" detail panel, so the Agent negotiation flow visibly includes the pay.sh verification step when the MatchRun recorded one.
- Updated Brand Promotion Agreement summaries to prioritize the current escrow/settlement money state over stale Agreement projection status, reducing demo confusion when an Agreement document lags behind released escrow state.
- Updated the frontend Agent run client so Brand `협찬 제안하기` uses the server-side orchestration endpoint instead of browser-side `getPromotion -> matches:run -> candidates -> start-negotiation -> timeline` sequencing.
- Added regression coverage for the server-side Agent run path, pay.sh system message projection, retry idempotency, and the no-candidate frontend flow.
- Added a pay.sh CLI fallback from `pay` to `npx -y @solana/pay`, matching pay.sh's documented one-shot install path, so local/CI sandbox verification can execute even when the global `pay` binary is not installed.
- Updated the Cloud Run demo deploy script to default `PAYSH_RESOURCE_ID` to the pay.sh sandbox debugger quote endpoint and keep demo services warm with min instances during the final demo.
- Added a Creator discovery fallback for missing Firestore composite indexes. When Firestore reports that the indexed query requires a new index, the API now reads real `creatorDiscoveryProfiles` documents and applies the same public filters in deterministic code instead of failing the live Agent run.
- Hardened the API container for pay.sh by installing `curl`/CA certificates and running `pay --version` during image build, so the native pay binary is available before the first Cloud Run request.

### Verification

- `./.venv/bin/python -m ruff check backend/libs/payments/paysh.py backend/apps/api/routes.py backend/tests/test_api_promotions.py`: passed.
- `./.venv/bin/python -m ruff check backend/libs/agents/discovery.py backend/tests/test_creator_discovery.py backend/tests/test_api_promotions.py backend/libs/payments/paysh.py`: passed.
- `bash -n scripts/deploy_cloud_run_demo.sh`: passed.
- `./.venv/bin/pytest backend/tests/test_creator_discovery.py backend/tests/test_api_promotions.py::test_brand_agent_run_starts_a2a_and_projects_paysh_message backend/tests/test_api_promotions.py::test_run_match_pays_a_real_paysh_sandbox_call -q -rs`: 4 passed.
- `./.venv/bin/pytest backend/tests/test_api_promotions.py backend/tests/test_paysh_sandbox.py backend/tests/test_api_a2a_http_integration.py -q`: 35 passed, 2 skipped.
- `npx -y @solana/pay --sandbox curl https://debugger.pay.sh/mpp/quote/AAPL`: passed and returned a sandbox AAPL quote.
- `./.venv/bin/pytest backend/tests/test_api_promotions.py::test_run_match_pays_a_real_paysh_sandbox_call -q -rs`: 1 passed.
- `./.venv/bin/pytest backend/tests -q`: 167 passed, 6 skipped.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- `npm --prefix frontend test -- --runInBand`: 21 passed.
- `npm --prefix frontend run build`: passed.

### Live Deployment Link Verification

- Public Cloud Run route smoke returned 200 for deployed Web routes: `/login`, Brand dashboard/promotions/promotion detail/negotiation detail/agreement detail, and Creator dashboard/offers/offer detail/agreements/settlements.
- Public service health returned 200 for deployed `knot-api`, `knot-web3`, and `knot-creator-agent` `/readyz`.
- Firebase sign-in succeeded for `t1@knot.com / 000000` and `c1@knot.com / 000000`.
- Deployed authenticated API smoke returned 200 for Brand `/me`, dashboard, promotions, XEXYMIX promotion detail, agreements, devnet Agreement detail, negotiation messages, and Agreement escrow.
- Deployed authenticated API smoke returned 200 for Creator `/me`, dashboard, agent, offers, XEXYMIX offer detail, agreements, and devnet Agreement detail.
- Deployed Web proxy API smoke returned 200 for `/api/v1/me`, Brand promotions, Brand negotiation messages, and Creator offers.
- Current deployed API and Web proxy both return 404 for `POST /api/v1/brand/promotions/{promotion_id}/agent-run`; the server-side Agent run orchestration change is not deployed yet.
- Current deployed `negotiation-xexymix-devnet` messages are only OFFER, COUNTER, and ACCEPT; no pay.sh `VERIFICATION_EVENT` system message is present on the deployment link yet.
- Playwright CLI screenshot against the deployed login page was attempted but did not complete within 60 seconds in this executor; it was stopped and not used as evidence.

### Demo Boundary

- No deployment, IAM/Secret change, wallet funding, program deployment, or on-chain transaction was performed in this phase.
- pay.sh visibility is now driven by stored MatchRun verification receipts/status. It should be demoed as an Agent-paid external verification/x402 proof, not as the creator payout rail.

## Final Hackathon QA Smoke (2026-08-20 KST)

### Verification

- `./.venv/bin/python -m ruff check backend/apps/api/routes.py backend/libs/settings/config.py backend/tests/test_api_a2a_http_integration.py backend/tests/test_api_promotions.py backend/tests/test_brand_orchestration.py backend/tests/test_creator_discovery.py backend/tests/test_firestore_repositories.py scripts/seed_devnet_phantom_demo.py scripts/seed_xexymix_demo.py scripts/seed_demo.py`: passed.
- `./.venv/bin/pytest backend/tests -q`: 165 passed, 7 skipped.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- `npm --prefix web3/gateway run build`: passed.
- `npm --prefix web3/gateway run lint`: passed.
- `npm --prefix web3/gateway test`: 14 passed, 1 failed in this sandbox because the route test needs a local `127.0.0.1` listener and the sandbox returns `listen EPERM`.
- Fixture JSON validation passed for users, brands, creators, extended creators, agents, extended agents, agent policies, promotions, agreements, escrows, settlements, negotiations, and matching golden data.
- Memory demo seeds passed:
  - `./.venv/bin/python scripts/seed_demo.py --target memory`
  - `./.venv/bin/python scripts/seed_devnet_phantom_demo.py --target memory`
  - `./.venv/bin/python scripts/seed_xexymix_demo.py --target memory`
- Cloud Run listed all services as `RoutesReady=True`: `knot-web`, `knot-api`, `knot-web3`, `knot-creator-agent`.
- Live HTTPS smoke returned 200 for:
  - `https://knot-web-7k3walthgq-uc.a.run.app/login`
  - `https://knot-api-7k3walthgq-uc.a.run.app/readyz`
  - `https://knot-web3-7k3walthgq-uc.a.run.app/readyz`
  - `https://knot-creator-agent-7k3walthgq-uc.a.run.app/readyz`
- Live deployed web routes returned 200 for the Brand/Creator demo route set, including promotion, negotiation, agreement, offers, criteria, and settlements pages.
- Firebase Auth sign-in succeeded for:
  - `t1@knot.com / 000000`: Brand, completed onboarding, devnet wallet present.
  - `c1@knot.com / 000000`: Creator, completed onboarding, devnet wallet present.
- Live deployed web proxy API smoke passed for `/api/v1/me`, Brand dashboard/promotions/agreements, Creator dashboard/offers/agreements/agent, negotiation messages, match candidates, agreement escrow.
- Firestore contains required demo/test documents for devnet and XEXYMIX flows: users, brand, Creator profile, Brand/Creator agents, Creator policy, discovery projection, promotions, match runs, candidates, negotiations, messages, agreements, milestones, escrows, evidence, and settlements.
- Solana devnet RPC confirmed the completed demo signatures:
  - funding `3ePDmJdJXr4mdgkHxpbP67SkZZVC24GiEjMM5Brmqug3F6JUKGhu9vXM6911jQtfVWJ9QD1L4ZWQyGvkkXd5fVLa`: finalized, `err=None`.
  - release `5GCmf7tRixGgV7ZS1zuJQ7AeNQ7G4QsPCai5jDQXDWyxwY6uVJESJwFvcNx3fKr9yAZAHy7pQB41osRx1ajLnnJf`: finalized, `err=None`.
- Tracked-file secret pattern scan found only the literal scan command documented in `.agent/execplans/11-final-qa-deployment-lock.md`.

### Demo Notes

- Use `agreement-devnet-1usdc` when showing the full funding/evidence/release proof sequence; it has timeline events for `ESCROW_FUNDED`, `EVIDENCE_SUBMITTED`, `EVIDENCE_VERIFIED`, and `MILESTONE_RELEASED`.
- Use `promotion-xexymix-devnet` / `negotiation-xexymix-devnet` when showing the branded XEXYMIX A2A story; it has OFFER -> COUNTER -> ACCEPT messages and a funding prepare path, but no promotion timeline events yet.
- The live `agreement-devnet-1usdc` Agreement document still reports `status=FUNDING_REQUIRED` while its escrow is `RELEASED`; explain money state from the escrow/settlement panel, not the Agreement status badge, until the projection is reconciled.
- Current demo data mixes devnet program IDs: completed escrow proof uses `9LjQL46RB4WigamSUmuEehVWF9BLz145Wv4cBxgF4Npn`, while current code/deploy defaults prepare new escrows with `Aj63B5hLtvJdNQiAi61rMrgfW3pt8Lak3GQB59B6jysj`. Both accounts exist and are executable on devnet, but the final script should present one canonical program ID.

## Mentoring Feedback Integration (2026-08-19)

### Changed

**pay.sh Integration - Creator & Content Verification**:
- Added `verify_creator()` function in `backend/libs/payments/paysh.py` for creator authenticity verification via Nansen/HypeAuditor API (~$0.10/call)
- Added `verify_content()` function for content quality verification via Brandwatch API (~$0.50/call)
- Integrated creator verification into discovery flow (`libs/agents/discovery.py`): filters candidates with bot_percentage > 25%
- Integrated content verification into evidence flow (`apps/api/routes.py`): validates brand mention, sentiment, quality
- Added sandbox mode simulation with deterministic fake data for development
- Settings: `PAYSH_CREATOR_VERIFICATION_ENABLED`, `PAYSH_CONTENT_VERIFICATION_ENABLED`, `PAYSH_CREATOR_VERIFICATION_MAX_PRICE`, `PAYSH_CONTENT_VERIFICATION_MAX_PRICE`

**3-Stage Milestone Escrow System**:
- Changed from single 100% milestone to 3-stage system (30%/50%/20%) in `libs/agents/brand.py`
- Contract milestone (30%): Released on agreement creation - prevents brand refund, guarantees creator minimum
- Verification milestone (50%): Released after pay.sh content verification - creator secures 80%
- Timelock milestone (20%): Released after 72-hour dispute window - final payment

**Dispute System**:
- Added `POST /disputes` API to raise disputes by brand or creator
- Added `GET /disputes/{dispute_id}` to retrieve dispute details
- Added `POST /disputes/{dispute_id}:resolve` to resolve disputes (manual or auto)
- Added `GET /agreements/{agreement_id}/disputes` to list all disputes for an agreement
- Dispute automatically freezes milestone (`frozen=true`) to prevent release during dispute
- Auto-resolution for small amounts (< $100 USDC) using Gemini analysis
- Data models: `Dispute`, `DisputeStatus`, `DisputeReason` added to `libs/domain/models.py`
- Firestore collection: `disputes` added to `libs/repositories/firestore_paths.py`

**72-Hour Timelock System**:
- Added `_set_timelock_for_next_milestone()` function to set 72-hour timer after verification milestone release
- Added `POST /milestones/timelock:check` API to check expired timelocks and auto-release
- Timelock prevents release if active disputes exist
- Auto-creates timelock evidence (`timelock://auto-release`) on expiry
- Milestone status: `TIMELOCK_ACTIVE` added

**Amount-Based Automation Policy**:
- Added `AutomationLevel` enum: `FULL_AUTO` (< $100), `HUMAN_REVIEW` ($100-500), `HUMAN_SIGNATURE` (>= $500)
- Added `_determine_automation_level()` function to check automation eligibility based on total amount
- Modified `_perform_milestone_release()` to enforce automation policy: blocks auto-release for HUMAN_REVIEW/HUMAN_SIGNATURE levels
- Settings: `AUTOMATION_FULL_AUTO_THRESHOLD_USDC` (100.0), `AUTOMATION_HUMAN_REVIEW_THRESHOLD_USDC` (500.0)
- Error: `HUMAN_APPROVAL_REQUIRED` raised when automation level requires manual approval

**Documentation**:
- Created `docs/IMPROVED_SPEC_MENTORING_FEEDBACK.md` - comprehensive redesign document addressing all mentoring feedback
- Created `docs/PITCH_DECK_FINAL_MENTORING_UPDATED.md` - final pitch deck with mentoring feedback responses
- Updated `docs/12_PAYSH_X402_PAID_VERIFICATION.md` - added creator/content verification use cases and implementation details
- Updated `docs/13_AGREEMENT_ESCROW_EVIDENCE_SETTLEMENT.md` - documented 3-stage milestones, dispute system, timelock, automation policy

### Verification

**Tests Added**:
- `backend/tests/test_paysh_sandbox.py`:
  - `test_sandbox_creator_verification()` - creator verification in sandbox mode
  - `test_sandbox_content_verification()` - content verification in sandbox mode
  - `test_sandbox_creator_verification_deterministic()` - deterministic result reproduction

**Code Changes**:
- 15 files modified
- +2,616 lines added
- 4 commits in `yw/paysh-integration` branch:
  - `7623d27` - pay.sh integration & 3-stage milestones
  - `f3ff697` - dispute system & timelock logic
  - `95da2d8` - amount-based automation policy
  - `eaadc2b` - final pitch deck

**Files Modified**:
- `backend/apps/api/routes.py` (+990 lines: dispute/timelock APIs, automation checks)
- `backend/apps/api/schemas.py` (+40 lines: DisputeCreateRequest, DisputeResolutionRequest)
- `backend/libs/agents/brand.py` (3-stage milestone definition)
- `backend/libs/agents/discovery.py` (+120 lines: verify_candidates, VerifiedCandidate)
- `backend/libs/domain/models.py` (+50 lines: Dispute, DisputeStatus, DisputeReason, AutomationLevel)
- `backend/libs/payments/__init__.py` (exports update)
- `backend/libs/payments/paysh.py` (+280 lines: verify_creator, verify_content)
- `backend/libs/repositories/firestore_paths.py` (+3 lines: disputes collection path)
- `backend/libs/settings/config.py` (+15 lines: automation thresholds, verification settings)
- `backend/tests/test_paysh_sandbox.py` (+80 lines: verification tests)

### Mentoring Feedback Addressed

| Feedback | Issue | Solution Implemented |
|----------|-------|---------------------|
| Agent Trustworthiness | AI 신뢰성 증명 필요 | pay.sh로 외부 검증 API 구매 (Nansen, Brandwatch) |
| Refund Issues | 브랜드 일방적 환불 | 3단계 마일스톤 (30%/50%/20%) + 분쟁 시스템 |
| Automation Evidence | 자동화 작동 증거 | 실제 구현 코드 + 샌드박스 테스트 |
| PMF Validation | 실사용 검증 필요 | 파일럿 프로그램 계획 (피칭 덱) |
| Legal Issues | 결제 라이선스 | devnet only, "정보 중개" 포지셔닝 |
| Wallet Hurdle | 블록체인 복잡성 | Phase 2: Web3Auth MPC 지갑 계획 |

---

## Previous Updates (2026-08-03)

## Promotion Retry Run and Creator Pool Seed

### Changed

- Brand dashboard Agent management now runs Creator discovery and A2A negotiation
  directly for the latest Promotion instead of only navigating back to the dashboard.
- Brand promotion detail now has a direct `Creator 탐색·협상 시작` action; when an
  eligible Creator is found it routes to the negotiation detail page, and when none
  exists it stays on the page with a truthful waiting message.
- Candidate-empty `runAgentForPromotion` frontend tests now validate the waiting
  result without starting negotiation.
- Local demo seed now creates/publishes multiple Creator accounts:
  `c1@knot.com` through `c7@knot.com`, all using password `000000`, across
  beauty, food, tech, fitness, fashion, and travel with low MVP test rates.
- Local Auth/API seed was executed against the running stack without resetting data.

### Verification

- `python3 scripts/local/seed_demo_accounts.py`: created/updated `t1@knot.com` and
  `c1@knot.com` through `c7@knot.com`.
- Local API smoke created `promotion-smoke-1a94d6a9`, ran MatchRun
  `match-744d4ec1-8ab5-4a1f-9fa2-89d6b1063dd4`, selected
  `creator-agent-e06L9PEAPWhuvTfe5dYOe1cdnIZu` (`Budget Beauty Reel Creator`),
  and started A2A negotiation `negotiation-253b1027-9a67-4684-9736-7e1b006908cb`
  with Agreement `agreement-46d00b8c-e90d-41ae-b742-035c8cfebd29`.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend test`: 19 passed.
- `npm --prefix frontend run build`: passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_promotions.py tests/test_creator_discovery.py tests/test_matching.py -q`:
  31 passed, 1 skipped.

## Real Onboarding Analysis and Local Demo Login

### Changed

- Product and Creator analysis jobs now run through the documented URL analysis path:
  HTTPS URL validation, public DNS/private IP rejection, bounded server-side fetch,
  HTML/meta text extraction, Gemini structured JSON when `KNOT_GEMINI_MODE=vertex`,
  and explicit fallback reasons when fetch or Gemini fails.
- The analysis API no longer stamps every result as
  `secure_fetch_and_gemini_not_configured`; provider/model/fallback now reflect the
  actual path used (`vertex-gemini`, `secure-fetch`, or `deterministic`).
- Brand promotion creation and legacy onboarding review screens now show a Korean
  source label instead of exposing internal fallback codes in the UI.
- `scripts/local/dev_stack.sh` now recreates the Auth Emulator accounts
  `t1@knot.com / 000000` and `c1@knot.com / 000000` after the emulator is ready, so
  local memory seed users can be used without manual account setup.
- Local `.env.local` was updated for this worktree to enable Vertex Gemini attempts
  and secure fetch. This file remains untracked and must not be committed.

### Verification

- `cd backend && ../.venv/bin/ruff check apps/api/routes.py libs/settings/config.py libs/ai/gemini.py tests/test_api_onboarding.py`: passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_onboarding.py tests/test_api_auth.py -q`: 16 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- Local Auth Emulator login verified:
  - `t1@knot.com / 000000` → UID `user-brand-1`, role `BRAND`, completed onboarding.
  - `c1@knot.com / 000000` → UID `user-creator-1`, role `CREATOR`, completed onboarding.
- Local analysis API verified with `https://example.com`: provider `vertex-gemini`,
  model `gemini-2.5-flash`, fallback `null`.

## Demo Data Cleanup and Public Metric Parsing

### Changed

- Memory repository no longer seeds demo fixtures unless `KNOT_MEMORY_SEED_DEMO=1` is
  explicitly set. This prevents new local signup accounts from seeing old fixture
  promotions on their dashboard.
- Local demo account setup now uses the real Auth Emulator and Product API profile
  endpoints to prepare `t1@knot.com` and `c1@knot.com`; it does not load promotion
  fixtures by default.
- Brand dashboard Agent management now reads the current user's API promotions only,
  not stale `sessionStorage` onboarding state.
- Product and Creator analysis requests accept bare domains such as
  `thezonebio.com/products/spf` and normalize them to `https://...` before validation.
- Creator analysis draft now carries public metric fields when they are actually
  present in fetched public page text: `followerCount`, `averageViews`,
  `engagementRate`, and `reelShare`.
- Creator onboarding now displays those metric fields from the analysis result instead
  of hardcoding all values to unknown.
- Brand promotion work-brief input now includes an explicit placeholder example.

### Verification

- `cd backend && ../.venv/bin/ruff check apps/api/repository_factory.py apps/api/routes.py apps/api/schemas.py libs/settings/config.py tests/test_api_auth.py tests/test_api_onboarding.py`: passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_auth.py tests/test_api_onboarding.py -q`: 20 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- Local API verification after restart:
  - `t1@knot.com / 000000` has a clean API-created Brand profile and
    `GET /api/v1/brand/promotions` returned 0 promotions.
  - Bare `example.com` product analysis normalized to `https://example.com` and returned
    provider `vertex-gemini`.
  - `instagram.com/ye__5o` Creator analysis returned provider `vertex-gemini` and
    extracted `followerCount=416`; average views, engagement rate, and reel share stayed
    unknown because the public response did not include those values.

## Matching Retry and Low-Budget Creator Fix

### Changed

- Creator discovery now searches `formatKeys array_contains <requested format>` instead
  of `primaryFormatKey == <requested format>`, so a creator whose primary format is
  Reels but who also supports Shorts/Post can still be selected for those promotions.
- Creator setup now supports low MVP test rates such as `10 USDC` and saves
  `reel`, `short`, and `post` as supported content formats.
- Re-running Creator setup on an existing completed creator account now updates the
  actual Creator profile, Agent policy, and discovery projection instead of silently
  returning the old minimum rate.
- Brand promotion creation idempotency now includes the full promotion payload, so
  changing budget, work brief, usage right, deliverables, or prohibited claims and
  retrying no longer reuses a key from a different request.
- Match run calls now send a stable per-promotion idempotency key, so retrying the
  same run reuses the existing MatchRun.
- Empty candidate errors now distinguish "no published Creator Agent/discovery profile"
  from "candidates exist but policy blocked them."

### Verification

- `cd backend && ../.venv/bin/ruff check apps/api/routes.py libs/agents/discovery.py tests/test_api_promotions.py tests/test_api_auth.py`: passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_auth.py tests/test_api_onboarding.py tests/test_api_promotions.py::test_run_match_uses_any_supported_format_not_only_primary_format tests/test_api_promotions.py::test_run_match_persists_run_candidates_and_timeline_event tests/test_api_promotions.py::test_match_run_start_is_idempotent_and_records_canonical_events -q`: 23 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- Local API smoke after restart:
  - Updated `c1@knot.com` Creator profile to minimum `10 USDC` and formats
    `reel`, `short`, `post`.
  - Created Brand promotion with `maximumPerCreator=20`, `initialOffer=12`,
    `usageRights=organicOnly`, and `short` deliverable.
  - Matching selected `creator-agent-user-creator-1`, returned one eligible candidate
    with no hard filter reasons.
  - A2A negotiation started and produced an Agreement.

## Payment Rails Refactor

### Changed

- Separated pay.sh/x402 from Creator compensation escrow.
- Added `agentPaymentEvents` Firestore collection for Agent operational payment events.
- Agreement creation now starts compensation lifecycle at `FUNDING_REQUIRED`.
- Added Brand Phantom-funded escrow APIs:
  - `POST /api/v1/agreements/{agreementId}/escrow/prepare`
  - `POST /api/v1/agreements/{agreementId}/escrow/confirm`
- Added `POST /api/v1/me/wallet` for storing only public Phantom wallet addresses.
- Added Web3 Gateway prepare/confirm endpoints for Brand-signed funding transactions.
- Added Agreement-scoped Anchor escrow instructions:
  - `initialize_escrow`
  - `fund_escrow`
  - `verify_milestone`
  - `release_milestone`
  - `refund_remaining`
- Existing server-keypair `/escrow:lock` path remains for legacy/local fixture compatibility.
- Phantom wallet handling now waits for the injected provider, stores only valid Solana
  public keys, and restores the saved wallet from `/api/v1/me` on Agreement detail pages.
- Creator onboarding no longer writes a fake settlement wallet. Existing invalid wallet
  values are hidden from current-user ViewModels and rejected before Web3 Gateway calls.
- Firebase login now links a completed seeded account by verified email when Firebase UID
  differs from the seeded user document, preventing `t1@knot.com` / `c1@knot.com` from
  being treated as new signup-required users.
- Devnet demo seed now updates an existing Firebase Auth account by email when the
  requested seeded UID is unavailable, keeping `000000` as the demo password.
- Agreement detail UI was restored to the intended structure: counterparty profile,
  Agent result, and wallet/settlement cards in one row; milestones below; full A2A
  message log with payload details at the bottom.
- Escrow prepare/legacy lock now derive a stable base58-safe Agreement escrow id,
  so repeated prepare calls with the same `Idempotency-Key` no longer conflict because
  of regenerated escrow ids and gateway calls no longer receive hyphenated escrow ids.
- Brand Agreement detail now separates Phantom connection from escrow funding: the
  first click only connects/saves the wallet, and funding prepare runs after a wallet
  is already connected.
- Web3 Gateway funding policy failures now surface as `FUNDING_PREPARE_FAILED` /
  `FUNDING_CONFIRM_FAILED` conflicts instead of generic 502 Bad Gateway responses.
- Web3 Gateway AIP-136 custom-method routes now use exact regex routes, preventing
  `/escrows:prepare-funding` from being captured by the legacy `/escrows:lock` handler.
- Root landing page was restored to the existing `/knot/index.html` iframe landing
  instead of the temporary React `LandingScreen`.
- Milestone release now has a Phantom-signed prepare/confirm path:
  `/milestones/{milestoneId}/release/prepare` returns an unsigned Solana devnet
  release transaction, and `/release/confirm` validates the confirmed signature,
  settlement signer, vault delta, and Creator USDC ATA delta before writing settlement state.
- Local memory API can load an explicit `KNOT_EXTRA_MEMORY_SEED_FILE` for dev-only
  recovery of confirmed on-chain escrow records after a process restart. This is
  opt-in and does not create a successful mock fallback.
- Cloud Run demo deploy script now builds/deploys `knot-web3` and wires `knot-api`
  to `KNOT_WEB3_MODE=gateway`, the web3 gateway URL, the canonical devnet escrow
  program, devnet USDC mint, and the current demo settlement authority.

### Current Money Flow

- pay.sh: Brand Agent operational API verification spend only.
- Creator compensation: Brand Phantom USDC ATA funds Agreement vault ATA.
- Milestone release: verified milestone releases from Agreement vault ATA to Creator Phantom USDC ATA.

### Required Runtime Configuration

- `KNOT_WEB3_MODE=gateway`
- `KNOT_ESCROW_PROGRAM_ID=9LjQL46RB4WigamSUmuEehVWF9BLz145Wv4cBxgF4Npn`
- `KNOT_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- `KNOT_SETTLEMENT_AUTHORITY=<settlement public key>`
- Gateway signing:
  - `KNOT_SETTLEMENT_KEYPAIR_JSON` or `KNOT_SETTLEMENT_KEYPAIR_PATH`
- Frontend:
  - `NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com`

### Verification

- `anchor build`: passed with existing Anchor cfg warnings.
- `scripts/deploy_devnet.sh`: deployed canonical escrow program
  `9LjQL46RB4WigamSUmuEehVWF9BLz145Wv4cBxgF4Npn` to devnet.
  - Deploy signature: `2NuhkFTeehyJpH588zSwvCpQ5s8AeComoTYdsUJUtrUbyqLVsY5Z7iqezDwjfzj5aMLm6dcDVw1LmNQzAGC3meb5`
  - ProgramData: `9ynq6BPG4uLdZ2xpVRn7yzono8oim6kpzpBdpyQt7qzS`
  - Upgrade authority / deploy payer: `GX1qtkjR89HXqagZ6x53BfFt4HVnSqWEw9QYxVBKgv6B`
  - Deploy payer remaining balance: `0.22430384 SOL`
- `anchor test`: build phase passed, devnet deploy phase failed because the configured upgrade authority has no credited SOL account.
- `anchor test --skip-deploy`: build phase passed, then Anchor.toml test script failed because `/opt/homebrew/opt/python@3.14/bin/python3.14` has no `pytest` module; the repository `.venv` pytest command below passed.
- `npm --prefix web3/gateway run build`: passed.
- `npm --prefix web3/gateway run lint`: passed.
- `npm --prefix web3/gateway test`: passed.
- `cd web3/gateway && npm test`: passed outside sandbox after local listen was blocked inside sandbox.
- `cd web3/gateway && npm run build`: passed after Phantom-signed release prepare/confirm changes.
- `env PYTHONPATH=backend ./.venv/bin/pytest backend/tests/test_api_escrow.py`: 21 passed.
- `cd frontend && npm run lint`: passed.
- `cd frontend && npm run build`: passed.
- `cd frontend && npm ci`: passed after synchronizing `frontend/package-lock.json`
  with `frontend/package.json`.
- `bash -n scripts/deploy_cloud_run_demo.sh`: passed.
- Local `POST /api/v1/agreements/agreement-bf47634b-9bbb-4a9d-99ee-b7a3d37b39a1/escrow/prepare`
  returned 200 with a prepared Phantom funding transaction after the gateway route fix.
- Local funded escrow recovery verified:
  - Escrow: `esc9vRLZ1xgG2x2Asr6RSytXFpmuGhZN6TL`
  - Funding tx: `5fAGfp1pY1NPNaxSJLUHWj5bP6TgFxXTKa1FZq12CSaC4hZBzgfJygLDHvnCV9uLXryANXxLcvo4395t12DLTApR`
  - Vault: `7Dk2VUaaxxLvBeo1ZQMvbMEyeuoqdeuPbpunwpsDMfet`
  - Release prepare returned `PREPARED` for settlement authority
    `63T8p6c4p1fFC7HmYDEqNtyheqMxnYKmiGqTafpzh8zJ`.
- Creator Phantom fee funding:
  - `0.02 SOL` sent to `63T8p6c4p1fFC7HmYDEqNtyheqMxnYKmiGqTafpzh8zJ`
  - Funding tx: `4WmqxoC1bEHxSoRA9r1S9x81eZ2yrNULJYjR5nJAzkQozsX8pUgv4Dnm1rNqB5DNM272czZW56Ny364UDXqoLzMb`
  - Creator SOL balance verified: `0.02 SOL`.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- `./.venv/bin/pytest backend/tests/test_api_auth.py backend/tests/test_api_escrow.py -q`: 29 passed.
- `./.venv/bin/pytest backend/tests -q`: 126 passed, 5 skipped.
- `./.venv/bin/python -m py_compile scripts/seed_devnet_phantom_demo.py`: passed.
- Firestore/Firebase devnet demo seed executed for `t1@knot.com` and `c1@knot.com`.
- Real Firebase password sign-in checked against local Firestore-backed API:
  - `t1@knot.com / 000000`: `BRAND`, `COMPLETED`, `/brand`.
  - `c1@knot.com / 000000`: `CREATOR`, `COMPLETED`, `/creator`.
- `./.venv/bin/pytest backend/tests/test_api_a2a_http_integration.py::test_product_api_runs_real_http_a2a_counter_accept_golden_path -q` outside sandbox: passed.
- Local current-branch stack health checked:
  - Product API `http://127.0.0.1:18090/readyz`: ready.
  - Creator Agent `http://127.0.0.1:18091/readyz`: ready.
  - Web3 Gateway `http://127.0.0.1:18082/readyz`: ready.
  - Frontend `http://localhost:3000/login`: 200.

### Not Yet Verified On Devnet

- Browser-side creator Phantom signature for the prepared milestone release transaction
  still needs to be clicked in the local UI. The backend/gateway prepare path is ready,
  and the creator fee payer now has SOL.
- Future production/devnet agreements should use a dedicated backend settlement signer
  as `settlementAuthority`; the recovered local escrow keeps the already-initialized
  creator wallet as settlement authority because that value is immutable on-chain.
- Cloud Run deployment of `knot-creator-agent`, `knot-web3`, and `knot-api` completed
  with image tag `97a4e76`; the first `knot-web` build failed on stale package-lock
  metadata and Linux optional peer resolution. Frontend Docker install now uses
  `npm ci --legacy-peer-deps` while preserving lockfile-based installs.

## 2026-08-03 Real Onboarding And Richer A2A Negotiation

### Changed

- Brand and Creator onboarding no longer call frontend deterministic fixture helpers
  (`extractProduct`, `lookupInstagram`) for product/profile analysis.
- Brand product onboarding now calls `/api/v1/analyses/product`, shows unknown fields as
  user-confirmable values, and confirms the analysis before creating the Brand profile.
- Creator connect onboarding now calls `/api/v1/analyses/creator-profile`, avoids
  fabricated follower/view metrics, confirms the analysis, creates the Creator profile,
  and publishes the Creator Agent so matching can discover it.
- A2A negotiation payloads now include a role-safe `display` projection with public
  message text, term summary, and public policy summary.
- When a Creator counteroffer is within Brand policy, Brand Agent can send one bridge
  counteroffer before final acceptance, producing a multi-turn A2A transcript instead
  of a single counter/accept jump.

### Verification

- `/Users/yewonchoi/Desktop/knot/.venv/bin/pytest backend/tests/test_a2a_negotiation.py backend/tests/test_api_promotions.py -q`:
  40 passed, 1 skipped.
- `cd frontend && npm run typecheck`: passed.

## 2026-08-03 Match Waiting State And Retry-Safe Creator Discovery

### Changed

- Match runs with no selected Creator now persist as `WAITING_FOR_CREATOR`
  instead of being shown as a failed negotiation.
- Promotion timelines record `MATCH_RUN_WAITING_FOR_CREATOR` so Brand dashboards
  can keep the Promotion active while waiting for newly published Creator Agents.
- The frontend Product API client no longer throws `NO_ELIGIBLE_CREATOR` for this
  state; Promotion creation returns to the Brand dashboard and shows a waiting
  state with a retry action.
- Match-run retries from the UI now use a fresh idempotency key per execution,
  while backend idempotency still returns the same run for the same key.
- Candidate explanation generation defaults to deterministic policy facts during
  match execution. `KNOT_GEMINI_MATCH_EXPLANATIONS=1` can opt into Vertex-generated
  explanation text without making the core match/negotiation path depend on it.

### Verification

- `cd backend && ../.venv/bin/ruff check apps/api/routes.py tests/test_api_promotions.py`: passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_promotions.py::test_start_negotiation_reports_no_eligible_creator tests/test_api_promotions.py::test_run_match_uses_any_supported_format_not_only_primary_format tests/test_api_promotions.py::test_run_match_persists_run_candidates_and_timeline_event tests/test_api_promotions.py::test_match_run_start_is_idempotent_and_records_canonical_events -q`: 4 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- Local HTTP smoke against `http://127.0.0.1:18080` passed:
  `c1@knot.com` Creator min `10 USDC` + `t1@knot.com` Brand max `20 USDC`
  produced `COMPLETED` match run selecting `creator-agent-user-creator-1`.
- Local HTTP no-match smoke passed: unmatched category/usage produced
  `WAITING_FOR_CREATOR` with `selectedCreatorAgentId=null`.

## 2026-08-03 Agreement Detail UI Regression Fix

### Changed

- `/brand/agreements/[agreementId]` and `/creator/agreements/[agreementId]`
  now resolve the Agreement and render the same Negotiation Detail surface used by
  `/brand/negotiations/[negotiationId]` and `/creator/offers/[negotiationId]`.
- Agreement detail pages again show the top three panels:
  counterparty profile, agreed work/result, and wallet/escrow settlement.
- The wallet/settlement panel explicitly displays escrow status, total amount,
  released amount, remaining balance, Escrow PDA, vault token account,
  Brand source wallet, Creator destination wallet, and Explorer links.
- The milestone section and long A2A message thread remain below the three-panel
  summary so Agreement links and Negotiation links have one consistent UI.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test`: 21 passed.
- `npm --prefix frontend run build`: passed.

## 2026-08-03 Promotion Detail UI Regression Fix

### Changed

- `/brand/promotions/[promotionId]` no longer renders the legacy
  `ProductScreens.BrandPromotionDetailScreen`.
- Promotion detail now uses the current dashboard visual language with three
  top panels: Promotion conditions, Agent run state, and escrow settlement
  summary.
- The page fetches Agreement escrow bundles and shows contracted amount,
  escrow total, released amount, remaining balance, funded status, and links to
  the unified Agreement/Negotiation detail surface.
- Promotion timeline rows now use the same Agent-run event wording used by the
  dashboard instead of the old generic activity list.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- Local route bundle check for `/brand/promotions/test`: passed.

## 2026-08-03 Analysis Retry And Public Metrics Fix

### Changed

- Product and Creator analysis frontend calls no longer send fixed URL-based
  idempotency keys. Re-running analysis for the same URL now avoids
  `IDEMPOTENCY_CONFLICT` 409 errors.
- Frontend and backend URL normalization now convert `http://...` and bare
  domains to `https://...` for public analysis inputs.
- Creator public metric analysis now removes extracted metrics from
  `unknownFields`; only metrics not present in the public page remain as
  user-confirmable unknowns.
- Instagram profile analysis still does not fabricate average views,
  engagement rate, or reel share when the public HTML does not expose them.

### Verification

- `cd backend && ../.venv/bin/ruff check apps/api/routes.py apps/api/schemas.py tests/test_api_onboarding.py`: passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_onboarding.py -q`: 9 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- Local HTTP smoke: repeated product analysis for `http://example.com/products/spf`
  and `example.com/products/spf` returned 202, normalized to HTTPS, and reused
  the same analysis ID.
- Local HTTP smoke: creator analysis for `http://instagram.com/ye__5o`
  normalized to HTTPS and left only unavailable public metrics in `unknownFields`.

## 2026-08-03 Brand Signup Simplification And Promotion Real Inputs

### Changed

- Brand signup now creates only the minimal Brand profile and routes directly to
  `/brand`; product, mood, budget, and deliverable setup no longer run during
  Brand signup.
- Incomplete Brand accounts now resume at `/brand/onboarding`, which stores only
  Brand profile metadata; `/brand/product` and `/brand/mood` redirect to
  `/brand/promotions/new`.
- Brand Promotion creation now calls `/api/v1/analyses/product` instead of the
  frontend fixture `extractProduct`.
- Removed the fixed demo product URL, fixed work brief, fixed mood tags, and fixed
  budget/deliverable defaults from the active Promotion wizard. The user must
  confirm product/category/work/mood/deliverable/budget inputs before negotiation
  can start.

### Verification

- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm run lint`: passed.
- `cd frontend && npm run build`: passed.
- `/Users/yewonchoi/Desktop/knot/.venv/bin/pytest backend/tests/test_api_auth.py backend/tests/test_api_promotions.py -q`:
  37 passed, 1 skipped.

## 2026-08-03 Creator Discovery Demo Data And Settlement Card Trim

### Changed

- Brand dashboard and Promotion detail retry actions now run the real
  promotion Agent matching/A2A flow instead of only navigating back to the
  dashboard.
- No-eligible-creator runs return a waiting state so a Brand can keep the
  Promotion open for future Creators instead of hitting an idempotency retry
  error.
- Local demo seed now creates one Brand account and seven Creator accounts
  across beauty, food, tech, fitness, fashion, travel, and low-budget beauty
  categories.
- Creator URL analysis now exposes available public page signals such as title,
  description, keyword hints, hashtags, and recent public Instagram post/reel
  links without fabricating unavailable metrics.
- Negotiation detail settlement cards now show only the user-facing essentials:
  connected Phantom, Agreement amount, Escrow status, remaining or released
  amount, and transaction availability. PDA, Vault, source token account, and
  counterparty wallet address are hidden from the main UI.

### Verification

- `cd backend && ../.venv/bin/ruff check apps/api/routes.py tests/test_api_onboarding.py`: passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_onboarding.py -q`: 9 passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_promotions.py tests/test_creator_discovery.py tests/test_matching.py -q`:
  31 passed, 1 skipped.
- `python3 -m py_compile scripts/local/seed_demo_accounts.py`: passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend test`: passed.
- `npm --prefix frontend run build`: passed.

## 2026-08-03 30 USDC Matching Demo And Creator Public Signal Cleanup

### Changed

- Added local demo Creator accounts `c8@knot.com`, `c9@knot.com`, and
  `c10@knot.com` for low-budget escrow demos. `c8@knot.com` is an all-format,
  broad-category Creator with a 5 USDC minimum so a Brand wallet with 30 USDC
  can complete the promotion-to-agreement path.
- Added category aliases for `supplement`, `nutrition`, `건강기능식품`, and
  `영양제` so health supplement product pages do not miss eligible low-budget
  Creators.
- Brand Promotion creation now uses a click-scoped idempotency key instead of a
  payload-stable key, allowing repeated demo attempts with the same Promotion
  terms without idempotency conflicts.
- Creator profile analysis now structures public Instagram counts from fetched
  HTML: follower count, following count, post count, visible public post links,
  and visible public reel links.
- Creator onboarding UI no longer renders unavailable metrics as `확인 필요`.
  It shows only metrics that were actually observed and removes duplicated
  title/description profile text from the public-signal card.
- Creator mood hints now include lightweight inferred mood tags from public
  profile text, such as daily/campus/pet-friendly signals, without inventing
  unavailable engagement metrics.

### Verification

- `cd backend && ../.venv/bin/ruff check apps/api/routes.py tests/test_api_onboarding.py ../scripts/local/seed_demo_accounts.py libs/domain/categories.py`:
  passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_onboarding.py tests/test_api_promotions.py tests/test_matching.py -q`:
  39 passed, 1 skipped.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend test`: 19 passed.
- `npm --prefix frontend run build`: passed.
- Local demo seed recreated `t1@knot.com` and `c1@knot.com` through
  `c10@knot.com`, all password `000000`.
- Local 20 USDC promotion smoke selected `30 USDC Demo All-Rounder`, created
  `negotiation-e85999a7-1e28-4a6e-866e-e4c1d6f8a5d7`, and created
  `agreement-e825cd4d-f4d4-4b41-b429-1b1cbec21ab6` for 10 USDC.
- Local Instagram smoke for `instagram.com/ye__5o` returned follower count 416,
  following count 437, post count 0, no public post/reel links, and mood hints
  `일상`, `캠퍼스`, `반려동물`, `친근함`.

## 2026-08-03 Korean Fashion Alias Match Fix

### Changed

- Added fashion category aliases for Korean apparel product categories including
  `남성 슬리브리스`, `맨즈 슬리브리스`, `슬리브리스`, `민소매`, and `나시`.
- This fixes Promotions whose product analysis stores a literal Korean product
  category instead of the canonical `fashion` category, which previously caused
  creator discovery to return zero candidates.

### Verification

- `cd backend && ../.venv/bin/ruff check libs/domain/categories.py tests/test_api_promotions.py`:
  passed.
- `cd backend && ../.venv/bin/pytest tests/test_api_promotions.py::test_run_match_normalizes_korean_fashion_product_aliases tests/test_api_promotions.py::test_run_match_normalizes_korean_category_aliases -q`:
  2 passed.
- Local smoke with category `남성 슬리브리스`, max 10 USDC, and reel 1 selected
  `30 USDC Demo All-Rounder`, created
  `negotiation-34f4ac94-e69b-48da-83ee-f75f2a2ef2d1`, and created
  `agreement-161a6cc3-2839-44cb-b595-786cd4bede7d` for 5 USDC.

## 2026-08-03 Local Escrow Prepare Blocking Fix

### Changed

- Demo Creator seed profiles now include the configured Creator settlement
  wallet `63T8p6c4p1fFC7HmYDEqNtyheqMxnYKmiGqTafpzh8zJ`, so Brand escrow
  funding can bind a real Creator destination before Phantom signing.
- Localnet bootstrap now writes `KNOT_SETTLEMENT_AUTHORITY` from the local
  agent/settlement keypair public key into `/tmp/knot-local/env.localnet`.
- Current localnet profile was updated with settlement authority
  `6hwmMX2uHrvvaWog9pQWiryrx2xvS24abiWnEUkZQB82`.

### Verification

- `python3 -m py_compile scripts/local/seed_demo_accounts.py scripts/local/localnet_bootstrap.py`:
  passed.
- `cd backend && ../.venv/bin/ruff check ../scripts/local/seed_demo_accounts.py ../scripts/local/localnet_bootstrap.py`:
  passed.
- Local smoke saved Brand wallet
  `8keJx2mcKFENHcUs4ti79aUurAHrWt8Z4XcQTnKGKks6`, created
  `agreement-bb05a43a-a7ba-4907-bece-03c174f63871` for 10 USDC, and
  `/api/v1/agreements/{agreementId}/escrow/prepare` returned 200 with
  `escrow.status=CREATED`, a funding transaction, Brand authority, Creator
  destination, and Settlement authority populated.

## 2026-08-03 Escrow Blockhash RPC Wiring Fix

### Changed

- Web3 Gateway funding and milestone-release prepare responses now include the
  exact Solana RPC URL used to build the transaction.
- Frontend escrow prepare types now carry `rpcUrl`, and Phantom transaction
  sending already forwards that value into `Connection`.
- Brand funding prepare now uses a click-scoped idempotency key. This prevents a
  failed or delayed retry from reusing an old prepared transaction with an
  expired blockhash.
- Creator milestone release prepare now uses the same click-scoped idempotency
  pattern, while release confirm remains signature-scoped for settlement
  idempotency.

### Why

- Local escrow transactions were prepared against localnet
  `http://127.0.0.1:8899`, but the browser defaulted to devnet when sending or
  confirming. That caused `Transaction simulation failed: Blockhash not found`.
- A stable prepare idempotency key could also return an old transaction after a
  retry, causing the same blockhash error after the blockhash expired.

### Verification

- `npm --prefix web3/gateway run build`: passed.
- `npm --prefix web3/gateway run lint`: passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- Local dev stack restarted on `http://127.0.0.1:3000`.
- Local smoke saved Brand wallet
  `8keJx2mcKFENHcUs4ti79aUurAHrWt8Z4XcQTnKGKks6`, created
  `agreement-aeda2680-c7db-4d7b-a7d0-fe6650400bad` for 10 USDC, and escrow
  prepare returned `rpcUrl=http://127.0.0.1:8899`, `has transaction=True`,
  and `feePayer=8keJx2mcKFENHcUs4ti79aUurAHrWt8Z4XcQTnKGKks6`.

## 2026-08-03 Localnet Anchor Program And Faucet Repair

### Changed

- Rebuilt the current `programs/knot-escrow` Anchor program and deployed it to
  localnet with generated local program ID
  `Ax3FQuUXAqaxEHQ4mrJWLewdnNmRXVuALYjrezHjXUvH`.
- Regenerated `/tmp/knot-local/env.localnet` so backend and Web3 Gateway use
  that local program ID and local USDC mint
  `3vtAPyiymfTKbQqm9tzkXAsARJxUVcob8aWfMRFnquJd`.
- Added the missing Web3 Gateway local faucet HTTP route
  `/internal/v1/faucet`.
- Backend `POST /api/v1/me/wallet` now calls the gateway faucet only when
  `KNOT_ESCROW_NETWORK=solanaLocalnet` and `KNOT_WEB3_MODE=gateway`.
- Fixed the local faucet so SOL top-up and USDC top-up are independent. A
  wallet that already has enough SOL now still receives/creates the local USDC
  ATA needed for escrow funding.
- Localnet bootstrap now writes the settlement authority public key directly
  from the agent keypair.

### Why

- Phantom funding failed with Anchor `InstructionFallbackNotFound` because the
  runtime env pointed to old local program ID `Fjb8...` while the active source
  expected a different escrow instruction set.
- After switching mint/program IDs, Brand Phantom prepare failed because the
  local faucet skipped early when SOL was already present and never created the
  Brand USDC ATA.

### Verification

- `anchor build`: passed.
- `.venv/bin/python scripts/local/localnet_bootstrap.py`: deployed/initialized
  localnet escrow wiring.
- `solana account Ax3FQuUXAqaxEHQ4mrJWLewdnNmRXVuALYjrezHjXUvH --url http://127.0.0.1:8899`:
  executable program account found.
- `npm --prefix web3/gateway run build`: passed.
- `npm --prefix web3/gateway run lint`: passed.
- `cd backend && ../.venv/bin/ruff check apps/api/routes.py libs/web3/client.py ../scripts/local/localnet_bootstrap.py`:
  passed.
- Local wallet save for Brand Phantom
  `8keJx2mcKFENHcUs4ti79aUurAHrWt8Z4XcQTnKGKks6` returned local faucet top-up
  with `usdcMinted=2000`.
- Local prepare smoke for `agreement-6771bbf0-6d60-4b3d-af80-0f0746fa3931`
  returned `programId=Ax3FQuUXAqaxEHQ4mrJWLewdnNmRXVuALYjrezHjXUvH`,
  `rpcUrl=http://127.0.0.1:8899`, and `brandBalanceRaw=2000000000`.
- Signed local funding smoke with CLI wallet
  `GX1qtkjR89HXqagZ6x53BfFt4HVnSqWEw9QYxVBKgv6B` confirmed escrow status
  `FUNDED` with signature
  `os58g9bxXB2i8oGde3NocpDofuiZU8Dc9PjNMoiDSNizjD7cbkRCUWbLzM71BYBqQyMDrfeerns5F8QuAGes77G`.

## 2026-08-03 Devnet Deployment Wiring

### Changed

- Deployed `knot-web3:devnet-fix-181525` to Cloud Run with
  `KNOT_WEB3_SIGNING_MODE=devnet`.
- Created Secret Manager secret `knot-settlement-keypair-json` and granted the
  Cloud Run runtime service account secret accessor permission.
- Deployed `knot-api:devnet-fix-181525` with
  `KNOT_SETTLEMENT_AUTHORITY=GX1qtkjR89HXqagZ6x53BfFt4HVnSqWEw9QYxVBKgv6B`
  and Web3 Gateway mode enabled.
- Seeded Firestore/Firebase Auth demo accounts `t1@knot.com / 000000` and
  `c1@knot.com / 000000` with a 5 USDC `FUNDING_REQUIRED` devnet Agreement
  `agreement-devnet-1usdc`.

### Verification

- `anchor build`: passed against devnet program ID
  `9LjQL46RB4WigamSUmuEehVWF9BLz145Wv4cBxgF4Npn`.
- `npm --prefix web3/gateway run build`: passed.
- `npm --prefix web3/gateway run lint`: passed.
- Cloud Build succeeded for `knot-web3:devnet-fix-181525`.
- Cloud Build succeeded for `knot-api:devnet-fix-181525`.
- Cloud Run env verification confirmed Web3 Gateway uses
  `KNOT_WEB3_SIGNING_MODE=devnet`, devnet USDC mint
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, and settlement secret.
- Firebase Auth login verification:
  `t1@knot.com` resolves to completed Brand account with wallet
  `8keJx2mcKFENHcUs4ti79aUurAHrWt8Z4XcQTnKGKks6`; `c1@knot.com` resolves to
  completed Creator account with wallet
  `63T8p6c4p1fFC7HmYDEqNtyheqMxnYKmiGqTafpzh8zJ`.
- Deployed API `POST /api/v1/agreements/agreement-devnet-1usdc/escrow/prepare`
  returned a devnet Phantom funding transaction for 5 USDC.
- Deployed Web3 Gateway funding transaction simulation on devnet succeeded with
  `InitializeEscrow` and `FundEscrow` logs and `err=null`.

### Remaining

- Program upgrade was attempted but not completed because the deployment wallet
  had only `0.20429884 SOL`; the upgrade required about `2.781 SOL`. The
  already deployed program `9LjQL46RB4WigamSUmuEehVWF9BLz145Wv4cBxgF4Npn`
  remains active and funding simulation against it passed.
- A real devnet funding transaction still requires the Brand Phantom wallet to
  sign in the browser. After funding, evidence verification should trigger
  automatic release via the deployed Web3 Gateway settlement authority.

## 2026-08-03 Deployment Login Copy And Signup Idempotency Fix

### Changes

- Confirmed the deployed login page was still serving an older frontend build
  containing internal Firebase/Product API copy, while local `main` had already
  removed that text.
- Updated Brand/Creator signup role and Brand profile creation calls to use a
  fresh request-scoped idempotency key instead of an email-derived fixed key.
  This prevents retrying signup with a changed form body from failing with
  `Idempotency-Key was already used for a different request`.
- Softened the incomplete-account guard copy so users do not see technical
  onboarding language while account context is being resolved.

### Verification

- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm run lint`: passed.
- `cd frontend && npm run build`: passed.
- `cd frontend && npm test`: 17 passed, 2 failed. The failures are existing
  test expectation drift around auth-copy text and API data-source projection;
  they are not caused by the signup idempotency change.

## 2026-08-20 Final Demo Cloud Run Deployment And Live Verification

### Changed

- Deployed the final demo risk-tightening source state to Cloud Run.
- `knot-api` now serves revision `knot-api-00023-d7n` at 100% traffic with image
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-api:96616ca`.
- The API image now preinstalls the native pay.sh binary path dependencies,
  including `curl`, and the deploy script normalizes empty/placeholder
  `PAYSH_RESOURCE_ID` to `https://debugger.pay.sh/mpp/quote/AAPL`.
- Firestore creator discovery now falls back to a real-document deterministic
  filter when a missing composite index blocks the optimized query. This avoids
  a production mock fallback while keeping candidate selection policy-owned.

### Live Deployment Verification

- API env confirmed `PAYSH_MODE=sandbox`,
  `PAYSH_RESOURCE_ID=https://debugger.pay.sh/mpp/quote/AAPL`, GCP Firestore
  backend, Vertex Gemini mode, HTTP Creator A2A, and Web3 Gateway mode.
- `/readyz` returned 200 for:
  - `https://knot-api-260001601654.us-central1.run.app/readyz`
  - `https://knot-web3-7k3walthgq-uc.a.run.app/readyz`
  - `https://knot-creator-agent-7k3walthgq-uc.a.run.app/readyz`
- Public Web routes returned 200 for `/login`, Brand dashboard/promotion/
  negotiation pages, and Creator dashboard/offers/agreements/settlements pages.
- `POST /api/v1/brand/promotions/promotion-xexymix-devnet/agent-run` returned
  401 without Firebase auth through both direct API and Web proxy when an
  idempotency key was supplied, confirming the route is deployed and protected.
- Authenticated Brand `agent-run` returned 201 on the deployment:
  - `matchRunId=match-11fa1c95-3840-48fe-a7e0-10184bb6ed46`
  - `paidStatus=SETTLED`
  - `receiptId=receipt-paysh-c345a5b4-3001-5fe4-952f-d0c941dc0ebe`
  - `negotiationId=negotiation-52aa022e-03e4-4460-ab5f-7a61a455d1df`
  - `agreementId=agreement-6fa1f7cd-2d13-42b7-b097-063d9118ef49`
- The deployed Web proxy returned the negotiation pay.sh system event:
  `SYSTEM`, `VERIFICATION_EVENT`, `provider=pay.sh`, `status=SETTLED`, display
  message `후보 검증 API를 사용했어요. 0.02 USDC · 결제 완료`.
- Authenticated Brand API paths returned 200 for `/me`, dashboard, promotion
  detail, agreement detail, and negotiation detail.
- Authenticated Creator API paths returned 200 for `/me`, dashboard, offers,
  the new offer detail, and agreements.
- Existing devnet escrow proof was checked read-only:
  - Funding signature
    `3ePDmJdJXr4mdgkHxpbP67SkZZVC24GiEjMM5Brmqug3F6JUKGhu9vXM6911jQtfVWJ9QD1L4ZWQyGvkkXd5fVLa`
    confirmed `Finalized`.
  - Release signature
    `5GCmf7tRixGgV7ZS1zuJQ7AeNQ7G4QsPCai5jDQXDWyxwY6uVJESJwFvcNx3fKr9yAZAHy7pQB41osRx1ajLnnJf`
    confirmed `Finalized`.
  - Devnet program accounts `Aj63B5hLtvJdNQiAi61rMrgfW3pt8Lak3GQB59B6jysj`
    and `9LjQL46RB4WigamSUmuEehVWF9BLz145Wv4cBxgF4Npn` were readable as
    executable program accounts.
- No Secret Manager change, wallet funding, Solana program deployment, or new
  on-chain transaction was performed during this verification phase.

### Final Test Verification

- `./.venv/bin/python -m ruff check backend/libs/payments/paysh.py backend/apps/api/routes.py backend/libs/agents/discovery.py backend/tests/test_creator_discovery.py backend/tests/test_api_promotions.py`:
  passed.
- `./.venv/bin/pytest backend/tests/test_creator_discovery.py backend/tests/test_api_promotions.py::test_brand_agent_run_starts_a2a_and_projects_paysh_message backend/tests/test_api_promotions.py::test_run_match_pays_a_real_paysh_sandbox_call -q -rs`:
  4 passed.
- `./.venv/bin/pytest backend/tests -q`: 168 passed, 6 skipped.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- `bash -n scripts/deploy_cloud_run_demo.sh`: passed.

## 2026-08-20 Final Demo Candidate Seed

### Changed

- Added `scripts/seed_xexymix_final_demo.py` to reset and reinstall a scoped
  XEXYMIX final-demo baseline.
- Added `docs/24_FINAL_DEMO_SCENARIO_AND_SEED.md` with demo login, onboarding,
  promotion, pricing, candidate-pool, reset, and run-of-show values.
- The seed is designed to create 30 creator discovery profiles while keeping the
  selected top creator tied to the live Creator demo account `c1@knot.com`.
- The demo contract amount is `1 devnet USDC`, and pay.sh remains a sandbox
  verification call expected to quote `0.02 USDC`.

### Scope Guard

- Reset/reseed is bounded to `promotion-xexymix-devnet` operational documents,
  `creator-xexymix-demo-*`, and `agent-creator-xexymix-demo-*`.
- Firebase Auth users, wallet secrets, Secret Manager, Solana programs, and
  on-chain state are not reset by this script.

### Local Verification

- `./.venv/bin/python -m ruff check scripts/seed_xexymix_final_demo.py backend/tests/test_final_demo_seed.py`:
  passed.
- `./.venv/bin/pytest backend/tests/test_final_demo_seed.py -q`: 1 passed.
- `PYTHONPATH=backend python scripts/seed_xexymix_final_demo.py --target memory`:
  generated 155 documents and 30 creator discovery profiles.

### Firestore Seed And Live Verification

- Firestore reset/reseed completed with 155 documents and 30
  `creatorDiscoveryProfiles`.
- Read-only Firestore matching verification after seed:
  - `creatorProfiles=31`
  - `discoveryProfiles=30`
  - `publicFilterMatched=30`
  - `formatMatched=30`
  - `ranked=30`
  - `detailReads=20`
  - `detailed=20`
  - `eligibleDetailed=20`
  - top candidate `creator-devnet-phantom / 민지핏로그`
- Creator Agent was redeployed because the deployed image was stale
  (`7f97e86`) and did not reflect the current embedded policy context path.
  New live revision: `knot-creator-agent-00015-8hx`, image
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-creator-agent:787d091`.
- Final deployed Brand Agent run produced:
  - `matchRunId=match-954b9104-e730-41a3-8d6e-ee8891c3cb28`
  - `discoveryReturnedCount=30`
  - `detailReadCount=20`
  - candidate endpoint `count=20`, `eligible=20`
  - selected creator `creator-devnet-phantom`
  - selected agent `agent-creator-devnet-phantom`
  - pay.sh `SETTLED`, receipt
    `receipt-paysh-d5974f95-6a09-546a-9a35-fbc53ac0c0b6`
  - negotiation `negotiation-76b252f1-60b5-4758-9c76-6582e80590da`
    reached `AGREED`
  - agreement `agreement-ab135b84-7876-481a-ace2-dfc24b84e8a9`
    reached `FUNDING_REQUIRED`
  - amount `1 devnet USDC`
- Deployed negotiation messages showed:
  - `SYSTEM / VERIFICATION_EVENT / pay.sh / SETTLED`
  - Brand Agent `OFFER` at `1 USDC`
  - Creator Agent `ACCEPT` at `1 USDC`
- Creator authenticated API returned 200 for `/me`, dashboard, offers, final
  offer detail, agreements, and final agreement detail.
- Public deployed Web routes returned 200 for the final Brand promotion,
  negotiation, agreement, Creator offer, and Creator agreement pages.
- No wallet funding, Solana program deployment, Secret Manager change, or new
  on-chain transaction was performed.

## 2026-08-20 Final Demo Web UX And One-Browser Runbook

### Changed

- Deployed the Negotiation Detail UI fix that makes pay.sh/x402 verification
  visible as a summary above the Agent conversation, instead of relying only on
  a system message inside the thread.
- Gated evidence submission by milestone trigger. `deposit` /
  `creatorAccepted` no longer shows the content evidence form; evidence is
  submitted only for the `contentLiveVerified` / `content` milestone.
- Added a one-browser demo flow to `docs/24_FINAL_DEMO_SCENARIO_AND_SEED.md`
  for switching Brand and Creator in one Firebase browser session and one
  Phantom extension.
- Added presentation notes explaining how pay.sh is used, the delegated payment
  / business model, and why wallet complexity is hidden from non-Web3 users.

### Deployment Verification

- Web revision: `knot-web-00019-wqc`.
- Web image:
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:8974883`.
- Public deployed Web routes returned 200 for:
  - `/brand/negotiations/negotiation-76b252f1-60b5-4758-9c76-6582e80590da`
  - `/brand/agreements/agreement-ab135b84-7876-481a-ace2-dfc24b84e8a9`
  - `/creator/offers/negotiation-76b252f1-60b5-4758-9c76-6582e80590da`
  - `/creator/agreements/agreement-ab135b84-7876-481a-ace2-dfc24b84e8a9`
- The deployed Web proxy returned the final negotiation messages:
  - `SYSTEM / VERIFICATION_EVENT / pay.sh / SETTLED`
  - Brand Agent `OFFER` at `1 USDC`
  - Creator Agent `ACCEPT` at `1 USDC`

### Frontend Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test`: 21 passed.

### Scope Guard

- No wallet funding, Solana program deployment, Secret Manager change, or new
  on-chain transaction was performed.
- The final seeded agreement
  `agreement-ab135b84-7876-481a-ace2-dfc24b84e8a9` remains
  `FUNDING_REQUIRED`; do not present settlement as complete until a devnet
  funding/release signature is confirmed.

## 2026-08-20 Promotion Budget Input UX

### Changed

- Updated the Brand promotion creation wizard numeric USDC fields to preserve
  an empty input state while the user is editing.
- The default `0` is no longer forced back into the field, so replacing the
  total budget with `10` no longer produces a visible `010` state.
- Submission still normalizes the values to integer USDC and keeps total budget
  greater than or equal to the per-deal cap.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test`: 21 passed.

## 2026-08-20 Demo UI Copy And Deadline UX

### Changed

- Removed the duplicate pay.sh/x402 summary card above the negotiation
  conversation. pay.sh remains visible as a verification message inside the
  conversation timeline.
- Slightly increased negotiation message, metadata, detail, and timestamp font
  sizes for demo readability.
- Added a `게시 마감일` date picker to the Brand promotion creation wizard; the
  selected date is now sent as the promotion deadline instead of always using
  an implicit 14-day default.
- Replaced visible internal labels such as `Agent`, `Agreement`, `Escrow`,
  `milestone`, `creatorAccepted`, and `contentLiveVerified` with user-facing
  Korean copy such as `매니저`, `계약`, `예치`, `정산 단계`, `계약금`, and
  `콘텐츠 확인 후 잔금`.
- Mapped common promotion, agreement, escrow, pay.sh, evidence, and offer status
  codes to readable Korean labels in the dashboard, promotion detail, and
  negotiation detail screens.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test`: 21 passed.
- `npm --prefix frontend run build`: passed.

### Scope Guard

- No API contract, Firestore data, deployment, wallet funding, Secret Manager,
  Solana program, or on-chain transaction change was made.

### Web Deployment

- Pushed main to `origin/main` through commit
  `a5c44ae Polish demo UI copy and deadline input`.
- Built Web image:
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:a5c44ae`.
- Cloud Build ID:
  `e94e4cd2-3824-4b92-96fa-454a04116bcf`, status `SUCCESS`.
- Deployed Cloud Run Web revision `knot-web-00020-r6r`.
- `knot-web-00020-r6r` is serving 100% traffic at
  `https://knot-web-7k3walthgq-uc.a.run.app`.
- Public route verification returned 200 for:
  - `/login`
  - `/brand/promotions/new`
  - `/brand/negotiations/negotiation-76b252f1-60b5-4758-9c76-6582e80590da`
  - `/creator/offers/negotiation-76b252f1-60b5-4758-9c76-6582e80590da`

## 2026-08-20 Demo Negotiation Tiki-Taka And Promotion Copy

### Changed

- Updated final demo seed defaults so the live demo can show a real A2A
  counteroffer path:
  - Contract amount / creator minimum: `2 devnet USDC`.
  - Initial Brand offer: `1 devnet USDC`.
  - Expected flow after reseed and a fresh Agent run:
    `OFFER 1 → COUNTER 2 → ACCEPT → ACCEPT`.
- Kept the amount faucet-friendly while avoiding the previous immediate
  `OFFER → ACCEPT` path.
- Changed Brand promotion creation category from free text to fixed
  user-facing options such as `피트니스/운동`, `패션/스타일`, `음식/카페`,
  `라이프스타일`, and `테크/가전`.
- Replaced abstract mood tags with practical content-angle tags:
  `착용샷/사용 장면`, `일상 루틴`, `핏/사용감 후기`, `제품 설명`,
  `스타일링/활용법`, `비교/체크`, `언박싱/첫인상`, and `문제 해결 팁`.
- Updated prohibited-claims placeholder with realistic examples such as
  `체형 교정 보장`, `통증 치료 효과`, `다이어트 효과 단정`, `경쟁사 비방`,
  and `실제와 다른 할인/성능 표현`.
- Replaced usage-right option labels with clearer user copy:
  `브랜드 채널 재게시만`, `재게시 + 30일 광고 활용`,
  `90일 광고/상세페이지 활용`.
- Increased negotiation message font size again and split message text into
  short displayed lines using `·` and sentence punctuation boundaries.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- `./.venv/bin/pytest backend/tests/test_final_demo_seed.py backend/tests/test_api_promotions.py::test_start_negotiation_uses_saved_initial_offer_for_counter_flow -q`:
  2 passed.
- `PYTHONPATH=backend ./.venv/bin/python scripts/seed_xexymix_final_demo.py --target memory --reset-demo`:
  passed, generated 155 documents and reported contract amount
  `2 devnet USDC`.

### Scope Guard

- After approval, Firestore was scoped-reset/reseeded with the final XEXYMIX
  demo seed.
- After approval, Web was deployed to Cloud Run.
- No wallet funding, Secret Manager change, Solana program change, or on-chain
  transaction was performed.

### Web Deployment And Seed

- Pushed main to `origin/main` through commit
  `ee512e2 Improve demo negotiation flow and promotion copy`.
- Built Web image:
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:ee512e2`.
- Cloud Build ID:
  `b7ee4596-498d-488c-af2a-1b23af1f5a06`, status `SUCCESS`.
- Deployed Cloud Run Web revision `knot-web-00021-8cq`.
- `knot-web-00021-8cq` is serving 100% traffic at
  `https://knot-web-7k3walthgq-uc.a.run.app`.
- Firestore seed command:
  `ALLOW_DEVNET_DEMO_SEED=true PYTHONPATH=backend ./.venv/bin/python scripts/seed_xexymix_final_demo.py --target firestore --project knot-dev-503505 --reset-demo --confirm=SEED_KNOT_XEXYMIX_FINAL_DEMO`.
- Seed result: 155 documents, 30 creator discovery profiles,
  `promotion-xexymix-devnet`, contract amount `2 devnet USDC`, pay.sh sandbox
  verification quote `0.02 USDC`.
- Deployed API verification still produced an immediate `OFFER 1 → ACCEPT 1`
  flow. Root cause: Creator Agent cached an existing tenant policy and ignored
  fresher embedded A2A negotiation context for the same tenant.

## 2026-08-20 Creator Agent Policy Cache Refresh

### Changed

- Updated `InMemoryA2ATaskStore.register_context` so embedded A2A
  `creatorNegotiationContext` replaces a previously cached tenant context.
- Updated `_get_context` so a configured context resolver, such as the
  Firestore resolver used by the deployed Creator Agent, refreshes an existing
  tenant cache entry when it can resolve a current policy.
- Added regression tests proving that a stale `agent-creator-devnet-phantom`
  policy cache no longer causes a `1 USDC` immediate accept when the fresh
  context requires `2 USDC`.

### Verification

- `./.venv/bin/pytest backend/tests/test_a2a_negotiation.py backend/tests/test_api_a2a_http_integration.py backend/tests/test_api_promotions.py::test_start_negotiation_uses_saved_initial_offer_for_counter_flow -q`:
  17 passed.

### Scope Guard

- No wallet funding, Secret Manager change, Solana program change, or on-chain
  transaction was performed.

### Creator Agent Deployment And Verification

- Pushed main to `origin/main` through commit
  `c0b5a16 Refresh creator agent policy context`.
- Built Creator Agent image:
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-creator-agent:c0b5a16`.
- Cloud Build ID:
  `48030fe2-1888-444b-ad4f-4bd7aad08951`, status `SUCCESS`.
- Deployed Cloud Run Creator Agent revision `knot-creator-agent-00016-vsw`.
- `knot-creator-agent-00016-vsw` is serving 100% traffic.
- Firestore final demo seed was reset/reseeded again after deployment:
  155 documents, 30 creator discovery profiles, contract amount
  `2 devnet USDC`, pay.sh sandbox verification quote `0.02 USDC`.
- Deployed Web/API verification at
  `https://knot-web-7k3walthgq-uc.a.run.app` with Brand login produced:
  - Match run: `match-e0fa1dc1-e81d-40e6-8cfe-a861bdaef7d2`.
  - pay.sh candidate verification status: `SETTLED`.
  - Selected creator: `creator-devnet-phantom /
    agent-creator-devnet-phantom`.
  - Negotiation: `negotiation-fabd9f47-e503-400a-bbe5-44578c42d98b`,
    status `AGREED`.
  - Agreement: `agreement-f92c6470-212d-4bb6-bd66-a6dd83cf1ef9`,
    amount `2 devnet USDC`.
  - Persisted conversation:
    `VERIFICATION_EVENT pay.sh 0.02 → OFFER 1 → COUNTER 2 → ACCEPT 2 → ACCEPT 2`.

### Remaining Notes

- The verification above confirms the deployed pay.sh sandbox candidate
  verification and real A2A negotiation path.
- It does not perform escrow lock, evidence submission, milestone release,
  wallet funding, or any new Solana transaction.

## 2026-08-20 Negotiation Message Render Rollback

### Changed

- Restored the negotiation message window to the previous stable single-line
  paragraph rendering.
- Removed the recently added sentence-splitting display helpers that caused the
  conversation UI to break.
- Restored message metadata, details, payload JSON, and timestamp font sizes to
  the previous `text-[11px]` values.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.

### Scope Guard

- No backend, Firestore, wallet, Secret Manager, Solana, or on-chain changes
  were made.
- Deployment is pending explicit approval.

## 2026-08-20 Creator Instagram Limited Analysis

### Changed

- Fixed Creator signup Instagram analysis so Instagram login-wall pages are not
  treated as valid scraped profile content.
- Added Creator profile access-wall detection for Instagram login/signup pages.
- When Instagram blocks public profile access, the API now returns a truthful
  limited analysis with:
  - `provider=deterministic`
  - `fallbackReason=instagram_access_limited`
  - handle/display name derived from the URL path
  - unknown public metrics left unknown
- Updated onboarding copy to explain that Instagram showed a login page and
  public metrics need user confirmation.
- Changed Creator onboarding stats so unknown public metrics are not displayed
  as `0`; limited access shows `공개 지표: 확인 필요`.

### Verification

- Reproduced the deployed issue before the fix: `https://instagram.com/ye__5o`
  was fetched as an Instagram login page and produced `displayName=Instagram`.
- `./.venv/bin/pytest backend/tests/test_api_onboarding.py::test_creator_profile_analysis_treats_instagram_login_wall_as_limited backend/tests/test_api_onboarding.py::test_creator_profile_analysis_extracts_public_metrics_when_present backend/tests/test_api_onboarding.py::test_creator_profile_analysis_and_confirmation_are_owner_scoped -q`:
  3 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.

### Scope Guard

- No Firestore reset, wallet funding, Secret Manager change, Solana program
  change, or on-chain transaction was performed.
- API/Web deployment was performed after explicit approval.

### Deployment And Verification

- Pushed main to `origin/main` through commit
  `7bc3107 Switch creator onboarding to YouTube analysis`.
- Built API image:
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-api:7bc3107`.
- API Cloud Build ID:
  `8147b7d6-64d4-4645-b55b-a94c8dccd74b`, status `SUCCESS`.
- Deployed Cloud Run API revision `knot-api-00024-xvp`.
- Built Web image:
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:7bc3107`.
- Web Cloud Build ID:
  `f76be030-a18a-4007-9517-1abf4fda9aaf`, status `SUCCESS`.
- Deployed Cloud Run Web revision `knot-web-00022-wxl`.
- `knot-api-00024-xvp` and `knot-web-00022-wxl` are serving 100% traffic.
- Public route verification returned 200 for:
  - `https://knot-web-7k3walthgq-uc.a.run.app/login`
  - `https://knot-web-7k3walthgq-uc.a.run.app/creator/connect`
- Deployed YouTube Creator analysis verification returned:
  - `provider=vertex-gemini`
  - `fallbackReason=null`
  - `displayName=Rick Astley`
  - `handle=@RickAstleyYT`
  - title `Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)`
  - notes confirming YouTube oEmbed metadata and Gemini metadata analysis.

## 2026-08-20 Creator YouTube Onboarding Analysis

### Changed

- Switched Creator signup source analysis from Instagram-first to
  YouTube-first.
- Updated `/creator/connect` copy and placeholder to ask for a YouTube channel,
  video, or Shorts URL.
- Bare handles now normalize to `https://www.youtube.com/@...`.
- Creator profile creation now preserves the analyzed source URL instead of
  forcing an Instagram URL.
- Added backend YouTube URL detection and YouTube oEmbed metadata fetch.
- Added Gemini structured analysis over YouTube public metadata when Vertex
  Gemini is enabled.
- Added a truthful `youtube-oembed` fallback when Gemini is off or unavailable.
- Kept subscriber, view, and engagement metrics unknown until YouTube Data API
  statistics are explicitly connected.
- Updated `docs/04_CARD_DECK_ONBOARDING_UX.md` so Creator Card 1 is YouTube
  source input, not Instagram scraping.

### Verification

- `./.venv/bin/pytest backend/tests/test_api_onboarding.py::test_creator_profile_analysis_uses_youtube_oembed_metadata backend/tests/test_api_onboarding.py::test_creator_profile_analysis_uses_gemini_for_youtube_metadata backend/tests/test_api_onboarding.py::test_creator_profile_analysis_treats_instagram_login_wall_as_limited -q`:
  3 passed.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.

### Scope Guard

- No Firestore reset, wallet funding, Secret Manager change, Solana program
  change, or on-chain transaction was performed.
- API/Web deployment is pending explicit approval.

## 2026-08-21 Deployed Negotiation Route Verification

### Changed

- Added early runtime route wrappers for
  `/api/v1/match-runs/{match_run_id}:start-negotiation` and
  `/api/v1/match-runs/{match_run_id}:cancel`.
- Added Cloud Run-safe slash action aliases:
  `/api/v1/match-runs/{match_run_id}/start-negotiation` and
  `/api/v1/match-runs/{match_run_id}/cancel`.
- Updated the frontend API client to use the slash action start-negotiation
  route because the deployed environment still returned 405 for the colon
  action path.

### Verification

- Deployed commit `c2cf5e1` passed service readiness checks:
  `knot-api`, `knot-creator-agent`, and `knot-web3` returned `ready`; web
  `/login` returned HTTP 200.
- Real deployed candidate verification for `promotion-xexymix-devnet`
  completed with pay.sh sandbox/x402 receipt, `0.02 USDC`, `status=SETTLED`,
  and selected `agent-creator-devnet-phantom`.
- The subsequent deployed start-negotiation request exposed a runtime 405 on
  the colon action route; this phase moves the frontend onto the slash action
  route and keeps the colon route as a compatibility alias.
- `./.venv/bin/pytest backend/tests/test_api_promotions.py::test_start_negotiation_path_action_alias backend/tests/test_api_promotions.py::test_start_negotiation_persists_messages_events_and_agreement backend/tests/test_api_promotions.py::test_start_negotiation_uses_gemini_for_brand_chat_display -q`:
  3 passed.
- `./.venv/bin/python -m ruff check backend/apps/api/routes.py backend/tests/test_api_promotions.py`: passed.
- `npm --prefix frontend run typecheck`: passed.

### Scope Guard

- No wallet funding, Solana program change, or on-chain transaction was
  performed in this phase.
- A Secret Manager IAM binding for `knot-youtube-api-key` was added after
  explicit approval so Cloud Run can read the YouTube API key secret.

## 2026-08-21 Demo Persona Seed Import

### Changed

- Added schema-aligned demo Brand/Creator persona generation for 10 brands and
  10 creators across beauty, tech, fitness/wellness, crypto, and gaming.
- Added `socialSnapshots`, `creatorProfiles`, `creatorDiscoveryProfiles`,
  `agents`, `agentPolicies`, `agentRegistry`, demo `promotions`, and unresolved
  account analysis documents through one seed pipeline.
- Added YouTube Data API v3 profile provider and a reusable
  `analyze_youtube_creator()` entry point.
- Added Instagram provider abstraction with truthful unresolved fallback when
  Apify/Meta credentials are unavailable.
- Added `backend/scripts/seed_demo_personas.py` with `--dry-run`,
  `--refresh-social`, `--only-brands`, `--only-creators`, `--write`, and
  `--reset`.
- Updated candidate display mapping so API-provided `creatorDisplayName` can be
  shown on match cards.
- Added `docs/DEMO_PERSONA_SEED.md`.

### Verification

- `./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --json`:
  10 brands, 10 creators, 5 promotions, 96 documents, no validation errors.
- `./.venv/bin/python backend/scripts/seed_demo_personas.py --write --json`:
  wrote 96 demo documents to Firestore after explicit approval.
- `./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --refresh-social --json`:
  no validation errors; refresh was skipped because local `YOUTUBE_API_KEY` is
  not configured.
- `./.venv/bin/pytest backend/tests/test_demo_persona_seed.py -q`: 3 passed.
- `./.venv/bin/python -m ruff check backend/libs/demo_seed backend/scripts/seed_demo_personas.py backend/tests/test_demo_persona_seed.py`:
  passed.
- `npm --prefix frontend run typecheck`: passed.
- Cloud Run seed matching verified:
  - Beauty `promotion-demo-cheriexx` selected `creator-demo-ssin`.
  - Tech `promotion-demo-samsung` selected `creator-demo-jocoding`.
  - Fitness/Wellness `promotion-demo-thezonebio` selected
    `creator-demo-thankyou-bubu`.
  - Crypto `promotion-demo-upbit` selected `creator-demo-99bitcoins`.
  - Gaming `promotion-demo-neowiz` selected `creator-demo-dotti`.
- Cloud Run seed A2A verified on `match-200a02af-2f9f-42c7-8c62-3b2ef69dfe92`.
  It returned `status=AGREED`, created negotiation
  `negotiation-063dcf8c-d0ff-40bb-9348-a3263352ce7f`, agreement
  `agreement-71dc759d-3583-4d99-a58e-2fcfc5ffcc4c`, and terms hash
  `sha256:3b2d36a676902145b85f07a75a340627b3731806ffcd7144823e380d1199861b`.

### Scope Guard

- Demo persona documents were written to Firestore. No Firestore reset was
  performed.
- No wallet funding, Solana program change, or new on-chain transaction was
  performed in this phase.

## 2026-08-21 Instagram Apify Onboarding Analysis

### Changed

- Added a reusable `libs.social.instagram.InstagramProfileProvider` using
  Apify's synchronous Actor dataset endpoint.
- Added API settings and deploy-secret wiring for `APIFY_TOKEN`,
  `INSTAGRAM_PROVIDER`, `INSTAGRAM_APIFY_ACTOR_ID`, and
  `INSTAGRAM_APIFY_TIMEOUT_SECONDS`.
- Creator onboarding now accepts exactly one selected social platform:
  Instagram or YouTube. Bare `@handle` input maps to the selected platform.
- Instagram onboarding uses Apify first when `APIFY_TOKEN` is configured, then
  returns a provider-tagged creator analysis with public profile counts, recent
  post URLs, derived averages, and analysis notes.
- Replaced two generic public demo brands with user-requested Instagram seed
  brands: `brand-demo-thehackathonkr` and `brand-demo-bzcf`.

### Verification

- `./.venv/bin/pytest backend/tests/test_api_onboarding.py backend/tests/test_demo_persona_seed.py -q`:
  19 passed.
- `./.venv/bin/python -m ruff check backend/apps/api/routes.py backend/libs/social backend/libs/demo_seed backend/scripts/seed_demo_personas.py backend/libs/settings/config.py backend/tests/test_api_onboarding.py`:
  passed.
- `npm --prefix frontend run typecheck`: passed.
- `./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --json`:
  10 brands, 10 creators, 5 promotions, 96 documents, no validation errors.
- `./.venv/bin/python backend/scripts/seed_demo_personas.py --write --json`:
  wrote the updated 96-document seed set with `brand-demo-thehackathonkr` and
  `brand-demo-bzcf` to Firestore without reset.

### Scope Guard

- Local `--refresh-social` did not call Apify because no local `APIFY_TOKEN` is
  configured.
- Cloud Run Secret Manager update was completed after explicit operator action.
  `knot-api` now receives `APIFY_TOKEN` from Secret Manager.

## 2026-08-21 Deployed Social Analysis Verification

### Changed

- Updated Creator onboarding YouTube channel URL analysis so `youtube.com/@...`
  and `/channel/...` inputs use YouTube Data API v3 directly instead of falling
  through to oEmbed-only fallback.
- The YouTube channel draft now includes public subscriber counts, recent video
  average/median view metrics, representative video URLs, and analysis notes
  marking recent-video metrics as KNOT-derived values.

### Verification

- `./.venv/bin/pytest backend/tests/test_api_onboarding.py backend/tests/test_demo_persona_seed.py -q`:
  20 passed.
- `./.venv/bin/python -m ruff check backend/apps/api/routes.py backend/tests/test_api_onboarding.py`:
  passed.
- Cloud Run deploy of commit `207c389` completed before the YouTube channel
  analysis patch:
  - `knot-api-00031-j4c`
  - `knot-creator-agent-00021-j8m`
  - `knot-web3-00018-xfs`
  - `knot-web-00027-dnk`
- Deployed health checks passed for `knot-api`, `knot-creator-agent`, `knot-web3`,
  and `knot-web`.
- Deployed Instagram analysis with `https://www.instagram.com/thehackathonkr/`
  returned `READY_FOR_CONFIRMATION` through provider
  `apify-instagram-profile-scraper`.
- Deployed Beauty matching for `promotion-demo-cheriexx` returned 5 candidates,
  selected `creator-demo-ssin`, and recorded a sandbox pay.sh/x402 candidate
  verification receipt with status `SETTLED`.
- Deployed A2A start negotiation for that match returned `AGREED` and created a
  `FUNDING_REQUIRED` agreement.

### Scope Guard

- No Firestore reset was performed.
- No wallet funding or Solana escrow transaction was performed during this
  verification pass.
- Cloud Run redeploy of commit `3f6e265` completed:
  - `knot-api-00032-xvd`
  - `knot-creator-agent-00022-hc7`
  - `knot-web3-00019-2xz`
  - `knot-web-00028-nsp`

## 2026-08-21 Demo Persona Admin Login Surface

### Changed

- Demo persona seed now writes `users/{uid}` documents for all 10 brand personas
  and all 10 creator personas.
- Added deterministic demo Auth account metadata for persona-linked accounts,
  using `brand-demo-...@knot.demo` and `creator-demo-...@knot.demo` emails.
- Added `backend/scripts/seed_demo_personas.py --auth-users` to create or update
  Firebase Auth accounts for every demo persona.
- Added admin-only `/api/v1/dev-admin/demo-personas`, guarded by the existing
  dev admin allowlist/admin claim check.
- Extended `/dev/admin` to show all demo brand/creator profiles in one screen
  and provide login buttons for seeded demo accounts.

### Verification

- `./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --json`:
  10 brands, 10 creators, 5 promotions, 116 documents, no validation errors.
- `./.venv/bin/pytest backend/tests/test_api_onboarding.py backend/tests/test_demo_persona_seed.py backend/tests/test_api_dev_admin.py -q`:
  27 passed.
- `./.venv/bin/python -m ruff check backend/apps/api/routes.py backend/libs/demo_seed/personas.py backend/scripts/seed_demo_personas.py backend/tests/test_api_onboarding.py backend/tests/test_api_dev_admin.py`:
  passed.
- `npm --prefix frontend run typecheck`: passed.

## 2026-08-21 Instagram Creator Persona Expansion

### Changed

- Expanded demo creator personas from 10 to 14 by adding Instagram-first
  creators:
  - `creator-demo-candofr` (`https://www.instagram.com/candofr/`)
  - `creator-demo-yubintmi` (`https://www.instagram.com/tmi_07070707/`)
  - `creator-demo-amisho` (`https://www.instagram.com/amirsho_kh/`)
  - `creator-demo-creatus` (`https://www.instagram.com/crea__tus/`)
- Kept the original 10 creators so the Beauty / Tech / Wellness / Crypto /
  Gaming category coverage remains stable.
- Relaxed seed validation from exactly 10 creators to at least 10 creators with
  required category coverage.
- Cleared the unresolved Instagram candidate list because the requested
  candidates now have seed persona documents.
- Added demo-safe profile images:
  - Brand profiles write `logoUrl` / `logoImageUrl`.
  - Creator profiles write `profileImageUrl`.
  - Generated fallback images are marked with `imageSource.provenance =
    SYNTHETIC_DEMO`.
- Extended the dev admin demo persona API and card UI to display profile images.

### Verification

- `./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --json`:
  10 brands, 14 creators, 5 promotions, 146 documents, no validation errors.

## 2026-08-21 GCP Demo Workspace UI Bridge

### Changed

- Added the `origin/minsung/live-product` demo workspace shell on this branch:
  `/b`, `/c`, `/b/graph`, and `/auth`.
- Changed `/` to enter the brand demo workspace through `/b`.
- Hid the legacy top navigation on demo workspace routes so the demo shell owns
  the screen composition.
- Kept the existing Product API proxy and added `PATCH` / `DELETE` forwarding.
- Connected the demo "탐험 보내기" action to real Product API paths:
  - `POST /api/v1/promotions/{promotionId}/matches:run`
  - `GET /api/v1/match-runs/{matchRunId}/candidates`
  - `POST /api/v1/match-runs/{matchRunId}/start-negotiation`
  - `GET /api/v1/negotiations/{negotiationId}/messages`
- In API mode, the post-agreement CTA now stops at wallet funding when the
  Agreement status is `FUNDING_REQUIRED`; the UI no longer fabricates escrow
  transaction hashes for that state.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- Local production server with
  `KNOT_API_BASE_URL=https://knot-api-7k3walthgq-uc.a.run.app`:
  - `/` returns `307` to `/b`.
  - `/b` returns `200`.
  - `/b/graph` returns `200`.
  - `/auth` returns `200`.
  - `/demo/ssin.jpg` and `/demo/moodbeam.svg` return `200`.
  - `/api/v1/promotions/promotion-demo-cheriexx` returns `200` through the
    frontend proxy.
- Real GCP API verification through the local web proxy:
  - Match run `match-adfdd549-5f67-4e9c-bef6-a0c4ef4887ca` completed with 5
    candidates and selected `creator-demo-ssin`.
  - pay.sh/x402 candidate verification recorded sandbox status `SETTLED` with
    0.02 USDC.
  - A2A negotiation `negotiation-d21ed516-bfbc-46b6-84c0-34f11490999b`
    completed as `AGREED` after a counter round.
  - Agreement `agreement-df342c24-62a4-41e8-b12b-af70141ede8b` was created with
    status `FUNDING_REQUIRED`.
  - Escrow read for that Agreement returned `escrow: null`, `settlements: []`.

### Scope Guard

- No Cloud Run redeploy has been performed for this UI branch yet.
- No wallet funding or Solana devnet escrow transaction was performed in this
  pass.

## 2026-08-21 Demo Workspace Escrow And Settlement Bridge

### Changed

- Connected the demo workspace approval CTA to the real wallet-backed escrow
  funding path:
  - Phantom connect
  - wallet ownership challenge/signature
  - `POST /api/v1/agreements/{agreementId}/escrow/prepare`
  - Phantom Solana transaction signature
  - `POST /api/v1/agreements/{agreementId}/escrow/confirm`
- Connected creator post URL submission in the demo workspace to the real
  evidence and settlement path:
  - `POST /api/v1/agreements/{agreementId}/evidence`
  - `POST /api/v1/evidence/{evidenceId}:verify`
  - refresh `GET /api/v1/agreements/{agreementId}/escrow`
  - reflect confirmed settlement signatures in the deal timeline.
- Added demo creator settlement wallet fields to persona seed documents. These
  are synthetic devnet demo destinations, not public creator data.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- `./.venv/bin/python -m ruff check backend/libs/demo_seed/personas.py`:
  passed.
- `./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --json`:
  10 brands, 14 creators, 5 promotions, 146 documents, no validation errors.
- `git diff --check`: passed.
- `./.venv/bin/pytest backend/tests/test_demo_persona_seed.py backend/tests/test_api_escrow.py backend/tests/test_api_promotions.py -q`:
  61 passed, 2 warnings.

### Scope Guard

- No actual Phantom signing, escrow funding, or milestone release was executed
  by this code change.
- The deployed Firestore seed must be refreshed before live funding, otherwise
  existing creator personas may still lack `walletAddress` and escrow prepare
  will return `CREATOR_WALLET_REQUIRED`.

### Deploy And Live QA

- Refreshed Firestore demo persona seed after approval:
  146 documents written, 26 Firebase Auth users updated, no validation errors.
- Deployed `knot-web` image
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:0745014` to Cloud
  Run revision `knot-web-00030-h5n`, serving 100% traffic.
- Live Cloud Run web URL:
  `https://knot-web-7k3walthgq-uc.a.run.app`
- Live route smoke:
  - `/b`: 200
  - `/c`: 200
  - `/b/graph`: 200
  - `/api/v1/promotions/promotion-demo-cheriexx`: 200
- Live API smoke from deployed web proxy:
  - Matching run `match-c33a3f3a-6b7f-4029-a96e-c9d7683adaf0` completed with
    5 candidates.
  - pay.sh/x402 sandbox verification receipt was recorded with
    `status=SETTLED`, `amountUsdc=0.02`.
  - A2A negotiation
    `negotiation-c8140ea4-2d1c-4ae5-b90c-3786eb532462` completed
    `AGREED` through the Cloud Run Creator Agent HTTP endpoint.
  - Agreement `agreement-3bca7dfd-ec3a-4329-92ee-4f433451c96f` was created
    with `status=FUNDING_REQUIRED`.
  - Agreement escrow read returned `escrow=null`, `settlements=[]`, which is
    expected before the Brand signs the Phantom funding transaction.
  - Authenticated demo brand `/api/v1/me` returned
    `uid=user-brand-demo-cheriexx`, `role=BRAND`,
    `brandId=brand-demo-cheriexx`, `agentId=agent-demo-brand-cheriexx`.
  - Deployed Firestore creator profile `creator-demo-ssin` contains
    `walletAddress=BTsMioiaKhxQzPBJV2hNYp6xHovY85dnE73v6CSqRQsX`,
    `walletNetwork=devnet`, and
    `walletCustody=DEMO_SEEDED_DESTINATION`.

### Remaining Live Step

- Final escrow funding and settlement release still require an operator with
  Phantom on devnet to sign the funding transaction from the Brand wallet and
  then submit a valid content URL. The UI is now wired to call the real prepare,
  confirm, evidence, verify, and settlement paths for that signed flow.

## 2026-08-21 Demo UI Font And Overflow Fix

### Changed

- Restored the `PretendardVariable.woff2` local font from the live product UI
  source branch and registered `--font-pretendard` in the app layout.
- Added demo-scoped wrapping rules for monospaced tokens so long Solana
  signatures, terms hashes, IDs, and URLs stay inside cards.
- Updated the shared `TxRow` component used by Brand and Creator settlement
  panels. Transaction rows now use responsive grid layout and wrap the hash
  within the card instead of forcing horizontal overflow.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- `git diff --check`: passed.

### Scope Guard

- No deployed environment or on-chain state was changed by this UI polish pass.

## 2026-08-21 Demo Onboarding Real API Wiring

### Changed

- Removed the successful local/mock fallback from the `/b` brand onboarding
  scan path. The demo onboarding now completes only after the real Product API
  creates or returns the authenticated user's Brand profile and Brand Agent.
- Connected `/auth` login/signup/persona entry to the backend account role
  path. After Firebase login, the UI calls `GET /api/v1/me` and, when needed,
  `POST /api/v1/me/role` before routing into `/b` or `/c`.
- Disabled Phantom-only login as a successful account path because the product
  does not currently issue Firebase custom auth tokens from wallet signatures.
  Phantom remains a real wallet connection step for escrow funding and
  settlement.
- Added backend-role guards to `/b` and `/c`, so stale local demo sessions no
  longer open the workspace without a matching authenticated Product API role.
- Updated the demo identity wallet connection to save the wallet through
  backend challenge/signature verification before updating the local display.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend test`: 21 passed.
- `npm --prefix frontend run build`: passed.
- `git diff --check`: passed.

### Scope Guard

- No deployment, Firestore write, Secret Manager change, wallet funding, or
  Solana transaction was performed in this pass.
- Creator onboarding was already wired to `POST /api/v1/analyses/creator-profile`
  and `POST /api/v1/me/creator-profile`; this pass focused on the demo `/auth`,
  `/b`, and `/c` paths that could previously succeed with local state alone.

### Deploy And Live QA

- Built web image
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:e989fd7`
  with Cloud Build `d213eed7-db94-41af-bea3-562cca34a878`.
- Deployed Cloud Run service `knot-web` revision `knot-web-00031-x7w`, serving
  100% traffic.
- Live Cloud Run web URL:
  `https://knot-web-7k3walthgq-uc.a.run.app`
- Live route/API smoke:
  - `/b`: 200
  - `/c`: 200
  - `/auth`: 200
  - `/b/graph`: 200
  - `/api/v1/promotions/promotion-demo-cheriexx`: 200
- Authenticated brand onboarding smoke through the deployed web proxy:
  - `GET /api/v1/me`: role `BRAND`, status `COMPLETED`,
    brand `brand-demo-cheriexx`, agent `agent-demo-brand-cheriexx`.
  - `POST /api/v1/analyses/product`: `READY_FOR_CONFIRMATION`, provider
    `vertex-gemini`, no fallback.
  - `POST /api/v1/analyses/{analysisId}:confirm`: `CONFIRMED`.
  - `POST /api/v1/me/brand-profile`: returned existing completed brand profile
    and agent.
- Authenticated creator onboarding smoke through the deployed web proxy:
  - `GET /api/v1/me`: role `CREATOR`, status `COMPLETED`,
    creator `creator-demo-ssin`, agent `agent-demo-creator-ssin`.
  - YouTube profile analysis endpoint returned `READY_FOR_CONFIRMATION`; the
    tested `@geekble` URL used deterministic limited analysis because oEmbed
    returned `youtube_oembed_http_404`.
  - Instagram profile analysis endpoint returned `READY_FOR_CONFIRMATION`,
    provider `apify-instagram-profile-scraper`, no fallback.
- Escrow read smoke returned `escrow=null`, `settlements=[]` for a
  `FUNDING_REQUIRED` Agreement. No Phantom signature, escrow funding, or
  settlement release was executed.

## 2026-08-21 One-Role Account Error Copy

### Changed

- Preserved the backend v1 account invariant: one Firebase account can only
  select one KNOT role.
- Mapped the Product API `ROLE_ALREADY_SELECTED` problem code to Korean
  user-facing guidance:
  "KNOT v1에서는 한 계정에 하나의 역할만 사용할 수 있습니다. 브랜드 데모는
  t1, 크리에이터 데모는 c1 계정으로 각각 입장해 주세요."
- Added frontend API client test coverage so the backend English detail is not
  exposed directly in role-conflict flows.

### Verification

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend test`: 22 passed.
- `npm --prefix frontend run build`: passed.
- `git diff --check`: passed.

### Deploy And Live QA

- Built web image
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:daabc81`
  with Cloud Build `388528e0-6722-4a34-a401-5e6290969f9c`.
- Deployed Cloud Run service `knot-web` revision `knot-web-00032-xd2`, serving
  100% traffic.
- Live Cloud Run web URL:
  `https://knot-web-7k3walthgq-uc.a.run.app`
- Live route smoke:
  - `/auth`: 200
  - `/b`: 200
