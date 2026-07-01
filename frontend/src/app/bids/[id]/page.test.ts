import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bid detail pursuit panel", () => {
  it("loads match score and creates intent from the detail page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchBidMatch");
    expect(page).toContain("createIntent");
    expect(page).toContain('import { useAuth } from "@/context/AuthContext"');
    expect(page).toContain("const { user, isLoading: isAuthLoading } = useAuth()");
    expect(page).toContain("const canCreateIntent = Boolean(user)");
    expect(page).toContain("bidIdFromRouteParam");
    expect(page).toContain("const bidId = rawBidId ? bidIdFromRouteParam(rawBidId) : ''");
    expect(page).toContain("Add to Intent");
    expect(page).toContain("match.score");
    expect(page).toContain("createIntentRequestRef");
    expect(page).toContain("requestedBidId");
    expect(page).toContain("USAGE_LIMIT_REACHED");
    expect(page).toContain("detail.intentLimitReached");
    expect(page).toContain("max-h-72");
    expect(page).toContain("winbids-detail-workspace");
    expect(page).toContain("winbids-hero-panel");
    expect(page).toContain("winbids-panel");
    expect(page).toContain("archiveTone");
    expect(page).toContain("detail.archiveStatus_archived");
    expect(page).toContain("detail.archiveError");
    expect(page).toContain('href="/login"');
    expect(page).toContain('href="/register"');
    expect(page).toContain('t("detail.pursuitAuthRequired")');
    expect(page).toContain('t("detail.pursuitSignIn")');
    expect(page).toContain('t("detail.pursuitRegister")');
    expect(page).toContain("canCreateIntent ? (");
    expect(page).toContain("disabled={isCreatingIntent || isAuthLoading}");
    expect(page).toContain("saveAuthPromptVisible");
    expect(page).toContain("handleToggleSave");
    expect(page).toContain('title={t("detail.saveAuthTitle")}');
    expect(page).toContain('message={t("detail.saveAuthDescription")}');
    expect(page).not.toContain("rounded-xl border border-slate-200 bg-white p-5");
  });

  it("uses UniversalState for bid detail not-found, error, and plan-limit states", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain('import { UniversalState } from "@/components/universal-state"');
    expect(page).toContain('code="empty"');
    expect(page).toContain('code="error"');
    expect(page).toContain('code="plan_limit"');
    expect(page).toContain('title={t("detail.notFoundTitle")}');
    expect(page).toContain('title={t("dashboard.errorTitle")}');
  });

  it("keeps detail actions, evidence links, and long contact text mobile-safe", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between");
    expect(page).toContain("w-full sm:w-auto");
    expect(page).toContain("break-words");
    expect(page).toContain("break-all");
    expect(page).toContain("grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4");
    expect(page).toContain("whitespace-normal");
    expect(page).not.toContain("max-w-md truncate text-xs text-rose-700");
  });

  it("distinguishes archived files from source download notes in attachment copy", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("attachmentIsArchivedOpenable");
    expect(page).toContain("attachmentStatusDescriptionKey");
    expect(page).toContain("attachmentActionLabelKey");
    expect(page).toContain("detail.archiveStatus_archivedOpenable");
    expect(page).toContain("detail.archiveStatus_sourceDownloadNote");
    expect(page).toContain("detail.openArchivedAttachment");
    expect(page).toContain("detail.openSourceDownloadNote");
    expect(page).toContain("detail.openArchiveStatusNote");
    expect(page).toContain("detail.attachmentArchivedOpenableDescription");
    expect(page).toContain("detail.attachmentSourceNoteDescription");
    expect(page).toContain("detail.attachmentFailedDescription");
    expect(page).not.toContain('<Download size={16} className="mr-2" /> {t("detail.download")}');
  });

  it("ships English and Chinese copy for attachment availability without promising external downloads", () => {
    const en = readFileSync(new URL("../../../lib/i18n/dictionaries/en.ts", import.meta.url), "utf8");
    const zh = readFileSync(new URL("../../../lib/i18n/dictionaries/zh.ts", import.meta.url), "utf8");

    expect(en).toContain('archiveStatus_archivedOpenable: "Archived file, ready to open"');
    expect(en).toContain('archiveStatus_sourceDownloadNote: "Source download note"');
    expect(en).toContain('openArchivedAttachment: "Open archived file"');
    expect(en).toContain('openSourceDownloadNote: "View source download note"');
    expect(en).toContain("External source availability is not guaranteed.");
    expect(en).not.toContain("guaranteed to download");

    expect(zh).toContain('archiveStatus_archivedOpenable: "已归档，可打开"');
    expect(zh).toContain('archiveStatus_sourceDownloadNote: "源站下载说明"');
    expect(zh).toContain('openArchivedAttachment: "打开归档文件"');
    expect(zh).toContain('openSourceDownloadNote: "查看源站下载说明"');
    expect(zh).toContain("不保证外部源站一定可用。");
    expect(zh).not.toContain("保证可下载");
  });
});
