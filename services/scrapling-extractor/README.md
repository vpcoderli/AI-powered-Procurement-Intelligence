# scrapling-extractor

Parser-only sidecar (Scrapling 0.4.15 base package, no fetchers) that turns a bid detail page's HTML into structured fields. The crawler fetches pages itself; this service never makes outbound requests.

- Local (the way to reach it from a host-run `npm run dev`): `./run-local.sh` (needs python3.12)
  → http://localhost:8091; set `SCRAPLING_EXTRACTOR_URL=http://localhost:8091` in `frontend/.env.local`.
- Docker: `docker compose up scrapling-extractor` — **internal-only**, no host port is published.
  The `app` container reaches it over compose DNS at `http://scrapling-extractor:8091`; from the
  host, use `docker compose exec scrapling-extractor …` (or `run-local.sh`), not `localhost:8091`.
  The service has no authentication and must never be exposed publicly.
- API: `GET /health`, `POST /extract {url, html, fields, selectors}`
- Tests: `.venv/bin/python -m pytest tests`

Real portal samples and the per-source selector notes live in `tests/fixtures/live/README.md`.
