"use client";

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Bookmark, Settings, Search, ShieldCheck, ClipboardList, UserRound, Route } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { useAuth } from "@/context/AuthContext"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const pathname = usePathname();

  // Menu items.
  const items = [
    {
      title: t('common.dashboard'),
      url: "/",
      icon: Home,
    },
    {
      title: t('common.search'),
      url: "/search",
      icon: Search,
    },
    {
      title: t('common.saved'),
      url: "/saved",
      icon: Bookmark,
    },
    {
      title: t("common.profile"),
      url: "/profile",
      icon: UserRound,
    },
    {
      title: t("common.intents"),
      url: "/intents",
      icon: ClipboardList,
    },
    {
      title: "Submission Path",
      url: "/intents",
      icon: Route,
    },
    {
      title: t('common.settings'),
      url: "/settings",
      icon: Settings,
    },
    ...(user?.role === "admin"
      ? [
          {
            title: t('common.admin'),
            url: "/admin",
            icon: ShieldCheck,
          },
        ]
      : []),
  ]

  return (
    <Sidebar className="winbids-sidebar border-r-0 bg-transparent">
      <SidebarHeader className="h-20 flex flex-row items-center px-5">
        <div className="winbids-sidebar-brand flex items-center gap-3 tracking-tight">
          <div className="winbids-sidebar-mark">
            WB
          </div>
          <div>
            <strong className="block text-lg font-black">WinBids</strong>
            <small className="mt-0.5 block text-xs font-semibold text-white/60">APSi platform</small>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-white/50">{t('common.application')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = item.url === "/" ? pathname === "/" : pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      className={`winbids-sidebar-link ${active ? "winbids-sidebar-link-active" : ""}`}
                      render={
                        <Link href={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
