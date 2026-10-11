# Demo Persona Seed

## Purpose

This seed builds live-demo Brand and Creator personas that follow the current
KNOT Firestore schema and can be used by the real Discovery, Matching, A2A
Negotiation, Agreement, and existing Escrow handoff paths.

It is not a standalone mock JSON bundle. The script writes the same canonical
collections that the application reads.

## Public Data And Synthetic Data

Every generated profile keeps this flag:

```json
{
  "dataUsage": {
    "type": "DEMO_SEED",
    "registeredUser": false,
    "source": "PUBLIC_DATA"
  }
}
```

The four permissioned demo brands also include:

```json
{
  "demoPermission": true
}
```

Public or observed social fields are stored with source metadata in
`socialSnapshots/{snapshotId}` and additive `creatorProfiles` fields. Values
that are not public, such as rates, negotiation behavior, usage-right limits,
deadline preferences, and auto-counter behavior, are marked as
`SYNTHETIC_DEMO` through `syntheticFields` and `demoPolicy`.

Until `--refresh-social` runs with a valid provider key, fixture metrics are
marked as `FIXTURE_PENDING_PROVIDER_REFRESH`. Do not present those as verified
current SNS statistics.

## Brand List

Permissioned demo brands:

| Brand | ID | Industry |
|---|---|---|
| 크라이치즈버거 | `brand-demo-kry-cheese-burger` | food |
| 체리엑스엑스 | `brand-demo-cheriexx` | beauty |
| 더존바이오 | `brand-demo-thezonebio` | fitness / wellness |
| 워크모어 | `brand-demo-workmore` | lifestyle / work |

Additional public-data demo brands, not represented as KNOT customers:

| Brand | ID | Industry |
|---|---|---|
| The Hackathon Korea | `brand-demo-thehackathonkr` | tech / community |
| Samsung | `brand-demo-samsung` | tech |
| DANO | `brand-demo-dano` | fitness / wellness |
| Upbit | `brand-demo-upbit` | crypto |
| NEOWIZ | `brand-demo-neowiz` | gaming |
| BZCF | `brand-demo-bzcf` | lifestyle / community |

## Creator List

The demo keeps the original 10 category-coverage creators and adds 4
Instagram-first creator personas for the cold-DM/live-demo story. The product
currently uses canonical category key `fitness`; in demo copy this maps to
Wellness.

| Category | Creator | ID | Primary platform |
|---|---|---|---|
| Beauty | RISABAE | `creator-demo-risabae` | YouTube + Instagram |
| Beauty | SSIN 씬님 | `creator-demo-ssin` | YouTube |
| Tech | 긱블 Geekble | `creator-demo-geekble` | YouTube |
| Tech | 조코딩 JoCoding | `creator-demo-jocoding` | YouTube |
| Wellness | Thankyou BUBU | `creator-demo-thankyou-bubu` | YouTube |
| Wellness | DanoTV | `creator-demo-dano-tv` | YouTube |
| Crypto | Coin Bureau | `creator-demo-coin-bureau` | YouTube |
| Crypto | 99Bitcoins | `creator-demo-99bitcoins` | YouTube |
| Gaming | 도티 TV | `creator-demo-dotti` | YouTube |
| Gaming | 김성회의 G식백과 | `creator-demo-g-sik` | YouTube |

Additional Instagram-first personas:

| Creator | ID | Instagram |
|---|---|---|
| 이차녕 @candofr | `creator-demo-candofr` | `https://www.instagram.com/candofr/` |
| 유빈이TMI | `creator-demo-yubintmi` | `https://www.instagram.com/tmi_07070707/` |
| 아미쇼 | `creator-demo-amisho` | `https://www.instagram.com/amirsho_kh/` |
| 크리투스 | `creator-demo-creatus` | `https://www.instagram.com/crea__tus/` |

The unresolved list is stored in
`analysisJobs/demo-persona-unresolved-candidates`; it is currently empty for
the requested Instagram additions. Some public metrics remain marked
`FIXTURE_PENDING_PROVIDER_REFRESH` or `PUBLIC_THIRD_PARTY_OR_PROVIDER` until a
successful provider refresh writes a current `socialSnapshots/*` document.

