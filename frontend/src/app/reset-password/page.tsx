"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthApiError, confirmPasswordReset } from "@/lib/api/auth";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const COPY = {
  en: {
    title: "Set new password",
    subtitle: "Paste your reset token and choose a new password.",
    token: "Reset token",
    password: "New password",
    submit: "Update password",
    submitting: "Updating...",
    success: "Password updated. You can sign in with the new password.",
    backToLogin: "Back to sign in",
    weakPassword: "Password must be at least 8 characters.",
    invalidToken: "This reset link is invalid or expired.",
    genericError: "Unable to reset password. Please try again.",
  },
  zh: {
    title: "设置新密码",
    subtitle: "粘贴重置 token，并设置新密码。",
    token: "重置 token",
    password: "新密码",
    submit: "更新密码",
    submitting: "正在更新...",
    success: "密码已更新，可以使用新密码登录。",
    backToLogin: "返回登录",
    weakPassword: "密码至少需要 8 个字符。",
    invalidToken: "重置链接无效或已过期。",
    genericError: "暂时无法重置密码，请稍后重试。",
  },
};

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const copy = COPY[language];
  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => token.trim().length > 0 && password.length >= 8 && !isSubmitting && !success,
    [isSubmitting, password, success, token],
  );

  const messageForError = (err: unknown) => {
    if (err instanceof AuthApiError) {
      if (err.code === "INVALID_RESET_TOKEN") {
        return copy.invalidToken;
      }

      if (err.code === "WEAK_PASSWORD") {
        return copy.weakPassword;
      }
    }

    return err instanceof Error ? err.message : copy.genericError;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password.length < 8) {
      setError(copy.weakPassword);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      await confirmPasswordReset({ token, password });
      setSuccess(true);
      setPassword("");
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CardContent className="px-6 py-6">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="token" className="text-slate-700">
            {copy.token}
          </Label>
          <Input
            id="token"
            type="text"
            autoComplete="one-time-code"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="h-11 rounded-lg border-slate-200 focus-visible:ring-slate-900"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-slate-700">
            {copy.password}
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 rounded-lg border-slate-200 focus-visible:ring-slate-900"
            minLength={8}
            required
          />
        </div>
        {success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {copy.success}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <Button
          type="submit"
          disabled={!canSubmit}
          className="h-11 w-full rounded-lg bg-slate-900 font-medium text-white hover:bg-slate-800"
        >
          {isSubmitting ? copy.submitting : copy.submit}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm">
        <Link className="font-medium text-slate-950 underline-offset-4 hover:underline" href="/login">
          {copy.backToLogin}
        </Link>
      </p>
    </CardContent>
  );
}

export default function ResetPasswordPage() {
  const { language } = useLanguage();
  const copy = COPY[language];

  return (
    <div className="flex min-h-full items-start justify-center px-2 py-8 md:py-14">
      <Card className="w-full max-w-md rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-3 border-b border-slate-100 px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl font-semibold text-slate-950">{copy.title}</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
            </div>
          </div>
        </CardHeader>
        <Suspense fallback={<CardContent className="px-6 py-6" />}>
          <ResetPasswordForm />
        </Suspense>
      </Card>
    </div>
  );
}
