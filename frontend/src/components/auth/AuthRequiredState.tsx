"use client";

import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const COPY = {
  en: {
    title: "Sign in to continue",
    description: "This workspace contains saved bids, account settings, and pursuit data for registered users.",
    login: "Sign in",
    register: "Create account",
  },
  zh: {
    title: "登录后继续",
    description: "该工作区包含已保存招标、账户设置和投标意向数据，仅对注册用户开放。",
    login: "登录",
    register: "注册账号",
  },
};

export function AuthRequiredState({
  description,
  title,
}: {
  description?: string;
  title?: string;
} = {}) {
  const { language } = useLanguage();
  const copy = COPY[language];

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel flex min-h-[420px] flex-col items-center justify-center px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
          <LockKeyhole className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-slate-950">{title ?? copy.title}</h1>
        <p className="mt-3 max-w-lg text-sm font-medium leading-6 text-slate-500">
          {description ?? copy.description}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button className="winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" render={<Link href="/login" />}>
            {copy.login}
          </Button>
          <Button
            variant="outline"
            className="h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950"
            render={<Link href="/register" />}
          >
            {copy.register}
          </Button>
        </div>
      </section>
    </div>
  );
}
