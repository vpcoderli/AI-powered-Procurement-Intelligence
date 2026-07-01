import type { Language } from "@/lib/i18n/LanguageContext";

export type RequestDemoLanguage = Language;

export const requestDemoLanguages = ["en", "zh"] as const satisfies readonly RequestDemoLanguage[];

interface RequestDemoCta {
  label: string;
  href: string;
}

interface RequestDemoStep {
  title: string;
  body: string;
}

export interface RequestDemoContent {
  eyebrow: string;
  title: string;
  body: string;
  localOnlyNotice: string;
  primaryCta: RequestDemoCta;
  secondaryCta: RequestDemoCta;
  steps: RequestDemoStep[];
  boundaryTitle: string;
  boundaries: string[];
}

const englishContent: RequestDemoContent = {
  eyebrow: "Local demo request",
  title: "Preview the WinBids workflow locally.",
  body:
    "Use this local demo path to create an account, browse public opportunities, and inspect the command-center workflow without sending a sales request.",
  localOnlyNotice: "No external email is sent. This page only prepares a local demo account path for this workspace.",
  primaryCta: { label: "Create Local Demo Account", href: "/register?intent=demo" },
  secondaryCta: { label: "Browse Public Search", href: "/search" },
  steps: [
    {
      title: "Create a local account",
      body: "The demo intent opens the normal registration form with copy that explains the local-only experience.",
    },
    {
      title: "Explore public discovery",
      body: "Use public search to inspect opportunities before saving or preparing response work in an account.",
    },
    {
      title: "Review command center context",
      body: "After sign-in, the home route keeps its command-center view for pursuit status, trust signals, and next actions.",
    },
  ],
  boundaryTitle: "Demo boundaries",
  boundaries: [
    "Suppliers still submit through the official buyer channel.",
    "WinBids organizes evidence and readiness signals, but official solicitation documents remain the source of truth.",
    "The local demo does not promise compliance, eligibility, award, or win outcomes.",
  ],
};

const chineseContent: RequestDemoContent = {
  eyebrow: "本地演示预约",
  title: "在本地预览 WinBids 工作流。",
  body: "通过这个本地演示路径创建账号、浏览公开机会，并查看控制台工作流；不会发送销售请求。",
  localOnlyNotice: "不会发送外部邮件。此页面只为当前工作区准备本地演示账号路径。",
  primaryCta: { label: "创建本地演示账号", href: "/register?intent=demo" },
  secondaryCta: { label: "浏览公开搜索", href: "/search" },
  steps: [
    {
      title: "创建本地账号",
      body: "演示 intent 会打开普通注册表单，并用文案说明这是本地体验。",
    },
    {
      title: "探索公开招标发现",
      body: "在保存或准备响应工作前，可以先用公开搜索查看机会。",
    },
    {
      title: "查看控制台上下文",
      body: "登录后，首页保持 Command Center 语义，用于查看追标状态、可信度信号和下一步动作。",
    },
  ],
  boundaryTitle: "演示边界",
  boundaries: [
    "供应商仍需通过采购方要求的官方渠道提交。",
    "WinBids 帮助组织证据和准备度信号，但官方招标文件始终是最终依据。",
    "本地演示不承诺合规、资格、授标或中标结果。",
  ],
};

const contentByLanguage = {
  en: englishContent,
  zh: chineseContent,
} satisfies Record<RequestDemoLanguage, RequestDemoContent>;

export function getRequestDemoContent(language: RequestDemoLanguage) {
  return contentByLanguage[language];
}
