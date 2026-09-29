"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import { isActiveAdminItem, resolveAdminRoute, visibleAdminNav } from "@/components/admin/admin-nav";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

/** The admin console's tree (spec §3.2): back to the app, the overview, then the role's groups. */
export function AdminSidebarTree({ role, pathname }: { role: AdminConsoleRole; pathname: string }) {
  const { t } = useLanguage();
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const view = visibleAdminNav(role);
  const activeGroupKey = resolveAdminRoute(pathname)?.group?.key ?? null;
  const overview = view.overview;
  const overviewActive = overview ? isActiveAdminItem(overview, pathname) : false;

  const toggleGroup = (key: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="winbids-sidebar-link"
                render={
                  <Link href="/">
                    <ArrowLeft />
                    <span>{t("admin.nav_backToApp")}</span>
                  </Link>
                }
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel className="text-white/50">{t("admin.nav_root")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {overview && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={overviewActive}
                  className={`winbids-sidebar-link ${overviewActive ? "winbids-sidebar-link-active" : ""}`}
                  render={
                    <Link href={overview.href}>
                      <overview.icon />
                      <span>{t(overview.labelKey)}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            )}
            {view.groups.map((group) => {
              // The group that holds the current page is always open (plan decision 16).
              const open = group.key === activeGroupKey || openGroups.has(group.key);
              return (
                <SidebarMenuItem key={group.key}>
                  <SidebarMenuButton className="winbids-sidebar-link" aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                    <group.icon />
                    <span>{t(group.labelKey)}</span>
                    {open ? <ChevronDown className="ml-auto" /> : <ChevronRight className="ml-auto" />}
                  </SidebarMenuButton>
                  {open && (
                    <SidebarMenuSub>
                      {group.items.map((item) => {
                        const active = isActiveAdminItem(item, pathname);
                        return (
                          <SidebarMenuSubItem key={item.key}>
                            <SidebarMenuSubButton
                              isActive={active}
                              className={`winbids-sidebar-link ${active ? "winbids-sidebar-link-active" : ""}`}
                              render={
                                <Link href={item.href}>
                                  <item.icon />
                                  <span>{t(item.labelKey)}</span>
                                </Link>
                              }
                            />
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