## Social Collection

### YouTube

`YouTubeProfileProvider` uses YouTube Data API v3 when `YOUTUBE_API_KEY` is
configured. It resolves channel IDs from `/channel/{id}` or `@handle` URLs,
loads channel metadata, reads the uploads playlist, fetches recent video
statistics, and stores a bounded snapshot.

Collected public fields:

- channel ID, channel name, description, thumbnail, URL
- subscriber count, total view count, video count
- recent videos, recent views, likes, comments, publish timestamps

Derived fields:

- average recent views
- median recent views
- min/max recent views
- average likes/comments
- view-subscriber ratio

Derived values are marked with `metricType: DERIVED`.

The reusable entry point is:

```python
from libs.demo_seed.social_providers import analyze_youtube_creator

analysis = analyze_youtube_creator("https://www.youtube.com/@example")
```

### Instagram

`InstagramProfileProvider` supports Apify. It reads `INSTAGRAM_PROVIDER`,
`APIFY_TOKEN`, `INSTAGRAM_APIFY_ACTOR_ID`, and
`INSTAGRAM_APIFY_TIMEOUT_SECONDS`.

Default provider:

```text
INSTAGRAM_PROVIDER=apify
INSTAGRAM_APIFY_ACTOR_ID=apify~instagram-profile-scraper
```

The API uses Apify's synchronous Actor dataset endpoint with a bearer token and
never puts the token in the URL. The provider collects public profile fields and
bounded recent post rows when the Actor returns them.

Collected fields:

- username, display name, biography, profile URL, profile image URL
- followers, following, post count
- verified/private/business flags
- recent public posts/reels, captions, likes, comments, views when available

Derived fields:

- average recent views
- average likes/comments
- estimated engagement rate
- reels share

Derived values are marked with `metricType: DERIVED`. Without `APIFY_TOKEN`,
Instagram refresh returns a truthful unresolved result instead of a successful
mock.

## Firestore Mapping

The seed writes these canonical collections:

| Collection | Purpose |
|---|---|
| `brands/{brandId}` | Brand profile and public demo usage metadata |
| `creatorProfiles/{creatorId}` | Creator profile used by context resolvers |
| `creatorDiscoveryProfiles/{creatorId}` | Matching/search projection |
| `socialSnapshots/{snapshotId}` | Raw bounded public SNS snapshot |
| `agents/{agentId}` | Brand/Creator Agent identity and availability |
| `agentPolicies/{agentId}` | Private synthetic demo policy |
| `agentRegistry/{agentId}` | Creator A2A registry entry |
| `promotions/{promotionId}` | Five demo promotions, one per core industry |
| `analysisJobs/{id}` | Unresolved public-account verification notes |

Brand profiles include `logoUrl` / `logoImageUrl`. Creator profiles include
`profileImageUrl`. If a provider returns a public SNS profile image, the seed
uses it. Otherwise the field points to a generated demo initials image and
stores `imageSource.provenance = SYNTHETIC_DEMO`, so it is not presented as an
official brand logo or verified creator photo.

## Matching Connection

The generated creator discovery profiles satisfy the current hard filters:

- `agentStatus == PUBLISHED`
- `acceptingOffers == true`
- `availability == AVAILABLE`
- `capacityAvailable == true`
- `countryCode == KR`
- `categoryKeys` contains the promotion primary category
- `formatKeys` contains the requested deliverable format
- `nextAvailableAt` is before the posting window

Five demo promotions are included:

| Promotion | Matching category | Expected candidates |
|---|---|---|
| `promotion-demo-cheriexx` | beauty | RISABAE, SSIN |
| `promotion-demo-samsung` | tech | Geekble, JoCoding |
| `promotion-demo-thezonebio` | fitness | Thankyou BUBU, DanoTV |
| `promotion-demo-upbit` | crypto | Coin Bureau, 99Bitcoins |
| `promotion-demo-neowiz` | gaming | Dotty, G식백과 |

