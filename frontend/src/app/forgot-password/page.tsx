"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/api/auth";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const COPY = {
  en: {
    title: "Reset password",
    subtitle: "Enter your account email to create a reset link.",
    email: "Email",
    submit: "Send reset link",
    submitting: "Sending...",
    sent: "If the email exists, a reset link is ready.",
    localToken: "Local reset link",
    expiresAt: "Expires at",
    backToLogin: "Back to sign in",
    genericError: "Unable to request a reset link. Please try again.",
  },
  zh: {
    title: "重置密码",
    subtitle: "输入账号邮箱，生成重置链接。",
    email: "邮箱",
    submit: "发送重置链接",
    submitting: "正在发送...",
    sent: "如果邮箱存在，重置链接已经生成。",
    localToken: "本地重置链接",
    expiresAt: "过期时间",
    backToLogin: "返回登录",
    genericError: "暂时无法生成重置链接，请稍后重试。",
  },
};

export default function ForgotPasswordPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const [email, setEmail] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim().length > 0 && !isSubmitting, [email, isSubmitting]);
  const resetHref = resetToken ? `/reset-password?token=${encodeURIComponent(resetToken)}` : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    setResetToken(null);
    setExpiresAt(null);

    try {
      const result = await requestPasswordReset({ email });
      setMessage(copy.sent);
      setResetToken(result.resetToken ?? null);
      setExpiresAt(result.expiresAt ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.genericError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-start justify-center px-2 py-8 md:py-14">
      <Card className="w-full max-w-md rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-3 border-b border-slate-100 px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl font-semibold text-slate-950">{copy.title}</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700">
                {copy.email}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 rounded-lg border-slate-200 focus-visible:ring-slate-900"
                required
              />
            </div>
            {message && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {message}
              </div>
            )}
            {resetHref && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <p className="font-medium text-slate-950">{copy.localToken}</p>
                <Link className="break-all text-slate-950 underline-offset-4 hover:underline" href={resetHref}>
                  {resetHref}
                </Link>
                {expiresAt && (
                  <p className="text-xs text-slate-500">
                    {copy.expiresAt}: {new Date(expiresAt).toLocaleString()}
                  </p>
                )}
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
      </Card>
    </div>
  );
}
