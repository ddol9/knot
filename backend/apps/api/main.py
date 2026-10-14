import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.agent_ops_routes import build_agent_ops_router
from apps.api.demo_routes import build_demo_router
from apps.api.repository_factory import build_repository
from apps.api.routes import build_api_router
from libs.observability.middleware import add_request_context
from libs.repositories.store import KnotRepository
from libs.settings.config import Settings, get_settings

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    repository: KnotRepository | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    repository = repository or build_repository(settings)
    app = FastAPI(title="KNOT API", version=settings.schema_version)

    # CORS 설정 (프론트엔드에서 접근 가능하게)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    add_request_context(app, service_name=settings.service_name)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        return {"status": "ready", "service": settings.service_name}

    @app.get("/version")
    def version() -> dict[str, str]:
        return {
            "service": settings.service_name,
            "gitSha": settings.git_sha,
            "buildTime": settings.build_time,
            "schemaVersion": settings.schema_version,
        }

    app.include_router(build_api_router(repository, settings))
    # Agent Ops 라우터는 Firestore 클라이언트(`repository.db`)가 있을 때만 배선한다.
    # 메모리 저장소(로컬 데모)에서는 앱 기동이 실패하지 않도록 건너뛴다.
    if getattr(repository, "db", None) is not None:
        app.include_router(build_agent_ops_router(repository))
    else:
        logger.warning("agent ops router skipped: repository has no Firestore client")

    # 데모/시연용 엔드포인트 (인증 불필요)
    app.include_router(build_demo_router(settings))

    return app


app = create_app()
