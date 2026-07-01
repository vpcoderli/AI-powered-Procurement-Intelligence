"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, Search, ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { getRequestDemoContent } from "@/lib/marketing/request-demo-content";

const FORM_COPY = {
  en: {
    formTitle: "Capture local demo interest",
    fullName: "Name",
    fullNamePlaceholder: "Buyer One",
    email: "Work email",
    companyName: "Company",
    companyPlaceholder: "Acme Supply",
    role: "Role",
    rolePlaceholder: "Founder, proposal lead, sales",
    serviceStates: "Service states",
    serviceStatesPlaceholder: "CA, TX, NY",
    notes: "Notes",
    notesPlaceholder: "What should the local demo focus on?",
    submit: "Save Demo Request",
    submitting: "Saving...",
    success: "Demo request saved. Opening local account setup...",
    error: "Unable to save the demo request. Please try again.",
  },
  zh: {
    formTitle: "记录本地演示意向",
    fullName: "姓名",
    fullNamePlaceholder: "采购负责人",
    email: "工作邮箱",
    companyName: "公司",
    companyPlaceholder: "Acme Supply",
    role: "角色",
    rolePlaceholder: "创始人、投标负责人、销售",
    serviceStates: "服务州",
    serviceStatesPlaceholder: "CA, TX, NY",
    notes: "备注",
    notesPlaceholder: "本地演示希望重点看哪些内容？",
    submit: "保存演示请求",
    submitting: "正在保存...",
    success: "演示请求已保存，正在打开本地账号设置...",
    error: "暂时无法保存演示请求，请稍后重试。",
  },
};

export default function RequestDemoPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const content = getRequestDemoContent(language);
  const formCopy = FORM_COPY[language];
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("");
  const [serviceStates, setServiceStates] = useState("");
  const [notes, setNotes] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitState("submitting");

    try {
      const response = await fetch("/api/marketing/request-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          companyName,
          role,
          serviceStates: serviceStates.split(",").map((state) => state.trim()).filter(Boolean),
          notes,
          language,
          websiteUrl,
        }),
      });

      if (!response.ok) {
        throw new Error("Request demo failed");
      }

      const body = await response.json() as { lead?: { nextUrl?: string } };
      const lead = body.lead;

      if (!lead?.nextUrl) {
        throw new Error("Request demo response missing next URL");
      }

      setSubmitState("success");
      router.push(lead.nextUrl);
    } catch {
      setSubmitState("error");
    }
  };

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-grid" aria-label="Request a local WinBids demo">
        <article className="winbids-hero-panel">
          <p className="winbids-kicker">{content.eyebrow}</p>
          <h1 className="winbids-title">{content.title}</h1>
          <p className="winbids-lead mt-4">{content.body}</p>
          <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm font-bold leading-6 text-blue-900">
            {content.localOnlyNotice}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/register?intent=demo"
              className={buttonVariants({ className: "winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" })}
            >
              {content.primaryCta.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/search"
              className={buttonVariants({
                variant: "outline",
                className: "h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
              })}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {content.secondaryCta.label}
            </Link>
          </div>
        </article>

        <aside className="grid gap-3" aria-label={content.boundaryTitle}>
          <article className="winbids-metric-card">
            <ShieldCheck className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <strong className="mt-4 block text-base font-black text-slate-950">{content.boundaryTitle}</strong>
            <div className="mt-4 grid gap-3">
              {content.boundaries.map((boundary) => (
                <div key={boundary} className="flex gap-2 text-sm font-semibold leading-6 text-slate-600">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
                  <span>{boundary}</span>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </section>

      <section className="winbids-hero-panel" aria-label={formCopy.formTitle}>
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="winbids-kicker">{content.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-black tracking-normal text-slate-950">{formCopy.formTitle}</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{content.localOnlyNotice}</p>
          </div>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <input
              aria-hidden="true"
              autoComplete="off"
              className="hidden"
              name="websiteUrl"
              tabIndex={-1}
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="requestDemoName">{formCopy.fullName}</Label>
                <Input
                  id="requestDemoName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder={formCopy.fullNamePlaceholder}
                  className="h-11 rounded-lg border-slate-200"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="requestDemoEmail">{formCopy.email}</Label>
                <Input
                  id="requestDemoEmail"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-11 rounded-lg border-slate-200"
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="requestDemoCompany">{formCopy.companyName}</Label>
                <Input
                  id="requestDemoCompany"
                  required
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder={formCopy.companyPlaceholder}
                  className="h-11 rounded-lg border-slate-200"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="requestDemoRole">{formCopy.role}</Label>
                <Input
                  id="requestDemoRole"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder={formCopy.rolePlaceholder}
                  className="h-11 rounded-lg border-slate-200"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="requestDemoStates">{formCopy.serviceStates}</Label>
              <Input
                id="requestDemoStates"
                value={serviceStates}
                onChange={(event) => setServiceStates(event.target.value)}
                placeholder={formCopy.serviceStatesPlaceholder}
                className="h-11 rounded-lg border-slate-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="requestDemoNotes">{formCopy.notes}</Label>
              <textarea
                id="requestDemoNotes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={formCopy.notesPlaceholder}
                className="min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium leading-6 text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            {submitState === "success" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                {formCopy.success}
              </div>
            )}
            {submitState === "error" && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                {formCopy.error}
              </div>
            )}
            <Button
              type="submit"
              disabled={submitState === "submitting"}
              className="winbids-primary-action h-11 w-fit border-0 px-5 hover:bg-blue-800"
            >
              {submitState === "submitting" ? formCopy.submitting : formCopy.submit}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
        </div>
      </section>

      <section className="winbids-hero-panel" aria-label="Local demo steps">
        <div className="grid gap-3 md:grid-cols-3">
          {content.steps.map((step, index) => (
            <article key={step.title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <span className="winbids-soft-pill">{String(index + 1).padStart(2, "0")}</span>
              <strong className="mt-4 block text-base font-black text-slate-950">{step.title}</strong>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{step.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
