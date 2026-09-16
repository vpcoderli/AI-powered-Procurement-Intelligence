"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateAdminDataSource, type AdminDataSource, type UpdateAdminDataSourceInput } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  CADENCES,
  ENRICHMENT_FIELDS,
  LIST_EXTRACTION_FIELDS,
  LIST_EXTRACTION_MODES,
  parseEnrichmentConfig,
  parseListExtractionConfig,
  serializeEnrichmentConfig,
  serializeListExtractionConfig,
  type Cadence,
  type EnrichmentField,
  type ListExtractionField,
  type ListExtractionMode,
} from "@/server/admin/crawler-config";
import {
  ATTACHMENT_MODES,
  parseAttachmentPolicy,
  serializeAttachmentPolicy,
  type AttachmentMode,
  type AttachmentPolicy,
} from "@/server/attachments/policy";

/**
 * Per-source crawler config editor for the admin data-source table (spec:
 * docs/superpowers/specs/2026-09-15-scrapling-enrichment-sidecar).
 *
 * The "Attachments" group edits `fetch_config.attachments`, the per-source archiving policy the
 * attachment repair worker reads (spec:
 * docs/superpowers/specs/2026-09-16-attachment-repair-design.md).
 *
 * The "List extraction" group edits `fetch_config.list_extraction` (contract C1 of
 * docs/superpowers/plans/2026-09-16-local-source-governance-recovery.md): which parser reads the
 * portal's LIST page — the Scrapling sidecar (main path) or the adapter's own regex/DOM parser
 * (fallback) — whether the page has to be rendered by the browser sidecar first, and the
 * per-source item/field selectors. It never adds a request: the same single list fetch feeds
 * whichever parser is selected.
 *
 * Edits the same `fetch_config.enrichment` block the Python crawler reads, plus the row's
 * cadence and base URL, through the existing PATCH /api/admin/data-sources/[id] route. The
 * PATCH replaces `fetch_config` wholesale, so the patch carries the complete object with
 * unrelated keys (e.g. `base_url`) preserved. Range rules live in the shared validator; the
 * inputs only carry matching HTML min/max hints and surface server rejections verbatim.
 */

export interface CrawlerConfigForm {
  cadence: Cadence;
  baseUrl: string;
  enabled: boolean;
  fields: EnrichmentField[];
  /**
   * The three numeric limits are held as RAW STRINGS, not numbers. A controlled
   * `<input type="number">` reports `""` while the user is clearing or retyping a value, and
   * `Number("")` is `0` — which would silently post an out-of-range 0 (the server floors are 1
   * and 5). Keeping the raw string lets the field sit empty mid-edit, and
   * `buildCrawlerConfigPatch` coerces it at patch time.
   */
  maxDetailsPerRun: string;
  minIntervalSeconds: string;
  timeoutSeconds: string;
  detailSelectors: Partial<Record<EnrichmentField, string>>;
  attachmentUrlTemplate: string;
  /**
   * Per-source attachment archiving policy (`fetch_config.attachments`), read by the
   * attachment repair worker. Same raw-string rule as the enrichment limits above; the size
   * cap is edited in MB and converted to bytes at patch time.
   */
  attachmentsArchive: boolean;
  attachmentsMode: AttachmentMode;
  attachmentsMaxPerRun: string;
  attachmentsMinIntervalSeconds: string;
  attachmentsTimeoutSeconds: string;
  attachmentsMaxMb: string;
  attachmentsBrowserLinkSelector: string;
  /**
   * Per-source list-page parsing (`fetch_config.list_extraction`). `listMaxItems` follows the
   * same raw-string rule as the limits above.
   */
  listMode: ListExtractionMode;
  listRender: boolean;
  listItemSelector: string;
  listMaxItems: string;
  listSelectors: Partial<Record<ListExtractionField, string>>;
}

const BYTES_PER_MB = 1024 * 1024;

