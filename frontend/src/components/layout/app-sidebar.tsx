"use client";

import Link from "next/link"
import { Home, Bookmark, Settings, Search, ShieldCheck } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
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
      title: t('common.settings'),
      url: "/settings",
      icon: Settings,
    },
    {
      title: t('common.admin'),
      url: "/admin",
      icon: ShieldCheck,
    },
  ]

  return (
    <Sidebar className="border-r border-slate-200 bg-white">
      <SidebarHeader className="h-16 flex flex-row items-center px-6 border-b border-slate-100">
        <div className="flex items-center gap-3 font-semibold text-xl text-slate-900 tracking-tight">
          <div className="bg-slate-900 p-1.5 rounded-lg text-white shadow-sm">
            <Search size={18} strokeWidth={2.5} />
          </div>
          APSi
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('common.application')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton render={
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  } />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
