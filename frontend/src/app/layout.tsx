import type { Metadata } from "next";
import "./globals.css";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthProvider } from "@/context/AuthContext";
import { SavedBidsProvider } from "@/context/SavedBidsContext";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

export const metadata: Metadata = {
  title: "APSi - AI-powered Procurement Intelligence",
  description: "AI-powered Procurement Intelligence Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-50 text-slate-900 selection:bg-slate-200 selection:text-slate-900">
        <LanguageProvider>
          <AuthProvider>
            <SavedBidsProvider>
              <SidebarProvider>
                <AppSidebar />
                <main className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-50">
                  <header className="h-16 flex items-center px-6 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10 shrink-0">
                    <SidebarTrigger className="mr-4 text-slate-500 hover:text-slate-900 transition-colors" />
                    <div className="flex items-center gap-4 ml-auto">
                      <LanguageSwitcher />
                      <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-medium text-sm">
                        JD
                      </div>
                    </div>
                  </header>
                  <div className="flex-1 overflow-auto p-6 md:p-8">
                    {children}
                  </div>
                </main>
              </SidebarProvider>
            </SavedBidsProvider>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
