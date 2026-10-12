from fastapi import FastAPI

from apps.api.agent_ops_routes import build_agent_ops_router
from apps.api.governance_routes import build_governance_router
from apps.api.repository_factory import build_repository
from apps.api.routes import build_api_router
from libs.observability.middleware import add_request_context
from libs.repositories.store import KnotRepository
from libs.settings.config import Settings, get_settings


def create_app(
    settings: Settings | None = None,
    repository: KnotRepository | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    repository = repository or build_repository(settings)
    app = FastAPI(title="KNOT API", version=settings.schema_version)
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
    app.include_router(build_agent_ops_router(repository))
    app.include_router(build_governance_router(repository))

    return app


app = create_app()
