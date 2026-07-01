"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  CreditCard,
  Download,
  Pencil,
  Plus,
  Key,
  LockKeyhole,
  Pause,
  Play,
  PaintBucket,
  Settings,
  Shield,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UniversalState } from "@/components/universal-state";
import type { UniversalStateCode } from "@/lib/universal-state";
import { useAuth } from "@/context/AuthContext";
import {
  ApiError as SearchAlertsApiError,
  createSearchAlert,
  deleteSearchAlert,
  listSearchAlerts,
  updateSearchAlert,
} from "@/lib/api/search-alerts";
import {
  changePassword,
  AuthApiError,
  cancelAccountSubscription,
  createBillingPortalSession,
  createCheckoutSession,
  deleteAccount,
  exportAccountData,
  fetchAccountSubscription,
  fetchAccountUsage,
  fetchAccountDeadlineReminders,
  fetchAccountNotificationPreferences,
  fetchBillingInvoices,
  fetchAccountWorkspace,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
  setWorkspaceMemberStatus,
  transferWorkspaceOwnership,
  updateAccountWorkspace,
  updateAccountDeadlineReminder,
  updateAccountNotificationPreferences,
  updateAccountProfile,
  updateWorkspaceMemberRole,
  type AccountDeadlineRemindersResponse,
  type AccountNotificationPreferencesResponse,
  type AccountWorkspaceMember,
  type AccountSubscriptionResponse,
  type AccountUsageData,
  type AccountWorkspaceResponse,
  type BillingInvoiceStatus,
  type BillingInvoicesResponse,
} from "@/lib/api/auth";
import { canUseFeature, lockedFeatureMessage } from "@/lib/features/useFeature";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { ACCOUNT_TIER_LABELS, type AccountTier, type FeatureKey, type ProductPlanKey } from "@/server/auth/entitlements";
import type { DeadlineReminder } from "@/server/deadlines/types";
import type { AlertFrequency, SearchAlert, SearchAlertDigestRun } from "@/server/search-alerts/types";

const FEATURE_ACCESS_ITEMS: Array<{ key: FeatureKey; label: string }> = [
  { key: "bid_search", label: "Bid search" },
  { key: "saved_bids", label: "Saved bids" },
  { key: "intent_workspace", label: "Intent workspace" },
  { key: "submission_guidance", label: "Submission guidance" },
  { key: "pursue_no_bid", label: "Pursue / No-Bid" },
  { key: "bid.brief.full.generate", label: "Grounded Q&A" },
  { key: "compliance_manifest", label: "Compliance manifest" },
  { key: "response.workspace.create", label: "Response workspace" },
  { key: "artifact.vault.upload", label: "Artifact Vault" },
  { key: "quote_workflow", label: "Quote workflow" },
  { key: "deadline_notifications", label: "Deadline notifications" },
  { key: "knowledge_station", label: "Knowledge Station" },
];
const BILLING_INVOICE_STATUS_FILTERS: Array<"all" | BillingInvoiceStatus> = [
  "all",
  "open",
  "paid",
  "payment_failed",
  "void",
  "uncollectible",
];
const USAGE_FEATURE_LABEL_KEYS: Record<AccountUsageData["items"][number]["feature"], string> = {
  saved_bids: "settings.usageFeature_saved_bids",
  intent_workspace: "settings.usageFeature_intent_workspace",
  search_alerts: "settings.usageFeature_search_alerts",
  team_members: "settings.usageFeature_team_members",
};
type SearchAlertDraft = {
  id: string | null;
  name: string;
  keywords: string;
  states: string;
  issuerType: "all" | "federal" | "state";
  deadline: "any" | "next7" | "next30";
  published: "any" | "last24" | "last7";
  sort: "relevance" | "newest" | "deadline";
  frequency: AlertFrequency;
  isEnabled: boolean;
};

const EMPTY_SEARCH_ALERT_DRAFT: SearchAlertDraft = {
  id: null,
  name: "",
  keywords: "",
  states: "",
  issuerType: "all",
  deadline: "any",
  published: "any",
  sort: "relevance",
  frequency: "daily",
  isEnabled: true,
};

