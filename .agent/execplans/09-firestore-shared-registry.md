# Phase 9 - Firestore Shared Registry (Emulator) for the Local Agent World

## Goal
로컬 멀티 에이전트 스택(크리에이터 A/B + 브랜드)이 **하나의 Firestore**(에뮬레이터)를 보게 해서,
크리에이터 heartbeat → 브랜드 탐색(🟢) → 캠페인 이력(`negotiationStats`)이 프로세스 경계를 넘어 실제로 흐르는 것을 실측한다.
Firestore 어댑터가 에이전트 경로가 쓰는 모든 연산(원문 문서 CRUD, `array_contains`/`<=` 쿼리, 프로필·정책 조회, 탐색 프로젝션 쿼리)에서 메모리 저장소와 같은 결과를 내는지 확인하고, 탐색 쿼리에 필요한 복합 인덱스를 고정한다.

## Current Behavior
- 세 프로세스 모두 `KNOT_REPOSITORY_BACKEND=memory`. 각자 자기 메모리에 시드하므로 크리에이터 heartbeat는 자기 프로세스에만 남고 브랜드는 못 본다(탐색 표가 항상 ⚪). 캠페인 이력도 브랜드 프로세스 안에서만 두 번째 캠페인부터 보인다.
- Firestore 어댑터(`FirestoreDocumentStore`)는 가짜 클라이언트 단위 테스트만 있고 실제 SDK/에뮬레이터로 돌려본 적이 없다. SDK 2.x 가 positional `where()`를 deprecate 해 탐색 쿼리마다 7개의 UserWarning 이 난다.
- `scripts/local/firebase.json` 은 Auth 에뮬레이터만 안다. Firestore 시드 스크립트가 없다.
- `firestore.indexes.json` 의 `creatorDiscoveryProfiles` 인덱스는 `primaryFormatKey` 등식을 포함한 옛 쿼리 모양이고, 현재 `_public_filters`(포맷은 메모리 후처리)와 정확히 맞는 인덱스가 없다.

## In Scope
- `scripts/local/firebase.json` 에 Firestore 에뮬레이터(:8780) + `firestore.indexes.json` 참조.
- `scripts/local/a2a_multi_agent_firestore.sh`: 에뮬레이터 기동(이미 떠 있으면 재사용) → `FIRESTORE_EMULATOR_HOST`/`GOOGLE_CLOUD_PROJECT=demo-knot`/`KNOT_REPOSITORY_BACKEND=firestore` → 시드 1회 → 크리에이터 A(:8091)/B(:8092)/브랜드(:8083). 브랜드에는 `KNOT_CREATOR_AGENT_ENDPOINTS` 를 주지 않는다(B 테넌트의 baseUrl 은 heartbeat 가 쓴다).
- `backend/scripts/seed_firestore.py`: `seed_demo_repository` 를 Firestore 저장소에, 멱등, 컬렉션별 개수 출력, 에뮬레이터 밖은 `--allow-remote` 없이는 거부, 기존 레지스트리 운영 신호 보존.
- 어댑터: `where(filter=FieldFilter(...))` 사용(SDK 없으면 positional 폴백), 프로토콜/가짜 클라이언트 갱신.
- `firestore.indexes.json` 에 탐색 쿼리와 정확히 맞는 복합 인덱스 추가, 문서 08 에 절 추가.
- `backend/tests/test_firestore_emulator_agents.py`: 에뮬레이터 있을 때만 도는 통합 테스트 + 인덱스 드리프트 테스트(항상).
- 세션 기록, 이 ExecPlan.

## Out of Scope
- 실제 GCP Firestore 배포/인덱스 배포(`firebase deploy --only firestore:indexes` 는 운영자 작업), 제품 API(`apps/api`) 를 이 스택에 넣는 것, Auth 에뮬레이터와의 동시 실행 포트 조정, 프론트, 정책/관측 모듈.
- 메모리 모드 스크립트(`a2a_multi_agent.sh`) 동작 변경.

## Files and Symbols
- `scripts/local/firebase.json` — `emulators.firestore`, `firestore.indexes`
- `scripts/local/a2a_multi_agent_firestore.sh` (신규)
- `backend/scripts/seed_firestore.py` (신규) — `OPERATIONAL_REGISTRY_FIELDS`, `_restore_operational_registry_fields`
- `backend/libs/repositories/firestore_adapter.py` — `_where`, Protocol `where(..., *, filter=None)`
- `backend/tests/test_firestore_adapter.py` — 가짜 클라이언트가 `filter=` 도 받음
- `backend/tests/test_firestore_emulator_agents.py` (신규)
- `firestore.indexes.json` — 탐색 쿼리 인덱스
- `docs/08_DATA_MODEL_FIRESTORE_AND_INDEXES.md` — §19 추가

## Data Migration
없음. 시드는 set 의미(같은 id 덮어쓰기). 재시드 시 `agentRegistry/*` 의 운영 필드(`healthStatus`, `lastSeenAt`, `hostedBy`, `negotiationStats`, 프로브 필드, heartbeat 가 옮긴 `baseUrl`)는 보존한다.

