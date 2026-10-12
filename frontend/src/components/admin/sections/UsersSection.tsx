"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createAdminUser,
  listAdminUserFeatureOverrides,
  listAdminUsers,
  reconcileAdminSubscriptions,
  updateAdminUser as updateAdminUserAccess,
  updateAdminUserFeatureOverride,
  type AdminUser,
  type AdminUserFeatureOverridesResponse,
  type AdminUserFilterStatus,
  type UpdateAdminUserInput,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";
import { endOfDayIsoFromDateInput, formatDate, formatDateInputValue, isUnreadableDateInput, readDateInput } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useBusyIds } from "../busy-reporting";
import { useAdminResource } from "../use-admin-resource";
import { ACCOUNT_TIERS, OVERRIDABLE_FEATURES, USER_ROLES } from "./user-access-constants";

type UserFilters = {
  q?: string;
  role?: UserRole;
  tier?: AccountTier;
  status?: AdminUserFilterStatus;
};

type InvitationDraft = {
  email: string;
  displayName: string;
  role: UserRole;
  tier: AccountTier;
};

const DEFAULT_INVITATION_DRAFT: InvitationDraft = {
  email: "",
  displayName: "",
  role: "user",
  tier: "free",
};

export function featureOverrideFormValues(
  data: AdminUserFeatureOverridesResponse | null,
  feature: FeatureKey,
) {
  const override = data?.overrides.find((item) => item.featureKey === feature);

  return {
    reason: override?.reason ?? "",
    expiresAt: formatDateInputValue(override?.expiresAt ?? null),
  };
}

/**
 * Whether an override save may go out for the form as it stands. Enabling or disabling sends the expiry input as
 * `expiresAt`, and endOfDayIsoFromDateInput answers null for text Date cannot read (a five- or six-digit year, which
 * a date input in desktop Chrome takes) just as it does for an emptied input; the route stores null as "no expiry",
 * so one slip in the year would save a permanent override. So would a date typed only in part: clearing one segment,
 * or typing some of one, leaves the input's value "" with `validity.badInput` set (`expiresAtBadInput`, from
 * readDateInput), the same "" as an emptied input. Both are held back. An emptied input (no badInput) still means no
 * expiry and a day is still sent as the end of that day in UTC. Clearing (`isEnabled` null) removes the override and
 * sends no expiry whatever the field holds, so it is never held back.
 */
export function featureOverrideCanBeSaved(isEnabled: boolean | null, expiresAt: string, expiresAtBadInput = false): boolean {
  return isEnabled === null || !isUnreadableDateInput(expiresAt, expiresAtBadInput);
}