function deadlineReminderSnoozeUntilIso() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function SettingsInlineState({
  code,
  message,
  title,
}: {
  code: UniversalStateCode;
  message: string;
  title: string;
}) {
  return (
    <UniversalState
      className="border-slate-200 bg-slate-50/70 p-3 shadow-none"
      code={code}
      message={message}
      title={title}
    />
  );
}

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
  const [usageData, setUsageData] = useState<AccountUsageData | null>(null);
  const [usageError, setUsageError] = useState("");
  const [notificationPreferences, setNotificationPreferences] =
    useState<AccountNotificationPreferencesResponse | null>(null);
  const [notificationPreferencesMessage, setNotificationPreferencesMessage] = useState("");
  const [notificationPreferencesError, setNotificationPreferencesError] = useState("");
  const [isSavingNotificationPreferences, setIsSavingNotificationPreferences] = useState(false);
  const [deadlineReminderCenter, setDeadlineReminderCenter] =
    useState<AccountDeadlineRemindersResponse["center"] | null>(null);
  const [deadlineReminderMessage, setDeadlineReminderMessage] = useState("");
  const [deadlineReminderError, setDeadlineReminderError] = useState("");
  const [deadlineReminderActionId, setDeadlineReminderActionId] = useState<string | null>(null);
  const [searchAlertsData, setSearchAlertsData] = useState<SearchAlert[] | null>(null);
  const [searchAlertDraft, setSearchAlertDraft] =
    useState<SearchAlertDraft>(EMPTY_SEARCH_ALERT_DRAFT);
  const [searchAlertMessage, setSearchAlertMessage] = useState("");
  const [searchAlertError, setSearchAlertError] = useState("");
  const [searchAlertActionId, setSearchAlertActionId] = useState<string | null>(null);
  const [isSavingSearchAlert, setIsSavingSearchAlert] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const [billingActionTier, setBillingActionTier] = useState<AccountTier | "cancel" | "portal" | null>(null);
  const [billingInvoicesData, setBillingInvoicesData] = useState<BillingInvoicesResponse | null>(null);
  const [billingInvoicesError, setBillingInvoicesError] = useState("");
  const [billingInvoiceStatusFilter, setBillingInvoiceStatusFilter] =
    useState<"all" | BillingInvoiceStatus>("all");
  const [workspaceData, setWorkspaceData] = useState<AccountWorkspaceResponse | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [inviteDraft, setInviteDraft] = useState({ email: "", displayName: "" });
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [isInvitingMember, setIsInvitingMember] = useState(false);
  const [teamActionMessage, setTeamActionMessage] = useState("");
  const [teamActionError, setTeamActionError] = useState("");
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null);
  const [accountAction, setAccountAction] = useState<"export" | "delete" | null>(null);
  const [accountActionMessage, setAccountActionMessage] = useState("");
  const [accountActionError, setAccountActionError] = useState("");
  const currentTier = user ? ACCOUNT_TIER_LABELS[user.tier] : ACCOUNT_TIER_LABELS.free;
  const displayName =
    profileDraft.userId === user?.id ? profileDraft.displayName : (user?.displayName ?? "");
  const currentSubscription = user ? subscriptionData?.subscription : null;
  const latestFailedInvoice = (billingInvoicesData?.invoices ?? []).find(
    (invoice) => invoice.status === "payment_failed",
  );
  const usageLimitedItems = usageData?.items.filter((item) => item.isLimited) ?? [];
  const canManageWorkspace = workspaceData?.currentUserRole === "owner";
  const canUseDeadlineReminderCenter = user ? canUseFeature(user, "deadline_notifications") : false;
  const deadlineReminderLockedMessage = lockedFeatureMessage("deadline_notifications");

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

    fetchAccountUsage()
      .then((data) => {
        if (isCancelled) return;
        setUsageData(data);
        setUsageError("");
      })
      .catch((error) => {
        if (isCancelled) return;
        setUsageError(error instanceof Error ? error.message : t("settings.usageLoadError"));
      });

    fetchAccountNotificationPreferences()
      .then((data) => {
        if (isCancelled) return;
        setNotificationPreferences(data);
        setNotificationPreferencesError("");
      })
      .catch((error) => {
        if (isCancelled) return;
        setNotificationPreferencesError(
          error instanceof Error ? error.message : t("settings.notificationPreferencesLoadError"),
        );
      });

    fetchAccountDeadlineReminders()
      .then((data) => {
        if (isCancelled) return;
        setDeadlineReminderCenter(data.center);
        setDeadlineReminderError("");
      })
      .catch((error) => {
        if (isCancelled) return;
        setDeadlineReminderError(
          error instanceof AuthApiError && error.code === "FEATURE_NOT_AVAILABLE"
            ? deadlineReminderLockedMessage
            : error instanceof Error ? error.message : t("settings.reminderCenterLoadError"),
        );
      });

    listSearchAlerts()
      .then((data) => {
        if (isCancelled) return;
        setSearchAlertsData(data.alerts);
        setSearchAlertError("");
      })
      .catch((error) => {
        if (isCancelled) return;
        setSearchAlertError(error instanceof Error ? error.message : t("settings.searchAlertsLoadError"));
      });

    return () => {
      isCancelled = true;
    };
  }, [deadlineReminderLockedMessage, t, user]);

  useEffect(() => {
    if (!user) return;

    let isCancelled = false;

    fetchBillingInvoices({
      status: billingInvoiceStatusFilter === "all" ? undefined : billingInvoiceStatusFilter,
    })
      .then((data) => {
        if (isCancelled) return;
        setBillingInvoicesData(data);
        setBillingInvoicesError("");
      })
      .catch((error) => {
        if (isCancelled) return;
        setBillingInvoicesError(error instanceof Error ? error.message : t("settings.invoiceLoadError"));
      });

    return () => {
      isCancelled = true;
    };
  }, [billingInvoiceStatusFilter, t, user]);

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

  function localizedPlanFeatures(productPlanKey: ProductPlanKey) {
    return [
      t(`settings.plan_${productPlanKey}_feature1`),
      t(`settings.plan_${productPlanKey}_feature2`),
      t(`settings.plan_${productPlanKey}_feature3`),
    ];
  }

  function planPriceLabel(priceMonthlyUsd: number | null) {
    if (priceMonthlyUsd === null) return t("settings.customPricing");
    if (priceMonthlyUsd === 0) return t("settings.freePrice");

     return t("settings.priceMonthly").replace("{price}", String(priceMonthlyUsd));
  }

  function invoiceAmountLabel(amountCents: number, currency: string) {
    return `${currency} ${(amountCents / 100).toFixed(2)}`;
  }

  function invoiceDateLabel(paidAt: string | null, dueAt: string | null) {
    if (paidAt) return t("settings.invoicePaidAt").replace("{date}", paidAt);
    if (dueAt) return t("settings.invoiceDueAt").replace("{date}", dueAt);

    return t("settings.invoiceDateUnavailable");
  }

  function usageLimitLabel(limit: number | null) {
    return limit === null ? t("settings.unlimitedUsage") : String(limit);
  }

  function usageRemainingLabel(remaining: number | null) {
    return remaining === null
      ? t("settings.unlimitedUsage")
      : t("settings.usageRemaining").replace("{remaining}", String(remaining));
  }

  function searchAlertDateLabel(value: string | null) {
    return value ?? t("settings.notScheduled");
  }

  function deadlineReminderDateLabel(value: string | null) {
    return value ?? t("settings.notScheduled");
  }

  function deadlineReminderKindLabel(kind: DeadlineReminder["kind"]) {
    return t(`settings.reminderKind_${kind}`);
  }

  function deadlineReminderStatusLabel(status: DeadlineReminder["status"]) {
    return t(`settings.reminderStatus_${status}`);
  }

  function deadlineReminderStatusClassName(status: DeadlineReminder["status"]) {
    if (status === "acknowledged") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "snoozed") return "border-amber-200 bg-amber-50 text-amber-800";
    if (status === "suppressed") return "border-slate-200 bg-slate-50 text-slate-600";

    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  function deadlineReminderPriorityLabel(priority: DeadlineReminder["priority"]) {
    return t(`settings.reminderPriority_${priority}`);
  }

  function deadlineReminderPriorityClassName(priority: DeadlineReminder["priority"]) {
    if (priority === "high") return "border-red-200 bg-red-50 text-red-700";
    if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-800";

    return "border-slate-200 bg-white text-slate-600";
  }

  function searchAlertQuerySummary(alert: SearchAlert) {
    const keywords = alert.query.q?.trim() || t("settings.searchAlertAnyKeywords");
    const states = alert.query.states?.length
      ? alert.query.states.join(", ")
      : t("settings.searchAlertAllStates");

    return `${keywords} · ${states}`;
  }

  function searchAlertDigestStatusLabel(status: SearchAlertDigestRun["status"]) {
    if (status === "queued") return t("settings.searchAlertDigestStatus_queued");
    if (status === "sent") return t("settings.searchAlertDigestStatus_sent");
    if (status === "failed") return t("settings.searchAlertDigestStatus_failed");

    return t("settings.searchAlertDigestStatus_skipped");
  }

  function searchAlertDigestStatusClassName(status: SearchAlertDigestRun["status"]) {
    if (status === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
    if (status === "skipped") return "border-amber-200 bg-amber-50 text-amber-700";

    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  function searchAlertDigestSkippedLabel(reason: SearchAlertDigestRun["skippedReason"]) {
    if (reason === "unsupported_channel") return t("settings.searchAlertDigestSkipped_unsupported_channel");
    if (reason === "missing_recipient") return t("settings.searchAlertDigestSkipped_missing_recipient");
    if (reason === "notifications_disabled") return t("settings.searchAlertDigestSkipped_notifications_disabled");
    if (reason === "duplicate_digest") return t("settings.searchAlertDigestSkipped_duplicate_digest");

    return t("settings.searchAlertDigestSkipped_unknown");
  }

  function searchAlertDigestDetail(run: SearchAlertDigestRun) {
    if (run.status === "failed") {
      return t("settings.searchAlertDigestFailureReason").replace(
        "{reason}",
        run.failureReason ?? t("settings.searchAlertDigestFailedUnknown"),
      );
    }
    if (run.status === "skipped") {
      return searchAlertDigestSkippedLabel(run.skippedReason);
    }

    return t("settings.searchAlertDigestMatched").replace("{count}", String(run.matchCount));
  }

  function searchAlertDigestDateLabel(run: SearchAlertDigestRun) {
    return t("settings.searchAlertDigestAt").replace("{date}", searchAlertDateLabel(run.createdAt));
  }

  function searchAlertDraftFrom(alert: SearchAlert): SearchAlertDraft {
    return {
      id: alert.id,
      name: alert.name,
      keywords: alert.query.q ?? "",
      states: alert.query.states?.join(", ") ?? "",
      issuerType: alert.query.issuerType ?? "all",
      deadline: alert.query.deadline ?? "any",
      published: alert.query.published ?? "any",
      sort: alert.query.sort ?? "relevance",
      frequency: alert.frequency,
      isEnabled: alert.isEnabled,
    };
  }

  function searchAlertInputFromDraft(draft: SearchAlertDraft) {
    const states = draft.states
      .split(",")
      .map((state) => state.trim().toUpperCase())
      .filter(Boolean);

    return {
      name: draft.name.trim(),
      query: {
        q: draft.keywords.trim(),
        states,
        issuerType: draft.issuerType,
        deadline: draft.deadline,
        published: draft.published,
        sort: draft.sort,
      },
      frequency: draft.frequency,
      isEnabled: draft.isEnabled,
    };
  }

  async function refreshSearchAlerts() {
    const data = await listSearchAlerts();
    setSearchAlertsData(data.alerts);
    return data.alerts;
  }

  function reminderCenterErrorMessage(error: unknown) {
    if (error instanceof AuthApiError && error.code === "FEATURE_NOT_AVAILABLE") {
      return deadlineReminderLockedMessage;
    }

    return error instanceof Error ? error.message : t("settings.reminderCenterSaveError");
  }

  async function handleDeadlineReminderAction(
    reminder: DeadlineReminder,
    action: "acknowledge" | "snooze",
  ) {
    setDeadlineReminderMessage("");
    setDeadlineReminderError("");
    setDeadlineReminderActionId(reminder.id);

    try {
      const data = action === "acknowledge"
        ? await updateAccountDeadlineReminder({ reminderId: reminder.id, action })
        : await updateAccountDeadlineReminder({
            reminderId: reminder.id,
            action,
            snoozedUntil: deadlineReminderSnoozeUntilIso(),
          });
      setDeadlineReminderCenter(data.center);
      setDeadlineReminderMessage(t("settings.reminderCenterSaved"));
    } catch (error) {
      setDeadlineReminderError(reminderCenterErrorMessage(error));
    } finally {
      setDeadlineReminderActionId(null);
    }
  }

  function searchAlertErrorMessage(error: unknown) {
    if (error instanceof SearchAlertsApiError && error.code === "USAGE_LIMIT_REACHED") {
      return t("settings.searchAlertLimitReached");
    }

    return error instanceof Error ? error.message : t("settings.searchAlertSaveError");
  }

  async function handleStartCheckout(tier: AccountTier) {
    setBillingMessage("");
    setSubscriptionError("");
    setBillingActionTier(tier);

    try {
      const result = await createCheckoutSession({ tier });
      setBillingMessage(t("settings.checkoutStarted"));
      window.location.assign(result.checkoutSession.checkoutUrl);
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
      setBillingInvoicesData(await fetchBillingInvoices({
        status: billingInvoiceStatusFilter === "all" ? undefined : billingInvoiceStatusFilter,
      }));
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : t("settings.cancelSubscriptionError"));
    } finally {
      setBillingActionTier(null);
    }
  }

  async function handleBillingPortal() {
    setBillingMessage("");
    setSubscriptionError("");
    setBillingActionTier("portal");

    try {
      const result = await createBillingPortalSession();
      setBillingMessage(t("settings.portalStarted"));
      window.location.assign(result.portalSession.portalUrl);
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : t("settings.portalError"));
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

  async function handleNotificationPreferencesChange(input: {
    savedSearchAlertsEnabled?: boolean;
    defaultAlertFrequency?: "daily" | "weekly";
    marketingUpdatesEnabled?: boolean;
  }) {
    setNotificationPreferencesMessage("");
    setNotificationPreferencesError("");
    setIsSavingNotificationPreferences(true);

    try {
      const data = await updateAccountNotificationPreferences(input);
      setNotificationPreferences(data);
      setNotificationPreferencesMessage(t("settings.notificationPreferencesSaved"));
    } catch (error) {
      setNotificationPreferencesError(
        error instanceof Error ? error.message : t("settings.notificationPreferencesSaveError"),
      );
    } finally {
      setIsSavingNotificationPreferences(false);
    }
  }

  async function handleSearchAlertSubmit() {
    setSearchAlertMessage("");
    setSearchAlertError("");
    setIsSavingSearchAlert(true);

    try {
      const input = searchAlertInputFromDraft(searchAlertDraft);
      if (searchAlertDraft.id) {
        await updateSearchAlert(searchAlertDraft.id, input);
      } else {
        await createSearchAlert(input);
      }
      await refreshSearchAlerts();
      setSearchAlertDraft(EMPTY_SEARCH_ALERT_DRAFT);
      setSearchAlertMessage(t("settings.searchAlertSaved"));
    } catch (error) {
      setSearchAlertError(searchAlertErrorMessage(error));
    } finally {
      setIsSavingSearchAlert(false);
    }
  }

  async function handleSearchAlertToggle(alert: SearchAlert) {
    setSearchAlertMessage("");
    setSearchAlertError("");
    setSearchAlertActionId(alert.id);

    try {
      const { alert: updatedAlert } = await updateSearchAlert(alert.id, { isEnabled: !alert.isEnabled });
      setSearchAlertsData((current) =>
        current?.map((item) => (item.id === updatedAlert.id ? updatedAlert : item)) ?? [updatedAlert],
      );
      setSearchAlertMessage(
        updatedAlert.isEnabled ? t("settings.searchAlertResumed") : t("settings.searchAlertPausedMessage"),
      );
    } catch (error) {
      setSearchAlertError(searchAlertErrorMessage(error));
    } finally {
      setSearchAlertActionId(null);
    }
  }

  async function handleSearchAlertDelete(alert: SearchAlert) {
    setSearchAlertMessage("");
    setSearchAlertError("");

    if (!window.confirm(t("settings.deleteSearchAlertConfirm"))) {
      return;
    }

    setSearchAlertActionId(alert.id);

    try {
      await deleteSearchAlert(alert.id);
      setSearchAlertsData((current) => current?.filter((item) => item.id !== alert.id) ?? []);
      if (searchAlertDraft.id === alert.id) {
        setSearchAlertDraft(EMPTY_SEARCH_ALERT_DRAFT);
      }
      setSearchAlertMessage(t("settings.searchAlertDeleted"));
    } catch (error) {
      setSearchAlertError(searchAlertErrorMessage(error));
    } finally {
      setSearchAlertActionId(null);
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
    setInviteUrl("");
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
      setInviteUrl(invite.inviteUrl);
      setInviteMessage(t("settings.memberInvited"));
    } catch (error) {
      setInviteError(
        error instanceof AuthApiError && error.code === "USAGE_LIMIT_REACHED"
          ? t("settings.teamSeatLimitReached")
          : error instanceof Error ? error.message : t("settings.memberInviteError"),
      );
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

  function ownerTransferErrorMessage(error: unknown) {
    if (error instanceof AuthApiError && error.code === "OWNER_TRANSFER_REQUIRED") {
      return t("settings.ownerTransferRequired");
    }

    return error instanceof Error ? error.message : t("settings.deleteAccountError");
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

  async function handleTransferOwnership(member: AccountWorkspaceMember) {
    setTeamActionMessage("");
    setTeamActionError("");
    setMemberActionUserId(member.userId);

    try {
      const data = await transferWorkspaceOwnership(member.userId);
      setWorkspaceData(data);
      await refreshSession();
      setTeamActionMessage(t("settings.ownershipTransferred"));
    } catch (error) {
      setTeamActionError(teamErrorMessage(error));
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleMemberStatusChange(member: AccountWorkspaceMember) {
    const nextStatus = member.status === "disabled" ? "active" : "disabled";
    setTeamActionMessage("");
    setTeamActionError("");
    setMemberActionUserId(member.userId);

    try {
      const data = await setWorkspaceMemberStatus(member.userId, { status: nextStatus });
      setWorkspaceData(data);
      await refreshSession();
      setTeamActionMessage(
        nextStatus === "disabled" ? t("settings.memberDisabled") : t("settings.memberRestored"),
      );
    } catch (error) {
      setTeamActionError(teamErrorMessage(error));
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleResendInvitation(member: AccountWorkspaceMember) {
    setTeamActionMessage("");
    setTeamActionError("");
    setInviteUrl("");
    setMemberActionUserId(member.userId);

    try {
      const invite = await resendWorkspaceInvitation(member.userId);
      const data = await fetchAccountWorkspace();
      setWorkspaceData(data);
      setInviteUrl(invite.inviteUrl);
      setTeamActionMessage(t("settings.inviteResent"));
    } catch (error) {
      setTeamActionError(teamErrorMessage(error));
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleRevokeInvitation(member: AccountWorkspaceMember) {
    setTeamActionMessage("");
    setTeamActionError("");

    if (!window.confirm(t("settings.revokeInviteConfirm"))) {
      return;
    }

    setInviteUrl("");
    setMemberActionUserId(member.userId);

    try {
      const data = await revokeWorkspaceInvitation(member.userId);
      setWorkspaceData(data);
      setTeamActionMessage(t("settings.inviteRevoked"));
    } catch (error) {
      setTeamActionError(teamErrorMessage(error));
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleExportAccountData() {
    setAccountActionMessage("");
    setAccountActionError("");
    setAccountAction("export");

    try {
      const data = await exportAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `winbids-account-export-${data.account.id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setAccountActionMessage(t("settings.accountExportStarted"));
    } catch (error) {
      setAccountActionError(error instanceof Error ? error.message : t("settings.accountExportError"));
    } finally {
      setAccountAction(null);
    }
  }

  async function handleDeleteAccount() {
    setAccountActionMessage("");
    setAccountActionError("");

    if (!window.confirm(t("settings.deleteAccountConfirm"))) {
      return;
    }

    setAccountAction("delete");

    try {
      await deleteAccount();
      setAccountActionMessage(t("settings.accountDeleted"));
      await refreshSession();
      window.location.assign("/login");
    } catch (error) {
      setAccountActionError(ownerTransferErrorMessage(error));
    } finally {
      setAccountAction(null);
    }
  }

  if (isLoading) {
    return (
      <div className="winbids-workspace">
        <section className="winbids-hero-panel min-h-[280px] animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthRequiredState
        description={t("settings.accountRequiresLogin")}
        title={t("settings.accountRequiresLoginTitle")}
      />
    );
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
                        <SettingsInlineState
                          code="plan_limit"
                          message={lockedFeatureMessage(feature.key)}
                          title={feature.label}
                        />
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.usageDashboard")}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t("settings.usageDashboardDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                {usageError && (
                  <SettingsInlineState
                    code="error"
                    message={usageError}
                    title={t("settings.usageDashboard")}
                  />
                )}
                {!usageData && !usageError && (
                  <SettingsInlineState
                    code="loading"
                    message={t("settings.loadingUsage")}
                    title={t("settings.usageDashboard")}
                  />
                )}
                {usageData && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        {t("settings.usageDashboardSummary")}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {t("settings.usageDashboardSummaryValue")
                          .replace("{used}", String(usageLimitedItems.length))
                          .replace("{total}", String(usageData.items.length))}
                      </p>
                    </div>
                    <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                      <p className="text-xs font-semibold uppercase text-cyan-700">
                        {t("settings.creditSummary")}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-cyan-950">
                        {usageData.creditSummary.availableCredits === null
                          ? t("settings.unlimitedCredits")
                          : t("settings.creditSummaryValue")
                            .replace("{available}", String(usageData.creditSummary.availableCredits))
                            .replace("{included}", String(usageData.creditSummary.includedMonthlyCredits ?? 0))}
                      </p>
                    </div>
                  </div>
                )}
                {(usageData?.items ?? []).map((item) => {
                  const percent =
                    item.limit === null ? 100 : Math.min(Math.round((item.used / Math.max(item.limit, 1)) * 100), 100);

                  return (
                    <div key={item.feature} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {t(USAGE_FEATURE_LABEL_KEYS[item.feature])}
                          </p>
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {usageRemainingLabel(item.remaining)}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`w-fit ${
                            item.isLimited ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          {item.used} / {usageLimitLabel(item.limit)}
                        </Badge>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                        <div
                          className={`h-full rounded-full ${item.isLimited ? "bg-amber-500" : "bg-emerald-600"}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      {item.isLimited && item.requiredTier && (
                        <p className="mt-2 text-xs font-semibold text-amber-800">
                          {t("settings.usageUpgradePrompt").replace(
                            "{tier}",
                            ACCOUNT_TIER_LABELS[item.requiredTier],
                          )}
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
                    {inviteUrl && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <span className="font-semibold">{t("settings.inviteUrl")}:</span>{" "}
                        <span className="break-all font-mono">{inviteUrl}</span>
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
                        <Badge variant="outline" className="mt-2 w-fit border-slate-200 bg-slate-50 text-slate-700">
                          {t(`settings.memberStatus_${member.status}`)}
                        </Badge>
                        {member.status === "invited" && member.invitationDelivery && (
                          <div className="mt-2 space-y-1">
                            <Badge
                              variant="outline"
                              className={`w-fit ${
                                member.invitationDelivery.status === "sent"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : member.invitationDelivery.status === "failed"
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-amber-200 bg-amber-50 text-amber-800"
                              }`}
                            >
                              {t(`settings.inviteDelivery_${member.invitationDelivery.status}`)}
                            </Badge>
                            {member.invitationDelivery.lastError && (
                              <p className="text-xs font-medium text-rose-700">
                                {member.invitationDelivery.lastError}
                              </p>
                            )}
                          </div>
                        )}
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
                            onClick={() => handleTransferOwnership(member)}
                            disabled={
                              memberActionUserId === member.userId ||
                              member.userId === user?.id ||
                              member.workspaceRole === "owner" ||
                              member.status !== "active"
                            }
                            className="h-9 border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {t("settings.transferOwnership")}
                          </Button>
                        )}
                        {canManageWorkspace && (
                          <Button
                            variant="outline"
                            onClick={() => handleMemberStatusChange(member)}
                            disabled={
                              memberActionUserId === member.userId ||
                              member.userId === user?.id ||
                              member.status === "invited"
                            }
                            className="h-9 border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {member.status === "disabled" ? t("settings.restoreMember") : t("settings.disableMember")}
                          </Button>
                        )}
                        {canManageWorkspace && member.status === "invited" && (
                          <Button
                            variant="outline"
                            onClick={() => handleResendInvitation(member)}
                            disabled={memberActionUserId === member.userId}
                            className="h-9 border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {t("settings.resendInvite")}
                          </Button>
                        )}
                        {canManageWorkspace && member.status === "invited" && (
                          <Button
                            variant="outline"
                            onClick={() => handleRevokeInvitation(member)}
                            disabled={memberActionUserId === member.userId}
                            className="h-9 border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 hover:text-red-800"
                          >
                            {t("settings.revokeInvite")}
                          </Button>
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
                {notificationPreferencesError && (
                  <p className="text-sm font-medium text-red-600">{notificationPreferencesError}</p>
                )}
                {notificationPreferencesMessage && (
                  <p className="text-sm font-medium text-emerald-700">{notificationPreferencesMessage}</p>
                )}
                {!notificationPreferences && !notificationPreferencesError && (
                  <p className="text-sm font-medium text-slate-500">{t("settings.loadingNotificationPreferences")}</p>
                )}
                <div className="flex flex-row items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t("settings.savedSearchAlerts")}</Label>
                    <span className="text-sm text-slate-500">{t("settings.savedSearchAlertsDesc")}</span>
                  </div>
                  <Switch
                    checked={notificationPreferences?.savedSearchAlertsEnabled ?? false}
                    disabled={!notificationPreferences || isSavingNotificationPreferences}
                    onCheckedChange={(checked) =>
                      handleNotificationPreferencesChange({ savedSearchAlertsEnabled: checked })
                    }
                    className="data-[state=checked]:bg-slate-900 shrink-0"
                  />
                </div>
                <Separator className="bg-slate-100" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col space-y-1">
                    <Label className="text-slate-900 font-medium text-base">{t("settings.alertFrequency")}</Label>
                    <span className="text-sm text-slate-500">{t("settings.alertFrequencyDesc")}</span>
                  </div>
                  <Select
                    value={notificationPreferences?.defaultAlertFrequency ?? "daily"}
                    disabled={!notificationPreferences || isSavingNotificationPreferences}
                    onValueChange={(value) =>
                      handleNotificationPreferencesChange({
                        defaultAlertFrequency: value === "weekly" ? "weekly" : "daily",
                      })
                    }
                  >
                    <SelectTrigger className="w-full sm:w-[180px] shrink-0 border-slate-200 focus:ring-slate-900 rounded-lg h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-md">
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
                  <Switch
                    checked={notificationPreferences?.marketingUpdatesEnabled ?? false}
                    disabled={!notificationPreferences || isSavingNotificationPreferences}
                    onCheckedChange={(checked) =>
                      handleNotificationPreferencesChange({ marketingUpdatesEnabled: checked })
                    }
                    className="data-[state=checked]:bg-slate-900 shrink-0"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.reminderCenter")}</CardTitle>
                    <CardDescription className="text-slate-500 font-medium">{t("settings.reminderCenterDesc")}</CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit border-slate-200 bg-white text-slate-700">
                    {t("settings.reminderCenterCount").replace(
                      "{count}",
                      String(deadlineReminderCenter?.reminders.length ?? 0),
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                {!canUseDeadlineReminderCenter && (
                  <SettingsInlineState
                    code="plan_limit"
                    message={deadlineReminderLockedMessage}
                    title={t("settings.reminderCenterLockedTitle")}
                  />
                )}
                {canUseDeadlineReminderCenter && deadlineReminderError && (
                  <SettingsInlineState
                    code="error"
                    message={deadlineReminderError}
                    title={t("settings.reminderCenter")}
                  />
                )}
                {canUseDeadlineReminderCenter && !deadlineReminderCenter && !deadlineReminderError && (
                  <SettingsInlineState
                    code="loading"
                    message={t("settings.loadingDeadlineReminders")}
                    title={t("settings.reminderCenter")}
                  />
                )}
                {deadlineReminderMessage && (
                  <p className="text-sm font-medium text-emerald-700">{deadlineReminderMessage}</p>
                )}
                {canUseDeadlineReminderCenter && deadlineReminderCenter && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">
                          {t("settings.reminderSummaryActive")}
                        </p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{deadlineReminderCenter.summary.active}</p>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-semibold uppercase text-amber-800">
                          {t("settings.reminderSummaryDueSoon")}
                        </p>
                        <p className="mt-1 text-lg font-bold text-amber-900">{deadlineReminderCenter.summary.dueSoon}</p>
                      </div>
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <p className="text-xs font-semibold uppercase text-red-700">
                          {t("settings.reminderSummaryOverdue")}
                        </p>
                        <p className="mt-1 text-lg font-bold text-red-800">{deadlineReminderCenter.summary.overdue}</p>
                      </div>
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                        <p className="text-xs font-semibold uppercase text-sky-700">
                          {t("settings.reminderSummarySnoozed")}
                        </p>
                        <p className="mt-1 text-lg font-bold text-sky-800">{deadlineReminderCenter.summary.snoozed}</p>
                      </div>
                    </div>

                    {deadlineReminderCenter.reminders.length === 0 && (
                      <SettingsInlineState
                        code="empty"
                        message={t("settings.reminderCenterEmptyMessage")}
                        title={t("settings.reminderCenterEmptyTitle")}
                      />
                    )}
                    <div className="space-y-3">
                      {deadlineReminderCenter.reminders.map((reminder) => {
                        const isWorking = deadlineReminderActionId === reminder.id;
                        const isClosed = reminder.status === "acknowledged" || reminder.status === "suppressed";

                        return (
                          <div
                            key={reminder.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className={deadlineReminderStatusClassName(reminder.status)}
                                  >
                                    {deadlineReminderStatusLabel(reminder.status)}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className={deadlineReminderPriorityClassName(reminder.priority)}
                                  >
                                    {deadlineReminderPriorityLabel(reminder.priority)}
                                  </Badge>
                                  <span className="text-xs font-semibold text-slate-500">
                                    {deadlineReminderKindLabel(reminder.kind)}
                                  </span>
                                </div>
                                <h3 className="mt-2 text-sm font-semibold text-slate-900">{reminder.title}</h3>
                                <p className="mt-1 text-xs font-medium text-slate-500">
                                  {t("settings.reminderDueAt").replace(
                                    "{date}",
                                    deadlineReminderDateLabel(reminder.dueAt),
                                  )}
                                  {reminder.snoozedUntil
                                    ? ` · ${t("settings.reminderSnoozedUntil").replace(
                                        "{date}",
                                        deadlineReminderDateLabel(reminder.snoozedUntil),
                                      )}`
                                    : ""}
                                </p>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Button
                                  variant="outline"
                                  disabled={isWorking || isClosed}
                                  onClick={() => void handleDeadlineReminderAction(reminder, "acknowledge")}
                                  className="h-8 rounded-lg border-slate-200 px-3 text-sm font-medium text-slate-700"
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                  {t("settings.acknowledgeReminder")}
                                </Button>
                                <Button
                                  variant="outline"
                                  disabled={isWorking || isClosed}
                                  onClick={() => void handleDeadlineReminderAction(reminder, "snooze")}
                                  className="h-8 rounded-lg border-slate-200 px-3 text-sm font-medium text-slate-700"
                                >
                                  <Pause className="mr-2 h-4 w-4" />
                                  {t("settings.snoozeReminder")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.searchAlertsManager")}</CardTitle>
                    <CardDescription className="text-slate-500 font-medium">{t("settings.searchAlertsManagerDesc")}</CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit border-slate-200 bg-white text-slate-700">
                    {t("settings.searchAlertCount").replace("{count}", String(searchAlertsData?.length ?? 0))}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {searchAlertDraft.id ? t("settings.editSearchAlert") : t("settings.createSearchAlert")}
                    </h3>
                    {searchAlertDraft.id && (
                      <Button
                        variant="outline"
                        onClick={() => setSearchAlertDraft(EMPTY_SEARCH_ALERT_DRAFT)}
                        className="h-8 w-full rounded-lg border-slate-200 px-3 text-sm font-medium text-slate-700 sm:w-auto"
                      >
                        {t("settings.cancelEditSearchAlert")}
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="searchAlertName" className="text-slate-700 font-medium">
                        {t("settings.searchAlertName")}
                      </Label>
                      <Input
                        id="searchAlertName"
                        value={searchAlertDraft.name}
                        onChange={(event) =>
                          setSearchAlertDraft((draft) => ({ ...draft, name: event.target.value }))
                        }
                        className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="searchAlertKeywords" className="text-slate-700 font-medium">
                        {t("settings.searchAlertKeywords")}
                      </Label>
                      <Input
                        id="searchAlertKeywords"
                        value={searchAlertDraft.keywords}
                        onChange={(event) =>
                          setSearchAlertDraft((draft) => ({ ...draft, keywords: event.target.value }))
                        }
                        placeholder={t("settings.searchAlertKeywordsPlaceholder")}
                        className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="searchAlertStates" className="text-slate-700 font-medium">
                        {t("settings.searchAlertStates")}
                      </Label>
                      <Input
                        id="searchAlertStates"
                        value={searchAlertDraft.states}
                        onChange={(event) =>
                          setSearchAlertDraft((draft) => ({ ...draft, states: event.target.value }))
                        }
                        placeholder={t("settings.searchAlertStatesPlaceholder")}
                        className="border-slate-200 focus-visible:ring-slate-900 h-10 rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">{t("settings.searchAlertFrequency")}</Label>
                      <Select
                        value={searchAlertDraft.frequency}
                        onValueChange={(value) =>
                          setSearchAlertDraft((draft) => ({
                            ...draft,
                            frequency: value === "weekly" ? "weekly" : "daily",
                          }))
                        }
                      >
                        <SelectTrigger className="h-10 border-slate-200 focus:ring-slate-900 rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg border-slate-200 shadow-md">
                          <SelectItem value="daily" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.dailyDigest")}
                          </SelectItem>
                          <SelectItem value="weekly" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.weeklySummary")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">{t("settings.searchAlertIssuerType")}</Label>
                      <Select
                        value={searchAlertDraft.issuerType}
                        onValueChange={(value) =>
                          setSearchAlertDraft((draft) => ({
                            ...draft,
                            issuerType: value === "federal" || value === "state" ? value : "all",
                          }))
                        }
                      >
                        <SelectTrigger className="h-10 border-slate-200 focus:ring-slate-900 rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg border-slate-200 shadow-md">
                          <SelectItem value="all" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertIssuer_all")}
                          </SelectItem>
                          <SelectItem value="federal" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertIssuer_federal")}
                          </SelectItem>
                          <SelectItem value="state" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertIssuer_state")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">{t("settings.searchAlertDeadline")}</Label>
                      <Select
                        value={searchAlertDraft.deadline}
                        onValueChange={(value) =>
                          setSearchAlertDraft((draft) => ({
                            ...draft,
                            deadline: value === "next7" || value === "next30" ? value : "any",
                          }))
                        }
                      >
                        <SelectTrigger className="h-10 border-slate-200 focus:ring-slate-900 rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg border-slate-200 shadow-md">
                          <SelectItem value="any" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertDeadline_any")}
                          </SelectItem>
                          <SelectItem value="next7" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertDeadline_next7")}
                          </SelectItem>
                          <SelectItem value="next30" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertDeadline_next30")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">{t("settings.searchAlertPublished")}</Label>
                      <Select
                        value={searchAlertDraft.published}
                        onValueChange={(value) =>
                          setSearchAlertDraft((draft) => ({
                            ...draft,
                            published: value === "last24" || value === "last7" ? value : "any",
                          }))
                        }
                      >
                        <SelectTrigger className="h-10 border-slate-200 focus:ring-slate-900 rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg border-slate-200 shadow-md">
                          <SelectItem value="any" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertPublished_any")}
                          </SelectItem>
                          <SelectItem value="last24" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertPublished_last24")}
                          </SelectItem>
                          <SelectItem value="last7" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertPublished_last7")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">{t("settings.searchAlertSort")}</Label>
                      <Select
                        value={searchAlertDraft.sort}
                        onValueChange={(value) =>
                          setSearchAlertDraft((draft) => ({
                            ...draft,
                            sort: value === "newest" || value === "deadline" ? value : "relevance",
                          }))
                        }
                      >
                        <SelectTrigger className="h-10 border-slate-200 focus:ring-slate-900 rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg border-slate-200 shadow-md">
                          <SelectItem value="relevance" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertSort_relevance")}
                          </SelectItem>
                          <SelectItem value="newest" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertSort_newest")}
                          </SelectItem>
                          <SelectItem value="deadline" className="focus:bg-slate-50 focus:text-slate-900 cursor-pointer">
                            {t("settings.searchAlertSort_deadline")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                      <Switch
                        checked={searchAlertDraft.isEnabled}
                        onCheckedChange={(checked) =>
                          setSearchAlertDraft((draft) => ({ ...draft, isEnabled: checked }))
                        }
                        className="data-[state=checked]:bg-slate-900"
                      />
                      {t("settings.searchAlertEnabled")}
                    </label>
                    <Button
                      onClick={handleSearchAlertSubmit}
                      disabled={isSavingSearchAlert || !user || !searchAlertDraft.name.trim()}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-10 sm:w-auto"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {isSavingSearchAlert ? t("settings.saving") : t("settings.saveSearchAlert")}
                    </Button>
                  </div>
                </div>

                {searchAlertMessage && <p className="text-sm font-medium text-emerald-700">{searchAlertMessage}</p>}
                {searchAlertError && <p className="text-sm font-medium text-red-600">{searchAlertError}</p>}
                {!searchAlertsData && !searchAlertError && (
                  <p className="text-sm font-medium text-slate-500">{t("settings.loadingSearchAlerts")}</p>
                )}
                {searchAlertsData?.length === 0 && (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-500">
                    {t("settings.noSearchAlerts")}
                  </p>
                )}
                <div className="space-y-3">
                  {(searchAlertsData ?? []).map((alert) => {
                    const digestHistory = alert.digestHistory ?? [];
                    const latestDigest = digestHistory[0];
                    const previousDigestRuns = digestHistory.slice(1);

                    return (
                      <div
                        key={alert.id}
                        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{alert.name}</p>
                            <Badge
                              variant="outline"
                              className={`w-fit ${
                                alert.isEnabled
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600"
                              }`}
                            >
                              {alert.isEnabled ? t("settings.searchAlertActive") : t("settings.searchAlertPaused")}
                            </Badge>
                            <Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-700">
                              {alert.frequency === "weekly" ? t("settings.weeklySummary") : t("settings.dailyDigest")}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm font-medium text-slate-600">{searchAlertQuerySummary(alert)}</p>
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {t("settings.searchAlertLastMatched").replace(
                              "{date}",
                              searchAlertDateLabel(alert.lastMatchedAt),
                            )}
                          </p>
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-xs font-semibold uppercase text-slate-500">
                                {t("settings.searchAlertDeliveryHistory")}
                              </p>
                              {latestDigest && (
                                <Badge
                                  variant="outline"
                                  className={`w-fit ${searchAlertDigestStatusClassName(latestDigest.status)}`}
                                >
                                  {searchAlertDigestStatusLabel(latestDigest.status)}
                                </Badge>
                              )}
                            </div>
                            {latestDigest ? (
                              <div className="mt-2 space-y-1 text-xs font-medium text-slate-600">
                                <p>{searchAlertDigestDetail(latestDigest)}</p>
                                <p>{searchAlertDigestDateLabel(latestDigest)}</p>
                                {previousDigestRuns.length > 0 && (
                                  <div className="space-y-1 pt-1">
                                    {previousDigestRuns.map((run) => (
                                      <p key={run.id} className="text-slate-500">
                                        {searchAlertDigestStatusLabel(run.status)}
                                        {" · "}
                                        {searchAlertDigestDetail(run)}
                                        {" · "}
                                        {searchAlertDateLabel(run.createdAt)}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs font-medium text-slate-500">
                                {t("settings.searchAlertNoDeliveryHistory")}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Button
                            variant="outline"
                            onClick={() => setSearchAlertDraft(searchAlertDraftFrom(alert))}
                            disabled={searchAlertActionId === alert.id}
                            className="h-9 border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            {t("settings.editSearchAlert")}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleSearchAlertToggle(alert)}
                            disabled={searchAlertActionId === alert.id}
                            className="h-9 border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {alert.isEnabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                            {alert.isEnabled ? t("settings.pauseSearchAlert") : t("settings.resumeSearchAlert")}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleSearchAlertDelete(alert)}
                            disabled={searchAlertActionId === alert.id}
                            className="h-9 border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 hover:text-red-800"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("settings.deleteSearchAlert")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
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
                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t("settings.manageBilling")}</p>
                    <p className="text-xs font-medium text-slate-500">{t("settings.manageBillingDesc")}</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={billingActionTier === "portal" || !user}
                    onClick={handleBillingPortal}
                    className="w-full rounded-lg border-slate-200 text-slate-700 sm:w-auto"
                  >
                    {billingActionTier === "portal" ? t("settings.openingPortal") : t("settings.manageBilling")}
                  </Button>
                </div>
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
                {currentSubscription?.status === "past_due" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-950">{t("settings.pastDueBillingTitle")}</p>
                    <p className="mt-1 text-sm font-medium text-amber-800">
                      {t("settings.pastDueBillingWarning")}
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      {latestFailedInvoice?.invoiceUrl && (
                        <a
                          href={latestFailedInvoice.invoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-amber-900 px-3 text-sm font-semibold text-white transition-colors hover:bg-amber-800 sm:w-auto"
                        >
                          {t("settings.retryPayment")}
                        </a>
                      )}
                      <Button
                        variant="outline"
                        disabled={billingActionTier === "portal" || !user}
                        onClick={handleBillingPortal}
                        className="h-9 w-full rounded-lg border-amber-300 bg-white text-amber-900 hover:bg-amber-100 sm:w-auto"
                      >
                        {billingActionTier === "portal" ? t("settings.openingPortal") : t("settings.updatePaymentMethod")}
                      </Button>
                    </div>
                  </div>
                )}

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
                      const isCurrentPlan = plan.tier !== null && user?.tier === plan.tier;
                      const canSelfServe = plan.tier !== null && plan.isSelfServe;
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
                            {localizedPlanFeatures(plan.productPlanKey).map((feature) => (
                              <li key={feature} className="flex items-start gap-2 text-sm font-medium text-slate-600">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                                <span>{feature}</span>
                              </li>
                            ))}
                            <li className="flex items-start gap-2 text-sm font-medium text-slate-600">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
                              <span>
                                {plan.includedMonthlyCredits === null
                                  ? t("settings.unlimitedCredits")
                                  : t("settings.includedCredits").replace(
                                    "{credits}",
                                    String(plan.includedMonthlyCredits),
                                  )}
                              </span>
                            </li>
                          </ul>
                          <Button
                            variant={isCurrentPlan ? "outline" : "default"}
                            disabled={isCurrentPlan || !canSelfServe || isWorking || !user}
                            onClick={() => {
                              if (plan.tier) void handleStartCheckout(plan.tier);
                            }}
                            className={`mt-4 w-full rounded-lg ${
                              isCurrentPlan ? "border-slate-200 text-slate-700" : "bg-slate-900 text-white"
                            }`}
                          >
                            {isCurrentPlan
                              ? t("settings.current")
                              : !plan.isAvailable
                                ? t("settings.plannedPlan")
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

                <div className="space-y-3 border-t border-slate-100 pt-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{t("settings.invoiceHistory")}</h3>
                      <p className="text-sm font-medium text-slate-500">{t("settings.invoiceHistoryDesc")}</p>
                    </div>
                    <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
                      {t("settings.invoiceFilter")}
                      <select
                        value={billingInvoiceStatusFilter}
                        onChange={(event) =>
                          setBillingInvoiceStatusFilter(event.target.value as "all" | BillingInvoiceStatus)
                        }
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
                      >
                        {BILLING_INVOICE_STATUS_FILTERS.map((status) => (
                          <option key={status} value={status}>
                            {status === "all"
                              ? t("settings.invoiceStatus_all")
                              : t(`settings.invoiceStatus_${status}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {billingInvoicesError && <p className="text-sm font-medium text-red-600">{billingInvoicesError}</p>}
                  {!billingInvoicesData && !billingInvoicesError && (
                    <p className="text-sm font-medium text-slate-500">{t("settings.loadingInvoices")}</p>
                  )}
                  {billingInvoicesData?.summary && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">
                          {t("settings.invoiceSummary")}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {billingInvoicesData.summary.totalInvoices}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">
                          {t("settings.invoicePaidTotal")}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {invoiceAmountLabel(billingInvoicesData.summary.totalPaidCents, "USD")}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">
                          {t("settings.invoiceDueTotal")}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {invoiceAmountLabel(billingInvoicesData.summary.totalDueCents, "USD")}
                        </p>
                      </div>
                    </div>
                  )}
                  {billingInvoicesData?.invoices.length === 0 && (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-500">
                      {t("settings.noInvoices")}
                    </p>
                  )}
                  <div className="space-y-2">
                    {(billingInvoicesData?.invoices ?? []).map((invoice) => (
                      <div
                        key={invoice.id}
                        className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              {invoice.invoiceNumber ?? invoice.providerInvoiceId}
                            </p>
                            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                              {t(`settings.invoiceStatus_${invoice.status}`)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {invoiceAmountLabel(invoice.amountPaidCents || invoice.amountDueCents, invoice.currency)}
                            {" · "}
                            {invoiceDateLabel(invoice.paidAt, invoice.dueAt)}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          {invoice.invoicePdfUrl && (
                            <a
                              href={invoice.invoicePdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-slate-200 px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto"
                            >
                              {t("settings.viewInvoicePdf")}
                            </a>
                          )}
                          {invoice.invoiceUrl && (
                            <a
                              href={invoice.invoiceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex h-8 w-full items-center justify-center rounded-lg border px-2.5 text-sm font-medium transition-colors sm:w-auto ${
                                invoice.status === "payment_failed"
                                  ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {invoice.status === "payment_failed"
                                ? t("settings.retryPayment")
                                : t("settings.viewInvoice")}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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

            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
                <CardTitle className="text-lg font-semibold text-slate-900">{t("settings.accountData")}</CardTitle>
                <CardDescription className="text-slate-500 font-medium">{t("settings.accountDataDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">{t("settings.exportAccountData")}</p>
                  <p className="mt-1 text-sm font-medium text-slate-500">{t("settings.exportAccountDataDesc")}</p>
                  <Button
                    variant="outline"
                    onClick={handleExportAccountData}
                    disabled={accountAction === "export" || !user}
                    className="mt-4 h-10 rounded-lg border-slate-200 text-slate-700"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {accountAction === "export" ? t("settings.exportingAccountData") : t("settings.exportAccountData")}
                  </Button>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-900">{t("settings.deleteAccount")}</p>
                  <p className="mt-1 text-sm font-medium text-red-700">{t("settings.deleteAccountDesc")}</p>
                  <Button
                    variant="outline"
                    onClick={handleDeleteAccount}
                    disabled={accountAction === "delete" || !user}
                    className="mt-4 h-10 rounded-lg border-red-200 text-red-700 hover:bg-red-100 hover:text-red-800"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {accountAction === "delete" ? t("settings.deletingAccount") : t("settings.deleteAccount")}
                  </Button>
                </div>
                {accountActionMessage && <p className="text-sm font-medium text-emerald-700">{accountActionMessage}</p>}
                {accountActionError && <p className="text-sm font-medium text-red-600">{accountActionError}</p>}
              </CardContent>
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
