# APSi Frontend MVP Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a front-end-only APSi MVP demo flow that lets a user search bids, filter results, inspect details, save bids, and switch between English and Chinese UI copy.

**Architecture:** Keep the slice entirely inside the existing Next.js front end. `MOCK_BIDS` remains the data source, search state stays local to the homepage, saved bid state stays in `SavedBidsContext`, and the existing i18n provider/dictionaries power English and Chinese UI copy.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, shadcn-style local UI components, lucide-react icons, existing `LanguageProvider`, existing `SavedBidsProvider`.

---

## File Structure

Modify these files:

- `frontend/src/lib/mock-data.ts`
  - Owns the exported `Bid`, `BidAttachment`, `IssuerType`, `DatePreset`, `SortOption`, `STATE_FILTERS`, and `MOCK_BIDS` data.
- `frontend/src/lib/i18n/dictionaries/en.ts`
  - Adds English UI copy for dashboard, bid cards, detail page, saved bids, filters, sorting, and shared labels.
- `frontend/src/lib/i18n/dictionaries/zh.ts`
  - Adds Chinese UI copy matching the English dictionary shape.
- `frontend/src/components/bids/BidCard.tsx`
  - Renders a PRD-aligned bid card using the new `Bid` type and translated labels.
- `frontend/src/app/page.tsx`
  - Renders the main search workspace with keyword search, filters, sorting, result count, and empty state.
- `frontend/src/app/bids/[id]/page.tsx`
  - Renders the bid detail page with contact info, metadata, attachments, source link, not-found state, and translations.
- `frontend/src/app/saved/page.tsx`
  - Renders saved bids with translated count copy and empty state.

Do not modify:

- Backend or API files.
- Crawler files.
- Authentication/session code.
- Root repository `README.md`.
- The existing `/search` saved alerts page, unless a later product decision repurposes it.

---

### Task 1: Expand Mock Bid Data Model

**Files:**
- Modify: `frontend/src/lib/mock-data.ts`

- [ ] **Step 1: Replace the ad hoc mock data shape with typed exports**

Edit `frontend/src/lib/mock-data.ts` so it exports these types and constants:

```ts
export type IssuerType = "federal" | "state";

export type SortOption = "relevance" | "newest" | "deadline";

export type DatePreset = "any" | "next7" | "next30" | "last24" | "last7";

export interface BidAttachment {
  name: string;
  size: string;
  url: string;
}

export interface Bid {
  id: string;
  title: string;
  source: string;
  stateCode: string;
  issuerName: string;
  issuerType: IssuerType;
  amount: string;
  deadlineDate: string;
  publishedDate: string;
  description: string;
  fullDescription: string;
  originalCategory: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  sourceUrl: string;
  attachments: BidAttachment[];
  tags: string[];
  isActive: boolean;
  saved: boolean;
}

export const STATE_FILTERS = [
  { id: "sam", label: "Federal (SAM.gov)", stateCode: "US", issuerType: "federal" as const },
  { id: "ca", label: "California (CA)", stateCode: "CA", issuerType: "state" as const },
  { id: "tx", label: "Texas (TX)", stateCode: "TX", issuerType: "state" as const },
  { id: "ny", label: "New York (NY)", stateCode: "NY", issuerType: "state" as const },
  { id: "fl", label: "Florida (FL)", stateCode: "FL", issuerType: "state" as const },
  { id: "il", label: "Illinois (IL)", stateCode: "IL", issuerType: "state" as const },
];
```

- [ ] **Step 2: Replace `MOCK_BIDS` with PRD-aligned records**

Keep at least six bids. Include:

- One SAM.gov/Federal bid.
- At least four state bids across CA, TX, NY, FL, or IL.
- One bid with no attachments.
- At least one initially saved bid.
- Contact information on every bid.
- English titles and descriptions.

Use this exact first record to validate the field shape:

