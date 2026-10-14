import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

from libs.observability.tracing import (
    langsmith_project_from_env,
    tracing_enabled_from_env,
    tracing_sink_from_env,
)


def _load_dotenv() -> None:
    env_file = Path(__file__).resolve().parents[3] / ".env"
    if not env_file.exists():
        return
    with open(env_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = val


# Real devnet knot-escrow program id and USDC-SPL mint (see programs/knot-escrow
# and backend/.env.example). Used to stamp escrow/receipt records so they stay
# consistent when on-chain signing is wired.
DEFAULT_ESCROW_PROGRAM_ID = "Aj63B5hLtvJdNQiAi61rMrgfW3pt8Lak3GQB59B6jysj"
DEFAULT_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"


class Settings(BaseModel):
    service_name: str = "knot-api"
    git_sha: str = "local"
    build_time: str = "local"
    schema_version: str = "v1"
    creator_agent_base_url: str = "http://localhost:8081/a2a/v1"
    creator_a2a_mode: str = "local"
    brand_agent_base_url: str = "http://localhost:8083/brand/v1"
    # Creator agent process hosts only these tenants (None = every tenant in the repository).
    creator_agent_tenants: list[str] | None = None
    # Brand side: tenant -> A2A base URL overrides (registry baseUrl wins when present).
    creator_agent_endpoints: dict[str, str] = {}
    # Creator agent process: re-announce hosted tenants every N seconds (0 = startup only).
    creator_agent_heartbeat_seconds: int = 0
    creator_a2a_timeout_seconds: int = 30
    a2a_service_token: str | None = None
    web3_gateway_base_url: str = "http://localhost:8082"
    web3_mode: str = "local"
    repository_backend: str = "memory"
    memory_seed_demo: bool = False
    firestore_project_id: str | None = None
    auth_mode: str = "firebase"
    firebase_project_id: str | None = None
    vertex_ai_location: str = "us-central1"
    gemini_mode: str = "off"
    gemini_model: str = "gemini-2.5-flash"
    gemini_match_explanations: bool = False
    youtube_api_key: str | None = None
    apify_token: str | None = None
    instagram_provider: str = "apify"
    instagram_apify_actor_id: str = "apify~instagram-profile-scraper"
    instagram_apify_timeout_seconds: float = 75.0
    secure_fetch_enabled: bool = True
    secure_fetch_timeout_seconds: float = 8.0
    paysh_mode: str = "sandbox"
    paysh_resource_id: str = "replace-me"
    paysh_timeout_seconds: int = 90
    paysh_quote_amount_usdc: float = 0.02
    paysh_max_call_amount_usdc: float = 0.02
    paysh_run_spend_cap_usdc: float = 0.02
    paysh_daily_spend_cap_usdc: float = 1.0
    paysh_allowed_resource_prefixes: list[str] = ["https://debugger.pay.sh/mpp/quote/"]
    paysh_failure_policy: str = "continue"
    # Creator verification via pay.sh
    paysh_creator_verification_enabled: bool = True
    paysh_creator_verification_max_price: float = 0.10
    paysh_creator_verification_bot_threshold: float = 0.25
    # Content verification via pay.sh
    paysh_content_verification_enabled: bool = False
    paysh_content_verification_max_price: float = 0.50
    escrow_network: str = "solanaDevnet"
    escrow_program_id: str = DEFAULT_ESCROW_PROGRAM_ID
    usdc_mint: str = DEFAULT_USDC_MINT
    settlement_authority: str | None = None
    # 역할 선택 시 유저 임베디드 지갑(플랫폼 커스터디)을 자동 생성한다.
    # → 구글 로그인만으로 Solana 주소를 갖는다. Phantom 연결은 선택 사항이 된다.
    user_wallet_provision: bool = False
    # evidence 검증 통과 즉시 마일스톤 정산을 서버 서명으로 실행한다(사람 클릭 없음).
    # 실패해도 수동 Phantom 릴리즈 경로가 fallback으로 남는다.
    auto_settlement_on_evidence: bool = True
    # Amount-based automation thresholds (멘토링 피드백 반영)
    automation_full_auto_threshold_usdc: float = 500.0  # < 500 USDC: 완전 자동
    automation_human_review_threshold_usdc: float = 1000.0  # < 1000 USDC: 검토 필요
    # >= 1000 USDC: 사람 서명 필요
    # Governance guardrails on the autonomous settlement path (libs/policies/governance.py).
    gov_max_auto_agreement_usdc: int = 800  # single agreement auto-fundable without a human
    gov_max_auto_campaign_total_usdc: int = 2000  # cumulative committed in one campaign
    gov_max_consecutive_failures: int = 3  # anomaly flag: last N negotiations all failed
    dev_admin_enabled: bool = False
    dev_admin_allowlist: list[str] = []
    # Agent tracing (libs/observability/tracing.py): JSON lines on logger `knot.trace`,
    # optionally mirrored to LangSmith when LANGSMITH_API_KEY/LANGCHAIN_API_KEY is set.
    tracing_enabled: bool = True
    tracing_sink: str = "log"  # log | langsmith
    langsmith_project: str = "knot-agent-ops"


@lru_cache
def get_settings(service_name: str | None = None) -> Settings:
    _load_dotenv()
    resolved_service_name = service_name or os.getenv("KNOT_SERVICE_NAME") or "knot-api"
    return Settings(
        service_name=resolved_service_name,
        git_sha=os.getenv("GIT_SHA", "local"),
        build_time=os.getenv("BUILD_TIME", "local"),
        creator_agent_base_url=os.getenv("CREATOR_AGENT_BASE_URL", "http://localhost:8081/a2a/v1"),
        creator_a2a_mode=os.getenv("KNOT_CREATOR_A2A_MODE", "local"),
        brand_agent_base_url=os.getenv("BRAND_AGENT_BASE_URL", "http://localhost:8083/brand/v1"),
        creator_agent_tenants=_csv_list(os.getenv("KNOT_CREATOR_AGENT_TENANTS")),
        creator_agent_endpoints=_csv_map(os.getenv("KNOT_CREATOR_AGENT_ENDPOINTS")),
        creator_agent_heartbeat_seconds=int(os.getenv("KNOT_CREATOR_AGENT_HEARTBEAT_SECONDS", "0")),
        creator_a2a_timeout_seconds=int(os.getenv("CREATOR_A2A_TIMEOUT_SECONDS", "30")),
        a2a_service_token=os.getenv("KNOT_A2A_SERVICE_TOKEN"),
        web3_gateway_base_url=os.getenv("WEB3_GATEWAY_BASE_URL", "http://localhost:8082"),
        web3_mode=os.getenv("KNOT_WEB3_MODE", "local"),
        repository_backend=os.getenv("KNOT_REPOSITORY_BACKEND", "memory"),
        memory_seed_demo=_truthy(os.getenv("KNOT_MEMORY_SEED_DEMO")),
        firestore_project_id=os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT_ID"),
        auth_mode=os.getenv("KNOT_AUTH_MODE", "firebase"),
        firebase_project_id=(
            os.getenv("FIREBASE_PROJECT_ID")
            or os.getenv("GOOGLE_CLOUD_PROJECT")
            or os.getenv("GCP_PROJECT_ID")
        ),
        vertex_ai_location=os.getenv("VERTEX_AI_LOCATION", "us-central1"),
        gemini_mode=os.getenv("KNOT_GEMINI_MODE", "off"),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        gemini_match_explanations=_truthy(os.getenv("KNOT_GEMINI_MATCH_EXPLANATIONS")),
        youtube_api_key=os.getenv("YOUTUBE_API_KEY"),
        apify_token=os.getenv("APIFY_TOKEN"),
        instagram_provider=os.getenv("INSTAGRAM_PROVIDER", "apify"),
        instagram_apify_actor_id=os.getenv(
            "INSTAGRAM_APIFY_ACTOR_ID",
            "apify~instagram-profile-scraper",
        ),
        instagram_apify_timeout_seconds=float(os.getenv("INSTAGRAM_APIFY_TIMEOUT_SECONDS", "75")),
        secure_fetch_enabled=_truthy_default_true(os.getenv("KNOT_SECURE_FETCH_ENABLED")),
        secure_fetch_timeout_seconds=float(os.getenv("KNOT_SECURE_FETCH_TIMEOUT_SECONDS", "8")),
        paysh_mode=os.getenv("PAYSH_MODE", "sandbox"),
        paysh_resource_id=os.getenv("PAYSH_RESOURCE_ID", "replace-me"),
        paysh_timeout_seconds=int(os.getenv("PAYSH_TIMEOUT_SECONDS", "90")),
        paysh_quote_amount_usdc=float(os.getenv("PAYSH_QUOTE_AMOUNT_USDC", "0.02")),
        paysh_max_call_amount_usdc=float(os.getenv("PAYSH_MAX_CALL_AMOUNT_USDC", "0.02")),
        paysh_run_spend_cap_usdc=float(os.getenv("PAYSH_RUN_SPEND_CAP_USDC", "0.02")),
        paysh_daily_spend_cap_usdc=float(os.getenv("PAYSH_DAILY_SPEND_CAP_USDC", "1.0")),
        paysh_allowed_resource_prefixes=_csv(
            os.getenv("PAYSH_ALLOWED_RESOURCE_PREFIXES", "https://debugger.pay.sh/mpp/quote/")
        ),
        paysh_failure_policy=os.getenv("PAYSH_FAILURE_POLICY", "continue"),
        paysh_creator_verification_enabled=_truthy_default_true(
            os.getenv("PAYSH_CREATOR_VERIFICATION_ENABLED")
        ),
        paysh_creator_verification_max_price=float(
            os.getenv("PAYSH_CREATOR_VERIFICATION_MAX_PRICE", "0.10")
        ),
        paysh_creator_verification_bot_threshold=float(
            os.getenv("PAYSH_CREATOR_VERIFICATION_BOT_THRESHOLD", "0.25")
        ),
        paysh_content_verification_enabled=_truthy(os.getenv("PAYSH_CONTENT_VERIFICATION_ENABLED")),
        paysh_content_verification_max_price=float(
            os.getenv("PAYSH_CONTENT_VERIFICATION_MAX_PRICE", "0.50")
        ),
        escrow_network=os.getenv("KNOT_ESCROW_NETWORK", "solanaDevnet"),
        escrow_program_id=os.getenv("KNOT_ESCROW_PROGRAM_ID", DEFAULT_ESCROW_PROGRAM_ID),
        usdc_mint=os.getenv("KNOT_USDC_MINT", DEFAULT_USDC_MINT),
        settlement_authority=os.getenv("KNOT_SETTLEMENT_AUTHORITY"),
        user_wallet_provision=_truthy(os.getenv("KNOT_USER_WALLET_PROVISION")),
        auto_settlement_on_evidence=_truthy_default_true(
            os.getenv("KNOT_AUTO_SETTLEMENT_ON_EVIDENCE")
        ),
        automation_full_auto_threshold_usdc=float(
            os.getenv("AUTOMATION_FULL_AUTO_THRESHOLD_USDC", "500.0")
        ),
        automation_human_review_threshold_usdc=float(
            os.getenv("AUTOMATION_HUMAN_REVIEW_THRESHOLD_USDC", "1000.0")
        ),
        gov_max_auto_agreement_usdc=int(os.getenv("KNOT_GOV_MAX_AUTO_AGREEMENT_USDC", "800")),
        gov_max_auto_campaign_total_usdc=int(
            os.getenv("KNOT_GOV_MAX_AUTO_CAMPAIGN_TOTAL_USDC", "2000")
        ),
        gov_max_consecutive_failures=int(os.getenv("KNOT_GOV_MAX_CONSECUTIVE_FAILURES", "3")),
        dev_admin_enabled=_truthy(os.getenv("KNOT_DEV_ADMIN_ENABLED")),
        dev_admin_allowlist=_csv(os.getenv("KNOT_DEV_ADMIN_ALLOWLIST")),
        tracing_enabled=tracing_enabled_from_env(),
        tracing_sink=tracing_sink_from_env(),
        langsmith_project=langsmith_project_from_env(),
    )


def _truthy(value: str | None) -> bool:
    return value is not None and value.lower() in {"1", "true", "yes", "on"}


def _truthy_default_true(value: str | None) -> bool:
    """미설정이면 켜진 값. 끄려면 명시적으로 0/false/no/off 를 준다."""
    if value is None or not value.strip():
        return True
    return value.lower() in {"1", "true", "yes", "on"}


def _csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _csv_list(value: str | None) -> list[str] | None:
    if not value or not value.strip():
        return None
    return [item.strip() for item in value.split(",") if item.strip()]


def _csv_map(value: str | None) -> dict[str, str]:
    """`tenant=url,tenant2=url2` -> dict."""
    result: dict[str, str] = {}
    for item in (value or "").split(","):
        if "=" not in item:
            continue
        key, url = item.split("=", 1)
        if key.strip() and url.strip():
            result[key.strip()] = url.strip()
    return result
