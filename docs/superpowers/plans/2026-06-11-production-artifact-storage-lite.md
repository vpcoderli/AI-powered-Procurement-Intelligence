# Production Artifact Storage Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Artifact Vault and generated package storage from local-MVP behavior toward production-ready storage controls without requiring live AWS credentials.

**Architecture:** Keep the existing `ObjectStorageProvider` abstraction and S3-compatible SigV4 implementation. Add fail-closed production preflight metadata for signed URL/CDN, malware scanning, retention, and staging smoke evidence; add append-only artifact versions so a replacement file preserves prior manifests.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle SQLite schema, MySQL migration conversion, Vitest, existing Artifact Vault service/API/UI.

---

### Task 1: Production Storage Preflight Contract

**Files:**
- Modify: `frontend/src/server/storage/object-storage.ts`
- Modify: `frontend/src/server/storage/object-storage.test.ts`
- Modify: `frontend/src/server/operations/production-readiness.ts`
- Modify: `frontend/src/server/operations/production-readiness.test.ts`

- [ ] **Step 1: Write failing tests for production storage controls**

Add tests that require `OBJECT_STORAGE_PUBLIC_ACCESS`, `OBJECT_STORAGE_SIGNED_URL_MODE`, `OBJECT_STORAGE_CDN_URL`, `OBJECT_STORAGE_MALWARE_SCANNER`, `OBJECT_STORAGE_RETENTION_POLICY`, and `OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL` when strict production/staging mode uses S3.

- [ ] **Step 2: Implement validation**

Extend `ObjectStoragePreflightResult.s3` with configured markers for access mode, signed URL mode, optional CDN, malware scanner, retention policy, and staging smoke evidence.

- [ ] **Step 3: Keep secrets redacted**

Ensure summaries expose only `configured` markers and never echo credential refs, access keys, secret keys, endpoint tokens, or evidence URLs.

- [ ] **Step 4: Verify**

Run:

```bash
cd frontend
npm test -- src/server/storage/object-storage.test.ts src/server/operations/production-readiness.test.ts
```

Expected: all tests pass.

### Task 2: Artifact Version / Replace Data Model

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`
- Modify: `frontend/src/server/db/mysql.test.ts`
- Modify: `frontend/src/server/artifacts/types.ts`

- [ ] **Step 1: Write failing schema tests**

Assert `artifact_versions` table exists with artifact/user/intent/bid ids, version number, file manifest, storage provider, replacement reason, malware status, retention policy, created actor, and timestamp.

- [ ] **Step 2: Add schema and migration**

Create `artifact_versions` with indexes for artifact id, intent id, user id, and created timestamp. Keep MySQL row-size safe via existing migration converter.

- [ ] **Step 3: Add API types**

Add `SupplierArtifactVersion` and include `versions` on `SupplierArtifact`.

- [ ] **Step 4: Verify**

Run:

```bash
cd frontend
npm test -- src/server/db/schema.test.ts src/server/db/mysql.test.ts
```

Expected: schema and MySQL conversion tests pass.

### Task 3: Artifact Replace Service / API

**Files:**
- Modify: `frontend/src/server/artifacts/repository.ts`
- Modify: `frontend/src/server/artifacts/service.ts`
- Modify: `frontend/src/server/artifacts/service.test.ts`
- Modify: `frontend/src/app/api/intents/[id]/artifacts/[artifactId]/route.ts`
- Modify: `frontend/src/app/api/intents/[id]/artifacts/[artifactId]/route.test.ts`

- [ ] **Step 1: Write failing service test**

Upload an artifact, replace it with a new file, verify the artifact row points to the latest manifest, and verify version history keeps both version 1 and version 2 manifests with a replacement reason.

- [ ] **Step 2: Write failing route test**

Assert `PUT /api/intents/[id]/artifacts/[artifactId]` parses multipart replacement input, requires auth/feature gate, returns updated vault, and maps validation errors.

- [ ] **Step 3: Implement repository methods**

Add SQLite/MySQL methods for creating artifact version rows, listing versions by intent/artifact, finding max version number, and updating the current supplier artifact manifest.

- [ ] **Step 4: Implement service**

Add `replaceSupplierArtifact()` that validates file, runs malware scan, stores object, appends new version, updates current row, writes an audit event, and returns the hydrated vault.

- [ ] **Step 5: Implement route**

Add `PUT` handler to existing artifact route and reuse the route error handling.

- [ ] **Step 6: Verify**

Run:

```bash
cd frontend
npm test -- src/server/artifacts/service.test.ts 'src/app/api/intents/[id]/artifacts/[artifactId]/route.test.ts'
```

Expected: service and route tests pass.

### Task 4: Intent UI Replace / Version Display

**Files:**
- Modify: `frontend/src/components/intents/ArtifactVaultPanel.tsx`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/lib/api/intents.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Write failing static/API tests**

Assert client API exposes `replaceSupplierArtifact`, Intent page wires `onReplaceArtifact`, and Artifact Vault panel shows version count/latest manifest plus replacement controls.

- [ ] **Step 2: Implement client API**

Add multipart `PUT` helper.

- [ ] **Step 3: Implement UI**

Add a compact replacement file input, reason input, version count/latest replaced timestamp, and localized labels.

- [ ] **Step 4: Verify**

Run:

```bash
cd frontend
npm test -- src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts'
```

Expected: tests pass.

### Task 5: Documentation and Full Verification

**Files:**
- Modify: `docs/operations/aws-deployment-runbook.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`
- Modify: `frontend/README.md`

- [ ] **Step 1: Update docs**

Record completed Lite scope, exact verification commands, production-blocked real AWS smoke items, and remaining storage risks.

- [ ] **Step 2: Run full regression**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
set -a; [ -f .env.local ] && . ./.env.local; set +a; npm run db:mysql:migrate
set -a; [ -f .env.local ] && . ./.env.local; set +a; npm run db:mysql:smoke
npm run demo:check
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all commands pass. If AWS credentials are absent, do not claim live AWS validation; document it as blocked external evidence.

---

Self-review:
- Scope covers production storage configuration, version/replace, API/UI, and documentation.
- Live AWS/S3 staging smoke is intentionally not claimed without real credentials.
- No placeholders or future-only implementation steps remain in this Lite plan.
