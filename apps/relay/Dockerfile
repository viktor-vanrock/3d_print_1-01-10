ARG NODE_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/nodejs-runtime-24-alpine:24.17.0-a1

FROM ${NODE_IMAGE} AS build

WORKDIR /workspace

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

ARG NPM_REGISTRY=https://nexus.sberdevices.ru/repository/npm-proxy/
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
RUN npm install --global pnpm@9.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/install-git-hooks.mjs scripts/install-git-hooks.mjs
COPY apps/relay/package.json apps/relay/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @portal/relay...

COPY apps/relay/tsconfig.json apps/relay/tsconfig.build.json apps/relay/
COPY apps/relay/src apps/relay/src
COPY packages/config/tsconfig.base.json packages/config/tsconfig.base.json
COPY packages/contracts/device-protocol packages/contracts/device-protocol
COPY packages/contracts/http packages/contracts/http

RUN pnpm --filter @portal/relay run build \
    && pnpm --filter @portal/relay deploy --prod /opt/relay

FROM ${NODE_IMAGE} AS runtime

USER root
WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

ENV NODE_ENV=production

COPY --from=build /opt/relay/package.json ./package.json
COPY --from=build /opt/relay/dist ./dist
COPY --from=build /opt/relay/node_modules ./node_modules
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/device-protocol ./packages/contracts/device-protocol
COPY --from=build /workspace/packages/contracts/http ./packages/contracts/http

# Node 24 strips the workspace package's TypeScript at runtime, but refuses to do
# so when pnpm's deployed copy resolves physically from inside node_modules.
RUN rm node_modules/@portal/contracts \
    && ln -s ../../packages/contracts node_modules/@portal/contracts \
    && ln -s .pnpm/node_modules/ajv node_modules/ajv \
    && ln -s ../../node_modules/.pnpm/node_modules packages/contracts/node_modules

USER node

EXPOSE 8443 9091

CMD ["node", "dist/main.js"]
