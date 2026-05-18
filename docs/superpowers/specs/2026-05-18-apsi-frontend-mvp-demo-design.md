# APSi Frontend MVP Demo Design

## 1. Purpose

This design defines the first functional implementation slice for APSi after the documentation reorganization: a front-end MVP demo workflow using mock data.

The goal is to make the current Next.js front end demonstrate the core PRD journey without adding a real backend, database, authentication system, crawler, or AI document parsing.

The target user is a US-based government procurement supplier. The default product language should therefore be English, with Chinese available through the existing language switcher for bilingual demos and Chinese-speaking stakeholders.

## 2. Scope

### 2.1 In Scope

- Keep the first screen as the bid search workspace.
- Use mock data to support an end-to-end bid discovery workflow.
- Expand mock bid fields to better match the PRD.
- Improve the search workspace with keyword search, source/state filters, issuer type filters, published date filters, deadline filters, sorting, result counts, and empty states.
- Improve bid cards so users can scan source, issuer, amount, published date, deadline, and saved state.
- Improve bid details so users can see metadata, contact information, source link, description, attachments, and saved state.
- Keep saved bid state shared across list, detail, and saved pages.
- Improve the saved bids page so users can inspect saved bids, open detail pages, remove saved bids, and understand the empty state.
- Extend bilingual UI coverage across the search workspace, bid cards, detail page, saved page, and core empty/error states.
- Preserve the existing quiet, professional, information-dense B2B visual direction.

### 2.2 Out Of Scope

- Real registration, login, logout, password reset, or authenticated sessions.
- Backend API routes.
- Database schema or persistence beyond existing front-end state.
- Real crawler implementation.
- Real SAM.gov or state portal integration.
- Search alerts or email notifications.
- AI RFP summaries or attachment parsing.
- URL locale routing, server-side language cookies, or translated bid source content.
- Translating mock bid descriptions, source URLs, or attachment names.

## 3. Current Project Context

The front end already includes:

- `frontend/src/app/page.tsx`: current bid search dashboard using `MOCK_BIDS`.
- `frontend/src/app/bids/[id]/page.tsx`: current bid detail page.
- `frontend/src/app/saved/page.tsx`: current saved bids page.
- `frontend/src/components/bids/BidCard.tsx`: reusable bid card.
- `frontend/src/context/SavedBidsContext.tsx`: saved bid state.
- `frontend/src/lib/mock-data.ts`: mock bid list.
- `frontend/src/lib/i18n/LanguageContext.tsx`: language context.
- `frontend/src/lib/i18n/dictionaries/en.ts`: English dictionary.
- `frontend/src/lib/i18n/dictionaries/zh.ts`: Chinese dictionary.
- `frontend/src/components/i18n/LanguageSwitcher.tsx`: existing language switcher in the app header.

The existing `/search` route is currently a saved search and alert management page. This first slice should not make `/search` the primary bid search surface. The homepage `/` remains the MVP search workspace.

## 4. Architecture

This slice stays entirely in the front end.

`MOCK_BIDS` remains the data source. The implementation should add a typed bid shape and richer sample data, then let the homepage derive filtered and sorted results from that data.

Search and filter state stays local to `frontend/src/app/page.tsx`. Saved bid state stays in `SavedBidsContext`. This keeps the first slice simple and avoids introducing a global state library before real API integration exists.

The main component boundaries are:

- `mock-data.ts`: bid type, source/state metadata, and mock bid records.
- `page.tsx`: search workspace state, filter logic, sorting, result count, and empty state.
- `BidCard.tsx`: single bid summary display and save button.
- `bids/[id]/page.tsx`: bid lookup and full details.
- `saved/page.tsx`: saved bid list and empty state.
- `en.ts` and `zh.ts`: UI copy for the core workflow.

## 5. Data Model

Mock bids should include enough PRD-aligned fields for the demo:

- `id`
- `title`
- `source`
- `stateCode`
- `issuerName`
- `issuerType`: `federal` or `state`
- `amount`
- `deadlineDate`
- `publishedDate`
- `description`
- `fullDescription`
- `originalCategory`
- `contactName`
- `contactEmail`
- `contactPhone`
- `sourceUrl`
- `attachments`
- `tags`
- `isActive`
- `saved`

