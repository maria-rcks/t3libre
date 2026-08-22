# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates curl tini docker.io \
      build-essential python3 pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${CODE_REVIEW_WEBHOOK_PORT:-3000}/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["node", "index.js"]
