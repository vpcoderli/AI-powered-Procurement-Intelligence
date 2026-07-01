import type { Language } from "@/lib/i18n/LanguageContext";
import { mergeMarketingContentOverride, type MarketingContentOverride } from "./homepage-content";

export type MarketingResourceLanguage = Language;

export const marketingResourceLanguages = ["en", "zh"] as const satisfies readonly MarketingResourceLanguage[];

export const resourceRouteMap = {
  hub: "/resources",
  glossary: "/resources/glossary",
  supplierWorkflow: "/resources/supplier-workflow",
  startFree: "/register",
  requestDemo: "/request-demo",
  publicSearch: "/search",
} as const;

interface ResourceCta {
  label: string;
  href: string;
}

interface ResourceGuide {
  key: string;
  title: string;
  body: string;
  href: string;
}

interface ResourceStep {
  key: string;
  title: string;
  body: string;
}

interface ResourceTerm {
  key: string;
  term: string;
  definition: string;
  whyItMatters: string;
}

interface WorkflowSection {
  key: string;
  title: string;
  body: string;
  steps: string[];
}

export interface ResourceHubContent {
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    primaryCta: ResourceCta;
    secondaryCta: ResourceCta;
  };
  guides: ResourceGuide[];
  lifecycle: ResourceStep[];
  safeClaims: string[];
}

export interface GlossaryContent {
  hero: {
    eyebrow: string;
    title: string;
    body: string;
  };
  terms: ResourceTerm[];
  relatedCta: ResourceCta;
}

export interface SupplierWorkflowContent {
  hero: {
    eyebrow: string;
    title: string;
    body: string;
  };
  sections: WorkflowSection[];
  safeClaims: string[];
  relatedCta: ResourceCta;
}

export interface MarketingResourceContentOverrides {
  hub?: Partial<Record<MarketingResourceLanguage, MarketingContentOverride<ResourceHubContent>>>;
  glossary?: Partial<Record<MarketingResourceLanguage, MarketingContentOverride<GlossaryContent>>>;
  workflow?: Partial<Record<MarketingResourceLanguage, MarketingContentOverride<SupplierWorkflowContent>>>;
}

const englishHub: ResourceHubContent = {
  hero: {
    eyebrow: "Resources",
    title: "Public procurement literacy for suppliers who pursue repeatedly.",
    body:
      "Use these guides to understand common bid language, prepare a supplier profile, review source evidence, and move through WinBids without confusing guidance for official submission.",
    primaryCta: { label: "Start Free", href: resourceRouteMap.startFree },
    secondaryCta: { label: "Request Demo", href: resourceRouteMap.requestDemo },
  },
  guides: [
    {
      key: "glossary",
      title: "Public bid glossary",
      body: "Plain-language definitions for terms suppliers see in solicitations, amendments, responsiveness reviews, and award notices.",
      href: resourceRouteMap.glossary,
    },
    {
      key: "supplier_workflow",
      title: "Supplier pursuit workflow",
      body: "A practical Match -> Understand -> Decide -> Prepare -> Submit -> Learn workflow for recurring public-sector bids.",
      href: resourceRouteMap.supplierWorkflow,
    },
    {
      key: "readiness_checklist",
      title: "Readiness checklist",
      body: "A lightweight checklist for profile quality, attachments, deadline evidence, and official source review before a team invests response time.",
      href: resourceRouteMap.supplierWorkflow,
    },
  ],
  lifecycle: [
    { key: "match", title: "Match", body: "Start with public search, saved criteria, and supplier profile context." },
    { key: "understand", title: "Understand", body: "Read source evidence, attachments, deadlines, and buyer instructions before acting." },
    { key: "decide", title: "Decide", body: "Separate credible pursuits from no-bid situations before response work expands." },
    { key: "prepare", title: "Prepare", body: "Gather artifacts, quotes, compliance notes, and response package evidence." },
    { key: "submit", title: "Submit", body: "Use official agency channels and keep confirmation evidence in WinBids." },
    { key: "learn", title: "Learn", body: "Track outcomes, tabulations, and lessons for the next pursuit." },
  ],
  safeClaims: [
    "WinBids guides preparation and official submission steps; it does not submit bids for suppliers.",
    "Official buyer documents, amendments, and portal instructions remain the source of truth.",
    "The resources are educational; they cannot confirm compliance, eligibility, award selection, or pursuit outcomes.",
  ],
};

