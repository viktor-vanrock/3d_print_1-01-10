ARG NODE_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/nodejs-runtime-24-alpine:24.17.0-a1
ARG NGINX_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/nginx-unprivileged-alpine:1.29-alpine-r1

FROM ${NODE_IMAGE} AS build

WORKDIR /app

ARG NPM_REGISTRY=https://nexus.sberdevices.ru/repository/npm-proxy/
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
RUN npm install --global pnpm@9.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml version.json ./
COPY scripts/install-git-hooks.mjs scripts/install-git-hooks.mjs
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @portal/web...

COPY apps/web apps/web
COPY packages/config packages/config
COPY packages/contracts packages/contracts

# VITE_* попадают в браузерный бандл на этапе сборки; в рантайме их изменить нельзя,
# поэтому каждое значение контура должно приезжать сюда как build-arg.
ARG VITE_API_URL=""
ARG VITE_CLOSED_DEV=""
ARG VITE_DEV_BANNER=""
ARG VITE_PROJECTS_WIDE=""
ARG VITE_UMAMI_WEBSITE_ID=""
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_CLOSED_DEV=${VITE_CLOSED_DEV} \
    VITE_DEV_BANNER=${VITE_DEV_BANNER} \
    VITE_PROJECTS_WIDE=${VITE_PROJECTS_WIDE} \
    VITE_UMAMI_WEBSITE_ID=${VITE_UMAMI_WEBSITE_ID}

RUN pnpm --filter @portal/web run build

FROM ${NGINX_IMAGE} AS runtime

USER root
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
USER 101

COPY apps/web/deploy/nginx.container.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
