# Build from the repository root: docker build -f frontend/Dockerfile .
# The runner target serves Next.js; the worker target runs the crawler worker.

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` collects page data in ~1 worker per CPU, and every worker that
# imports `@/server/db/client` opens cwd/data/apsi.sqlite (the path is a module
# constant; DATABASE_PATH is not consulted there) and runs
# `pragma journal_mode = WAL`. When that file does not exist yet, the workers
# race to create it and switch journal mode, and the losers abort the build with
# `SqliteError: database is locked` (SQLITE_BUSY). Reproduced here as an
# intermittent failure of `--target runner`. Creating the file in WAL mode first
# makes each worker's pragma a no-op read, so the build is deterministic.
RUN node -e "const D=require('better-sqlite3');require('node:fs').mkdirSync('data',{recursive:true});const d=new D('data/apsi.sqlite');d.pragma('journal_mode = WAL');d.close()"
RUN npm run build

# Both entry points execute the same Python fetch-task contract. Scrapling stays
# in its own parser service; the crawler runtime only needs its own dependencies.
FROM node:20-alpine AS crawler-runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 py3-pip tzdata \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY crawler/requirements-runtime.txt /tmp/crawler-requirements.txt
RUN python3 -m venv /opt/crawler-venv \
    && /opt/crawler-venv/bin/python -m pip install --no-cache-dir -r /tmp/crawler-requirements.txt
COPY --chown=nextjs:nodejs crawler/apsi_crawler /crawler/apsi_crawler
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    CRAWLER_DIRECTORY=/crawler CRAWLER_PYTHON_BIN=/opt/crawler-venv/bin/python \
    PATH="/opt/crawler-venv/bin:${PATH}" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

FROM crawler-runtime AS worker
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs frontend/package.json frontend/package-lock.json frontend/tsconfig.json ./
COPY --chown=nextjs:nodejs frontend/src ./src
COPY --chown=nextjs:nodejs frontend/scripts ./scripts
USER nextjs
CMD ["node_modules/.bin/tsx", "scripts/crawler-worker.ts"]

FROM crawler-runtime AS runner
ENV PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
