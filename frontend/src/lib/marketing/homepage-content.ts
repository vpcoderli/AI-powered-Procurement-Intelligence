import type { Language } from "@/lib/i18n/LanguageContext";

export type MarketingHomepageLanguage = Language;
export type HomepageAnalyticsEvent = (typeof homepageAnalyticsEvents)[number];

export const marketingHomepageLanguages = ["en", "zh"] as const satisfies readonly MarketingHomepageLanguage[];

export const homepageRouteMap = {
  product: "#product-map",
  howItWorks: "#how-it-works",
  knowledge: "#knowledge-station",
  pricing: "#pricing",
  resources: "/resources",
  signIn: "/login",
  startFree: "/register",
  requestDemo: "/request-demo",
  publicSearch: "/search",
} as const;

export const homepageAnalyticsEvents = [
  "view_homepage",
  "click_start_free",
  "click_see_how_it_works",
  "click_pricing_tier",
  "click_request_demo",
  "click_public_search",
  "start_signup",
] as const;

interface MarketingCta {
  label: string;
  href: string;
}

interface MarketingNavItem extends MarketingCta {
  key: string;
}

interface MarketingItem {
  key: string;
  title: string;
  body: string;
  href?: string;
}

interface PricingTier extends MarketingItem {
  price: string;
  cta: MarketingCta;
}

interface MarketingFaq {
  question: string;
  answer: string;
}

export interface MarketingHomepageContent {
  nav: MarketingNavItem[];
  sections: {
    howItWorks: { eyebrow: string; title: string };
    productMap: { eyebrow: string; title: string };
    knowledgeStation: { eyebrow: string };
    pricing: { eyebrow: string; title: string };
    resources: { eyebrow: string; title: string };
    faq: { eyebrow: string; title: string };
    finalCta: { eyebrow: string };
  };
  hero: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    primaryCta: MarketingCta;
    secondaryCta: MarketingCta;
    searchCta: MarketingCta;
    trustSignals: string[];
  };
  problem: MarketingItem[];
  lifecycle: MarketingItem[];
  productMap: MarketingItem[];
  knowledgeStation: MarketingItem;
  pricingTiers: PricingTier[];
  safeClaims: string[];
  resources: MarketingItem[];
  faq: MarketingFaq[];
  finalCta: {
    title: string;
    body: string;
    primaryCta: MarketingCta;
    secondaryCta: MarketingCta;
  };
}

export type MarketingContentOverride<T> = T extends readonly (infer Item)[]
  ? MarketingContentOverride<Item>[]
  : T extends object
    ? { [Key in keyof T]?: MarketingContentOverride<T[Key]> }
    : T;

export type MarketingHomepageContentOverrides = Partial<
  Record<MarketingHomepageLanguage, MarketingContentOverride<MarketingHomepageContent>>
>;

