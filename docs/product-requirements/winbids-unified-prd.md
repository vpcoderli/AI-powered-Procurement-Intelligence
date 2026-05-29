# WinBids Unified Product Requirements

Updated: 2026-05-29

## Product Vision

WinBids is an AI-powered bid pursuit assistant for small and mid-sized suppliers bidding on public-sector opportunities. It is not only a bid search product. It guides suppliers through discovery, bid understanding, sourcing readiness, pursue/no-bid decisioning, preparation, external submission guidance, award tracking, and win/loss learning.

## Core Promise

Most bid platforms help suppliers find opportunities. WinBids helps suppliers decide whether to bid, prepare correctly, submit through the correct external process, and improve future win probability.

## Target Users

Primary users are small and mid-sized suppliers that sell, or want to sell, to public agencies without a mature internal bid team.

Representative supplier types:

- Food distributors.
- Office supply vendors.
- Cleaning and maintenance suppliers.
- Construction material suppliers.
- Medical supply vendors.
- Educational supply vendors.
- Freight and logistics companies.
- Small manufacturers.
- Minority-, woman-, veteran-, and small-business-certified suppliers.

## Product Boundary

WinBids should support the supplier's work before and after external submission, but it should not become the official submission portal in the MVP.

MVP workflow:

1. Matched bid discovery.
2. Intent to Bid.
3. Bid brief and checklist.
4. Submission path warning.
5. Basic sourcing and quote support.
6. Pursue or no-bid decision.
7. Preparation workspace.
8. External submission guidance.
9. Submission confirmation.
10. Award tracking.
11. Win/loss analysis.
12. Fulfillment preparation reminder.

## Latest Drive Adjustment

The 2026-05-29 Drive refresh adds four major planning changes:

- Commercial packaging should use Free, Pursuit Starter, Response Builder, Growth, and Enterprise as the product language. The current local `pro` and `business` tiers should be treated as compatibility names until migrated or aliased.
- Credits are a first-class metering layer for premium actions such as full bid brief generation, compliance manifest generation, readiness review, response drafting, package review, amendment delta review, tabulation analysis, and price-to-win analysis.
- Product 1 data work is split into Source Registry, Connector Data Ingestion Engine, Bid Data Normalization/Storage/Data Quality, and Bid Admin/Data QA. The crawler work should be aligned to these boundaries instead of treated as one generic scraper layer.
- Knowledge Station is Product 0.9 / workflow coaching for MVP support, not only a far-future standalone knowledge product.

## Differentiators

### Bid Match Guidance

WinBids ranks and explains opportunities against supplier profile, location, category, certifications, contract size, deadline feasibility, and known risks.

### Pursue / No-Bid Assistant

WinBids helps suppliers make disciplined bid decisions. No-bid reasons should be structured so they can later become supplier learning data and buyer-side intelligence.

### Supply Chain Matching

WinBids should help suppliers understand sourcing feasibility through partners, freight contacts, quotes, product/category coverage, and fulfillment readiness.

### Submission Path Guidance

WinBids should reduce the pain of external portals, registrations, intent steps, addenda, separate instructions, file naming, physical delivery, and strict deadlines.

### Win/Loss Learning Loop

WinBids should turn awards, tabulations, loss reasons, buyer patterns, pricing, and pursuit outcomes into better future recommendations.

## MVP Product Modules

### Product 0: Platform Foundation

Purpose: establish the base account, data, role, and product shell needed for the MVP.

Core modules:

- Master PRD.
- MVP release plan.
- Data model.
- User account and subscription placeholder.
- Security, roles, and permissions.
- Shared AI system rules.
- Basic dashboard.
- Homepage and marketing entry.
- Product 0.9 Knowledge Station Lite / workflow coaching.

Commercial modules:

- Free account and onboarding.
- Pursuit Starter activation.
- Response Builder activation.
- Growth plan placeholder for award learning and intelligence.
- Enterprise sales-led governance.
- Credits, credit ledger, usage, and contextual paywalls.

### Product 1: Bid Discovery

Purpose: collect, normalize, QA, search, display, save, and match public-sector bid opportunities.

Core modules:

- Source Registry and Source Discovery for federal, state, local, education, airport, utility, healthcare, and other SLED sources.
- Connector Data Ingestion Engine.
- Bid Data Normalization, Storage, and Data Quality.
- Supplier profile.
- Bid Admin and Data QA.
- Bid display, search, filters, detail page, saved bids, saved search alerts.
- Bid match scoring.

### Product 2: Bid Qualification & Pursuit Decisioning

Purpose: create the first meaningful pursuit workflow after a supplier finds a bid.

Core modules:

- Intent to Bid.
- Bid Understanding Assistant.
- Compliance manifest.
- Pursue / no-bid assistant.
- No-bid reason taxonomy.

### Product 3: Bid Response Workspace

Purpose: turn requirements into work.

Core modules:

- Bid pursuit workspace.
- Artifact vault.
- Supply chain management.
- Quote inquiry and quote management.
- Deadline notifications and reminders.

### Product 4: Submission Guidance & Confirmation

Purpose: help users submit outside WinBids through the correct external process.

Core modules:

- Submission management.
- Submission confirmation.
- External portal/readiness guidance.
- Submission method, confirmation number, email, screenshot, or receipt capture.

