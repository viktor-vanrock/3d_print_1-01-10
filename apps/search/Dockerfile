ARG PYTHON_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/python3.12-alpine:3.12-alpine-r1
ARG UV_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/uv-python3.12-alpine:python3.12-alpine-r1

FROM ${UV_IMAGE} AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app/apps/search

COPY packages/python/portal-queue-lifecycle/pyproject.toml /app/packages/python/portal-queue-lifecycle/pyproject.toml
COPY packages/python/portal-queue-lifecycle/src /app/packages/python/portal-queue-lifecycle/src
COPY apps/search/pyproject.toml apps/search/uv.lock ./

RUN uv sync --frozen --no-dev --no-install-project --no-editable

COPY apps/search/src ./src

RUN uv sync --frozen --no-dev --no-editable

FROM ${PYTHON_IMAGE} AS runtime

RUN addgroup -g 10001 portal \
    && adduser -u 10001 -G portal -D -H -s /sbin/nologin portal \
    && python -m pip uninstall --yes pip

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
USER portal

STOPSIGNAL SIGTERM

CMD ["search-worker"]
