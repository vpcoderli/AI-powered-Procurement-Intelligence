# scrapling-extractor

Parser-only sidecar (Scrapling 0.4.15 base package, no fetchers) that turns a bid detail page's HTML into structured fields. The crawler fetches pages itself; this service never makes outbound requests.

- Local: `./run-local.sh` (needs python3.12) → http://localhost:8091
- Docker: `docker compose up scrapling-extractor`
- API: `GET /health`, `POST /extract {url, html, fields, selectors}`
- Tests: `.venv/bin/python -m pytest tests`

Real portal samples and the per-source selector notes live in `tests/fixtures/live/README.md`.
