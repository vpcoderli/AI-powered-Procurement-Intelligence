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
  LogOut,
  LogIn,
  UserPlus,
} from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { useAuth } from "@/context/AuthContext"
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

const adminConsoleRoles = ["admin", "operator", "support"];

export function AppSidebar() {
  const { t } = useLanguage();
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

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

  const authenticatedItems = [
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
    ...(user && adminConsoleRoles.includes(user.role)
      ? [
          {
            title: t('common.admin'),
            url: "/admin",
            icon: ShieldCheck,
          },
        ]
      : []),
  ];
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
