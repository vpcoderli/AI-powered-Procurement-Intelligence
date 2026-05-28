"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { AuthApiError, acceptWorkspaceInvitation } from "@/lib/api/auth";
import { useLanguage } from "@/lib/i18n/LanguageContext";

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const { refreshSession } = useAuth();
  const [token, setToken] = useState(() => searchParams.get("token") ?? "");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleAcceptInvite() {
    setMessage("");
    setError("");

    if (password !== confirmPassword) {
      setError(t("acceptInvite.passwordMismatch"));
      return;
    }

    setIsSubmitting(true);

    try {
      await acceptWorkspaceInvitation({
        token,
        password,
        displayName: displayName.trim() || undefined,
      });
      await refreshSession();
      setMessage(t("acceptInvite.accepted"));
      window.location.assign("/settings");
    } catch (err) {
      setError(
        err instanceof AuthApiError && err.code === "USAGE_LIMIT_REACHED"
          ? t("acceptInvite.teamSeatLimitReached")
          : err instanceof Error ? err.message : t("acceptInvite.error"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-xl font-semibold text-slate-900">{t("acceptInvite.title")}</CardTitle>
            <CardDescription className="mt-1 text-slate-500">{t("acceptInvite.description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token">{t("acceptInvite.token")}</Label>
            <Input
              id="token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="h-10 rounded-lg border-slate-200"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">{t("acceptInvite.displayName")}</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="h-10 rounded-lg border-slate-200"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("acceptInvite.password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 rounded-lg border-slate-200"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t("acceptInvite.confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-10 rounded-lg border-slate-200"
            />
          </div>
          {message && (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {message}
            </p>
          )}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <Button
            onClick={handleAcceptInvite}
            disabled={isSubmitting || !token.trim() || !password || !confirmPassword}
            className="h-10 w-full rounded-lg bg-slate-900 font-medium text-white hover:bg-slate-800"
          >
            {isSubmitting ? t("acceptInvite.accepting") : t("acceptInvite.accept")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