const chineseHub: ResourceHubContent = {
  hero: {
    eyebrow: "资源",
    title: "给持续追标供应商使用的公共采购知识。",
    body:
      "这些指南帮助团队理解常见招标语言、准备供应商资料、复核来源证据，并在 WinBids 中推进工作流，同时不把产品指引误认为官方提交。",
    primaryCta: { label: "免费开始", href: resourceRouteMap.startFree },
    secondaryCta: { label: "预约演示", href: resourceRouteMap.requestDemo },
  },
  guides: [
    {
      key: "glossary",
      title: "公共招标术语表",
      body: "用简单语言解释供应商在招标文件、补遗、响应性审核和授标公告里经常遇到的术语。",
      href: resourceRouteMap.glossary,
    },
    {
      key: "supplier_workflow",
      title: "供应商追标流程",
      body: "围绕匹配、理解、决策、准备、提交、复盘，建立可重复的公共部门追标流程。",
      href: resourceRouteMap.supplierWorkflow,
    },
    {
      key: "readiness_checklist",
      title: "准备度清单",
      body: "在投入响应工作前，快速检查企业资料、附件、截止证据和官方来源。",
      href: resourceRouteMap.supplierWorkflow,
    },
  ],
  lifecycle: [
    { key: "match", title: "匹配", body: "从公开搜索、保存条件和供应商资料上下文开始。" },
    { key: "understand", title: "理解", body: "先阅读来源证据、附件、截止时间和买方说明。" },
    { key: "decide", title: "决策", body: "在响应工作扩大前，区分可信追标和应放弃机会。" },
    { key: "prepare", title: "准备", body: "收集材料、报价、合规笔记和响应包证据。" },
    { key: "submit", title: "提交", body: "通过官方采购渠道提交，并在 WinBids 保存确认凭证。" },
    { key: "learn", title: "复盘", body: "跟踪结果、开标表和经验，改进下一次追标。" },
  ],
  safeClaims: [
    "WinBids 指导准备和官方提交步骤，但不会替供应商提交投标。",
    "买方官方文件、补遗和门户说明始终是最终依据。",
    "这些资源用于教育和工作流组织，不保证合规、资格、授标或中标结果。",
  ],
};

const englishGlossary: GlossaryContent = {
  hero: {
    eyebrow: "Glossary",
    title: "Public bid glossary",
    body: "Plain-language explanations for terms that often shape pursuit decisions, compliance checks, and response preparation.",
  },
  terms: [
    {
      key: "solicitation",
      term: "Solicitation",
      definition: "The official buyer request that describes what is being purchased, how suppliers should respond, and when responses are due.",
      whyItMatters: "It anchors the opportunity record and should be reviewed before relying on summaries.",
    },
    {
      key: "rfp",
      term: "RFP",
      definition: "A request for proposal, usually asking suppliers to explain approach, qualifications, pricing, and evidence rather than only submit a price.",
      whyItMatters: "RFPs often need stronger response workspaces, artifacts, and review steps.",
    },
    {
      key: "amendment",
      term: "Amendment",
      definition: "A formal change to the solicitation, such as a deadline extension, requirement update, Q&A release, or attachment replacement.",
      whyItMatters: "Teams should refresh evidence before finalizing response packages.",
    },
    {
      key: "addendum",
      term: "Addendum",
      definition: "Additional buyer material attached to the solicitation, often clarifying specifications, forms, drawings, or instructions.",
      whyItMatters: "Missing an addendum can lead to stale assumptions or incomplete response evidence.",
    },
    {
      key: "responsiveness",
      term: "Responsiveness",
      definition: "Whether the submitted response follows mandatory buyer instructions, required forms, deadlines, and format rules.",
      whyItMatters: "A strong offer can still fail if the response misses required instructions.",
    },
    {
      key: "responsibility",
      term: "Responsibility",
      definition: "Whether the supplier appears capable, qualified, and reliable enough to perform the work if selected.",
      whyItMatters: "Supplier profile evidence and past performance notes support this review.",
    },
    {
      key: "no_bid",
      term: "No-bid",
      definition: "A deliberate decision not to pursue an opportunity because fit, timing, requirements, or risk make response work unattractive.",
      whyItMatters: "No-bid discipline protects teams from spending time on poor-fit pursuits.",
    },
    {
      key: "award_tabulation",
      term: "Award tabulation",
      definition: "A buyer-published summary of submitted prices, evaluated suppliers, or award results after a procurement decision.",
      whyItMatters: "It helps teams learn from outcomes and improve future pursuit decisions.",
    },
  ],
  relatedCta: { label: "Read the supplier workflow", href: resourceRouteMap.supplierWorkflow },
};

