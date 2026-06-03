"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { fetchSupplierProfile, updateSupplierProfile } from "@/lib/api/profile";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { SupplierProfile, SupplierProfileInput } from "@/server/profile/types";

interface ProfileFormState {
  companyName: string;
  businessTypes: string;
  keywords: string;
  categories: string;
  certifications: string;
  serviceStates: string;
  minContractValue: string;
  maxContractValue: string;
  riskPreferences: string;
}

const emptyForm: ProfileFormState = {
  companyName: "",
  businessTypes: "",
  keywords: "",
  categories: "",
  certifications: "",
  serviceStates: "",
  minContractValue: "",
  maxContractValue: "",
  riskPreferences: "",
};

function joinValues(values: string[]) {
  return values.join(", ");
}

function splitValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function currencyValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function profileToForm(profile: SupplierProfile): ProfileFormState {
  return {
    companyName: profile.companyName,
    businessTypes: joinValues(profile.businessTypes),
    keywords: joinValues(profile.keywords),
    categories: joinValues(profile.categories),
    certifications: joinValues(profile.certifications),
    serviceStates: joinValues(profile.serviceStates),
    minContractValue: profile.minContractValue === null ? "" : String(profile.minContractValue),
    maxContractValue: profile.maxContractValue === null ? "" : String(profile.maxContractValue),
    riskPreferences: joinValues(profile.riskPreferences),
  };
}

function formToInput(form: ProfileFormState): SupplierProfileInput | null {
  const minContractValue = currencyValue(form.minContractValue);
  const maxContractValue = currencyValue(form.maxContractValue);

  if (minContractValue === undefined || maxContractValue === undefined) {
    return null;
  }

  return {
    companyName: form.companyName.trim(),
    businessTypes: splitValues(form.businessTypes),
    keywords: splitValues(form.keywords),
    categories: splitValues(form.categories),
    certifications: splitValues(form.certifications),
    serviceStates: splitValues(form.serviceStates),
    minContractValue,
    maxContractValue,
    riskPreferences: splitValues(form.riskPreferences),
  };
}

function ProfileContent() {
  const { t } = useLanguage();
  const mountedRef = useRef(true);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [completionScore, setCompletionScore] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    mountedRef.current = true;

    async function loadProfile() {
      setIsLoading(true);
      setLoadError(false);

      try {
        const response = await fetchSupplierProfile();

        if (!mountedRef.current) {
          return;
        }

        setForm(profileToForm(response.profile));
        setCompletionScore(response.profile.completionScore);
      } catch {
        if (mountedRef.current) {
          setLoadError(true);
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateField = (field: keyof ProfileFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setIsSaved(false);
    setSaveError(false);
    setValidationError(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = formToInput(form);

    if (!input) {
      setValidationError(true);
      setSaveError(false);
      setIsSaved(false);
      return null;
    }

    setIsSaving(true);
    setSaveError(false);
    setValidationError(false);
    setIsSaved(false);

    try {
      const response = await updateSupplierProfile(input);
      if (!mountedRef.current) return null;

      setForm(profileToForm(response.profile));
      setCompletionScore(response.profile.completionScore);
      setIsSaved(true);
    } catch {
      if (mountedRef.current) {
        setSaveError(true);
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }

    return null;
  };

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="winbids-sidebar-mark">
            <UserRound size={22} strokeWidth={2.5} />
          </div>
          <div>
            <p className="winbids-kicker">Core profile</p>
            <h1 className="winbids-title">{t("profilePage.title")}</h1>
            <p className="winbids-lead mt-2">{t("profilePage.description")}</p>
          </div>
        </div>
        <div className="winbids-score-badge">
          <p className="text-xs font-semibold uppercase text-slate-500">{t("profilePage.completionScore")}</p>
          <p className="text-2xl font-bold text-slate-900">{completionScore}%</p>
        </div>
      </section>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {t("profilePage.loadError")}
        </div>
      ) : isLoading ? (
        <Card className="winbids-panel border-slate-200 rounded-lg overflow-hidden bg-white">
          <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="grid gap-5 p-6">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card className="winbids-panel border-slate-200 rounded-lg overflow-hidden bg-white">
            <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
              <CardTitle className="text-lg font-semibold text-slate-900">{t("profilePage.formTitle")}</CardTitle>
              <CardDescription className="text-slate-500 font-medium">{t("profilePage.formDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 p-6">
              <div className="space-y-2">
                <Label htmlFor="companyName" className="text-slate-700 font-medium">{t("profilePage.companyName")}</Label>
                <Input
                  id="companyName"
                  value={form.companyName}
                  onChange={(event) => updateField("companyName", event.target.value)}
                  className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessTypes" className="text-slate-700 font-medium">{t("profilePage.businessTypes")}</Label>
                <Input
                  id="businessTypes"
                  value={form.businessTypes}
                  onChange={(event) => updateField("businessTypes", event.target.value)}
                  placeholder={t("profilePage.businessTypesPlaceholder")}
                  className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="keywords" className="text-slate-700 font-medium">{t("profilePage.keywords")}</Label>
                  <Input
                    id="keywords"
                    value={form.keywords}
                    onChange={(event) => updateField("keywords", event.target.value)}
                    placeholder={t("profilePage.commaPlaceholder")}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categories" className="text-slate-700 font-medium">{t("profilePage.categories")}</Label>
                  <Input
                    id="categories"
                    value={form.categories}
                    onChange={(event) => updateField("categories", event.target.value)}
                    placeholder={t("profilePage.commaPlaceholder")}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="certifications" className="text-slate-700 font-medium">{t("profilePage.certifications")}</Label>
                  <Input
                    id="certifications"
                    value={form.certifications}
                    onChange={(event) => updateField("certifications", event.target.value)}
                    placeholder={t("profilePage.commaPlaceholder")}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="serviceStates" className="text-slate-700 font-medium">{t("profilePage.serviceStates")}</Label>
                  <Input
                    id="serviceStates"
                    value={form.serviceStates}
                    onChange={(event) => updateField("serviceStates", event.target.value)}
                    placeholder={t("profilePage.statesPlaceholder")}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="minContractValue" className="text-slate-700 font-medium">{t("profilePage.minContractValue")}</Label>
                  <Input
                    id="minContractValue"
                    type="number"
                    min="0"
                    value={form.minContractValue}
                    onChange={(event) => updateField("minContractValue", event.target.value)}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxContractValue" className="text-slate-700 font-medium">{t("profilePage.maxContractValue")}</Label>
                  <Input
                    id="maxContractValue"
                    type="number"
                    min="0"
                    value={form.maxContractValue}
                    onChange={(event) => updateField("maxContractValue", event.target.value)}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="riskPreferences" className="text-slate-700 font-medium">{t("profilePage.riskPreferences")}</Label>
                <Input
                  id="riskPreferences"
                  value={form.riskPreferences}
                  onChange={(event) => updateField("riskPreferences", event.target.value)}
                  placeholder={t("profilePage.riskPlaceholder")}
                  className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                />
              </div>
              {validationError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                  {t("profilePage.invalidContractValue")}
                </div>
              )}
              {saveError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {t("profilePage.saveError")}
                </div>
              )}
              {isSaved && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                  {t("profilePage.saved")}
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 justify-end">
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10"
              >
                {isSaving ? t("profilePage.saving") : t("profilePage.save")}
              </Button>
            </CardFooter>
          </Card>
        </form>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="winbids-workspace">
        <section className="winbids-hero-panel min-h-64 animate-pulse" />
      </div>
    );
  }

  if (!user) return <AuthRequiredState />;

  return <ProfileContent />;
}
