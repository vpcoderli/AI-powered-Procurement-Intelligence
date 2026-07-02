# Known Limitations

This document lists transferability and production readiness gaps that a receiving team should understand before operating WinBids / APSI.

## Current Boundaries

- Full AWS infrastructure is not provisioned by this repository. The AWS service map and AWS deployment runbook document the target architecture and operating steps, but an operator must still create App Runner/ECS, RDS, Secrets Manager/SSM, CloudWatch, EventBridge, and backup resources.
- ECS/Fargate worker deployment needs a production container image or equivalent task runtime. The repository currently has no Dockerfile.
- SQLite is the current local database path. Production can start on durable SQLite only with explicit backup/restore ownership, but managed database migration should be planned before scale.
- Observability is basic: logs, provider dashboards, database state, and manual checks. Centralized metrics, tracing, alert routing, and uptime checks are future production requirements.
- Notification delivery supports file, console, generic HTTP, SES, and SendGrid provider paths, plus SES/SendGrid bounce/complaint/delivery webhook handling (`frontend/src/app/api/notifications/webhooks/`). `@aws-sdk/client-sesv2`/`@sendgrid/mail` still need `npm install`, and real SES/SendGrid account setup (verified sending domain, DKIM/SPF, production sending access) is still required before either adapter can send live email. See `docs/operations/notification-delivery-runbook.md`.
- Billing production readiness depends on live Stripe configuration, production webhook setup, secret rotation drills, and a low-risk live smoke test.
- Artifact Vault and response package exports default to local file storage helpers; an S3-compatible object storage adapter exists (`OBJECT_STORAGE_PROVIDER=s3`, either a hand-rolled SigV4 REST client or `@aws-sdk/client-s3` via `OBJECT_STORAGE_S3_CLIENT=aws-sdk`) but has not been validated against a real AWS bucket. Malware scanning (`OBJECT_STORAGE_MALWARE_SCANNER`) is a pluggable heuristic (file-type allowlist + size limit), not a real anti-malware engine; see `frontend/src/server/storage/malware-scan.ts` for how to integrate ClamAV or an AWS-native scanning service.
- Source ingestion governance is still being hardened. Login-required, paid, restricted, browser-check, or terms-uncertain sources must remain blocked or needs-review until approval exists.
- AI-backed extraction, confidence handling, prompt/version logging, and production LLM cost controls are not complete.
- Universal UX state coverage is not yet complete across every route.

## Local Safe Defaults

Local development may use:

```bash
cd frontend
NOTIFICATION_PROVIDER=file npm run worker:notifications:check
STATE_CRAWLER_LIMIT=5 npm run crawler:once
```

These local defaults are not proof of production readiness.

## Production Before Launch

Before production launch, close or explicitly accept these gaps:

- Backup and restore has been tested on production-like data.
- Deployment rollback owner and command path are documented.
- Production secrets are stored in a secret manager.
- Production notification provider is configured and observed.
- Stripe live webhook endpoint is configured and monitored.
- Source ingestion approval status is documented for each active source.
- Incident response owner, on-call path, and observability dashboards are in place.
