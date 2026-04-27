"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="flex items-center gap-2">
      <Globe className="h-4 w-4 text-slate-500" />
      <Select value={language} onValueChange={(val) => setLanguage(val as 'en' | 'zh')}>
        <SelectTrigger className="h-8 w-[100px] border-slate-200 bg-slate-50 text-xs focus:ring-slate-900 rounded-md">
          <SelectValue placeholder={t('common.language')} />
        </SelectTrigger>
        <SelectContent className="rounded-lg border-slate-200 shadow-md">
          <SelectItem value="en" className="text-xs cursor-pointer focus:bg-slate-50 focus:text-slate-900">
            {t('common.english')}
          </SelectItem>
          <SelectItem value="zh" className="text-xs cursor-pointer focus:bg-slate-50 focus:text-slate-900">
            {t('common.chinese')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