```ts
{
  id: "1",
  title: "Enterprise Cloud Migration Services",
  source: "SAM.gov",
  stateCode: "US",
  issuerName: "Department of Defense",
  issuerType: "federal",
  amount: "$5M - $10M",
  deadlineDate: "2026-06-15",
  publishedDate: "2026-05-01",
  description: "Seeking contractors to provide comprehensive cloud migration services for legacy on-premise infrastructure. Requires secure cloud delivery experience.",
  fullDescription: `## Overview\nThe Department of Defense is seeking qualified contractors to migrate legacy on-premise data centers to a secure cloud environment.\n\n## Scope of Work\n1. Assessment of current infrastructure\n2. Design of cloud architecture for government workloads\n3. Migration of 500+ applications\n4. Security compliance and authority-to-operate support\n\n## Requirements\n- Previous experience with federal cloud migrations.\n- FedRAMP High implementation experience.\n- Strong migration planning and documentation practices.`,
  originalCategory: "Information Technology",
  contactName: "Jordan Miller",
  contactEmail: "cloud-procurement@example.gov",
  contactPhone: "+1 (202) 555-0144",
  sourceUrl: "https://sam.gov/opp/12345",
  attachments: [
    { name: "Statement_of_Work_v2.pdf", size: "2.4 MB", url: "https://sam.gov/opp/12345/sow.pdf" },
    { name: "Pricing_Matrix_Template.xlsx", size: "156 KB", url: "https://sam.gov/opp/12345/pricing.xlsx" },
  ],
  tags: ["IT Services", "Cloud", "Federal"],
  isActive: true,
  saved: false,
}
```

- [ ] **Step 3: Run type-aware build check**

Run:

```bash
cd frontend
npm run build
```

Expected: build may fail because UI files still reference legacy bid fields. The acceptable failures at this point mention fields such as `agency`, `deadline`, or `posted` missing from `Bid`. If the failure is a syntax error in `mock-data.ts`, fix it before continuing.

- [ ] **Step 4: Commit mock data changes**

Run:

```bash
git add frontend/src/lib/mock-data.ts
git commit -m "feat: expand APSi mock bid model"
```

Expected: commit succeeds.

---

### Task 2: Extend English And Chinese Dictionaries

**Files:**
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Add English dictionary sections**

Add these sections to the exported `en` object while preserving existing `common`, `settings`, and `header` keys:

```ts
dashboard: {
  title: "Bid Search Workspace",
  description: "Search public government opportunities across federal and state sources.",
  searchLabel: "Search",
  searchPlaceholder: "Search by keyword, agency, category, or NAICS code",
  searchButton: "Search",
  filters: "Filters",
  clearFilters: "Clear all filters",
  stateRegion: "State / Region",
  issuerType: "Issuer Type",
  allIssuerTypes: "All issuer types",
  federal: "Federal",
  state: "State",
  deadline: "Deadline",
  publishedDate: "Published Date",
  anyTime: "Any time",
  next7Days: "Next 7 days",
  next30Days: "Next 30 days",
  last24Hours: "Last 24 hours",
  last7Days: "Last 7 days",
  resultsCount: "Showing {count} results for your criteria",
  sortBy: "Sort by",
  relevance: "Relevance",
  newest: "Newest First",
  soonestDeadline: "Deadline: Soonest",
  noResultsTitle: "No bids match your current filters.",
  noResultsDescription: "Adjust your keywords or clear filters to broaden the search.",
},
bid: {
  save: "Save",
  saved: "Saved",
  posted: "Posted",
  deadline: "Deadline",
  value: "Value",
  source: "Source",
  issuer: "Issuer",
  issuerType: "Issuer Type",
  category: "Category",
  contact: "Contact",
  email: "Email",
  phone: "Phone",
  viewDetails: "View details",
},
detail: {
  notFoundTitle: "Bid not found",
  notFoundDescription: "The opportunity may have been removed from the demo data.",
  backToResults: "Back to Results",
  viewSource: "View Original Source",
  detailedDescription: "Detailed Description",
  attachments: "Attachments",
  noAttachments: "No attachments available for this bid.",
  download: "Open",
  estimatedValue: "Estimated Value",
  metadata: "Opportunity Metadata",
},
saved: {
  title: "Saved Bids",
  description: "You have {count} saved bids.",
  descriptionSingular: "You have {count} saved bid.",
  emptyTitle: "No saved bids yet",
  emptyDescription: "Keep track of interesting opportunities by clicking the save icon on any bid card.",
  browseBids: "Browse Bids",
}
```

- [ ] **Step 2: Add matching Chinese dictionary sections**

Add these matching keys to the `zh` object:

```ts
dashboard: {
  title: "招标搜索工作台",
  description: "跨联邦和州级公开来源搜索政府采购机会。",
  searchLabel: "搜索",
  searchPlaceholder: "按关键词、机构、分类或 NAICS 代码搜索",
  searchButton: "搜索",
  filters: "筛选",
  clearFilters: "清空全部筛选",
  stateRegion: "州 / 地区",
  issuerType: "发布机构类型",
  allIssuerTypes: "全部机构类型",
  federal: "联邦",
  state: "州级",
  deadline: "截止日期",
  publishedDate: "发布日期",
  anyTime: "任意时间",
  next7Days: "未来 7 天",
  next30Days: "未来 30 天",
  last24Hours: "过去 24 小时",
  last7Days: "过去 7 天",
  resultsCount: "当前条件下显示 {count} 条结果",
  sortBy: "排序",
  relevance: "相关性",
  newest: "最新发布",
  soonestDeadline: "截止日期最近",
  noResultsTitle: "当前筛选条件下没有匹配招标。",
  noResultsDescription: "请调整关键词或清空筛选以扩大搜索范围。",
},
bid: {
  save: "收藏",
  saved: "已收藏",
  posted: "发布",
  deadline: "截止",
  value: "金额",
  source: "来源",
  issuer: "机构",
  issuerType: "机构类型",
  category: "分类",
  contact: "联系人",
  email: "邮箱",
  phone: "电话",
  viewDetails: "查看详情",
},
detail: {
  notFoundTitle: "未找到该招标",
  notFoundDescription: "该机会可能已从演示数据中移除。",
  backToResults: "返回结果",
  viewSource: "查看原始来源",
  detailedDescription: "详细说明",
  attachments: "附件",
  noAttachments: "该招标暂无附件。",
  download: "打开",
  estimatedValue: "预估金额",
  metadata: "机会元数据",
},
saved: {
  title: "已保存招标",
  description: "你已保存 {count} 条招标。",
  descriptionSingular: "你已保存 {count} 条招标。",
  emptyTitle: "还没有保存招标",
  emptyDescription: "点击任意招标卡片上的收藏图标，即可跟踪感兴趣的机会。",
  browseBids: "浏览招标",
}
```

- [ ] **Step 3: Verify dictionary shape**

Run:

```bash
cd frontend
npm run lint
```

Expected: lint may still fail in UI files until later tasks update legacy field references. It must not fail because `zh` is missing keys required by the `Dictionary` type.

- [ ] **Step 4: Commit dictionary changes**

Run:

```bash
git add frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: add bilingual MVP workflow copy"
```

Expected: commit succeeds.

---

### Task 3: Update Bid Card For PRD-Aligned Fields

**Files:**
- Modify: `frontend/src/components/bids/BidCard.tsx`

- [ ] **Step 1: Update imports and props**

Use the `Bid` type from `mock-data.ts` and the existing language hook:

```ts
import type { Bid } from "@/lib/mock-data";
import { useLanguage } from "@/lib/i18n/LanguageContext";
```

Set props to:

```ts
interface BidCardProps {
  bid: Bid;
}
```

- [ ] **Step 2: Render PRD-aligned labels**

Inside `BidCard`, get translations:

```ts
const { t } = useLanguage();
```

Replace legacy references:

- `bid.agency` becomes `bid.issuerName`.
- `bid.deadline` becomes `bid.deadlineDate`.
- `bid.posted` becomes `bid.publishedDate`.

Show issuer type and category cues using:

```tsx
<Badge variant="outline" className="rounded-md font-medium border-slate-200 text-slate-600 bg-slate-50 px-2 py-0.5">
  {bid.source}