const chineseGlossary: GlossaryContent = {
  hero: {
    eyebrow: "术语表",
    title: "公共招标术语表",
    body: "用简单语言解释会影响追标决策、合规检查和响应准备的常见术语。",
  },
  terms: [
    {
      key: "solicitation",
      term: "Solicitation / 招标文件",
      definition: "采购方发布的正式采购请求，说明采购内容、供应商响应方式以及提交截止时间。",
      whyItMatters: "它是机会记录的核心依据，阅读摘要前也应复核官方文件。",
    },
    {
      key: "rfp",
      term: "RFP / 提案请求",
      definition: "Request for Proposal，通常要求供应商说明方案、资质、价格和证据，而不只是报价。",
      whyItMatters: "RFP 往往需要更完整的响应工作区、材料和审核步骤。",
    },
    {
      key: "amendment",
      term: "Amendment / 修订",
      definition: "对招标文件的正式修改，例如延期、要求更新、问答发布或附件替换。",
      whyItMatters: "团队在完成响应包前需要刷新证据，避免使用过期要求。",
    },
    {
      key: "addendum",
      term: "Addendum / 补遗",
      definition: "采购方补充发布的材料，常用于澄清规格、表格、图纸或提交说明。",
      whyItMatters: "遗漏补遗可能导致假设过期或响应证据不完整。",
    },
    {
      key: "responsiveness",
      term: "Responsiveness / 响应性",
      definition: "响应文件是否遵循采购方强制说明、表格、截止时间和格式要求。",
      whyItMatters: "即使报价或方案很好，遗漏强制要求也可能导致失败。",
    },
    {
      key: "responsibility",
      term: "Responsibility / 履约能力",
      definition: "供应商是否具备完成工作的能力、资质和可靠性，能够在中选后履约。",
      whyItMatters: "供应商资料、资质和历史表现证据会支持这类判断。",
    },
    {
      key: "no_bid",
      term: "No-bid / 放弃追标",
      definition: "基于匹配度、时间、要求或风险，主动决定不投入响应工作的行为。",
      whyItMatters: "有纪律的放弃能保护团队时间，避免低质量追标消耗。",
    },
    {
      key: "award_tabulation",
      term: "Award tabulation / 授标表",
      definition: "采购方在采购决策后发布的报价、评估供应商或授标结果摘要。",
      whyItMatters: "它帮助团队从结果中学习，改进下一次追标判断。",
    },
  ],
  relatedCta: { label: "阅读供应商流程", href: resourceRouteMap.supplierWorkflow },
};

const englishWorkflow: SupplierWorkflowContent = {
  hero: {
    eyebrow: "Supplier Workflow",
    title: "A Match-to-Learn workflow for public-sector pursuits",
    body:
      "This guide turns the homepage lifecycle into a repeatable operating rhythm for suppliers using WinBids locally.",
  },
  sections: [
    {
      key: "profile",
      title: "Build the supplier profile first",
      body: "A useful pursuit starts with capability, geography, certifications, and plan access context.",
      steps: ["List service states and core capabilities.", "Add certifications and reusable artifacts.", "Review plan limits before assigning advanced work."],
    },
    {
      key: "source_review",
      title: "Review source evidence",
      body: "Public opportunity summaries are only useful when the official source and attachments are understood.",
      steps: ["Open the official source record.", "Check amendment or addendum signals.", "Use local attachment routes and download notes as evidence context."],
    },
    {
      key: "pursuit_decision",
      title: "Make a pursue or no-bid decision",
      body: "The decision should happen before response work grows into a hidden project.",
      steps: ["Check fit, deadline, and missing documents.", "Record no-bid reasons for future learning.", "Promote only credible opportunities into intent workspaces."],
    },
    {
      key: "response_workspace",
      title: "Prepare the response workspace",
      body: "Response work should connect artifacts, quote evidence, compliance notes, and package readiness.",
      steps: ["Attach required supplier artifacts.", "Track compliance and package readiness.", "Export only after evidence and review gates are clear."],
    },
    {
      key: "official_submission",
      title: "Submit through the official channel",
      body: "WinBids can guide steps and store evidence, but the supplier submits through the buyer's required system.",
      steps: ["Follow buyer instructions exactly.", "Capture confirmation references after submission.", "Freeze package evidence for the local record."],
    },
    {
      key: "learning_loop",
      title: "Close the learning loop",
      body: "Award and win/loss notes turn individual pursuits into reusable intelligence.",
      steps: ["Record award or tabulation outcomes.", "Capture what changed the decision.", "Reuse lessons in Knowledge Station and future no-bid checks."],
    },
  ],
  safeClaims: englishHub.safeClaims,
  relatedCta: { label: "Open the glossary", href: resourceRouteMap.glossary },
};

