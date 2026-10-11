# 2026-08-21 GCP Live Product Web

## Goal

Use the `origin/minsung/live-product` demo workspace composition as the GCP
demo UI, while preserving the stable `main` backend/API/A2A/Agreement/Escrow
services. The demo UI must call real Product API paths for Discovery,
Matching, A2A negotiation, and Agreement state; it must not fabricate successful
escrow or settlement state.

## Branch

`gcp-live-product-web`

## Constraints

- Do not change `main` directly.
- Do not replace the backend data model or API contracts.
- Keep browser business writes behind the Product API.
- Do not claim escrow success unless the deployed API returns an escrow with a
  confirmed devnet signature.
- Do not execute new wallet funding, escrow lock, milestone release, or other
  on-chain transactions without explicit approval.

## Current Findings

- Vercel `https://thezonebio.com/knot` serves pages, but
  `/knot/api/v1/...` returns 500.
- Direct Cloud Run API is healthy:
  `https://knot-api-7k3walthgq-uc.a.run.app/readyz`.
- Existing Cloud Run web has a working `/api/v1` proxy to Cloud Run API.
- Existing Cloud Run web image is `knot-web:49c90e1`, behind local `main`.
- `origin/minsung/live-product` contains the desired demo workspace shell:
  home, campaign, deals, performance, brand, agent chat, graph view.
- The demo shell originally had deterministic post-approval escrow animation;
  in API mode this must stop at `FUNDING_REQUIRED` unless a real wallet-signed
  devnet escrow exists.

## Plan

1. [x] Bring the demo workspace routes/components into this branch.
2. [x] Keep the existing `/api/v1` proxy and connect the demo run action to real
   Product API endpoints.
3. [x] Make `/` enter the demo workspace and keep `/b`, `/c`, `/b/graph`, `/auth`
   available.
4. [x] Connect demo approval/post-submission actions to the real escrow funding,
   evidence verification, and settlement APIs. The UI must still require
   Phantom signatures and must not fabricate successful Solana transactions.
5. [x] Add demo creator settlement wallet fields to the persona seed output so
   refreshed dev/prod demo data can pass escrow prepare.
6. [x] Verify local typecheck, tests, and production build.
7. [x] Refresh deployed Firestore demo seed after explicit approval.
8. [x] Deploy only `knot-web` after explicit approval, with API mode and existing
   Cloud Run API URL.
9. [x] QA the deployed Cloud Run web URL:
   - page routes
   - `/api/v1` proxy
   - demo promotion read
   - negotiation/agreement read
   - escrow read state
10. [x] Update `docs/IMPLEMENTATION_STATUS.md` with implementation result.

## 2026-08-21 UI Polish Follow-Up

1. [x] Restore the live demo Pretendard font variable used by the
   `origin/minsung/live-product` `/b` screen.
2. [x] Prevent long Solana signatures, terms hashes, and URLs from overflowing
   demo cards.
3. [x] Fix transaction rows in Brand and Creator settlement panels so the label
   and hash wrap inside the card instead of pushing the template width.
4. [x] Re-run frontend typecheck, tests, production build, and whitespace check.
5. [x] Deploy the UI polish build after explicit approval.

## 2026-08-21 Real Onboarding API Follow-Up

1. [x] Audit the demo auth and onboarding path for successful local/mock
   fallbacks.
2. [x] Connect `/auth` success paths to the real Product API account and role
   endpoints:
   - `GET /api/v1/me`
   - `POST /api/v1/me/role`
3. [x] Remove Phantom-only login as a successful local session path. Phantom is
   now presented as an escrow/settlement wallet connection step after account
   login.
4. [x] Require `/b` and `/c` to have both a local demo session and an
   authenticated backend role before rendering the demo workspace.
5. [x] Replace `/b` onboarding scan fallback with the real Product API profile
   path:
   - `POST /api/v1/analyses/product`
   - `POST /api/v1/analyses/{analysisId}:confirm`
   - `POST /api/v1/me/brand-profile`
6. [x] Make scan failures visible in the onboarding UI instead of silently
   completing with deterministic demo data.
7. [x] Register wallet connections from the demo identity block through
   backend wallet challenge/signature verification before updating the local
   session display.
8. [x] Re-run frontend typecheck, tests, production build, and whitespace check.
9. [x] Deploy the real onboarding build after explicit approval.

### Deployment Result

- Built web image
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:e989fd7`
  with Cloud Build `d213eed7-db94-41af-bea3-562cca34a878`.
- Deployed Cloud Run service `knot-web` revision `knot-web-00031-x7w` with
  100% traffic.
- Live URL: `https://knot-web-7k3walthgq-uc.a.run.app`.

### Live QA

- `GET /b`: 200.
- `GET /c`: 200.
- `GET /auth`: 200.
- `GET /b/graph`: 200.
- `GET /api/v1/promotions/promotion-demo-cheriexx`: 200.
- Authenticated demo brand `GET /api/v1/me`: returned role `BRAND`, status
  `COMPLETED`, brand `brand-demo-cheriexx`, agent
  `agent-demo-brand-cheriexx`.
- Deployed brand onboarding path:
  - `POST /api/v1/analyses/product`: `READY_FOR_CONFIRMATION`,
    provider `vertex-gemini`, no fallback.
  - `POST /api/v1/analyses/{analysisId}:confirm`: `CONFIRMED`.
  - `POST /api/v1/me/brand-profile`: returned existing completed brand profile
    and agent for the demo account.
- Authenticated demo creator `GET /api/v1/me`: returned role `CREATOR`, status
  `COMPLETED`, creator `creator-demo-ssin`, agent
  `agent-demo-creator-ssin`.
- Deployed creator onboarding analysis path:
  - YouTube analysis endpoint returned `READY_FOR_CONFIRMATION`; the tested
    `@geekble` URL used deterministic limited analysis because oEmbed returned
    `youtube_oembed_http_404`.
  - Instagram analysis endpoint returned `READY_FOR_CONFIRMATION`, provider
    `apify-instagram-profile-scraper`, no fallback.
- Escrow read path returned `escrow=null`, `settlements=[]` for a
  `FUNDING_REQUIRED` Agreement, which is expected before Phantom signs funding.

## 2026-08-21 One-Role Account Error Copy

1. [x] Keep the backend v1 invariant that one Firebase account has one KNOT
   role.
2. [x] Map `ROLE_ALREADY_SELECTED` API errors to Korean demo guidance instead
   of exposing the backend English detail.
3. [x] Add frontend API client coverage for the user-facing error mapping.
4. [x] Re-run frontend typecheck, tests, production build, and whitespace check.
5. [x] Deploy the error-copy build after explicit approval.

### Deployment Result

- Built web image
  `us-central1-docker.pkg.dev/knot-dev-503505/knot/knot-web:daabc81`
  with Cloud Build `388528e0-6722-4a34-a401-5e6290969f9c`.
- Deployed Cloud Run service `knot-web` revision `knot-web-00032-xd2` with
  100% traffic.
- Live URL: `https://knot-web-7k3walthgq-uc.a.run.app`.

### Live QA

- `GET /auth`: 200.
- `GET /b`: 200.
- Latest ready revision: `knot-web-00032-xd2`, serving 100% traffic.
