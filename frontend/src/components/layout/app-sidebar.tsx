"use client";

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Home,
  Bookmark,
  Settings,
  Search,
  ShieldCheck,
  ClipboardList,
  UserRound,
  Route,
  BookOpen,
  Database,
  LogOut,
  LogIn,
  ServerCog,
  UserPlus,
} from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { useAuth } from "@/context/AuthContext"
import { ADMIN_CONSOLE_ROLES } from "@/server/auth/entitlements"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isAdminUser = user ? ADMIN_CONSOLE_ROLES.includes(user.role as (typeof ADMIN_CONSOLE_ROLES)[number]) : false;

  const handleLogout = async () => {
    await logout();
    router.push("/login");
    router.refresh();
  };

  const anonymousItems = [
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
  ];

  const ordinaryItems = [
    ...anonymousItems,
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
    ...(user?.features.includes("knowledge_station")
      ? [
          {
            title: t("knowledge.library"),
            url: "/knowledge",
            icon: BookOpen,
          },
        ]
      : []),
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
  ];

  const adminItems = [
    ...ordinaryItems,
    {
      title: t("admin.title"),
      url: "/admin",
      icon: ShieldCheck,
    },
    {
      title: t("admin.sources"),
      url: "/admin#data-sources",
      icon: Database,
    },
    {
      title: t("admin.config"),
      url: "/admin#configuration",
      icon: ServerCog,
    },
  ];

  const authenticatedItems = isAdminUser ? adminItems : ordinaryItems;
  const items = user ? authenticatedItems : anonymousItems;

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
                const itemPath = item.url.split(/[?#]/)[0];
                const active = itemPath === "/" ? pathname === "/" : pathname.startsWith(itemPath);
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
      <SidebarFooter className="px-4 pb-5">
        <SidebarMenu>
          {user ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                className="winbids-sidebar-link text-white/75 hover:text-white"
                onClick={() => {
                  void handleLogout();
                }}
              >
                <LogOut />
                <span>{t("common.logout")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="winbids-sidebar-link text-white/75 hover:text-white"
                  render={
                    <Link href="/login">
                      <LogIn />
                      <span>{t("common.login")}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="winbids-sidebar-link text-white/75 hover:text-white"
                  render={
                    <Link href="/register">
                      <UserPlus />
                      <span>{t("common.register")}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            </>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