const chineseWorkflow: SupplierWorkflowContent = {
  hero: {
    eyebrow: "供应商流程",
    title: "公共部门追标的“匹配到复盘”工作流",
    body: "这份指南把首页生命周期落成供应商在本地 WinBids 中可重复执行的操作节奏。",
  },
  sections: [
    {
      key: "profile",
      title: "先建立供应商资料",
      body: "有效追标需要能力、地域、资质和套餐权限上下文。",
      steps: ["列出服务州和核心能力。", "添加资质和可复用材料。", "分配高级工作前先检查套餐限制。"],
    },
    {
      key: "source_review",
      title: "复核来源证据",
      body: "只有理解官方来源和附件，公开机会摘要才真正有用。",
      steps: ["打开官方来源记录。", "检查修订或补遗信号。", "把本地附件路由和下载说明作为证据上下文。"],
    },
    {
      key: "pursuit_decision",
      title: "做出追标或放弃决策",
      body: "响应工作变成隐藏项目之前，应先完成决策。",
      steps: ["检查匹配度、截止时间和缺失文件。", "记录放弃原因，供未来复盘。", "只把可信机会推进到意向工作区。"],
    },
    {
      key: "response_workspace",
      title: "准备响应工作区",
      body: "响应工作应连接材料、报价证据、合规笔记和响应包准备度。",
      steps: ["附加必要供应商材料。", "跟踪合规和响应包准备度。", "证据和审核门禁清晰后再导出。"],
    },
    {
      key: "official_submission",
      title: "通过官方渠道提交",
      body: "WinBids 可以指导步骤并保存证据，但供应商需要通过买方要求的系统提交。",
      steps: ["严格遵循买方说明。", "提交后记录确认编号。", "冻结本地响应包证据。"],
    },
    {
      key: "learning_loop",
      title: "闭合复盘循环",
      body: "授标和胜负笔记会把单次追标变成可复用情报。",
      steps: ["记录授标或开标结果。", "捕捉影响决策的原因。", "把经验复用到知识站和未来放弃判断中。"],
    },
  ],
  safeClaims: chineseHub.safeClaims,
  relatedCta: { label: "打开术语表", href: resourceRouteMap.glossary },
};

const hubByLanguage = { en: englishHub, zh: chineseHub } satisfies Record<MarketingResourceLanguage, ResourceHubContent>;
const glossaryByLanguage = { en: englishGlossary, zh: chineseGlossary } satisfies Record<MarketingResourceLanguage, GlossaryContent>;
const workflowByLanguage = { en: englishWorkflow, zh: chineseWorkflow } satisfies Record<MarketingResourceLanguage, SupplierWorkflowContent>;

export function getResourceHubContent(
  language: MarketingResourceLanguage,
  overrides?: MarketingResourceContentOverrides,
) {
  return mergeMarketingContentOverride(hubByLanguage[language], overrides?.hub?.[language]);
}

export function getGlossaryContent(
  language: MarketingResourceLanguage,
  overrides?: MarketingResourceContentOverrides,
) {
  return mergeMarketingContentOverride(glossaryByLanguage[language], overrides?.glossary?.[language]);
}

export function getSupplierWorkflowContent(
  language: MarketingResourceLanguage,
  overrides?: MarketingResourceContentOverrides,
) {
  return mergeMarketingContentOverride(workflowByLanguage[language], overrides?.workflow?.[language]);
}