## Agent Context Connection

Each creator gets:

- `creatorProfiles/{creatorId}`
- `creatorDiscoveryProfiles/{creatorId}`
- `agents/{agent-demo-creator-*}`
- `agentPolicies/{agent-demo-creator-*}`
- `agentRegistry/{agent-demo-creator-*}`

Each brand gets:

- `brands/{brandId}`
- `agents/{agent-demo-brand-*}`
- `agentPolicies/{agent-demo-brand-*}`
- optional `promotions/{promotion-demo-*}`

The existing Brand Agent reads Promotion plus matching candidates. The Creator
Agent reads its profile and private synthetic policy. Policy remains private and
is not copied to counterparty payloads.

## Demo Policies

Creator policies intentionally differ so negotiation outcomes are not identical:

| Persona | Behavior |
|---|---|
| `brand_fit_first` | Accepts good fit at low demo prices |
| `usage_rights_sensitive` | Counters or escalates when usage rights are broad |
| `price_sensitive` | Counters below synthetic minimum rate |
| `detail_sensitive` | Requires clearer scope and modest rate |
| `schedule_sensitive` | Requires longer posting window |
| `fast_accept_if_price_ok` | Accepts quickly when base price passes threshold |

All policy values are synthetic and use low USDC values for devnet/faucet-safe
demo runs.

Demo creator profiles also include a devnet settlement destination so the live
escrow demo can be funded without presenting a real creator's private wallet as
public data. The wallet fields are marked in `syntheticFields` and use
`walletCustody = DEMO_SEEDED_DESTINATION`.

## Commands

Dry-run planned documents:

```bash
./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run
```

Dry-run with JSON output:

```bash
./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --json
```

Refresh YouTube and Instagram social snapshots when provider keys are configured:

```bash
YOUTUBE_API_KEY=... APIFY_TOKEN=... \
  ./.venv/bin/python backend/scripts/seed_demo_personas.py --dry-run --refresh-social
```

Write to the configured Firestore project:

```bash
./.venv/bin/python backend/scripts/seed_demo_personas.py --write
```

Write Firestore documents and create/update Firebase Auth accounts for every
demo persona:

```bash
./.venv/bin/python backend/scripts/seed_demo_personas.py --write --auth-users
```

Generated demo accounts use deterministic emails:

```text
brand-demo-{slug}@knot.demo
creator-demo-{slug}@knot.demo
```

The default demo password is `000000`; override it with `--auth-password` when
needed.

Reset and re-seed generated demo documents:

```bash
./.venv/bin/python backend/scripts/seed_demo_personas.py --write --reset
```

Selective writes:

```bash
./.venv/bin/python backend/scripts/seed_demo_personas.py --write --only-brands
./.venv/bin/python backend/scripts/seed_demo_personas.py --write --only-creators
```

Firestore writes, resets, provider refreshes against paid/quota APIs, and
Cloud Run deployment all require explicit operator approval.

## Verification

Local verification:

```bash
./.venv/bin/pytest backend/tests/test_demo_persona_seed.py -q
./.venv/bin/python -m ruff check backend/libs/demo_seed backend/scripts/seed_demo_personas.py backend/tests/test_demo_persona_seed.py
npm --prefix frontend run typecheck
```

The test suite verifies:

- 10 brands
- 10 creators
- at least 2 creators per demo category
- discovery returns candidates for all five industry promotions
- match candidates include explanations
- slash-route A2A start negotiation creates an Agreement artifact

## Final Demo Flow

```text
Brand login
→ Promotion selection
→ Agent match run
→ Creator candidates with match reasons
→ Creator selection
→ Brand Agent OFFER
→ Creator Agent COUNTER or ACCEPT using private demo policy
→ Brand Agent follow-up
→ Agreement artifact
→ Existing Escrow funding path
→ Solana devnet proof when funded and confirmed
```

The persona seed does not fabricate escrow success. Escrow is complete only
after the existing devnet transaction path returns a confirmed signature.
