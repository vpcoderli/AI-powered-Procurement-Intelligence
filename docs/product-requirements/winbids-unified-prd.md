# WinBids Unified Product Requirements

Updated: 2026-05-28

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

### Product 1: Bid Discovery

Purpose: collect, normalize, QA, search, display, save, and match public-sector bid opportunities.

Core modules:

- Federal and state bid data source discovery.
- Local, education, district, and non-state source discovery.
- Supplier profile.
- Bid ingestion and normalization.
- Bid admin QA.
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

Purpose: capture reusable knowledge from bid documents, requirements, compliance checklists, supplier artifacts, awards, and prior pursuit outcomes.

MVP role:

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

## Phase Cutline

### Phase 1: Core Bid Discovery and Intent Workflow

Goal: prove users can create a profile, view matched bids, save a bid, and start evaluation.

Must build:

- Homepage.
- Sign up / sign in.
- Supplier profile.
- Bid source and bid database.
- Bid fetch / normalize with admin/manual import plus first connectors.
- Bid display / search / filter.
- Match score v1.
- Save bid.
- Add to Intent to Bid.
- AI bid brief v1.
- Initial checklist v1.
- Basic admin bid review.

Do not build yet:

- Full submission management.
- Full quote management.
- Full win/loss analysis.
- Advanced billing.
- Team accounts.
- Direct bid submission.

### Phase 2: Submission Management and Tracking

Goal: help users understand where and how to submit outside WinBids.

Must build:

- Submission path object.
- Submission complexity score.
- Submission readiness checklist.
- External submission guidance.
- Submission confirmation.
- Official bid status tracking.
- User pursuit status tracking.
- Reminder checkpoints.

### Phase 3: Supply Chain and Quote Support

Goal: help users understand whether they can source competitively for a bid.

Must build:

- Sourcing partner database.
- Freight partner database.
- Supplier match for bid.
- Quote inquiry template.
- Copy-to-clipboard quote inquiry.
- Manual mark-as-sent.
- Manual quote entry.
- Quote attachment upload.
- Quote comparison table.
- Quote status tracking.

### Phase 4: Award, Tabulation, and Win/Loss Learning

Goal: turn bid results into learning data.

Must build:

- Award record.
- Tabulation record.
- Award/tabulation notification.
- Loss debrief.
- Win analysis.
- Future bid recommendation update.
- Fulfillment preparation reminder.

### Phase 5: Advanced Integrations

Future only:

- Gmail / Outlook integration.
- Calendar integration.
- Team workflow.
- Supplier quote portal.
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
- CA/TX/NY/FL/IL state crawler runner flow.
- Supplier profile API and page.
- Deterministic match score v1.
- Intent to Bid API, list page, detail page, and bid-detail pursuit panel.
- Deterministic AI brief/checklist/risk flags.
- Bilingual English/Chinese UI shell.
- Static Generative Art Platform UI exploration route.

This means the next product work should focus on deepening Product 2 and then moving into Phase 2 submission guidance, not restarting Product 0/P1 from scratch.
