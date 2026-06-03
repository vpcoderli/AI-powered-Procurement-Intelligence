import type { ReactNode } from "react";
import { BarChart3, Bell, FileCheck2, Search } from "lucide-react";

interface AuthPageShellProps {
  mode: "login" | "register";
  title: string;
  subtitle: string;
  children: ReactNode;
}

const metrics = [
  { label: "Live bid discovery", value: "50", icon: Search },
  { label: "Pursuit workspace", value: "AI", icon: BarChart3 },
  { label: "Response readiness", value: "Lite", icon: FileCheck2 },
];

export function AuthPageShell({ mode, title, subtitle, children }: AuthPageShellProps) {
  return (
    <div className="winbids-workspace">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:items-start">
        <article className="winbids-hero-panel min-h-[420px]">
          <p className="winbids-kicker">American Public Supply Intelligence LLC</p>
          <h1 className="winbids-title">WinBids</h1>
          <p className="winbids-lead mt-4">
            Procurement intelligence for U.S. suppliers: discover public bids, qualify opportunities, and coordinate
            response work from one focused workspace.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article key={metric.label} className="winbids-metric-card">
                  <Icon size={18} className="text-blue-700" aria-hidden="true" />
                  <strong className="mt-4 block text-2xl font-black text-slate-950">{metric.value}</strong>
                  <span className="mt-1 block text-xs font-black uppercase text-slate-500">{metric.label}</span>
                </article>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="winbids-soft-pill">Bilingual workspace</span>
            <span className="winbids-soft-pill">Plan-aware access</span>
            <span className="winbids-soft-pill">Source governance</span>
          </div>
        </article>

        <section className="winbids-hero-panel">
          <div className="mb-6 flex items-start gap-3 border-b border-slate-100 pb-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
              <Bell className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="winbids-kicker">{mode === "login" ? "Welcome back" : "Get started"}</p>
              <h2 className="mt-1 text-xl font-black tracking-normal text-slate-950">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p>
            </div>
          </div>
          {children}
        </section>
      </section>
    </div>
  );
}