</Badge>
<Badge variant="secondary" className="rounded-md bg-slate-100 text-slate-600 px-2 py-0.5">
  {bid.issuerType === "federal" ? t("dashboard.federal") : t("dashboard.state")}
</Badge>
```

Use translated labels for posted/deadline/value:

```tsx
<span>{t("bid.deadline")}: {bid.deadlineDate}</span>
<span>{t("bid.posted")}: {bid.publishedDate}</span>
```

Use accessible save label:

```tsx
aria-label={saved ? t("bid.saved") : t("bid.save")}
```

- [ ] **Step 3: Run component-level checks through lint**

Run:

```bash
cd frontend
npm run lint
```

Expected: no lint errors from `BidCard.tsx`. Other files may still fail because homepage/detail/saved page have not been updated.

- [ ] **Step 4: Commit bid card update**

Run:

```bash
git add frontend/src/components/bids/BidCard.tsx
git commit -m "feat: update bid cards for MVP fields"
```

Expected: commit succeeds.

---

### Task 4: Build Search Workspace On Homepage

**Files:**
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: Replace local filter constants with data exports**

Import:

```ts
import { MOCK_BIDS, STATE_FILTERS, type DatePreset, type IssuerType, type SortOption } from "@/lib/mock-data";
import { useLanguage } from "@/lib/i18n/LanguageContext";
```

Remove the local `STATES` constant.

- [ ] **Step 2: Add filter state**

Use these state values:

```ts
const [searchQuery, setSearchQuery] = useState("");
const [selectedStates, setSelectedStates] = useState<string[]>([]);
const [issuerType, setIssuerType] = useState<"all" | IssuerType>("all");
const [deadlinePreset, setDeadlinePreset] = useState<DatePreset>("any");
const [publishedPreset, setPublishedPreset] = useState<DatePreset>("any");
const [sortBy, setSortBy] = useState<SortOption>("relevance");
```

- [ ] **Step 3: Add date helper functions in the page file**

Add these helper functions above the component:

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysFromToday(dateString: string) {
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(dateString));
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

function daysAgo(dateString: string) {
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(dateString));
  return Math.round((today.getTime() - target.getTime()) / MS_PER_DAY);
}

function matchesDeadlinePreset(dateString: string, preset: DatePreset) {
  if (preset === "any") return true;
  const days = daysFromToday(dateString);
  if (preset === "next7") return days >= 0 && days <= 7;
  if (preset === "next30") return days >= 0 && days <= 30;
  return true;
}

function matchesPublishedPreset(dateString: string, preset: DatePreset) {
  if (preset === "any") return true;
  const days = daysAgo(dateString);
  if (preset === "last24") return days >= 0 && days <= 1;
  if (preset === "last7") return days >= 0 && days <= 7;
  return true;
}
```

