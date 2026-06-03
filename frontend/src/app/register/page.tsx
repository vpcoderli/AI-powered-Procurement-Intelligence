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
    title: "Create account",
    subtitle: "Start saving bids and searches locally.",
    displayName: "Display name",
    displayNamePlaceholder: "Buyer One",
    email: "Email",
    password: "Password",
    submit: "Create account",
    submitting: "Creating account...",
    hasAccount: "Already have an account?",
    login: "Sign in",
    weakPassword: "Password must be at least 8 characters.",
    duplicateEmail: "That email is already registered.",
    genericError: "Unable to create the account. Please try again.",
  },
  zh: {
    title: "创建账号",
    subtitle: "本地保存标案和搜索。",
    displayName: "显示名称",
    displayNamePlaceholder: "采购负责人",
    email: "邮箱",
    password: "密码",
    submit: "创建账号",
    submitting: "正在创建...",
    hasAccount: "已有账号？",
    login: "登录",
    weakPassword: "密码至少需要 8 个字符。",
    duplicateEmail: "该邮箱已经注册。",
    genericError: "暂时无法创建账号，请稍后重试。",
  },
};

export default function RegisterPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const copy = COPY[language];
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => email.trim().length > 0 && password.length >= 8 && !isSubmitting,
    [email, isSubmitting, password],
  );

  const messageForError = (err: unknown) => {
    if (err instanceof AuthApiError) {
      if (err.code === "EMAIL_ALREADY_REGISTERED") {
        return copy.duplicateEmail;
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

    try {
      await register({
        email,
        password,
        displayName: displayName.trim() || undefined,
      });
      router.push("/");
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageShell mode="register" title={copy.title} subtitle={copy.subtitle}>
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="displayName" className="text-slate-700">
            {copy.displayName}
          </Label>
          <Input
            id="displayName"
            type="text"
            autoComplete="name"
            placeholder={copy.displayNamePlaceholder}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="h-11 rounded-lg border-slate-200 focus-visible:ring-blue-700"
          />
        </div>
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
            autoComplete="new-password"
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
        {copy.hasAccount}{" "}
        <Link className="font-medium text-slate-950 underline-offset-4 hover:underline" href="/login">
          {copy.login}
        </Link>
      </p>
    </AuthPageShell>
  );
}
