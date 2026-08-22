# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV CI=true
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS development
ENV NODE_ENV=development \
    PORT=3001 \
    VITE_HOST=0.0.0.0
COPY . .
EXPOSE 5173 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "npm run dev:backend & npm exec vite -- --host 0.0.0.0 --port 5173"]

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS production
ENV NODE_ENV=production \
    PORT=3001
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/tsconfig.json /app/tsconfig.node.json ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 5173 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "node --loader ts-node/esm server/index.ts & npm exec vite -- preview --host 0.0.0.0 --port 5173"]
