FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58 AS base

FROM base AS build
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
COPY apps/media-gateway/pyproject.toml apps/media-gateway/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/media-gateway/src ./src
RUN uv sync --frozen --no-dev

FROM build AS test
RUN uv sync --frozen
COPY apps/media-gateway/tests ./tests
RUN uv run pytest -q

FROM scratch AS runtime
COPY --from=base / /
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
COPY --from=build /app/.venv /app/.venv
RUN groupadd --gid 10001 rogichat && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin rogichat
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3)"
CMD ["gunicorn", "-w", "2", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8080", "--access-logfile", "-", "--error-logfile", "-", "meloming_media_gateway.app:app"]