const englishContent: MarketingHomepageContent = {
  nav: [
    { key: "product", label: "Product", href: homepageRouteMap.product },
    { key: "how_it_works", label: "How It Works", href: homepageRouteMap.howItWorks },
    { key: "knowledge", label: "Knowledge Station", href: homepageRouteMap.knowledge },
    { key: "pricing", label: "Pricing", href: homepageRouteMap.pricing },
    { key: "resources", label: "Resources", href: homepageRouteMap.resources },
    { key: "sign_in", label: "Sign In", href: homepageRouteMap.signIn },
    { key: "start_free", label: "Start Free", href: homepageRouteMap.startFree },
  ],
  sections: {
    howItWorks: { eyebrow: "How It Works", title: "Match -> Understand -> Decide -> Prepare -> Submit -> Learn" },
    productMap: {
      eyebrow: "Product",
      title: "Supplier Profile, discovery, readiness, pipeline, and Knowledge Station",
    },
    knowledgeStation: { eyebrow: "Knowledge Station" },
    pricing: {
      eyebrow: "Pricing",
      title: "Start free, then unlock more pursuit depth when the workflow proves useful",
    },
    resources: {
      eyebrow: "Resources",
      title: "Practical procurement literacy for recurring pursuit work",
    },
    faq: {
      eyebrow: "FAQ",
      title: "Clear boundaries before a team trusts the workflow",
    },
    finalCta: { eyebrow: "Next Step" },
  },
  hero: {
    eyebrow: "Supplier pursuit operating system",
    headline: "Find public bids you can actually pursue.",
    subheadline:
      "WinBids helps U.S. suppliers discover matched opportunities, understand requirements, decide whether to pursue, prepare response materials, follow official submission steps, and learn from results.",
    primaryCta: { label: "Start Free", href: homepageRouteMap.startFree },
    secondaryCta: { label: "See How It Works", href: homepageRouteMap.howItWorks },
    searchCta: { label: "Browse Public Bids", href: homepageRouteMap.publicSearch },
    trustSignals: ["50-state public-source coverage", "Bilingual workspace", "Role and tier-aware access"],
  },
  problem: [
    {
      key: "too_many_sources",
      title: "Public bids are scattered",
      body: "Small teams lose time checking state portals, federal listings, amendments, attachments, and deadline changes.",
    },
    {
      key: "hard_to_qualify",
      title: "Fit is hard to judge quickly",
      body: "The real question is not whether a bid exists. It is whether your team can credibly pursue it before the deadline.",
    },
    {
      key: "response_work_is_fragmented",
      title: "Response work gets fragmented",
      body: "Notes, files, pricing, compliance checks, reminders, and submission evidence often live in separate tools.",
    },
  ],
  lifecycle: [
    { key: "match", title: "Match", body: "Find public opportunities that align with your supplier profile and saved search criteria." },
    { key: "understand", title: "Understand", body: "Read bid briefs, requirements, deadlines, source evidence, and attachment summaries in one place." },
    { key: "decide", title: "Decide", body: "Use pursue or no-bid guidance to separate promising work from risky distractions." },
    { key: "prepare", title: "Prepare", body: "Collect artifacts, build response workspaces, compare quotes, and prepare exportable packages." },
    { key: "submit", title: "Submit", body: "Follow official submission guidance and keep confirmation evidence after submitting outside WinBids." },
    { key: "learn", title: "Learn", body: "Track awards, tabulations, decisions, and win/loss notes so future pursuits improve." },
  ],
  productMap: [
    { key: "supplier_profile", title: "Supplier Profile", body: "Keep company capabilities, certifications, locations, and plan access attached to the workspace." },
    { key: "bid_discovery", title: "Bid Discovery", body: "Search and monitor state, local, and federal opportunity sources with freshness and evidence checks." },
    { key: "pursuit_readiness", title: "Pursuit Readiness", body: "Review fit, compliance risks, missing artifacts, and decision support before investing response time." },
    { key: "pursuit_pipeline", title: "Pursuit Pipeline", body: "Move from saved bid to intent, response workspace, submission guidance, award tracking, and learning." },
    { key: "knowledge_station", title: "Knowledge Station", body: "Turn pursuit notes, official evidence, and reusable lessons into a guided library for future bids." },
  ],
  knowledgeStation: {
    key: "knowledge_station_marketing",
    title: "Knowledge Station as an embedded bid mentor",
    body: "Knowledge Station helps teams reuse bid context, past decisions, buyer notes, and source-backed lessons. It supports decisions but does not replace official solicitation review.",
  },
  pricingTiers: [
    { key: "free", title: "Free", price: "$0", body: "Browse public opportunities and start learning the workflow.", cta: { label: "Start Free", href: homepageRouteMap.startFree } },
    { key: "starter", title: "Pursuit Starter", price: "Starter", body: "Save bids, build supplier profile context, and organize early pursuit decisions.", cta: { label: "Start Free", href: homepageRouteMap.startFree } },
    { key: "builder", title: "Response Builder", price: "Builder", body: "Unlock deeper response workspace, artifact, export, and readiness workflows.", cta: { label: "Request Demo", href: homepageRouteMap.requestDemo } },
    { key: "growth", title: "Growth", price: "Growth", body: "Coordinate more alerts, reminders, quotes, and team workflows as pursuit volume increases.", cta: { label: "Request Demo", href: homepageRouteMap.requestDemo } },
    { key: "enterprise", title: "Enterprise", price: "Custom", body: "Advanced governance, Knowledge Station, admin controls, and operational support.", cta: { label: "Request Demo", href: homepageRouteMap.requestDemo } },
  ],
  safeClaims: [
    "WinBids guides official submission steps, but suppliers submit bids through the agency's required channel.",
    "WinBids does not guarantee compliance, eligibility, award, or win outcomes.",
    "Official source documents and buyer instructions remain the source of truth.",
  ],
  resources: [
    { key: "glossary", title: "Bid glossary", body: "Plain-language definitions for common public procurement terms.", href: "/resources/glossary" },
    { key: "checklists", title: "Readiness checklists", body: "Repeatable preparation guides for supplier profiles, artifacts, deadlines, and submission evidence.", href: "/resources/supplier-workflow" },
    { key: "market_notes", title: "Market notes", body: "Source-health and procurement workflow notes for teams building a pursuit habit.", href: "/resources/supplier-workflow" },
  ],
  faq: [
    { question: "Does WinBids submit bids for me?", answer: "No. WinBids provides guidance and workspace tools. The supplier submits through the official agency channel." },
    { question: "Can WinBids guarantee that my response is compliant?", answer: "No. It helps organize evidence and risks, but the buyer's official documents remain authoritative." },
    { question: "Can I browse without an account?", answer: "Yes. Public search is available before signup; saved workspaces, alerts, and response features require an account." },
    { question: "Who is WinBids for?", answer: "It is built for U.S. suppliers who need a practical operating system for recurring public-sector pursuits." },
  ],
  finalCta: {
    title: "Build a calmer bid pursuit rhythm.",
    body: "Start with public search, create your account when you are ready to save and prepare opportunities, then upgrade as your pursuit volume grows.",
    primaryCta: { label: "Start Free", href: homepageRouteMap.startFree },
    secondaryCta: { label: "Request Demo", href: homepageRouteMap.requestDemo },
  },
};

