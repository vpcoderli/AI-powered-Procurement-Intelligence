"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  CreditCard,
  Key,
  LockKeyhole,
  PaintBucket,
  Settings,
  Shield,
  User,
  Users,
} from "lucide-react";
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
import {
  changePassword,
  AuthApiError,
  cancelAccountSubscription,
  createCheckoutSession,
  fetchAccountSubscription,
  fetchAccountWorkspace,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  updateAccountWorkspace,
  updateAccountProfile,
  updateWorkspaceMemberRole,
  type AccountWorkspaceMember,
  type AccountSubscriptionResponse,
  type AccountWorkspaceResponse,
} from "@/lib/api/auth";
import { canUseFeature, lockedFeatureMessage } from "@/lib/features/useFeature";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { ACCOUNT_TIER_LABELS, type AccountTier, type FeatureKey } from "@/server/auth/entitlements";

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
  const { user, isLoading, refreshSession } = useAuth();
  const [profileDraft, setProfileDraft] = useState<{ userId: string | null; displayName: string }>({
    userId: null,
    displayName: "",
  });
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [subscriptionData, setSubscriptionData] = useState<AccountSubscriptionResponse | null>(null);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [billingMessage, setBillingMessage] = useState("");
  const [billingActionTier, setBillingActionTier] = useState<AccountTier | "cancel" | null>(null);
  const [workspaceData, setWorkspaceData] = useState<AccountWorkspaceResponse | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [inviteDraft, setInviteDraft] = useState({ email: "", displayName: "" });
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [isInvitingMember, setIsInvitingMember] = useState(false);
  const [teamActionMessage, setTeamActionMessage] = useState("");
  const [teamActionError, setTeamActionError] = useState("");
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null);
  const currentTier = user ? ACCOUNT_TIER_LABELS[user.tier] : ACCOUNT_TIER_LABELS.free;
  const displayName =
    profileDraft.userId === user?.id ? profileDraft.displayName : (user?.displayName ?? "");
  const currentSubscription = user ? subscriptionData?.subscription : null;
  const canManageWorkspace = workspaceData?.currentUserRole === "owner";

  useEffect(() => {
    if (!user) return;

    let isCancelled = false;

    fetchAccountSubscription()
      .then((data) => {
        if (isCancelled) return;
        setSubscriptionData(data);
        setSubscriptionError("");
      })
      .catch((error) => {
        if (isCancelled) return;
        setSubscriptionError(error instanceof Error ? error.message : t("settings.subscriptionLoadError"));
      });

    return () => {
      isCancelled = true;
    };
  }, [t, user]);

  useEffect(() => {
    if (!user) return;

    let isCancelled = false;

    fetchAccountWorkspace()
      .then((data) => {
        if (isCancelled) return;
        setWorkspaceData(data);
        setWorkspaceNameDraft(data.organization.name);
        setWorkspaceError("");
      })
      .catch((error) => {
        if (isCancelled) return;
        setWorkspaceError(error instanceof Error ? error.message : t("settings.workspaceLoadError"));
      });

    return () => {
      isCancelled = true;
    };
  }, [t, user]);

  function localizedPlanFeatures(tier: AccountTier) {
    return [
      t(`settings.plan_${tier}_feature1`),
      t(`settings.plan_${tier}_feature2`),
      t(`settings.plan_${tier}_feature3`),
    ];
  }

  function planPriceLabel(priceMonthlyUsd: number | null) {
    if (priceMonthlyUsd === null) return t("settings.customPricing");
    if (priceMonthlyUsd === 0) return t("settings.freePrice");

     return t("settings.priceMonthly").replace("{price}", String(priceMonthlyUsd));
  }

  async function refreshSubscription() {
    const data = await fetchAccountSubscription();
    setSubscriptionData(data);
    return data;
  }

  async function handleStartCheckout(tier: AccountTier) {
    setBillingMessage("");
    setSubscriptionError("");
    setBillingActionTier(tier);

    try {
      const result = await createCheckoutSession({ tier });
      setBillingMessage(t("settings.checkoutStarted"));
      window.history.replaceState(null, "", result.checkoutSession.checkoutUrl);
      await refreshSubscription();
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : t("settings.checkoutError"));
    } finally {
      setBillingActionTier(null);
    }
  }

  async function handleCancelSubscription() {
    setBillingMessage("");
    setSubscriptionError("");
    setBillingActionTier("cancel");

    try {
      const data = await cancelAccountSubscription();
      setSubscriptionData(data);
      setBillingMessage(t("settings.subscriptionCancelScheduled"));
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : t("settings.cancelSubscriptionError"));
    } finally {
      setBillingActionTier(null);
    }
  }

  async function handleProfileSave() {
    setProfileMessage("");
    setProfileError("");
    setIsSavingProfile(true);

    try {
      await updateAccountProfile({ displayName });
      await refreshSession();
      setProfileMessage(t("settings.profileSaved"));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t("settings.profileSaveError"));
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handlePasswordChange() {
    setPasswordMessage("");
    setPasswordError("");

    if (newPassword !== confirmPassword) {
      setPasswordError(t("settings.passwordMismatch"));
      return;
    }

    setIsChangingPassword(true);

    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(t("settings.passwordSaved"));
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t("settings.passwordSaveError"));
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleWorkspaceSave() {
    setWorkspaceMessage("");
    setWorkspaceError("");
    setIsSavingWorkspace(true);

    try {
      const data = await updateAccountWorkspace({ name: workspaceNameDraft });
      setWorkspaceData(data);
      setWorkspaceNameDraft(data.organization.name);
      await refreshSession();
      setWorkspaceMessage(t("settings.workspaceSaved"));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : t("settings.workspaceSaveError"));
    } finally {
      setIsSavingWorkspace(false);
    }
  }

  async function handleInviteMember() {
    setInviteMessage("");
    setInviteError("");
    setTemporaryPassword("");
    setIsInvitingMember(true);

    try {
      const invite = await inviteWorkspaceMember({
        email: inviteDraft.email,
        displayName: inviteDraft.displayName.trim() || undefined,
        role: "member",
      });
      const data = await fetchAccountWorkspace();
      setWorkspaceData(data);
      setInviteDraft({ email: "", displayName: "" });
      setTemporaryPassword(invite.temporaryPassword);
      setInviteMessage(t("settings.memberInvited"));
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : t("settings.memberInviteError"));
    } finally {
      setIsInvitingMember(false);
    }
  }

  function teamErrorMessage(error: unknown) {
    if (error instanceof AuthApiError && error.code === "LAST_OWNER_REQUIRED") {
      return t("settings.lastOwnerRequired");
    }

    return error instanceof Error ? error.message : t("settings.memberUpdateError");
  }

  async function handleMemberRoleChange(
    member: AccountWorkspaceMember,
    role: AccountWorkspaceMember["workspaceRole"],
  ) {
    if (member.workspaceRole === role) return;

    setTeamActionMessage("");
    setTeamActionError("");
    setMemberActionUserId(member.userId);

    try {
      const data = await updateWorkspaceMemberRole(member.userId, { role });
      setWorkspaceData(data);
      await refreshSession();
      setTeamActionMessage(t("settings.memberUpdated"));
    } catch (error) {
      setTeamActionError(teamErrorMessage(error));
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleRemoveMember(member: AccountWorkspaceMember) {
    setTeamActionMessage("");
    setTeamActionError("");
    setMemberActionUserId(member.userId);

    try {
      const data = await removeWorkspaceMember(member.userId);
      setWorkspaceData(data);
      await refreshSession();
      setTeamActionMessage(t("settings.memberRemoved"));
    } catch (error) {
      setTeamActionError(teamErrorMessage(error));
    } finally {
      setMemberActionUserId(null);
    }
  }

  return (
    <div className="flex flex-col h-full gap-8 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm">
            <Settings size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("settings.title")}</h1>
            <p className="text-sm text-slate-500 font-medium mt-0.5">{t("settings.description")}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="profile" className="flex flex-col md:flex-row gap-6 md:gap-8 mt-2" orientation="vertical">
        <TabsList className="flex flex-col w-full md:w-64 h-auto justify-start items-stretch p-1.5 bg-slate-50 border border-slate-200 rounded-xl shadow-sm gap-1">
          <TabsTrigger value="profile" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <User className="mr-2.5 h-4 w-4" /> {t("settings.profile")}
          </TabsTrigger>
          <TabsTrigger value="notifications" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <Bell className="mr-2.5 h-4 w-4" /> {t("settings.notifications")}
          </TabsTrigger>
          <TabsTrigger value="team" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <Users className="mr-2.5 h-4 w-4" /> {t("settings.team")}
          </TabsTrigger>
          <TabsTrigger value="billing" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <CreditCard className="mr-2.5 h-4 w-4" /> {t("settings.billing")}
          </TabsTrigger>
          <TabsTrigger value="security" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <Shield className="mr-2.5 h-4 w-4" /> {t("settings.security")}
          </TabsTrigger>
          <TabsTrigger value="appearance" className="w-full justify-start text-left data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded-lg text-slate-500 font-medium py-2.5 px-3">
            <PaintBucket className="mr-2.5 h-4 w-4" /> {t("settings.appearance")}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1">
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
                <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.personalInfo")}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t("settings.personalInfoDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <Label htmlFor="displayName" className="text-slate-700 font-medium">
                    {t("settings.displayName")}
                  </Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(event) =>
                      setProfileDraft({
                        userId: user?.id ?? null,
                        displayName: event.target.value,
                      })
                    }
                    disabled={isLoading || isSavingProfile || !user}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-700 font-medium">{t("settings.email")}</Label>
                  <Input
                    id="email"
                    value={user?.email ?? ""}
                    disabled
                    className="bg-slate-50 border-slate-200 h-10 rounded-lg text-slate-500"
                  />
                </div>
                {profileMessage && <p className="text-sm font-medium text-emerald-700">{profileMessage}</p>}
                {profileError && <p className="text-sm font-medium text-red-600">{profileError}</p>}
              </CardContent>
              <CardFooter className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <Button
                  onClick={handleProfileSave}
                  disabled={isLoading || isSavingProfile || !user}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10"
                >
                  {isSavingProfile ? t("settings.saving") : t("common.save")}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          <TabsContent value="team" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.workspace")}</CardTitle>
                    <CardDescription className="text-slate-500 font-medium">{t("settings.workspaceDesc")}</CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit border-slate-200 bg-white text-slate-700">
                    {workspaceData ? t(`settings.workspaceRole_${workspaceData.currentUserRole}`) : t("settings.loadingPlans")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <Label htmlFor="workspaceName" className="text-slate-700 font-medium">
                    {t("settings.workspaceName")}
                  </Label>
                  <Input
                    id="workspaceName"
                    value={workspaceNameDraft}
                    onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                    disabled={!canManageWorkspace || isSavingWorkspace || !user}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                  {!canManageWorkspace && workspaceData && (
                    <p className="text-xs font-medium text-slate-500">{t("settings.ownerOnlyWorkspace")}</p>
                  )}
                </div>
                {workspaceMessage && <p className="text-sm font-medium text-emerald-700">{workspaceMessage}</p>}
                {workspaceError && <p className="text-sm font-medium text-red-600">{workspaceError}</p>}
              </CardContent>
              <CardFooter className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <Button
                  onClick={handleWorkspaceSave}
                  disabled={!canManageWorkspace || isSavingWorkspace || !workspaceNameDraft.trim()}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10"
                >
                  {isSavingWorkspace ? t("settings.saving") : t("common.save")}
                </Button>
              </CardFooter>
            </Card>

            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.teamMembers")}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t("settings.teamMembersDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                {canManageWorkspace && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">{t("settings.inviteMember")}</h3>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="inviteEmail" className="text-slate-700 font-medium">
                          {t("settings.email")}
                        </Label>
                        <Input
                          id="inviteEmail"
                          type="email"
                          value={inviteDraft.email}
                          onChange={(event) => setInviteDraft((draft) => ({ ...draft, email: event.target.value }))}
                          className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="inviteDisplayName" className="text-slate-700 font-medium">
                          {t("settings.displayName")}
                        </Label>
                        <Input
                          id="inviteDisplayName"
                          value={inviteDraft.displayName}
                          onChange={(event) => setInviteDraft((draft) => ({ ...draft, displayName: event.target.value }))}
                          className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={handleInviteMember}
                      disabled={isInvitingMember || !inviteDraft.email.trim()}
                      className="mt-4 bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10"
                    >
                      {isInvitingMember ? t("settings.inviting") : t("settings.inviteMember")}
                    </Button>
                    {inviteMessage && <p className="mt-3 text-sm font-medium text-emerald-700">{inviteMessage}</p>}
                    {temporaryPassword && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <span className="font-semibold">{t("settings.temporaryPassword")}:</span>{" "}
                        <span className="break-all font-mono">{temporaryPassword}</span>
                      </div>
                    )}
                    {inviteError && <p className="mt-3 text-sm font-medium text-red-600">{inviteError}</p>}
                  </div>
                )}

                <div className="space-y-3">
                  {teamActionMessage && <p className="text-sm font-medium text-emerald-700">{teamActionMessage}</p>}
                  {teamActionError && <p className="text-sm font-medium text-red-600">{teamActionError}</p>}
                  {(workspaceData?.members ?? []).map((member) => (
                    <div
                      key={member.userId}
                      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {member.displayName || member.email || member.userId}
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-500">{member.email}</p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        {canManageWorkspace ? (
                          <Select
                            value={member.workspaceRole}
                            onValueChange={(role) =>
                              handleMemberRoleChange(member, role as AccountWorkspaceMember["workspaceRole"])
                            }
                            disabled={memberActionUserId === member.userId}
                          >
                            <SelectTrigger
                              aria-label={t("settings.changeRole")}
                              className="h-9 w-full border-slate-200 text-sm font-medium focus:ring-slate-900 sm:w-[132px]"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-lg border-slate-200 shadow-md">
                              <SelectItem value="owner" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                                {t("settings.workspaceRole_owner")}
                              </SelectItem>
                              <SelectItem value="member" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                                {t("settings.workspaceRole_member")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-700">
                            {t(`settings.workspaceRole_${member.workspaceRole}`)}
                          </Badge>
                        )}
                        {canManageWorkspace && (
                          <Button
                            variant="outline"
                            onClick={() => handleRemoveMember(member)}
                            disabled={memberActionUserId === member.userId || member.userId === user?.id}
                            className="h-9 border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 hover:text-red-800"
                          >
                            {t("settings.removeMember")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!workspaceData && !workspaceError && (
                    <p className="text-sm font-medium text-slate-500">{t("settings.loadingPlans")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.emailPreferences")}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t("settings.emailPreferencesDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="flex flex-row items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t("settings.savedSearchAlerts")}</Label>
                    <span className="text-sm text-slate-500">{t("settings.savedSearchAlertsDesc")}</span>
                  </div>
                  <Switch defaultChecked className="data-[state=checked]:bg-slate-900 shrink-0" />
                </div>
                <Separator className="bg-slate-100" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t("settings.alertFrequency")}</Label>
                    <span className="text-sm text-slate-500">{t("settings.alertFrequencyDesc")}</span>
                  </div>
                  <Select defaultValue="daily">
                    <SelectTrigger className="w-full sm:w-[180px] shrink-0 border-slate-200 focus:ring-slate-900 rounded-lg h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-md">
                      <SelectItem value="realtime" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">{t("settings.asTheyArrive")}</SelectItem>
                      <SelectItem value="daily" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">{t("settings.dailyDigest")}</SelectItem>
                      <SelectItem value="weekly" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">{t("settings.weeklySummary")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator className="bg-slate-100" />
                <div className="flex flex-row items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t("settings.marketingUpdates")}</Label>
                    <span className="text-sm text-slate-500">{t("settings.marketingUpdatesDesc")}</span>
                  </div>
                  <Switch className="data-[state=checked]:bg-slate-900 shrink-0" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="billing" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.billing")}</CardTitle>
                    <CardDescription className="text-slate-500 font-medium">{t("settings.billingDesc")}</CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit border-slate-200 bg-white text-slate-700">
                    {currentTier}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">{t("settings.subscriptionStatus")}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {currentSubscription
                        ? t(`settings.subscriptionStatus_${currentSubscription.status}`)
                        : t("settings.loadingPlans")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">{t("settings.subscriptionSource")}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {currentSubscription
                        ? t(`settings.subscriptionSource_${currentSubscription.source}`)
                        : t("settings.loadingPlans")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">{t("settings.currentPeriodEnd")}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {currentSubscription?.currentPeriodEnd ?? t("settings.notScheduled")}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{t("settings.availablePlans")}</h3>
                    <p className="text-sm font-medium text-slate-500">{t("settings.availablePlansDesc")}</p>
                  </div>
                  {billingMessage && <p className="text-sm font-medium text-emerald-700">{billingMessage}</p>}
                  {subscriptionError && <p className="text-sm font-medium text-red-600">{subscriptionError}</p>}
                  {!subscriptionData && !subscriptionError && (
                    <p className="text-sm font-medium text-slate-500">{t("settings.loadingPlans")}</p>
                  )}
                  <div className="grid gap-3 lg:grid-cols-2">
                    {(subscriptionData?.plans ?? []).map((plan) => {
                      const isCurrentPlan = user?.tier === plan.tier;
                      const canSelfServe = plan.tier === "pro" || plan.tier === "business";
                      const isWorking = billingActionTier === plan.tier;

                      return (
                        <div
                          key={plan.tier}
                          className={`rounded-lg border p-4 ${
                            isCurrentPlan ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-base font-semibold text-slate-900">{plan.label}</h4>
                              <p className="mt-1 text-sm font-semibold text-slate-600">
                                {planPriceLabel(plan.priceMonthlyUsd)}
                              </p>
                            </div>
                            {isCurrentPlan && (
                              <Badge variant="outline" className="border-slate-300 bg-white text-slate-700">
                                {t("settings.current")}
                              </Badge>
                            )}
                          </div>
                          <ul className="mt-4 space-y-2">
                            {localizedPlanFeatures(plan.tier).map((feature) => (
                              <li key={feature} className="flex items-start gap-2 text-sm font-medium text-slate-600">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                          <Button
                            variant={isCurrentPlan ? "outline" : "default"}
                            disabled={isCurrentPlan || !canSelfServe || isWorking || !user}
                            onClick={() => handleStartCheckout(plan.tier)}
                            className={`mt-4 w-full rounded-lg ${
                              isCurrentPlan ? "border-slate-200 text-slate-700" : "bg-slate-900 text-white"
                            }`}
                          >
                            {isCurrentPlan
                              ? t("settings.current")
                              : plan.tier === "enterprise"
                                ? t("settings.contactSales")
                                : isWorking
                                  ? t("settings.startingCheckout")
                                  : t("settings.startCheckout")}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  {currentSubscription &&
                    currentSubscription.status !== "none" &&
                    !currentSubscription.cancelAtPeriodEnd && (
                      <Button
                        variant="outline"
                        disabled={billingActionTier === "cancel" || !user}
                        onClick={handleCancelSubscription}
                        className="w-full rounded-lg border-slate-200 text-slate-700 sm:w-auto"
                      >
                        {billingActionTier === "cancel"
                          ? t("settings.cancelingSubscription")
                          : t("settings.cancelSubscription")}
                      </Button>
                    )}
                  {currentSubscription?.cancelAtPeriodEnd && (
                    <p className="text-sm font-medium text-amber-700">{t("settings.subscriptionCancelPending")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.passwordSecurity")}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t("settings.passwordSecurityDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <Label htmlFor="current" className="text-slate-700 font-medium">{t("settings.currentPassword")}</Label>
                  <Input
                    id="current"
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    disabled={isChangingPassword || !user}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new" className="text-slate-700 font-medium">{t("settings.newPassword")}</Label>
                  <Input
                    id="new"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={isChangingPassword || !user}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-slate-700 font-medium">{t("settings.confirmPassword")}</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={isChangingPassword || !user}
                    className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                  />
                </div>
                {passwordMessage && <p className="text-sm font-medium text-emerald-700">{passwordMessage}</p>}
                {passwordError && <p className="text-sm font-medium text-red-600">{passwordError}</p>}
              </CardContent>
              <CardFooter className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" disabled className="border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-lg h-10">
                  <Key className="mr-2 h-4 w-4" /> {t("settings.enable2fa")}
                </Button>
                <Button
                  onClick={handlePasswordChange}
                  disabled={isChangingPassword || !user || !currentPassword || !newPassword || !confirmPassword}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10"
                >
                  {isChangingPassword ? t("settings.updating") : t("settings.updatePassword")}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          <TabsContent value="appearance" className="m-0 space-y-6">
            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.appearance")}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t("settings.appearanceDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t("settings.theme")}</Label>
                    <span className="text-sm text-slate-500">{t("settings.themeDesc")}</span>
                  </div>
                  <Select defaultValue="light">
                    <SelectTrigger className="w-full sm:w-[180px] shrink-0 border-slate-200 focus:ring-slate-900 rounded-lg h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-md">
                      <SelectItem value="light" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">{t("settings.light")}</SelectItem>
                      <SelectItem value="dark" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">{t("settings.dark")}</SelectItem>
                      <SelectItem value="system" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">{t("settings.system")}</SelectItem>
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
