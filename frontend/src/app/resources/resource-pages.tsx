"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, FileText, Search, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  getGlossaryContent,
  getResourceHubContent,
  getSupplierWorkflowContent,
  resourceRouteMap,
} from "@/lib/marketing/resource-content";

const guideIcons = [BookOpen, FileText, ShieldCheck];
const lifecycleIcons = [Search, BookOpen, ShieldCheck, FileText, ArrowRight, CheckCircle2];

function SafeClaimList({ claims }: { claims: string[] }) {
  return (
    <div className="grid gap-2">
      {claims.map((claim) => (
        <div key={claim} className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{claim}</span>
        </div>
      ))}
    </div>
  );
}

export function ResourceHubPage() {
  const { language } = useLanguage();
  const content = getResourceHubContent(language);

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel">
        <p className="winbids-kicker">{content.hero.eyebrow}</p>
        <h1 className="winbids-title">{content.hero.title}</h1>
        <p className="winbids-lead mt-4">{content.hero.body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={content.hero.primaryCta.href} className={buttonVariants({ className: "winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" })}>
            {content.hero.primaryCta.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href={content.hero.secondaryCta.href} className={buttonVariants({ variant: "outline", className: "h-10 rounded-lg border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950" })}>
            {content.hero.secondaryCta.label}
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Resource guides">
        {content.guides.map((guide, index) => {
          const Icon = guideIcons[index % guideIcons.length];
          return (
            <Link key={guide.key} href={guide.href} className="winbids-metric-card block transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50">
              <Icon className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <strong className="mt-4 block text-base font-black text-slate-950">{guide.title}</strong>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{guide.body}</p>
            </Link>
          );
        })}
      </section>

      <section className="winbids-hero-panel" aria-label="Match to Learn lifecycle">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {content.lifecycle.map((step, index) => {
            const Icon = lifecycleIcons[index % lifecycleIcons.length];
            return (
              <article key={step.key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <Icon className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <strong className="mt-4 block text-sm font-black text-slate-950">{step.title}</strong>
                <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="winbids-hero-panel" aria-label="Resource boundaries">
        <SafeClaimList claims={content.safeClaims} />
      </section>
    </div>
  );
}

export function ResourceGlossaryPage() {
  const { language } = useLanguage();
  const content = getGlossaryContent(language);

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel">
        <p className="winbids-kicker">{content.hero.eyebrow}</p>
        <h1 className="winbids-title">{content.hero.title}</h1>
        <p className="winbids-lead mt-4">{content.hero.body}</p>
      </section>

      <section className="grid gap-3 md:grid-cols-2" aria-label="Public bid glossary terms">
        {content.terms.map((term) => (
          <article key={term.key} className="winbids-metric-card">
            <span className="winbids-soft-pill">{term.key}</span>
            <h2 className="mt-4 text-lg font-black tracking-normal text-slate-950">{term.term}</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{term.definition}</p>
            <p className="mt-3 text-xs font-bold leading-5 text-blue-800">{term.whyItMatters}</p>
          </article>
        ))}
      </section>

      <Link href={content.relatedCta.href} className={buttonVariants({ className: "winbids-primary-action h-10 w-fit border-0 px-5 hover:bg-blue-800" })}>
        {content.relatedCta.label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function SupplierWorkflowPage() {
  const { language } = useLanguage();
  const content = getSupplierWorkflowContent(language);

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel">
        <p className="winbids-kicker">{content.hero.eyebrow}</p>
        <h1 className="winbids-title">{content.hero.title}</h1>
        <p className="winbids-lead mt-4">{content.hero.body}</p>
      </section>

      <section className="grid gap-4" aria-label="Supplier pursuit workflow">
        {content.sections.map((section, index) => (
          <article key={section.key} className="winbids-hero-panel">
            <span className="winbids-soft-pill">{String(index + 1).padStart(2, "0")}</span>
            <h2 className="mt-4 text-xl font-black tracking-normal text-slate-950">{section.title}</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{section.body}</p>
            <ol className="mt-4 grid gap-2">
              {section.steps.map((step) => (
                <li key={step} className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-600">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </section>

      <section className="winbids-hero-panel" aria-label="Workflow boundaries">
        <SafeClaimList claims={content.safeClaims} />
        <Link href={content.relatedCta.href} className={buttonVariants({ variant: "outline", className: "mt-5 h-10 w-fit rounded-lg border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950" })}>
          {content.relatedCta.label}
        </Link>
        <Link href={resourceRouteMap.hub} className="ml-3 inline-flex h-10 items-center text-sm font-black text-blue-700 hover:text-blue-900">
          Resources
        </Link>
      </section>
    </div>
  );
}
