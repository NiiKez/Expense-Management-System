# Stage 1: Build
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build

WORKDIR /app
ENV NODE_ENV=development

COPY server/package.json server/package-lock.json ./
# --ignore-scripts: prevents arbitrary code execution from postinstall hooks
# in transitive dependencies during the build stage.
RUN npm ci --ignore-scripts

COPY server/ .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

WORKDIR /app
ENV NODE_ENV=production

# OCI metadata links the published GHCR image back to the source repo/commit.
# CI can pass --build-arg IMAGE_REVISION=$GITHUB_SHA for provenance.
ARG IMAGE_REVISION=""
LABEL org.opencontainers.image.title="expense-management-server" \
      org.opencontainers.image.description="Expense Management System API (Node.js/Express)" \
      org.opencontainers.image.source="https://github.com/NiiKez/Expense-Management-System" \
      org.opencontainers.image.revision="${IMAGE_REVISION}"

# tini as PID 1 so the app receives SIGTERM on `docker stop` and shuts down
# gracefully (drains the MySQL pool); also reaps any zombie child processes.
RUN apk add --no-cache tini=0.19.0-r3

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build --chown=appuser:appgroup /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build --chown=appuser:appgroup /app/dist ./dist
RUN mkdir -p /app/dist/uploads && chown -R appuser:appgroup /app/dist/uploads

USER appuser

EXPOSE 3000

# Validates DB connectivity via /api/v1/health. Uses node's http module so we
# don't need wget/curl in the runtime image. start-period gives the app time
# to wait on the MySQL pool on first boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