### Product 5: Award Tracking & Learning

Purpose: track official outcomes and convert them into future learning.

Core modules:

- Bid status tracking.
- Award and tabulation records.
- Win/loss analysis.
- Fulfillment preparation reminders.
- Award/status notifications.

### Product 6: Procurement Intelligence

Purpose: convert bid, award, pricing, buyer, and supplier activity history into strategic intelligence.

Core modules:

- Buyer intelligence.
- Competitor intelligence.
- Pricing intelligence.
- Category intelligence.
- Opportunity forecasting.
- Supplier performance intelligence.

### Knowledge Station

Purpose: provide embedded workflow coaching and later capture reusable knowledge from bid documents, requirements, compliance checklists, supplier artifacts, awards, and prior pursuit outcomes.

MVP role:

- Explain bid concepts, product workflow, and next steps in context.
- Provide glossary terms, coaching snippets, and mini playbooks.
- Support bid understanding and preparation.
- Store reusable requirements and lessons.
- Avoid becoming a full enterprise knowledge system before core pursuit workflow is useful.

## MVP Success Definition

The MVP is successful when a supplier can:

1. Create an account.
2. Build a supplier profile.
3. View matched open bids.
4. Save bids.
5. Add a bid to Intent to Bid.
6. Understand requirements through an AI brief and checklist.
7. Review submission complexity and portal readiness.
8. Manage basic sourcing partners and quotes.
9. Decide pursue/no-bid with AI guidance.
10. Prepare documents using a compliance checklist.
11. Submit outside WinBids using clear guidance.
12. Confirm submission inside WinBids.
13. Track award and tabulation updates.
14. Receive win/loss analysis.
15. Receive fulfillment preparation reminders after award.

## MVP Guardrails

- Do not build direct bid submission in the MVP.
- Do not build full quote portals before manual quote workflows prove useful.
- Do not build CRM, ERP, purchase order, invoice, or fulfillment management in the MVP.
- Do not over-automate source ingestion where manual admin QA is safer.
- AI output must be explainable, cite source fields or documents when possible, show confidence, and avoid legal guarantees.

## Release Cutline

### R0: Planning Readiness

Goal: align scope, architecture, launch guardrails, and commercial model.

Must build or maintain:

- Master Product PRD.
- MVP Release Plan PRD.
- Data Model PRD.
- AI System PRD.
- Security / roles / permissions.
- User account and subscription foundation.
- Basic dashboard and homepage direction.
- Commercial packaging and credits roadmap.

### R1: Bid Discovery Alpha

Goal: users can create a profile, find bids, view bid details, save bids, and see match ranking.

Must build:

- Source Registry and source activation readiness.
- Connector ingestion and raw/attachment archival for approved sources.
- Normalization, data quality flags, dedupe signals, and admin QA routing.
- Bid display, search, filters, saved bids, saved searches/alerts.
- Supplier profile and match scoring.

### R2: Qualification Beta

Goal: users can save bids, understand requirements, and decide pursue/no-bid.

Must build:

- Intent to Bid.
- Bid Understanding Assistant.
- Compliance Manifest.
- Pursue / No-Bid Assistant.
- No-Bid Reason Taxonomy.
- Knowledge Station Lite.

### R3: MVP Launch

Goal: users can lightly manage a pursuit, receive submission guidance, confirm submission, and track outcomes.

Must build:

- Bid Pursuit Workspace Lite.
- Artifact Vault Lite.
- Deadline notifications.
- Submission Management and Submission Confirmation.
- Status Tracking.
- Award / Tabulation capture.
- Win/Loss Lite.
- Award/status alerts.

### R4: Post-MVP Expansion

Future only:

- Full supply chain management.
- Full quote management and supplier portal integrations.
- Full Knowledge Station.
- Product 6 Procurement Intelligence.
- Forecasting, pricing/category intelligence, buyer/competitor intelligence.
- Gmail / Outlook integration.
- Calendar integration.
- CRM / ERP export.
- PO management.
- Invoice management.
- Full fulfillment management.

## Current Local Implementation Snapshot

The current local codebase already includes:

- Next.js App Router frontend.
- Local SQLite/Drizzle data layer.
- Authentication APIs and anonymous principal fallback.
- Bid database, bid attachments, saved bids.
- Search, filters, saved bids, saved search alerts.
- Admin data sources and crawler logs.
- SAM.gov runner and state runner foundations.
- 50-state state runner registry with CA/TX/NY/FL/IL verified dedicated adapters and the other 45 state sources covered by beta dedicated adapters.
- Supplier profile API and page.
- Deterministic match score v1.
- Intent to Bid API, list page, detail page, and bid-detail pursuit panel.
- Deterministic AI brief/checklist/risk flags.
- Submission Guidance Lite.
- Compliance Manifest Lite.
- Pursue / No-Bid Decision Lite.
- Account, organization, tier, feature gate, usage limit, Stripe sandbox, invoice, customer portal, and notification foundations.
- Bilingual English/Chinese UI shell.
- Static Generative Art Platform UI exploration route.

This means the next product work should first reconcile commercial packaging and credits, then continue with Product 1 data pipeline hardening or Product 3/Knowledge workflow depth.