- [ ] **Step 4: Update filtering logic**

Filter by:

- Keyword across title, description, issuerName, originalCategory, tags.
- State/source via `STATE_FILTERS`.
- Issuer type unless `"all"`.
- Deadline preset.
- Published preset.

Sort by:

- `"deadline"`: ascending `deadlineDate`.
- `"newest"`: descending `publishedDate`.
- `"relevance"`: original mock order.

- [ ] **Step 5: Update rendered UI copy to use translations**

Use `const { t } = useLanguage();`.

Update labels:

- Header title: `t("dashboard.title")`.
- Header description: `t("dashboard.description")`.
- Search hint: `t("dashboard.searchPlaceholder")`.
- Search button: `t("dashboard.searchButton")`.
- Filter heading: `t("dashboard.filters")`.
- Clear action: `t("dashboard.clearFilters")`.
- State filter: `t("dashboard.stateRegion")`.
- Issuer type: `t("dashboard.issuerType")`.
- Date presets: dictionary keys from Task 2.
- Result count: `t("dashboard.resultsCount").replace("{count}", String(filteredBids.length))`.
- Sort labels: dictionary keys from Task 2.
- Empty state title/description: dictionary keys from Task 2.

- [ ] **Step 6: Keep dense B2B layout**

Keep the left filter rail plus right result list. Do not introduce a landing page, hero section, decorative illustration, or marketing copy.

- [ ] **Step 7: Run lint/build**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: build may still fail only if detail/saved pages still reference legacy fields. Lint should not report syntax or hook issues in `page.tsx`.

- [ ] **Step 8: Commit homepage update**

Run:

```bash
git add frontend/src/app/page.tsx
git commit -m "feat: build MVP bid search workspace"
```

Expected: commit succeeds.

---

### Task 5: Update Bid Detail Page

**Files:**
- Modify: `frontend/src/app/bids/[id]/page.tsx`

- [ ] **Step 1: Use translated labels and PRD fields**

Import:

```ts
import { useLanguage } from "@/lib/i18n/LanguageContext";
```

Inside the component:

```ts
const { t } = useLanguage();
```

Replace legacy fields:

- `bid.agency` becomes `bid.issuerName`.
- `bid.posted` becomes `bid.publishedDate`.
- `bid.deadline` becomes `bid.deadlineDate`.

- [ ] **Step 2: Improve not-found state**

Use translated copy:

```tsx
<h2>{t("detail.notFoundTitle")}</h2>
<p>{t("detail.notFoundDescription")}</p>
```

Button label: `t("detail.backToResults")`.

- [ ] **Step 3: Add contact section**

Add a card or metadata block showing:

- `bid.contactName`
- `bid.contactEmail`
- `bid.contactPhone`

Use translated labels:

- `t("bid.contact")`
- `t("bid.email")`
- `t("bid.phone")`