export function formFromSource(source: AdminDataSource): CrawlerConfigForm {
  const enrichment = parseEnrichmentConfig(source.fetchConfig ?? {});
  const attachments = parseAttachmentPolicy(source.fetchConfig ?? {});
  const listExtraction = parseListExtractionConfig(source.fetchConfig ?? {});
  return {
    cadence: (CADENCES as readonly string[]).includes(source.cadence) ? (source.cadence as Cadence) : "daily",
    baseUrl: source.baseUrl ?? "",
    enabled: enrichment.enabled,
    fields: enrichment.fields,
    maxDetailsPerRun: String(enrichment.maxDetailsPerRun),
    minIntervalSeconds: String(enrichment.minIntervalSeconds),
    timeoutSeconds: String(enrichment.timeoutSeconds),
    detailSelectors: enrichment.detailSelectors,
    attachmentUrlTemplate: enrichment.attachmentUrlTemplate ?? "",
    attachmentsArchive: attachments.archive,
    attachmentsMode: attachments.mode,
    attachmentsMaxPerRun: String(attachments.maxPerRun),
    attachmentsMinIntervalSeconds: String(attachments.minIntervalSeconds),
    attachmentsTimeoutSeconds: String(attachments.timeoutSeconds),
    attachmentsMaxMb: String(attachments.maxBytes / BYTES_PER_MB),
    attachmentsBrowserLinkSelector: attachments.browserLinkSelector ?? "",
    listMode: listExtraction.mode,
    listRender: listExtraction.render,
    listItemSelector: listExtraction.itemSelector ?? "",
    listMaxItems: String(listExtraction.maxItems),
    listSelectors: listExtraction.selectors,
  };
}

/**
 * Coerces one raw numeric field. An empty (or unparseable) input means "leave this limit alone":
 * it falls back to the value currently saved on the row, so clearing a field can never post a 0.
 * Out-of-range numbers are still sent as typed and rejected by the server validator, whose message
 * the panel surfaces verbatim.
 */
function numberOrSaved(raw: string, saved: number): number {
  const parsed = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(parsed) ? parsed : saved;
}

/**
 * Returns the snake_case block that belongs under `fetch_config.attachments`. The shared
 * serializer returns the wrapper `{ attachments: {...} }`, so unwrap it before merging the block
 * into the patch alongside `enrichment`.
 */
function attachmentsBlock(policy: AttachmentPolicy): Record<string, unknown> {
  return serializeAttachmentPolicy(policy).attachments as Record<string, unknown>;
}


export function buildCrawlerConfigPatch(
  source: AdminDataSource,
  form: CrawlerConfigForm,
): UpdateAdminDataSourceInput {
  const selectors: Partial<Record<EnrichmentField, string>> = {};
  for (const [field, selector] of Object.entries(form.detailSelectors) as Array<
    [EnrichmentField, string | undefined]
  >) {
    if (selector && selector.trim()) selectors[field] = selector.trim();
  }
  const template = form.attachmentUrlTemplate.trim();
  const baseUrl = form.baseUrl.trim();
  const saved = parseEnrichmentConfig(source.fetchConfig ?? {});
  const savedAttachments = parseAttachmentPolicy(source.fetchConfig ?? {});
  const savedListExtraction = parseListExtractionConfig(source.fetchConfig ?? {});
  const browserLinkSelector = form.attachmentsBrowserLinkSelector.trim();
  const listItemSelector = form.listItemSelector.trim();

  const listSelectors: Partial<Record<ListExtractionField, string>> = {};
  for (const [field, selector] of Object.entries(form.listSelectors) as Array<
    [ListExtractionField, string | undefined]
  >) {
    if (selector && selector.trim()) listSelectors[field] = selector.trim();
  }

  return {
    cadence: form.cadence,
    baseUrl: baseUrl === "" ? null : baseUrl,
    fetchConfig: {
      ...(source.fetchConfig ?? {}),
      list_extraction: serializeListExtractionConfig({
        mode: form.listMode,
        render: form.listRender,
        itemSelector: listItemSelector === "" ? null : listItemSelector,
        maxItems: numberOrSaved(form.listMaxItems, savedListExtraction.maxItems),
        selectors: listSelectors,
      }),
      attachments: attachmentsBlock({
        archive: form.attachmentsArchive,
        mode: form.attachmentsMode,
        maxPerRun: numberOrSaved(form.attachmentsMaxPerRun, savedAttachments.maxPerRun),
        minIntervalSeconds: numberOrSaved(form.attachmentsMinIntervalSeconds, savedAttachments.minIntervalSeconds),
        timeoutSeconds: numberOrSaved(form.attachmentsTimeoutSeconds, savedAttachments.timeoutSeconds),
        maxBytes: Math.round(
          numberOrSaved(form.attachmentsMaxMb, savedAttachments.maxBytes / BYTES_PER_MB) * BYTES_PER_MB,
        ),
        browserLinkSelector: browserLinkSelector === "" ? null : browserLinkSelector,
      }),
      enrichment: serializeEnrichmentConfig({
        enabled: form.enabled,
        fields: form.fields,
        maxDetailsPerRun: numberOrSaved(form.maxDetailsPerRun, saved.maxDetailsPerRun),
        minIntervalSeconds: numberOrSaved(form.minIntervalSeconds, saved.minIntervalSeconds),
        timeoutSeconds: numberOrSaved(form.timeoutSeconds, saved.timeoutSeconds),
        detailSelectors: selectors,
        attachmentUrlTemplate: template === "" ? null : template,
      }),
    },
  };
}