Attachments should include:

- `name`
- `size`
- `url`

The implementation can keep backward-compatible aliases only when needed to avoid a noisy one-step rewrite, but the UI should prefer the PRD-aligned names.

## 6. User Experience

### 6.1 Search Workspace

The homepage should act as the main bid search workspace.

It should support:

- Keyword search against title, description, issuer name, tags, and original category.
- Source/state filters including Federal/SAM.gov and available state examples.
- Issuer type filter for Federal and State.
- Published date presets.
- Deadline presets.
- Sorting by relevance, newest, and soonest deadline.
- Clear filters action.
- Result count.
- Empty result state with a clear filters action.

The search workspace should be dense but organized. It should prioritize scanning and repeated use over decorative presentation.

### 6.2 Bid Cards

Bid cards should show:

- Source badge.
- Issuer name.
- Bid title.
- Description snippet.
- Deadline date.
- Published date.
- Amount if available.
- Issuer type or state/source cue.
- Save or saved state.

Clicking the card opens the details page. Clicking the save button should not trigger navigation.

### 6.3 Bid Details

The detail page should show:

- Back to results action.
- Save or saved action.
- View original source action.
- Source badge.
- Issuer name.
- Title.
- Metadata grid.
- Contact information.
- Full description.
- Attachments list.
- Empty attachment state.
- Bid not found state.

Attachment actions should open the provided mock URLs or source-style links. This slice does not download or parse files.

### 6.4 Saved Bids

The saved bids page should show:

- Number of saved bids.
- Saved bid cards.
- Ability to remove a saved bid through the shared save button.
- Empty state with a button back to the search workspace.

Saved state should remain consistent across homepage, detail page, and saved page during the current browser session.

## 7. Internationalization

The default product language is English. The existing language switcher remains available in the header.

This slice should extend dictionaries so the following areas use `t(...)` instead of hardcoded strings:

- Sidebar labels that already use i18n should continue to work.
- Search workspace labels, placeholders, filters, sorting, result count, and empty state.
- Bid card labels such as posted, deadline, save, saved, source, and value.
- Bid detail labels such as back to results, view source, detailed description, attachments, contact, issuer type, published, deadline, and estimated value.
- Saved bids page labels, count copy, empty state, and browse bids action.

Mock bid titles, descriptions, attachment names, source names, and source URLs should remain English because real US government procurement data is expected to be English.

## 8. Error And Empty States

The implementation should cover:

- No search results.
- Bid detail not found.
- Bid with no attachments.
- No saved bids.

Each state should provide a clear next action, such as clearing filters, returning to results, viewing the original source, or browsing bids.

## 9. Testing And Verification

Verification should include:

- `npm run lint` from `frontend/`.
- `npm run build` from `frontend/`.
- Run the development server and inspect the core flow in a browser.
- Verify English and Chinese switching across the main workflow.
- Verify keyword search finds a known bid.
- Verify state/source and issuer type filters affect results.
- Verify published date and deadline presets affect results.
- Verify sorting changes result order.
- Verify opening a bid detail shows metadata, contact info, source link, description, and attachments.
- Verify saving and unsaving a bid updates the homepage, detail page, and saved bids page consistently.
- Verify empty states for no results and no saved bids.
- Verify the layout remains usable at desktop width and basic mobile width.

## 10. Acceptance Criteria

- The homepage presents a usable bid search workspace, not a marketing landing page.
- The demo supports the full path: search, filter, open detail, save, view saved bids, remove saved bid.
- The UI copy for the main workflow supports English and Chinese switching.
- PRD-aligned mock data fields appear in the UI.
- Bid details include contact information and attachments.
- Empty and not-found states are clear and actionable.
- No real backend, crawler, authentication, or AI parsing work is introduced in this slice.
- Lint and build pass.

## 11. Open Decisions Resolved

- First implementation slice: front-end end-to-end demo workflow.
- Default audience language: English.
- Chinese support: included through the existing language switcher.
- Mock bid body language: remains English.
- Data source: `MOCK_BIDS`, not API.
- Homepage role: primary bid search workspace.