const chineseContent: MarketingHomepageContent = {
  nav: [
    { key: "product", label: "产品", href: homepageRouteMap.product },
    { key: "how_it_works", label: "工作流程", href: homepageRouteMap.howItWorks },
    { key: "knowledge", label: "知识站", href: homepageRouteMap.knowledge },
    { key: "pricing", label: "价格", href: homepageRouteMap.pricing },
    { key: "resources", label: "资源", href: homepageRouteMap.resources },
    { key: "sign_in", label: "登录", href: homepageRouteMap.signIn },
    { key: "start_free", label: "免费开始", href: homepageRouteMap.startFree },
  ],
  sections: {
    howItWorks: { eyebrow: "工作流程", title: "匹配 -> 理解 -> 决策 -> 准备 -> 提交 -> 复盘" },
    productMap: {
      eyebrow: "产品",
      title: "供应商资料、招标发现、准备度、追标管线和知识站",
    },
    knowledgeStation: { eyebrow: "知识站" },
    pricing: {
      eyebrow: "价格",
      title: "先免费开始，工作流证明有用后再解锁更深的追标能力",
    },
    resources: {
      eyebrow: "资源",
      title: "面向持续追标工作的实用采购知识",
    },
    faq: {
      eyebrow: "常见问题",
      title: "让团队信任工作流之前，先明确边界",
    },
    finalCta: { eyebrow: "下一步" },
  },
  hero: {
    eyebrow: "供应商投标作战系统",
    headline: "找到真正值得追的公共招标。",
    subheadline:
      "WinBids 帮助美国供应商发现匹配机会、理解要求、判断是否追标、准备响应材料、按官方流程提交，并从结果中学习。",
    primaryCta: { label: "免费开始", href: homepageRouteMap.startFree },
    secondaryCta: { label: "了解流程", href: homepageRouteMap.howItWorks },
    searchCta: { label: "浏览公开招标", href: homepageRouteMap.publicSearch },
    trustSignals: ["50 州公开来源覆盖", "中英文工作区", "按角色和套餐展示功能"],
  },
  problem: [
    {
      key: "too_many_sources",
      title: "公共招标来源分散",
      body: "小团队需要反复检查州级门户、联邦机会、补遗、附件和截止时间变化，时间很容易被消耗掉。",
    },
    {
      key: "hard_to_qualify",
      title: "是否值得追很难快速判断",
      body: "关键不只是有没有招标，而是团队是否能在截止日前可信地完成追标。",
    },
    {
      key: "response_work_is_fragmented",
      title: "响应准备容易碎片化",
      body: "笔记、文件、报价、合规检查、提醒和提交证据常常散落在不同工具里。",
    },
  ],
  lifecycle: [
    { key: "match", title: "匹配", body: "根据供应商资料和保存搜索条件发现合适的公开机会。" },
    { key: "understand", title: "理解", body: "集中查看招标摘要、要求、截止时间、来源证据和附件信息。" },
    { key: "decide", title: "决策", body: "用追标或放弃建议，把高价值机会和高风险干扰区分开。" },
    { key: "prepare", title: "准备", body: "收集材料、搭建响应工作区、比较报价，并准备可导出的响应包。" },
    { key: "submit", title: "提交", body: "按官方提交指引操作，并在外部提交后保留确认凭证。" },
    { key: "learn", title: "复盘", body: "跟踪授标、开标表、决策和胜负原因，让下一次追标更准确。" },
  ],
  productMap: [
    { key: "supplier_profile", title: "供应商资料", body: "维护企业能力、资质、服务区域和套餐权限，并绑定到工作区。" },
    { key: "bid_discovery", title: "招标发现", body: "搜索和监控州级、地方及联邦机会来源，并查看新鲜度和证据状态。" },
    { key: "pursuit_readiness", title: "追标准备度", body: "投入响应前检查匹配度、合规风险、缺失材料和决策建议。" },
    { key: "pursuit_pipeline", title: "追标管线", body: "从保存招标到投标意向、响应工作区、提交指引、授标跟踪和复盘学习。" },
    { key: "knowledge_station", title: "知识站", body: "把追标笔记、官方证据和可复用经验沉淀成未来投标的辅助资料库。" },
  ],
  knowledgeStation: {
    key: "knowledge_station_marketing",
    title: "知识站像嵌入式投标导师",
    body: "知识站帮助团队复用招标上下文、历史决策、买方记录和来源证据经验。它支持决策，但不替代官方招标文件审核。",
  },
  pricingTiers: [
    { key: "free", title: "Free", price: "$0", body: "浏览公开机会，先理解完整工作流。", cta: { label: "免费开始", href: homepageRouteMap.startFree } },
    { key: "starter", title: "Pursuit Starter", price: "Starter", body: "保存招标、完善供应商资料，并组织早期追标决策。", cta: { label: "免费开始", href: homepageRouteMap.startFree } },
    { key: "builder", title: "Response Builder", price: "Builder", body: "解锁更深入的响应工作区、资料、导出和准备度流程。", cta: { label: "预约演示", href: homepageRouteMap.requestDemo } },
    { key: "growth", title: "Growth", price: "Growth", body: "随追标数量增长，协同更多提醒、报价和团队工作流。", cta: { label: "预约演示", href: homepageRouteMap.requestDemo } },
    { key: "enterprise", title: "Enterprise", price: "Custom", body: "高级治理、知识站、管理员控制和运营支持。", cta: { label: "预约演示", href: homepageRouteMap.requestDemo } },
  ],
  safeClaims: [
    "WinBids 提供官方提交步骤指引，但供应商仍需通过采购方要求的官方渠道提交。",
    "WinBids 不保证合规、资格、授标或中标结果。",
    "官方来源文件和采购方说明始终是最终依据。",
  ],
  resources: [
    { key: "glossary", title: "招标术语表", body: "用简单语言解释常见公共采购术语。", href: "/resources/glossary" },
    { key: "checklists", title: "准备度清单", body: "为供应商资料、材料、截止时间和提交证据提供可重复检查流程。", href: "/resources/supplier-workflow" },
    { key: "market_notes", title: "市场笔记", body: "面向建立追标习惯的团队，沉淀来源健康和采购流程经验。", href: "/resources/supplier-workflow" },
  ],
  faq: [
    { question: "WinBids 会替我提交投标吗？", answer: "不会。WinBids 提供指引和工作区工具，供应商仍需通过官方采购渠道提交。" },
    { question: "WinBids 能保证响应文件合规吗？", answer: "不能。它帮助组织证据和风险，但采购方官方文件仍是最终依据。" },
    { question: "不注册可以浏览吗？", answer: "可以。公开搜索可在注册前使用；保存、提醒和响应工作区需要账号。" },
    { question: "WinBids 适合谁？", answer: "适合需要持续参与美国公共部门投标，并希望建立稳定追标流程的供应商。" },
  ],
  finalCta: {
    title: "建立更稳定的追标节奏。",
    body: "先从公开搜索开始；准备保存和管理机会时注册账号；当追标数量增长，再按需求升级。",
    primaryCta: { label: "免费开始", href: homepageRouteMap.startFree },
    secondaryCta: { label: "预约演示", href: homepageRouteMap.requestDemo },
  },
};

