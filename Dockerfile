FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY scripts/security-audit.mjs scripts/security-audit.mjs
COPY security/node-forge-1.4.0.json security/node-forge-1.4.0.json
RUN npm ci && npm ls --workspace @quan1/mobile expo react-native --depth=0
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json ./
COPY scripts/build-site.mjs scripts/build-site.mjs
ARG RELEASE_SHA
ARG RENDER_GIT_COMMIT
RUN npm run build:site

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /uvx /bin/
WORKDIR /app
COPY services/backend/pyproject.toml services/backend/uv.lock /app/services/backend/
WORKDIR /app/services/backend
RUN uv sync --frozen --no-dev --no-cache --no-install-project
COPY services/backend /app/services/backend
COPY --from=frontend /build/apps/web/dist /app/static
COPY scripts/release_migrate.py /app/scripts/release_migrate.py
ENV PATH="/app/services/backend/.venv/bin:$PATH"
ENV APP_ENV=production AI_MODE=worker COOKIE_SECURE=true STATIC_ROOT=/app/static
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