- [ ] **Step 4: Update attachment action**

Use an anchor-style button:

```tsx
<Button asChild variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium">
  <a href={file.url} target="_blank" rel="noreferrer">
    <Download size={16} className="mr-2" /> {t("detail.download")}
  </a>
</Button>
```

Use `t("detail.noAttachments")` for the empty attachment state.

- [ ] **Step 5: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build may still fail if `saved/page.tsx` references old fields indirectly through untyped data issues. No failures should originate from `bids/[id]/page.tsx`.

- [ ] **Step 6: Commit detail page update**

Run:

```bash
git add 'frontend/src/app/bids/[id]/page.tsx'
git commit -m "feat: complete MVP bid detail page"
```

Expected: commit succeeds.

---

### Task 6: Update Saved Bids Page

**Files:**
- Modify: `frontend/src/app/saved/page.tsx`

- [ ] **Step 1: Add translations**

Import and use:

```ts
import { useLanguage } from "@/lib/i18n/LanguageContext";
```

Inside component:

```ts
const { t } = useLanguage();
```

- [ ] **Step 2: Use translated count copy**

Use:

```ts
const savedDescription = savedBids.length === 1
  ? t("saved.descriptionSingular").replace("{count}", String(savedBids.length))
  : t("saved.description").replace("{count}", String(savedBids.length));
```

- [ ] **Step 3: Update rendered labels**

Use:

- Heading: `t("saved.title")`.
- Description: `savedDescription`.
- Empty title: `t("saved.emptyTitle")`.
- Empty description: `t("saved.emptyDescription")`.
- Browse button: `t("saved.browseBids")`.

- [ ] **Step 4: Run lint/build**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: both commands pass.

- [ ] **Step 5: Commit saved page update**

Run:

```bash
git add frontend/src/app/saved/page.tsx
git commit -m "feat: localize saved bids page"
```

Expected: commit succeeds.

---

### Task 7: Browser Verification And Polish

**Files:**
- Modify only files from Tasks 1-6 if verification reveals small UI or copy issues.

- [ ] **Step 1: Start the dev server**

Run:

```bash
cd frontend
npm run dev
```

Expected: Next.js dev server starts and prints a local URL, usually `http://localhost:3000`.

- [ ] **Step 2: Verify desktop flow in browser**

Open the local URL and verify:

- Homepage shows bid search workspace.
- Searching `cloud` returns the cloud migration bid.
- Selecting Federal/SAM.gov narrows results to federal bids.
- Issuer type filter changes result set.
- Published date and deadline presets affect result set.
- Sorting by newest and deadline changes order.
- Empty result state appears with a clear filters action.
- Opening a bid detail shows metadata, contact info, source link, description, and attachments.
- Saving and unsaving updates the homepage, detail page, and saved page.
- Saved page empty state appears after all saved bids are removed.

- [ ] **Step 3: Verify Chinese flow**

Use the existing language switcher and verify:

- Homepage labels switch to Chinese.
- Bid card labels switch to Chinese.
- Detail page labels switch to Chinese.
- Saved page labels switch to Chinese.
- Mock bid titles/descriptions remain English.

- [ ] **Step 4: Verify mobile width**

Use browser responsive mode or a narrow viewport around 390 px wide. Verify:

- Filters and search content remain usable.
- Text does not overlap.
- Buttons remain readable.
- Cards maintain stable spacing.

- [ ] **Step 5: Run final verification commands**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: both pass.

From the repository root, run:

```bash
git status --short
```

Expected: no uncommitted tracked changes. Untracked `.superpowers/` may remain from brainstorming and must not be staged.

- [ ] **Step 6: Commit polish if needed**

If browser verification required small fixes:

```bash
git add frontend/src
git commit -m "fix: polish APSi MVP demo flow"
```

If no fixes were required, skip this step.

---

## Self-Review Checklist

- Spec coverage: Tasks cover mock data, search workspace, bid cards, bid details, saved bids, i18n, empty states, browser checks, lint, and build.
- Scope control: No task introduces backend APIs, database persistence, authentication, crawler work, AI parsing, URL locale routing, or bid body translation.
- Type consistency: UI tasks use the `Bid` fields from Task 1: `issuerName`, `issuerType`, `deadlineDate`, `publishedDate`, `contactName`, `contactEmail`, `contactPhone`, and `attachments`.
- Verification: Final task requires `npm run lint`, `npm run build`, browser interaction checks, and clean Git status.