## API Changes
없음.

## Security Considerations
- 시드 스크립트는 `FIRESTORE_EMULATOR_HOST` 가 없으면 종료한다. 실 프로젝트에 쓰려면 `--allow-remote` 를 명시해야 한다(devnet/에뮬레이터 전용 원칙).
- 에뮬레이터는 규칙 없이 전체 허용(로컬 전용). `firestore-debug.log` 는 `/tmp/knot-local` 에 남긴다(레포 오염 방지).

## Milestones
1. [x] 에뮬레이터 + firebase.json + 스택 스크립트
2. [x] 시드 스크립트(멱등, 개수 출력, 원격 보호)
3. [x] 어댑터 실측 + FieldFilter 수정 + 복합 인덱스
4. [x] 에뮬레이터 통합 테스트
5. [x] 라이브 E2E(캠페인 2회: 1회차 🟢, 2회차 1/1) + 문서

## Tests
- `tests/test_firestore_emulator_agents.py` (에뮬레이터 필요, 3개): 어댑터 왕복(컬렉션 개수 = 메모리, 재시드 멱등, 프로필/정책 조회, 중첩/None/빈 컨테이너, 서브컬렉션), 탐색 쿼리 결과 = 메모리(`==`/`array_contains`/`<=`, limit, 프로젝션 검색), heartbeat(TestClient 기동) → 다른 클라이언트의 레지스트리/탐색에 `UP`·`baseUrl`·`hostedBy` → 인프로세스 캠페인 → 세 번째 클라이언트에서 `negotiationStats`, `agreements/`+milestones, `matchRuns` 확인, 두 번째 탐색에 이력 반영.
- 같은 파일(항상, 1개): `firestore.indexes.json` 에 `_public_filters` 와 정확히 맞는 인덱스가 있는지.
- `tests/test_firestore_adapter.py`(2개): 가짜 클라이언트로 `filter=` 경로.

## Rollback
스크립트/테스트/시드 파일 삭제, firebase.json 에서 firestore 항목 제거, 어댑터의 `_where` 를 positional 로 되돌림. 인덱스 추가는 남겨도 무해.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. 에뮬레이터 통합 3 + 인덱스 1 + 어댑터 2 = 6 passed. 에뮬레이터 없으면 3 skipped.
- [x] 라이브: `a2a_multi_agent_firestore.sh`(8191/8192/8183 로 실행) + CLI 캠페인 2회. 1회차 탐색 표에 모든 후보 🟢(creator heartbeat, 005/003 은 B 의 8192 로 라우팅, 엔드포인트 env 없이), 2회차 합의 에이전트 `1/1`. 결과는 `WORK_SESSION_2026-10-13.md` 세션 6a.

## Decisions
- 별도 스크립트(`a2a_multi_agent_firestore.sh`)로 둔다. 메모리 스크립트는 그대로이고, Firestore 버전은 에뮬레이터/시드 단계가 더 있어 플래그보다 읽기 쉽다. 포트 변수(`KNOT_CREATOR_A_PORT` 등)만 추가.
- 에뮬레이터 포트 8780: 기본 8080 은 로컬 Docker 가 쓴다. 포트는 firebase.json 한 곳에서만 읽는다.
- 브랜드에 엔드포인트 오버라이드를 주지 않는다. 레지스트리 `baseUrl`(heartbeat) 이 라우팅의 진실이 되는 것이 이 단계의 요점이다. (`registry_base_url` 우선순위: override > registry > default)
- 복합 인덱스는 쿼리와 **정확히** 같은 필드 집합(등식 5 + `categoryKeys` CONTAINS + `nextAvailableAt` 범위)으로 둔다. 에뮬레이터는 인덱스를 강제하지 않으므로 드리프트는 테스트로 잡는다. 옛 인덱스는 남겨둔다(다른 쿼리가 쓸 수 있고 삭제는 운영 작업).
- 시드 재실행이 운영 신호를 지우지 않게 한다. 에뮬레이터는 매 기동마다 비어 있지만, 떠 있는 에뮬레이터를 재사용할 때 heartbeat 를 잃지 않기 위해서다.

## Risks
- 에뮬레이터는 복합 인덱스를 강제하지 않는다 → 실 Firestore 에서 인덱스가 없으면 `FAILED_PRECONDITION` → `discovery.py` 의 폴백 스캔(경고 로그). 인덱스 배포 전까지 성능만 떨어지고 결과는 같다.
- Auth 에뮬레이터(`dev_stack.sh`)와 동시에 띄우면 UI/허브 포트(4000/4400)가 겹친다. 둘 중 하나만 띄우거나 Firestore 스택이 기존 에뮬레이터를 재사용하게 한다.
- `singleProjectMode` 에서 테스트가 `demo-knot-test` 프로젝트를 쓰면 에뮬레이터가 경고를 찍지만 동작한다. 라이브 스택 데이터(`demo-knot`)는 건드리지 않는다.