const contentByLanguage = {
  en: englishContent,
  zh: chineseContent,
} satisfies Record<MarketingHomepageLanguage, MarketingHomepageContent>;

const unsafeMarketingClaimPatterns = [
  /\bguarantee(?:s|d)?\s+(?:a\s+)?(?:win|wins|award|awards|compliance|eligibility|outcome|outcomes)\b/i,
  /\b(?:win|wins|award|awards|compliance|eligibility|outcome|outcomes)\s+guarantee(?:s|d)?\b/i,
  /\bcomplete\s+compliance\s+guarantee\b/i,
  /\b(?:automatically\s+)?submit(?:s|ting)?\s+(?:for|on behalf of)\s+you\b/i,
  /\bwe\s+(?:will\s+)?submit\s+(?:the\s+)?bid(?:s)?\b/i,
  /保证(?:中标|授标|合规|资格|结果)|自动提交|替你提交|代.*提交/,
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasUnsafeMarketingClaim(value: unknown): boolean {
  if (typeof value === "string") {
    return unsafeMarketingClaimPatterns.some((pattern) => pattern.test(value));
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeMarketingClaim(item));
  }

  if (isPlainRecord(value)) {
    return Object.values(value).some((item) => hasUnsafeMarketingClaim(item));
  }

  return false;
}

