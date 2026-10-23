FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json ./
COPY scripts/build-site.mjs scripts/build-site.mjs
RUN npm run build:site

FROM python:3.12-slim
WORKDIR /app
COPY services/backend /app/services/backend
RUN python -c "import subprocess,sys,tomllib; p=tomllib.load(open('/app/services/backend/pyproject.toml','rb')); subprocess.check_call([sys.executable,'-m','pip','install','--no-cache-dir',*p['project']['dependencies']])"
COPY --from=frontend /build/apps/web/dist /app/static
ENV APP_ENV=production AI_MODE=worker COOKIE_SECURE=true STATIC_ROOT=/app/static
WORKDIR /app/services/backend
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
