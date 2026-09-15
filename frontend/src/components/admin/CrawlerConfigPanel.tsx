"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateAdminDataSource, type AdminDataSource, type UpdateAdminDataSourceInput } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  CADENCES,
  ENRICHMENT_FIELDS,
  parseEnrichmentConfig,
  serializeEnrichmentConfig,
  type Cadence,
  type EnrichmentField,
} from "@/server/admin/crawler-config";

/**
 * Per-source crawler config editor for the admin data-source table (spec:
 * docs/superpowers/specs/2026-09-15-scrapling-enrichment-sidecar).
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
}

export function formFromSource(source: AdminDataSource): CrawlerConfigForm {
  const enrichment = parseEnrichmentConfig(source.fetchConfig ?? {});
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

  return {
    cadence: form.cadence,
    baseUrl: baseUrl === "" ? null : baseUrl,
    fetchConfig: {
      ...(source.fetchConfig ?? {}),
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