export function UsersSection() {
  const { t } = useLanguage();
  const { canManageUsers } = useAdminSession();
  const [userFilters, setUserFilters] = useState<UserFilters>({});
  const loadUsers = useCallback(() => listAdminUsers(userFilters).then((response) => response.users), [userFilters]);
  const users = useAdminResource(loadUsers);
  const [notice, setNotice] = useState<string | null>(null);
  const { busyIds: pendingUserIds, setBusy: setUserBusy } = useBusyIds<string>();
  const [invitationDraft, setInvitationDraft] = useState<InvitationDraft>(DEFAULT_INVITATION_DRAFT);
  const [invitedTemporaryPassword, setInvitedTemporaryPassword] = useState<string | null>(null);
  const [isInvitingUser, setIsInvitingUser] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isReconcilingSubscriptions, setIsReconcilingSubscriptions] = useState(false);
  const [featureOverrideUser, setFeatureOverrideUser] = useState<AdminUser | null>(null);
  const [featureOverrideData, setFeatureOverrideData] = useState<AdminUserFeatureOverridesResponse | null>(null);
  const [featureOverrideFeature, setFeatureOverrideFeature] = useState<FeatureKey>("submission_guidance");
  const [featureOverrideReason, setFeatureOverrideReason] = useState("");
  const [featureOverrideExpiresAt, setFeatureOverrideExpiresAt] = useState("");
  // The expiry input holds a date typed only in part: its value reads "" like an emptied input, so the flag lives apart from it.
  const [featureOverrideExpiresAtBadInput, setFeatureOverrideExpiresAtBadInput] = useState(false);
  // Bumped whenever the form is refilled from stored data; it is the expiry input's key.
  const [featureOverrideFormVersion, setFeatureOverrideFormVersion] = useState(0);
  const [isLoadingFeatureOverrides, setIsLoadingFeatureOverrides] = useState(false);
  const [isUpdatingFeatureOverride, setIsUpdatingFeatureOverride] = useState(false);

  // The feature selected now, for a load or a save that comes back after the select may have moved on: the handler that started
  // it still holds the feature it saw at the time, and refilling the form for that one would put its reason and expiry under the
  // feature the select shows. Written in an effect, never during render, the way use-admin-resource keeps its loader.
  const featureOverrideFeatureRef = useRef(featureOverrideFeature);
  useEffect(() => {
    featureOverrideFeatureRef.current = featureOverrideFeature;
  }, [featureOverrideFeature]);

  const updateUserAccess = (user: AdminUser, input: UpdateAdminUserInput) => {
    setUserBusy(user.id, true);
    updateAdminUserAccess(user.id, input)
      .then(({ user: updated }) => {
        users.setData((current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
      })
      .catch(() => {
        setNotice(t("admin.userUpdateFailed"));
      })
      .finally(() => {
        setUserBusy(user.id, false);
      });
  };

  const syncFeatureOverrideForm = (data: AdminUserFeatureOverridesResponse | null, feature: FeatureKey) => {
    const form = featureOverrideFormValues(data, feature);

    setFeatureOverrideReason(form.reason);
    setFeatureOverrideExpiresAt(form.expiresAt);
    // The field has to be reset with the flag: React does not rewrite a value it already holds, so a half-typed date (value
    // "") would stay on screen through a reset to "" while the form said "no expiry". A new key remounts the input.
    setFeatureOverrideExpiresAtBadInput(false);
    setFeatureOverrideFormVersion((version) => version + 1);
  };

  /** Reads the expiry input now (a React event's currentTarget is gone once the handler returns) and records it. */
  const recordExpiresAtInput = (input: HTMLInputElement) => {
    const reading = readDateInput(input);

    setFeatureOverrideExpiresAt(reading.value);
    setFeatureOverrideExpiresAtBadInput(reading.badInput);
  };

  const openFeatureOverrides = (targetUser: AdminUser) => {
    setFeatureOverrideUser(targetUser);
    setFeatureOverrideData(null);
    syncFeatureOverrideForm(null, featureOverrideFeature);
    setIsLoadingFeatureOverrides(true);
    listAdminUserFeatureOverrides(targetUser.id)
      .then((response) => {
        setFeatureOverrideData(response);
        syncFeatureOverrideForm(response, featureOverrideFeatureRef.current);
      })
      .catch(() => {
        setNotice(t("admin.featureOverrideLoadFailed"));
      })
      .finally(() => {
        setIsLoadingFeatureOverrides(false);
      });
  };

  const selectedFeatureOverride = featureOverrideData?.overrides.find(
    (override) => override.featureKey === featureOverrideFeature,
  );

  const saveFeatureOverride = (isEnabled: boolean | null) => {
    if (!featureOverrideUser || !featureOverrideCanBeSaved(isEnabled, featureOverrideExpiresAt, featureOverrideExpiresAtBadInput)) return;

    const reason = featureOverrideReason.trim();

    setIsUpdatingFeatureOverride(true);
    updateAdminUserFeatureOverride(featureOverrideUser.id, {
      featureKey: featureOverrideFeature,
      isEnabled,
      reason: isEnabled === null ? null : reason || null,
      expiresAt: isEnabled === null ? null : endOfDayIsoFromDateInput(featureOverrideExpiresAt),
    })
      .then((response) => {
        setFeatureOverrideData(response);
        syncFeatureOverrideForm(response, featureOverrideFeatureRef.current);
        setNotice(t("admin.featureOverrideUpdated"));
      })
      .catch(() => {
        setNotice(t("admin.featureOverrideUpdateFailed"));
      })
      .finally(() => {
        setIsUpdatingFeatureOverride(false);
      });
  };

  const handleCreateAdminUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const email = invitationDraft.email.trim();
    if (!email || isInvitingUser) return;

    setIsInvitingUser(true);
    setInviteError(null);
    setInvitedTemporaryPassword(null);

    createAdminUser({
      email,
      displayName: invitationDraft.displayName.trim() || undefined,
      role: invitationDraft.role,
      tier: invitationDraft.tier,
    })
      .then((response) => {
        setInvitationDraft(DEFAULT_INVITATION_DRAFT);
        setInvitedTemporaryPassword(response.temporaryPassword);
        setNotice(t("admin.inviteCreated").replace("{email}", response.user.email ?? response.user.id));
        users.setData((current) => [...(current ?? []), response.user]);
      })
      .catch(() => {
        setInviteError(t("admin.inviteError"));
      })
      .finally(() => {
        setIsInvitingUser(false);
      });
  };

  const reconcileSubscriptions = () => {
    setIsReconcilingSubscriptions(true);
    setNotice(null);
    reconcileAdminSubscriptions({ pastDueGraceDays: 7 })
      .then(async (result) => {
        setNotice(
          t("admin.subscriptionReconcileResult")
            .replace("{checked}", String(result.checked))
            .replace("{pastDue}", String(result.markedPastDue))
            .replace("{downgraded}", String(result.downgradedPastDue + result.canceledAtPeriodEnd + result.expiredTrials)),
        );
        await users.reload();
      })
      .catch(() => {
        setNotice(t("admin.subscriptionReconcileFailed"));
      })
      .finally(() => {
        setIsReconcilingSubscriptions(false);
      });
  };

  const userRows = users.data ?? [];

  if (users.status === "error" && users.data === null) {
    return (
      <AdminSectionStateCard
        action={() => void users.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.users")}
      />
    );
  }
  if (users.status === "loading" && users.data === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.users")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminNotice message={notice} />
      {users.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold text-slate-950">
            <UserCog size={18} />
            {t("admin.users")}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
              {userRows.length}
            </Badge>
            {canManageUsers && (
              <Button
                variant="outline"
                onClick={reconcileSubscriptions}
                disabled={isReconcilingSubscriptions}
                className="h-10 rounded-lg border-slate-200"
              >
                <RefreshCw size={16} />
                {isReconcilingSubscriptions ? t("admin.reconcilingSubscriptions") : t("admin.reconcileSubscriptions")}
              </Button>
            )}
          </div>
        </div>
        <form
          onSubmit={handleCreateAdminUser}
          className="grid gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-4 lg:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_140px_150px_auto]"
        >
          <div className="lg:col-span-5">
            <p className="text-sm font-semibold text-slate-950">{t("admin.inviteUser")}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t("admin.inviteDescription")}</p>
          </div>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
            {t("admin.email")}
            <Input
              type="email"
              value={invitationDraft.email}
              onChange={(event) =>
                setInvitationDraft((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="buyer@example.com"
              className="h-9 rounded-lg border-slate-200 bg-white"
              required
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
            {t("admin.displayName")}
            <Input
              value={invitationDraft.displayName}
              onChange={(event) =>
                setInvitationDraft((current) => ({ ...current, displayName: event.target.value }))
              }
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
            {t("admin.role")}
            <select
              value={invitationDraft.role}
              onChange={(event) =>
                setInvitationDraft((current) => ({ ...current, role: event.target.value as UserRole }))
              }
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`admin.role_${role}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
            {t("admin.tier")}
            <select
              value={invitationDraft.tier}
              onChange={(event) =>
                setInvitationDraft((current) => ({ ...current, tier: event.target.value as AccountTier }))
              }
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              {ACCOUNT_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {t(`admin.tier_${tier}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={isInvitingUser || invitationDraft.email.trim().length === 0}
              className="h-9 rounded-lg bg-slate-900 px-3 text-white hover:bg-slate-800"
            >
              {isInvitingUser ? t("admin.creatingInvite") : t("admin.createInvite")}
            </Button>
          </div>
          {(invitedTemporaryPassword || inviteError) && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm lg:col-span-5">
              {invitedTemporaryPassword ? (
                <div>
                  <span className="font-semibold text-slate-950">{t("admin.temporaryPassword")}:</span>{" "}
                  <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-slate-800">
                    {invitedTemporaryPassword}
                  </code>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{t("admin.temporaryPasswordHelp")}</p>
                </div>
              ) : (
                <span className="font-medium text-rose-700">{inviteError}</span>
              )}
            </div>
          )}
        </form>
        <div className="grid gap-3 border-b border-slate-100 px-4 py-3 md:grid-cols-[minmax(220px,1fr)_160px_160px_160px]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={userFilters.q ?? ""}
              onChange={(event) => setUserFilters((current) => ({ ...current, q: event.target.value || undefined }))}
              placeholder={t("admin.searchUsers")}
              className="h-9 rounded-lg border-slate-200 pl-9"
            />
          </div>
          <select
            value={userFilters.role ?? "all"}
            onChange={(event) =>
              setUserFilters((current) => ({
                ...current,
                role: event.target.value === "all" ? undefined : event.target.value as UserRole,
              }))
            }
            aria-label={t("admin.role")}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
          >
            <option value="all">{t("admin.allRoles")}</option>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`admin.role_${role}`)}
              </option>
            ))}
          </select>
          <select
            value={userFilters.tier ?? "all"}
            onChange={(event) =>
              setUserFilters((current) => ({
                ...current,
                tier: event.target.value === "all" ? undefined : event.target.value as AccountTier,
              }))
            }
            aria-label={t("admin.tier")}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
          >
            <option value="all">{t("admin.allTiers")}</option>
            {ACCOUNT_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {t(`admin.tier_${tier}`)}
              </option>
            ))}
          </select>
          <select
            value={userFilters.status ?? "all"}
            onChange={(event) =>
              setUserFilters((current) => ({
                ...current,
                status: event.target.value === "all" ? undefined : event.target.value as AdminUserFilterStatus,
              }))
            }
            aria-label={t("admin.status")}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
          >
            <option value="all">{t("admin.allStatuses")}</option>
            <option value="enabled">{t("admin.enabled")}</option>
            <option value="disabled">{t("admin.disabled")}</option>
          </select>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.account")}</TableHead>
              <TableHead>{t("admin.role")}</TableHead>
              <TableHead>{t("admin.tier")}</TableHead>
              <TableHead>{t("admin.lastLogin")}</TableHead>
              <TableHead>{t("admin.featureOverrides")}</TableHead>
              <TableHead className="text-right">{t("admin.enabledColumn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {userRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">
                  {t("admin.noUsers")}
                </TableCell>
              </TableRow>
            )}
            {userRows.map((user) => {
              const isPending = pendingUserIds.has(user.id);

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{user.displayName || user.email || user.id}</div>
                    <div className="text-xs text-slate-500">{user.email ?? user.id}</div>
                  </TableCell>
                  <TableCell>
                    <select
                      value={user.role}
                      disabled={isPending}
                      onChange={(event) => updateUserAccess(user, { role: event.target.value as UserRole })}
                      aria-label={t("admin.role")}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    >
                      {USER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(`admin.role_${role}`)}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <select
                      value={user.tier}
                      disabled={isPending}
                      onChange={(event) => updateUserAccess(user, { tier: event.target.value as AccountTier })}
                      aria-label={t("admin.tier")}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    >
                      {ACCOUNT_TIERS.map((tier) => (
                        <option key={tier} value={tier}>
                          {t(`admin.tier_${tier}`)}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openFeatureOverrides(user)}
                      disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride}
                      className="h-8 rounded-lg border-slate-200 px-2"
                    >
                      {t("admin.manageFeatureOverrides")}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Label htmlFor={`user-${user.id}`} className="text-xs font-medium text-slate-500">
                        {user.isDisabled ? t("admin.disabled") : t("admin.enabled")}
                      </Label>
                      <Switch
                        id={`user-${user.id}`}
                        checked={!user.isDisabled}
                        disabled={isPending}
                        onCheckedChange={(checked) => updateUserAccess(user, { isDisabled: !checked })}
                        className="data-checked:bg-slate-900"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {featureOverrideUser && (
          <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-4 lg:grid-cols-[minmax(220px,1fr)_220px_180px_180px_auto] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-slate-950">{t("admin.featureOverrides")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {t("admin.featureOverrideDescription").replace(
                  "{account}",
                  featureOverrideUser.email ?? featureOverrideUser.id,
                )}
              </p>
              {featureOverrideData && (
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {t("admin.organization")}: {featureOverrideData.organizationName}
                </p>
              )}
            </div>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              {t("admin.feature")}
              <select
                value={featureOverrideFeature}
                disabled={isLoadingFeatureOverrides}
                onChange={(event) => {
                  const feature = event.target.value as FeatureKey;

                  setFeatureOverrideFeature(feature);
                  syncFeatureOverrideForm(featureOverrideData, feature);
                }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
              >
                {OVERRIDABLE_FEATURES.map((feature) => (
                  <option key={feature} value={feature}>
                    {t(`admin.feature_${feature}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                {selectedFeatureOverride
                  ? selectedFeatureOverride.isEnabled
                    ? t("admin.overrideEnabled")
                    : t("admin.overrideDisabled")
                  : t("admin.overrideDefault")}
              </Badge>
              {selectedFeatureOverride?.isExpired && (
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                  {t("admin.overrideExpired")}
                </Badge>
              )}
            </div>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              {t("admin.overrideReason")}
              <Input
                value={featureOverrideReason}
                onChange={(event) => setFeatureOverrideReason(event.target.value)}
                placeholder={t("admin.overrideReasonPlaceholder")}
                className="h-9 rounded-lg border-slate-200 bg-white"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              {t("admin.overrideExpiresAt")}
              <Input
                key={featureOverrideFormVersion}
                type="date"
                value={featureOverrideExpiresAt}
                onChange={(event) => recordExpiresAtInput(event.currentTarget)}
                onKeyUp={(event) => recordExpiresAtInput(event.currentTarget)}
                onBlur={(event) => recordExpiresAtInput(event.currentTarget)}
                aria-invalid={isUnreadableDateInput(featureOverrideExpiresAt, featureOverrideExpiresAtBadInput) || undefined}
                className="h-9 rounded-lg border-slate-200 bg-white"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => saveFeatureOverride(true)}
                disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride || !featureOverrideCanBeSaved(true, featureOverrideExpiresAt, featureOverrideExpiresAtBadInput)}
                className="h-9 rounded-lg border-slate-200 px-3"
              >
                {t("admin.enableOverride")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => saveFeatureOverride(false)}
                disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride || !featureOverrideCanBeSaved(false, featureOverrideExpiresAt, featureOverrideExpiresAtBadInput)}
                className="h-9 rounded-lg border-slate-200 px-3"
              >
                {t("admin.disableOverride")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => saveFeatureOverride(null)}
                disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride}
                className="h-9 rounded-lg px-3 text-slate-600"
              >
                {t("admin.clearOverride")}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
