# Ubuntu вместо Debian trixie: в trixie perl-base/gzip/pcre2/glib без фиксов
# в Trivy, а Alpine не годится — openscad нет в apk.
ARG BASE_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/ubuntu-24:latest
ARG UV_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/uv-python3.12-slim-trixie:python3.12-trixie-slim-r1

FROM ${UV_IMAGE} AS uv

FROM ${BASE_IMAGE} AS builder

RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /usr/local/bin/uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON=/usr/bin/python3 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app/apps/giga

# Copy only dependency metadata first so source-only changes keep the dependency layer cached.
COPY packages/python/portal-queue-lifecycle/pyproject.toml /app/packages/python/portal-queue-lifecycle/pyproject.toml
COPY packages/python/portal-queue-lifecycle/src /app/packages/python/portal-queue-lifecycle/src
COPY apps/giga/pyproject.toml apps/giga/uv.lock ./

RUN uv sync --frozen --no-dev --no-install-project --no-editable

COPY apps/giga/src ./src

RUN uv sync --frozen --no-dev --no-editable

FROM ${BASE_IMAGE} AS runtime

# The generation worker executes OpenSCAD for the openscad branch.
RUN apt-get update \
    && apt-get upgrade --yes \
    && apt-get install --yes --no-install-recommends python3 openscad \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 portal \
    && useradd --uid 10001 --gid portal --no-create-home --shell /usr/sbin/nologin portal

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
USER portal

EXPOSE 3102
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python3", "-c", "import pathlib,sys,urllib.request; command=pathlib.Path('/proc/1/cmdline').read_bytes(); sys.exit(0) if b'giga.main:app' not in command else urllib.request.urlopen('http://127.0.0.1:3102/health', timeout=3).read()"]

# Override with giga-worker, giga-assistant-worker, giga-calendar-agent, or
# giga-catalog-agent for queue consumers and one-shot jobs.
CMD ["uvicorn", "giga.main:app", "--host", "0.0.0.0", "--port", "3102"]
