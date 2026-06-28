# ============================================================
# Combined image: Express API that also serves the built React client.
# One container, one port — suited to a Vercel-style PaaS that builds from a
# root Dockerfile and routes all traffic to a single port.
#
# Build context is the repo root.
# ============================================================

# ---- Stage 1: build the client (Vite) ----
# VITE_* values are inlined at build time, so they are build args. A PaaS that
# threads VITE_-prefixed project env vars in as --build-arg wires these up.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS client-build

WORKDIR /app/client
ENV NODE_ENV=development

ARG VITE_ENTRA_CLIENT_ID=""
ARG VITE_ENTRA_TENANT_ID="common"
ARG VITE_REDIRECT_URI=""
ARG VITE_API_URL="/api/v1"
ARG VITE_AUTH_MODE="msal"
ARG VITE_ENABLE_DEMO="false"

ENV VITE_ENTRA_CLIENT_ID="${VITE_ENTRA_CLIENT_ID}" \
    VITE_ENTRA_TENANT_ID="${VITE_ENTRA_TENANT_ID}" \
    VITE_REDIRECT_URI="${VITE_REDIRECT_URI}" \
    VITE_API_URL="${VITE_API_URL}" \
    VITE_AUTH_MODE="${VITE_AUTH_MODE}" \
    VITE_ENABLE_DEMO="${VITE_ENABLE_DEMO}"

COPY client/package.json client/package-lock.json ./
RUN npm ci --ignore-scripts

COPY client/ .
RUN npm run build

# ---- Stage 2: build the server (tsc) ----
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS server-build

WORKDIR /app
ENV NODE_ENV=development

COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts

COPY server/ .
RUN npm run build

# ---- Stage 3: production runtime ----
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

WORKDIR /app
ENV NODE_ENV=production
# Absolute path to the built client; app.ts serves it + an SPA fallback.
ENV CLIENT_DIST_PATH=/app/client-dist

ARG IMAGE_REVISION=""
LABEL org.opencontainers.image.title="expense-management" \
      org.opencontainers.image.description="Expense Management System (Express API + React client, single image)" \
      org.opencontainers.image.source="https://github.com/NiiKez/Expense-Management-System" \
      org.opencontainers.image.revision="${IMAGE_REVISION}"

# tini as PID 1 for clean SIGTERM handling (drains the MySQL pool) + zombie reaping.
RUN apk add --no-cache tini=0.19.0-r3

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Production server dependencies only.
COPY --from=server-build --chown=appuser:appgroup /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Compiled server + built client.
COPY --from=server-build --chown=appuser:appgroup /app/dist ./dist
COPY --from=client-build --chown=appuser:appgroup /app/client/dist ./client-dist

RUN mkdir -p /app/dist/uploads && chown -R appuser:appgroup /app/dist/uploads

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