interface CrawlerConfigPanelProps {
  source: AdminDataSource;
  disabled?: boolean;
  onSaved: (source: AdminDataSource) => void;
}

interface CrawlerConfigStatus {
  kind: "success" | "error";
  text: string;
}

const inputClass =
  "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none";

export function CrawlerConfigPanel({ source, disabled = false, onSaved }: CrawlerConfigPanelProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CrawlerConfigForm>(() => formFromSource(source));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CrawlerConfigStatus | null>(null);

  const update = <K extends keyof CrawlerConfigForm>(key: K, value: CrawlerConfigForm[K]) => {
    setStatus(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleField = (field: EnrichmentField) => {
    setStatus(null);
    setForm((current) => ({
      ...current,
      fields: current.fields.includes(field)
        ? current.fields.filter((item) => item !== field)
        : [...current.fields, field],
    }));
  };

  const save = () => {
    setSaving(true);
    setStatus(null);
    updateAdminDataSource(source.id, buildCrawlerConfigPatch(source, form))
      .then(({ source: updated }) => {
        onSaved(updated);
        setForm(formFromSource(updated));
        setStatus({ kind: "success", text: t("admin.crawlerConfigSaved").replace("{source}", source.label) });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({ kind: "error", text: t("admin.crawlerConfigSaveFailed").replace("{message}", message) });
      })
      .finally(() => setSaving(false));
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="h-7 rounded-lg border-slate-200 px-2 text-xs"
      >
        {t("admin.crawlerConfigOpen")}
      </Button>
    );
  }

  return (
    <div
      className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left text-xs"
      data-testid={`crawler-config-${source.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">{t("admin.crawlerConfigTitle")}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-slate-500 underline-offset-2 hover:underline"
        >
          {t("admin.crawlerConfigClose")}
        </button>
      </div>
      <p className="text-slate-500">{t("admin.crawlerConfigDescription")}</p>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigCadence")}</span>
        <select
          value={form.cadence}
          onChange={(event) => update("cadence", event.target.value as Cadence)}
          className={inputClass}
        >
          {CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {t(`admin.crawlerConfigCadence_${cadence}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigBaseUrl")}</span>
        <input
          type="url"
          value={form.baseUrl}
          onChange={(event) => update("baseUrl", event.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex items-center gap-2 font-medium text-slate-700">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(event) => update("enabled", event.target.checked)}
        />
        {t("admin.crawlerConfigEnrichmentEnabled")}
      </label>

      <div className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigFields")}</span>
        <div className="flex flex-wrap gap-3">
          {ENRICHMENT_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={form.fields.includes(field)}
                onChange={() => toggleField(field)}
              />
              {t(`admin.crawlerConfigField_${field}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigMaxDetails")}</span>
          <input
            type="number"
            min={1} max={200}
            value={form.maxDetailsPerRun}
            onChange={(event) => update("maxDetailsPerRun", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigMinInterval")}</span>
          <input
            type="number"
            min={0} max={60}
            step={0.5}
            value={form.minIntervalSeconds}
            onChange={(event) => update("minIntervalSeconds", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigTimeout")}</span>
          <input
            type="number"
            min={5} max={60}
            value={form.timeoutSeconds}
            onChange={(event) => update("timeoutSeconds", event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigSelectors")}</span>
        {ENRICHMENT_FIELDS.map((field) => (
          <label key={field} className="grid grid-cols-[8rem_1fr] items-center gap-2">
            <span className="text-slate-500">{t(`admin.crawlerConfigField_${field}`)}</span>
            <input
              type="text"
              value={form.detailSelectors[field] ?? ""}
              onChange={(event) =>
                update("detailSelectors", { ...form.detailSelectors, [field]: event.target.value })
              }
              className={inputClass}
            />
          </label>
        ))}
      </div>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentTemplate")}</span>
        <input
          type="text"
          value={form.attachmentUrlTemplate}
          onChange={(event) => update("attachmentUrlTemplate", event.target.value)}
          className={inputClass}
        />
      </label>

      <div
        className="grid gap-2 border-t border-slate-200 pt-3"
        data-testid={`crawler-config-list-extraction-${source.id}`}
      >
        <span className="font-semibold text-slate-800">{t("admin.crawlerConfigListTitle")}</span>
        <p className="text-slate-500">{t("admin.crawlerConfigListDescription")}</p>

        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigListMode")}</span>
          <select
            value={form.listMode}
            onChange={(event) => update("listMode", event.target.value as ListExtractionMode)}
            className={inputClass}
          >
            {LIST_EXTRACTION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`admin.crawlerConfigListMode_${mode}`)}
              </option>
            ))}
          </select>
          <span className="text-slate-500">{t("admin.crawlerConfigListModeHelp")}</span>
        </label>

        <label className="flex items-center gap-2 font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.listRender}
            onChange={(event) => update("listRender", event.target.checked)}
          />
          {t("admin.crawlerConfigListRender")}
        </label>
        <span className="text-slate-500">{t("admin.crawlerConfigListRenderHelp")}</span>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="font-medium text-slate-600">{t("admin.crawlerConfigListItemSelector")}</span>
            <input
              type="text"
              value={form.listItemSelector}
              onChange={(event) => update("listItemSelector", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="font-medium text-slate-600">{t("admin.crawlerConfigListMaxItems")}</span>
            <input
              type="number"
              min={1} max={500}
              value={form.listMaxItems}
              onChange={(event) => update("listMaxItems", event.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigListSelectors")}</span>
          {LIST_EXTRACTION_FIELDS.map((field) => (
            <label key={field} className="grid grid-cols-[8rem_1fr] items-center gap-2">
              <span className="text-slate-500">{t(`admin.crawlerConfigListField_${field}`)}</span>
              <input
                type="text"
                value={form.listSelectors[field] ?? ""}
                onChange={(event) =>
                  update("listSelectors", { ...form.listSelectors, [field]: event.target.value })
                }
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2 border-t border-slate-200 pt-3" data-testid={`crawler-config-attachments-${source.id}`}>
        <span className="font-semibold text-slate-800">{t("admin.crawlerConfigAttachmentsTitle")}</span>
        <p className="text-slate-500">{t("admin.crawlerConfigAttachmentsDescription")}</p>

        <label className="flex items-center gap-2 font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.attachmentsArchive}
            onChange={(event) => update("attachmentsArchive", event.target.checked)}
          />
          {t("admin.crawlerConfigAttachmentsArchive")}
        </label>

        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentsMode")}</span>
          <select
            value={form.attachmentsMode}
            onChange={(event) => update("attachmentsMode", event.target.value as AttachmentMode)}
            className={inputClass}
          >
            {ATTACHMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`admin.crawlerConfigAttachmentsMode_${mode}`)}
              </option>
            ))}
          </select>
          <span className="text-slate-500">{t("admin.crawlerConfigAttachmentsModeHelp")}</span>
        </label>

        <div className="grid gap-2 md:grid-cols-4">
          <label className="grid gap-1">
            <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentsMaxPerRun")}</span>
            <input
              type="number"
              min={1} max={200}
              value={form.attachmentsMaxPerRun}
              onChange={(event) => update("attachmentsMaxPerRun", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentsMinInterval")}</span>
            <input
              type="number"
              min={0} max={60}
              step={0.5}
              value={form.attachmentsMinIntervalSeconds}
              onChange={(event) => update("attachmentsMinIntervalSeconds", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentsTimeout")}</span>
            <input
              type="number"
              min={5} max={120}
              value={form.attachmentsTimeoutSeconds}
              onChange={(event) => update("attachmentsTimeoutSeconds", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentsMaxMb")}</span>
            <input
              type="number"
              min={1} max={200}
              value={form.attachmentsMaxMb}
              onChange={(event) => update("attachmentsMaxMb", event.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentsSelector")}</span>
          <input
            type="text"
            value={form.attachmentsBrowserLinkSelector}
            onChange={(event) => update("attachmentsBrowserLinkSelector", event.target.value)}
            className={inputClass}
          />
          <span className="text-slate-500">{t("admin.crawlerConfigAttachmentsSelectorHelp")}</span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2">
        {status?.kind === "success" && (
          <p role="status" className="text-xs text-emerald-600">
            {status.text}
          </p>
        )}
        {status?.kind === "error" && (
          <p role="alert" className="text-xs text-rose-600">
            {status.text}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={disabled || saving}
          className="h-8 rounded-lg px-3"
        >
          {saving ? t("admin.crawlerConfigSaving") : t("admin.crawlerConfigSave")}
        </Button>
      </div>
    </div>
  );
}
