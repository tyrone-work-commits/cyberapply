import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.config import get_settings
from app.core.db import get_db, migrate_db


@asynccontextmanager
async def lifespan(_app):
    if get_settings().environment in {"test", "local"}:
        migrate_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="CyberApply Backend", version="0.1.0",
                  description="Cybersecurity job discovery, resume preparation and controlled application processing.",
                  lifespan=lifespan)
    settings = get_settings()
    app.add_middleware(CORSMiddleware, allow_origins=settings.frontend_origins,
                       allow_credentials=False, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
                       expose_headers=["X-Request-ID"])
    attempts = defaultdict(deque)

    @app.middleware("http")
    async def boundaries(request: Request, call_next):
        import uuid
        request_id = str(uuid.uuid4())
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            content = bytearray()
            async for chunk in request.stream():
                content.extend(chunk)
                if len(content) > settings.request_max_bytes:
                    return JSONResponse(status_code=413, content={"detail": {"code": "request_too_large",
                                                                             "message": "Request exceeds upload limit"}})
            request._body = bytes(content)
        if request.url.path.startswith("/api/v1/auth/") and request.method == "POST":
            # Single-process local limiter. Production reverse proxy must enforce a shared limit.
            now = time.monotonic()
            identity = request.client.host if request.client else "unknown"
            queue = attempts[identity]
            while queue and queue[0] < now - 60:
                queue.popleft()
            if len(queue) >= settings.auth_rate_limit:
                return JSONResponse(status_code=429, headers={"Retry-After": "60"},
                                    content={"detail": {"code": "rate_limited", "message": "Try again shortly"}})
            queue.append(now)
            if len(attempts) > 10000:
                for key in list(attempts):
                    if not attempts[key] or attempts[key][-1] < now - 60:
                        del attempts[key]
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, exception):
        # Do not echo password, OAuth tokens or uploaded content in validation responses.
        errors = [{"loc": list(e["loc"]), "message": e["msg"], "type": e["type"]} for e in exception.errors()]
        return JSONResponse(status_code=422, content={"detail": {"code": "validation_error", "errors": errors}})

    @app.exception_handler(StaleDataError)
    async def stale_error(_request, _exception):
        return JSONResponse(status_code=409, content={"detail": {"code": "concurrent_update",
                                                                 "message": "This record changed; refresh and retry"}})

    @app.get("/health", tags=["Operations"])
    def health():
        return {"status": "ok", "service": "cyberapply-backend", "version": "0.1.0"}

    @app.get("/health/ready", tags=["Operations"])
    def ready(db: Session = Depends(get_db)):
        try:
            db.execute(text("SELECT 1"))
            return {"status": "ready"}
        except Exception:
            return JSONResponse(status_code=503, content={"status": "not_ready"})

    from app.domain import applications, auth, automation, documents, inbox, jobs, profiles, support
    for module in [auth, profiles, documents, jobs, applications, automation, inbox, support]:
        app.include_router(module.router, prefix="/api/v1")
    return app


app = create_app()
