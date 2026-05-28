"use client";

import { Bell, CheckCircle2, Key, LockKeyhole, PaintBucket, Settings, Shield, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { canUseFeature, lockedFeatureMessage } from "@/lib/features/useFeature";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { ACCOUNT_TIER_LABELS, type FeatureKey } from "@/server/auth/entitlements";

const FEATURE_ACCESS_ITEMS: Array<{ key: FeatureKey; label: string }> = [
  { key: "bid_search", label: "Bid search" },
  { key: "saved_bids", label: "Saved bids" },
  { key: "intent_workspace", label: "Intent workspace" },
  { key: "submission_guidance", label: "Submission guidance" },
  { key: "compliance_manifest", label: "Compliance manifest" },
  { key: "quote_workflow", label: "Quote workflow" },
  { key: "knowledge_station", label: "Knowledge Station" },
];

export default function SettingsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const currentTier = user ? ACCOUNT_TIER_LABELS[user.tier] : ACCOUNT_TIER_LABELS.free;

  return (
    <div className="flex flex-col h-full gap-8 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm">
            <Settings size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('settings.title')}</h1>
            <p className="text-sm text-slate-500 font-medium mt-0.5">
              {t('settings.description')}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="profile" className="flex flex-col md:flex-row gap-6 md:gap-8 mt-2" orientation="vertical">
        <TabsList className="flex flex-col w-full md:w-64 h-auto justify-start items-stretch p-1.5 bg-slate-50 border border-slate-200 rounded-xl shadow-sm gap-1">
          <TabsTrigger value="profile" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <User className="mr-2.5 h-4 w-4" /> {t('settings.profile')}
          </TabsTrigger>
          <TabsTrigger value="notifications" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <Bell className="mr-2.5 h-4 w-4" /> {t('settings.notifications')}
          </TabsTrigger>
          <TabsTrigger value="security" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <Shield className="mr-2.5 h-4 w-4" /> {t('settings.security')}
          </TabsTrigger>
          <TabsTrigger value="appearance" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <PaintBucket className="mr-2.5 h-4 w-4" /> {t('settings.appearance')}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1">
          {/* Profile Settings */}
          <TabsContent value="profile" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.currentPlan")}</CardTitle>
                    <CardDescription className="text-slate-500 font-medium">{t("settings.featureAccess")}</CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit border-slate-200 bg-white text-slate-700">
                    {currentTier}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 p-6 sm:grid-cols-2">
                {FEATURE_ACCESS_ITEMS.map((feature) => {
                  const enabled = canUseFeature(user, feature.key);

                  return (
                    <div
                      key={feature.key}
                      className={`rounded-lg border p-3 ${
                        enabled ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-slate-900">{feature.label}</span>
                        {enabled ? (
                          <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />
                        ) : (
                          <LockKeyhole size={16} className="shrink-0 text-slate-400" />
                        )}
                      </div>
                      {!enabled && (
                        <p className="mt-2 text-xs font-medium leading-5 text-slate-500">
                          {lockedFeatureMessage(feature.key)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t('settings.personalInfo')}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t('settings.personalInfoDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-slate-700 font-medium">{t('settings.firstName')}</Label>
                    <Input id="firstName" defaultValue="John" className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-slate-700 font-medium">{t('settings.lastName')}</Label>
                    <Input id="lastName" defaultValue="Doe" className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-700 font-medium">{t('settings.email')}</Label>
                  <div className="flex gap-2">
                    <Input id="email" defaultValue="john.doe@example.com" disabled className="bg-slate-50 border-slate-200 h-10 rounded-lg text-slate-500" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company" className="text-slate-700 font-medium">{t('settings.company')}</Label>
                  <Input id="company" defaultValue="Acme Corp LLC" className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg" />
                </div>
              </CardContent>
              <CardFooter className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <Button className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10">{t('common.save')}</Button>
              </CardFooter>
            </Card>
          </TabsContent>

          {/* Notifications Settings */}
          <TabsContent value="notifications" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t('settings.emailPreferences')}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t('settings.emailPreferencesDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="flex flex-row items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t('settings.savedSearchAlerts')}</Label>
                    <span className="text-sm text-slate-500">{t('settings.savedSearchAlertsDesc')}</span>
                  </div>
                  <Switch defaultChecked className="data-[state=checked]:bg-slate-900 shrink-0" />
                </div>
                <Separator className="bg-slate-100" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t('settings.alertFrequency')}</Label>
                    <span className="text-sm text-slate-500">{t('settings.alertFrequencyDesc')}</span>
                  </div>
                  <Select defaultValue="daily">
                    <SelectTrigger className="w-full sm:w-[180px] shrink-0 border-slate-200 focus:ring-slate-900 rounded-lg h-10">
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-md">
                      <SelectItem value="realtime" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">As they arrive</SelectItem>
                      <SelectItem value="daily" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">Daily Digest</SelectItem>
                      <SelectItem value="weekly" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">Weekly Summary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator className="bg-slate-100" />
                <div className="flex flex-row items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">Marketing Updates</Label>
                    <span className="text-sm text-slate-500">Receive news about new features and updates.</span>
                  </div>
                  <Switch className="data-[state=checked]:bg-slate-900 shrink-0" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Settings */}
          <TabsContent value="security" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">Password & Security</CardTitle>
                <CardDescription className="text-slate-500 font-medium">Manage your password and secure your account.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <Label htmlFor="current" className="text-slate-700 font-medium">Current password</Label>
                  <Input id="current" type="password" className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new" className="text-slate-700 font-medium">New password</Label>
                  <Input id="new" type="password" className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-slate-700 font-medium">Confirm new password</Label>
                  <Input id="confirm" type="password" className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg" />
                </div>
              </CardContent>
              <CardFooter className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 flex justify-between items-center">
                <Button variant="outline" className="border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-lg h-10"><Key className="mr-2 h-4 w-4" /> Enable 2FA</Button>
                <Button className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10">Update Password</Button>
              </CardFooter>
            </Card>
          </TabsContent>

          {/* Appearance Settings */}
          <TabsContent value="appearance" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">Appearance</CardTitle>
                <CardDescription className="text-slate-500 font-medium">Customize how APSi looks on your device.</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">Theme</Label>
                    <span className="text-sm text-slate-500">Select your preferred color theme.</span>
                  </div>
                  <Select defaultValue="light">
                    <SelectTrigger className="w-full sm:w-[180px] shrink-0 border-slate-200 focus:ring-slate-900 rounded-lg h-10">
                      <SelectValue placeholder="Select theme" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-md">
                      <SelectItem value="light" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">Light (Slate)</SelectItem>
                      <SelectItem value="dark" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">Dark (Coming soon)</SelectItem>
                      <SelectItem value="system" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
