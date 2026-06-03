"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { AuthApiError } from "@/lib/api/auth";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const COPY = {
  en: {
    title: "Sign in",
    subtitle: "Access your APSi workspace.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in...",
    noAccount: "No account yet?",
    register: "Create one",
    forgotPassword: "Forgot password?",
    weakPassword: "Password must be at least 8 characters.",
    invalidCredentials: "Invalid email or password.",
    genericError: "Unable to sign in. Please try again.",
  },
  zh: {
    title: "登录",
    subtitle: "进入你的 APSi 工作台。",
    email: "邮箱",
    password: "密码",
    submit: "登录",
    submitting: "正在登录...",
    noAccount: "还没有账号？",
    register: "创建账号",
    forgotPassword: "忘记密码？",
    weakPassword: "密码至少需要 8 个字符。",
    invalidCredentials: "邮箱或密码不正确。",
    genericError: "暂时无法登录，请稍后重试。",
  },
};

export default function LoginPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const copy = COPY[language];
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => email.trim().length > 0 && password.length >= 8 && !isSubmitting,
    [email, isSubmitting, password],
  );

  const messageForError = (err: unknown) => {
    if (err instanceof AuthApiError && err.code === "INVALID_CREDENTIALS") {
      return copy.invalidCredentials;
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

    try {
      await login({ email, password });
      router.push("/");
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageShell mode="login" title={copy.title} subtitle={copy.subtitle}>
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
            className="h-11 rounded-lg border-slate-200 focus-visible:ring-blue-700"
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
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 rounded-lg border-slate-200 focus-visible:ring-blue-700"
            minLength={8}
            required
          />
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <Button
          type="submit"
          disabled={!canSubmit}
          className="winbids-primary-action h-11 w-full border-0 hover:bg-blue-800"
        >
          {isSubmitting ? copy.submitting : copy.submit}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        {copy.noAccount}{" "}
        <Link className="font-medium text-slate-950 underline-offset-4 hover:underline" href="/register">
          {copy.register}
        </Link>
      </p>
      <p className="mt-3 text-center text-sm">
        <Link
          className="font-medium text-slate-950 underline-offset-4 hover:underline"
          href="/forgot-password"
        >
          {copy.forgotPassword}
        </Link>
      </p>
    </AuthPageShell>
  );
}
