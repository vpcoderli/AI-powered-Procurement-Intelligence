# WinBids Drive Source Inventory

Updated: 2026-05-28

## Source

Drive folder: `WinBids Product Design`

URL: https://drive.google.com/drive/folders/1k41va8s9BV1Bk6PKnPqiAMm6SSa_Gbxc

Extraction result:

- Folder entries scanned: 64
- Leaf files read: 34
- Read success: 34
- Read failures: 0
- Temporary extraction directory: `/tmp/winbids-drive-extract`
- Extraction manifest: `/tmp/winbids-drive-extract/manifest.json`

## Canonical Local Reading Order

Use these documents as the local source hierarchy for future planning. When documents disagree, prefer newer or more specific documents in this order:

1. Product Road Map & PRD Writing Management Plan.
2. Master Product PRD.
3. MVP Release Plan PRD.
4. Data Model PRD.
5. Architecture Map documents.
6. Module PRDs.
7. Prototype HTML files.
8. Older workflow notes.

## Read Files

| # | File | Lines | Notes |
|---|---|---:|---|
| 1 | `1 WinBids Product Vision` | 43 | One-page product vision and promise. |
| 2 | `3 Win Bids CTO Build Pack.docx` | 2423 | Technical execution pack, phase cutline, API, data, screens, stories. |
| 3 | `Winbids Global State Machine Lifecycle Architecture V2.docx` | 742 | MVP lifecycle states, transitions, automation, notifications. |
| 4 | `Winbids MVP API & Event Architecture.docx` | 1658 | API groups, event model, status values, service boundaries. |
| 5 | `Winbids MVP UX Route & Page Architecture.docx` | 1261 | Route map and page-level behavior. |
| 6 | `Winbids Unified Database Entity Relationship Map.docx` | 1147 | Entity relationship map for MVP. |
| 7 | `Winbids Unified Product System Map_Comprehensive Ideal.docx` | 511 | Ideal product system map. |
| 8 | `Winbids Unified Product System Map_MVP Focus.docx` | 478 | MVP-focused product system map. |
| 9 | `winbids_knowledge_station_complete_prd.docx` | 1966 | Complete Knowledge Station PRD. |
| 10 | `winbids_knowledge_station_mvp_prd.docx` | 338 | Lightweight Knowledge Station MVP PRD. |
| 11 | `winbids_homepage_mvp_html.html` | 1126 | Homepage prototype. |
| 12 | `UI Modes 3 Types` | 94 | Three UI modes and product UI framing. |
| 13 | `WinBids_Master_Product_PRD.docx` | 2083 | Full MVP product document and source of truth. |
| 14 | `WinBids_MVP_Release_Plan_PRD.docx` | 257 | MVP release plan and cutline. |
| 15 | `Winbids Data Model.docx` | 3068 | Core object model and status fields. |
| 16 | `WinBids_User_Account_and_Subscription_PRD.docx` | 1011 | Account, company, plans, trial, usage limits. |
| 17 | `WinBids_Security_Roles_Permissions_PRD.docx` | 505 | Access control and company data isolation. |
| 18 | `Bid Admin Prd.docx` | 1274 | Admin review, correction, publishing, QA. |
| 19 | `Bid Data Ingestion Normalization Prd.docx` | 1114 | Fetch, parse, normalize, dedupe, searchable records. |
| 20 | `PRD: WinBids Federal & 50-State Bid Data Module` | 1952 | Federal and state source registry and connector strategy. |
| 21 | `WinBids Non-Federal / Non-State Bid Source Discovery Module` | 1418 | Local, education, district, and aggregator source strategy. |
| 22 | `Bid Display Search Filters Prd.docx` | 1215 | Bid search, cards, filters, detail pages, saved searches. |
| 23 | `Bid_Match_Scoring_PRD.docx` | 1283 | Match score, priority score, explainability, penalties. |
| 24 | `UI Design _Supplier Profile` | 1314 | Supplier profile UI design. |
| 25 | `PRD_Supplier Profile Build` | 1583 | Supplier signup and profile requirements. |
| 26 | `Winbids_prototype_Signup & Build Supplier Profile.html` | 1604 | Supplier profile prototype. |
| 27 | `Bid Display_More Details` | 1189 | Older guided bid display details. |
| 28 | `Bids Scrap & Display` | 1456 | Older bid fetching and display workflow. |
| 29 | `Product Prototype_Winbids_Admin_Bids.html` | 2074 | Admin bid prototype. |
| 30 | `Intent_to_Bid_PRD.docx` | 1034 | Intent to Bid module. |
| 31 | `Bid_Understanding_Assistant_PRD.docx` | 847 | AI bid brief, checklist, risk flags, requirements extraction. |
| 32 | `winbids_mvp_ux_prototype_May 28.html` | 711 | Current MVP UX prototype. |
| 33 | `Winbids_Prototype.html` | 542 | Prototype file. |
| 34 | `Product Road Map & PRD Writing Management Plan` | 48 | PRD module roadmap and status table. |

## Product Roadmap Modules

The roadmap spreadsheet organizes the product into these major groups:

| Product | Scope |
|---|---|
| Product 0: Platform Foundation | Account, subscription placeholder, roles, security, data model, dashboard, homepage. |
| Product 1: Bid Discovery | Source discovery, ingestion, normalization, admin QA, display, search, saved bids, matching. |
| Product 2: Bid Qualification & Pursuit Decisioning | Intent, bid understanding, compliance manifest, pursue/no-bid, no-bid taxonomy. |
| Product 3: Bid Response Workspace | Tasks, documents, quotes, reminders, reusable artifacts. |
| Product 4: Submission Guidance & Confirmation | External submission path, confirmation record, submission route guidance. |
| Product 5: Award Tracking & Learning | Status tracking, award/tabulation, win/loss analysis, fulfillment reminders. |
| Product 6: Procurement Intelligence | Buyer, competitor, pricing, category, forecasting, supplier performance intelligence. |
| Product 6.7 / 7: Knowledge Station | Reusable knowledge capture and retrieval layer. |

## Local Follow-Up Documents

This source inventory feeds:

- `docs/product-requirements/winbids-unified-prd.md`
- `docs/product-requirements/winbids-current-gap-analysis.md`
- `docs/product-requirements/winbids-next-development-plan.md`