function mergeMarketingContentValue<T>(base: T, override: unknown): T {
  if (override === undefined) return base;

  if (Array.isArray(base)) {
    if (!Array.isArray(override)) return base;
    return base.map((item, index) =>
      index in override ? mergeMarketingContentValue(item, override[index]) : item,
    ) as T;
  }

  if (isPlainRecord(base)) {
    if (!isPlainRecord(override)) return base;

    const next = { ...base } as Record<string, unknown>;
    for (const key of Object.keys(base)) {
      if (Object.hasOwn(override, key)) {
        next[key] = mergeMarketingContentValue((base as Record<string, unknown>)[key], override[key]);
      }
    }

    return next as T;
  }

  return typeof override === typeof base ? (override as T) : base;
}

export function mergeMarketingContentOverride<T>(base: T, override: MarketingContentOverride<T> | undefined): T {
  if (!override || hasUnsafeMarketingClaim(override)) return base;
  return mergeMarketingContentValue(base, override);
}

export function getMarketingHomepageContent(
  language: MarketingHomepageLanguage,
  overrides?: MarketingHomepageContentOverrides,
) {
  return mergeMarketingContentOverride(contentByLanguage[language], overrides?.[language]);
}

export function recordHomepageAnalyticsEvent(eventName: HomepageAnalyticsEvent, metadata: Record<string, string> = {}) {
  if (typeof window === "undefined") return;

  const win = window as Window & {
    winbidsMarketingEvents?: Array<{ eventName: HomepageAnalyticsEvent; metadata: Record<string, string>; occurredAt: string }>;
  };
  win.winbidsMarketingEvents = win.winbidsMarketingEvents ?? [];
  win.winbidsMarketingEvents.push({
    eventName,
    metadata,
    occurredAt: new Date().toISOString(),
  });
}
