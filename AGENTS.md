# Repository Guidelines

## Project Structure & Module Organization

- `frontend/src/app/`: pages, layouts, and API routes; `src/server/`: database access and business services. Keep database code server-side.
- `frontend/src/components/`, `hooks/`, `context/`, and `lib/`: UI, shared behavior, types, and English/Chinese dictionaries. Static assets live in `frontend/public/`.
- `frontend/scripts/`: migrations, workers, seeds, and checks. Tests sit alongside source and scripts.
- `crawler/apsi_crawler/`: spiders, source registry, normalization, storage, enrichment, list extraction, and read-only tenant-path discovery; `crawler/tests/`: tests and fixtures.
- `services/scrapling-extractor/`: independent HTML parsing service (`/extract` for detail pages, `/extract-list` for list pages) and pytest suite.
- `services/browser-downloader/`: independent Playwright/Chromium sidecar — `/download` for form- or JavaScript-driven portal attachments, `/render` for JavaScript-built list pages — and its pytest suite. Public pages only: it never signs in, solves CAPTCHAs, or leaves the caller's allowed hosts.
- `docs/`: requirements, architecture, QA, and operations guides.

## Build, Test, and Development Commands

Use Node.js 20; from `frontend/`:

- `npm ci`: install locked dependencies.
- `npm run dev`: start development at `http://localhost:3000`.
- `npm run build` / `npm start`: build and serve production output.
- `npm run lint` / `npm test`: run ESLint and Vitest.
- `npm run db:migrate`: apply SQLite migrations; `npm run db:mysql:migrate`: migrate configured MySQL.

Install each Python component's `requirements.txt` in its own virtual environment (`crawler/requirements-runtime.txt` is the runtime-only subset baked into the container images). `npm run test:crawler-integration` needs one Python >= 3.10 interpreter with both components' requirements installed. From the repository root, run `PYTHONPATH=crawler python3 -m pytest crawler/tests`. From `services/scrapling-extractor/`, run `python -m pytest tests` in its environment. Its `./run-local.sh` starts the service and defaults to Python 3.12.

## Coding Style & Naming Conventions

Match surrounding code: TypeScript uses two-space indentation, double quotes, semicolons, strict types, and `@/` imports. Use PascalCase for React components, camelCase for functions, and kebab-case for service modules. Python uses four spaces and snake_case. ESLint extends Next.js Core Web Vitals and TypeScript rules. Update both language dictionaries for translated UI changes.

## Testing Guidelines

Use colocated `*.test.ts` files for Vitest and `test_*.py` for pytest. Prefer deterministic fixtures and mocked network calls. No numeric coverage threshold is configured. Cover changed behavior and relevant SQLite/MySQL paths. CI covers frontend, both Python suites, and database integration. Run `npm run test:crawler-integration` with the documented Python/MySQL environment.

## Crawler Integration

Read [the crawler flow](docs/architecture/crawler-enrichment-flow.md) before crawler changes. Scrapling parses HTML fetched by the existing crawler. Verify normalization, enrichment, both importers, and displayed descriptions together; use field provenance to protect enriched content and archives during reimports.

## Commit & Pull Request Guidelines

Use Conventional Commits: `feat(admin): ...`, `fix(crawler): ...`, `docs: ...`. PRs should explain changes, link issues, report validation, include UI screenshots, and document configuration/migration impacts.

## Configuration & Agent Instructions

Keep secrets in `frontend/.env.local`; exclude credentials and generated user artifacts from commits. Keep the extractor private. Before frontend changes, follow `frontend/AGENTS.md` and consult bundled Next.js documentation as directed there.
