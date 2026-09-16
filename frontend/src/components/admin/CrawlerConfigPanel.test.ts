import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminDataSource } from "@/lib/api/admin";
import { buildCrawlerConfigPatch, formFromSource } from "./CrawlerConfigPanel";

const source = {
  id: "il_bidbuy",
  label: "Illinois BidBuy",
  cadence: "daily",
  baseUrl: "https://www.bidbuy.illinois.gov",
  fetchConfig: {
    base_url: "https://www.bidbuy.illinois.gov",
    enrichment: {
      enabled: true,
      fields: ["description", "attachments"],
      max_details_per_run: 10,
      min_interval_seconds: 2,
      timeout_seconds: 15,
      detail_selectors: { description: "div.x" },
      attachment_url_template: "https://x/{id}",
    },
  },
} as unknown as AdminDataSource;

describe("formFromSource", () => {
  it("hydrates the form from fetch_config.enrichment, cadence and baseUrl", () => {
    expect(formFromSource(source)).toEqual({
      cadence: "daily",
      baseUrl: "https://www.bidbuy.illinois.gov",
      enabled: true,
      fields: ["description", "attachments"],
      // Numeric fields live in the form as raw strings so a half-typed or momentarily empty
      // input stays empty instead of snapping to 0; they are coerced in buildCrawlerConfigPatch.
      maxDetailsPerRun: "10",
      minIntervalSeconds: "2",
      timeoutSeconds: "15",
      detailSelectors: { description: "div.x" },
      attachmentUrlTemplate: "https://x/{id}",
      // No `attachments` block on this row, so the shared attachment policy defaults apply.
      attachmentsArchive: true,
      attachmentsMode: "direct",
      attachmentsMaxPerRun: "50",
      attachmentsMinIntervalSeconds: "3",
      attachmentsTimeoutSeconds: "30",
      attachmentsMaxMb: "50",
      attachmentsBrowserLinkSelector: "",
      // No `list_extraction` block either, so the C1 defaults apply: Scrapling is the main path,
      // no browser render, no per-source selectors.
      listMode: "scrapling",
      listRender: false,
      listItemSelector: "",
      listMaxItems: "200",
      listSelectors: {},
    });
  });

  it("falls back to the daily cadence and an empty base URL for unusable rows", () => {
    const hydrated = formFromSource({
      ...source,
      cadence: "fortnightly",
      baseUrl: null,
      fetchConfig: {},
    } as unknown as AdminDataSource);

    expect(hydrated.cadence).toBe("daily");
    expect(hydrated.baseUrl).toBe("");
    // An absent `enrichment` block falls back to the shared defaults (disabled, all fields).
    expect(hydrated.enabled).toBe(false);
    expect(hydrated.fields).toEqual(["description", "attachments", "category", "contact", "published_date"]);
    expect(hydrated.attachmentUrlTemplate).toBe("");
    expect(hydrated.maxDetailsPerRun).toBe("25");
    expect(hydrated.minIntervalSeconds).toBe("3");
    expect(hydrated.timeoutSeconds).toBe("20");
    expect(hydrated.attachmentsArchive).toBe(true);
    expect(hydrated.attachmentsMode).toBe("direct");
    expect(hydrated.attachmentsMaxMb).toBe("50");
    expect(hydrated.attachmentsBrowserLinkSelector).toBe("");
  });

  it("hydrates a saved attachments policy, showing the size cap in MB", () => {
    const hydrated = formFromSource({
      ...source,
      fetchConfig: {
        ...source.fetchConfig,
        attachments: {
          archive: false,
          mode: "browser",
          max_per_run: 10,
          min_interval_seconds: 5,
          timeout_seconds: 45,
          max_bytes: 20971520,
          browser_link_selector: "a.download",
        },
      },
    } as unknown as AdminDataSource);

    expect(hydrated.attachmentsArchive).toBe(false);
    expect(hydrated.attachmentsMode).toBe("browser");
    expect(hydrated.attachmentsMaxPerRun).toBe("10");
    expect(hydrated.attachmentsMinIntervalSeconds).toBe("5");
    expect(hydrated.attachmentsTimeoutSeconds).toBe("45");
    expect(hydrated.attachmentsMaxMb).toBe("20");
    expect(hydrated.attachmentsBrowserLinkSelector).toBe("a.download");
  });
});

describe("buildCrawlerConfigPatch", () => {
  it("serializes the form back into a PATCH body preserving unrelated fetch_config keys", () => {
    const patch = buildCrawlerConfigPatch(
      { ...source, fetchConfig: { ...source.fetchConfig, custom_flag: true } } as AdminDataSource,
      { ...formFromSource(source), enabled: false, cadence: "weekly", baseUrl: "https://new.example.gov" },
    );

    expect(patch).toEqual({
      cadence: "weekly",
      baseUrl: "https://new.example.gov",
      fetchConfig: {
        base_url: "https://www.bidbuy.illinois.gov",
        custom_flag: true,
        list_extraction: {
          mode: "scrapling",
          render: false,
          item_selector: null,
          max_items: 200,
          selectors: {},
        },
        attachments: {
          archive: true,
          mode: "direct",
          max_per_run: 50,
          min_interval_seconds: 3,
          timeout_seconds: 30,
          max_bytes: 52428800,
          browser_link_selector: null,
        },
        enrichment: {
          enabled: false,
          fields: ["description", "attachments"],
          max_details_per_run: 10,
          min_interval_seconds: 2,
          timeout_seconds: 15,
          detail_selectors: { description: "div.x" },
          attachment_url_template: "https://x/{id}",
        },
      },
    });
  });

  it("drops blank selectors and a blank template", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      detailSelectors: { description: "  " },
      attachmentUrlTemplate: "",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;
    expect(enrichment.detail_selectors).toEqual({});
    expect(enrichment.attachment_url_template).toBeNull();
  });

  it("trims retained selectors and templates, and sends a blank base URL as null", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      baseUrl: "   ",
      detailSelectors: { description: "  div.x  ", contact: "" },
      attachmentUrlTemplate: "  https://x/{id}  ",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    expect(patch.baseUrl).toBeNull();
    expect(enrichment.detail_selectors).toEqual({ description: "div.x" });
    expect(enrichment.attachment_url_template).toBe("https://x/{id}");
  });

  it("keeps the row's saved numbers when a numeric input is cleared, never sending 0", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      maxDetailsPerRun: "",
      minIntervalSeconds: "   ",
      timeoutSeconds: "",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    // An emptied field means "leave this one alone": it falls back to the value currently saved
    // on the row, so a cleared input can never post an out-of-range 0.
    expect(enrichment.max_details_per_run).toBe(10);
    expect(enrichment.min_interval_seconds).toBe(2);
    expect(enrichment.timeout_seconds).toBe(15);
  });

  it("falls back to the shared defaults when the row itself has no saved enrichment numbers", () => {
    const bare = { ...source, fetchConfig: {} } as unknown as AdminDataSource;
    const patch = buildCrawlerConfigPatch(bare, {
      ...formFromSource(bare),
      maxDetailsPerRun: "",
      minIntervalSeconds: "",
      timeoutSeconds: "abc",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    expect(enrichment.max_details_per_run).toBe(25);
    expect(enrichment.min_interval_seconds).toBe(3);
    expect(enrichment.timeout_seconds).toBe(20);
  });

  it("coerces edited numeric strings, including a fractional interval", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      maxDetailsPerRun: "200",
      minIntervalSeconds: "1.5",
      timeoutSeconds: "60",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    expect(enrichment.max_details_per_run).toBe(200);
    expect(enrichment.min_interval_seconds).toBe(1.5);
    expect(enrichment.timeout_seconds).toBe(60);
  });
});

describe("buildCrawlerConfigPatch attachments policy", () => {
  it("serializes the attachment group, converting the MB cap back into bytes", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      attachmentsArchive: true,
      attachmentsMode: "browser",
      attachmentsMaxPerRun: "25",
      attachmentsMinIntervalSeconds: "5",
      attachmentsTimeoutSeconds: "45",
      attachmentsMaxMb: "20",
      attachmentsBrowserLinkSelector: "  a.download  ",
    });

    expect((patch.fetchConfig as { attachments: Record<string, unknown> }).attachments).toEqual({
      archive: true,
      mode: "browser",
      max_per_run: 25,
      min_interval_seconds: 5,
      timeout_seconds: 45,
      max_bytes: 20971520,
      browser_link_selector: "a.download",
    });
  });

  it("sends a blank browser selector as null and keeps saved numbers when inputs are cleared", () => {
    const saved = {
      ...source,
      fetchConfig: {
        ...source.fetchConfig,
        attachments: { max_per_run: 10, min_interval_seconds: 5, timeout_seconds: 45, max_bytes: 20971520 },
      },
    } as unknown as AdminDataSource;

    const patch = buildCrawlerConfigPatch(saved, {
      ...formFromSource(saved),
      attachmentsMaxPerRun: "",
      attachmentsMinIntervalSeconds: "   ",
      attachmentsTimeoutSeconds: "",
      attachmentsMaxMb: "",
      attachmentsBrowserLinkSelector: "   ",
    });
    const attachments = (patch.fetchConfig as { attachments: Record<string, unknown> }).attachments;

    expect(attachments.max_per_run).toBe(10);
    expect(attachments.min_interval_seconds).toBe(5);
    expect(attachments.timeout_seconds).toBe(45);
    expect(attachments.max_bytes).toBe(20971520);
    expect(attachments.browser_link_selector).toBeNull();
  });

  it("turns archiving off without disturbing the rest of fetch_config", () => {
    const patch = buildCrawlerConfigPatch(source, { ...formFromSource(source), attachmentsArchive: false });
    const fetchConfig = patch.fetchConfig as Record<string, unknown>;

    expect((fetchConfig.attachments as Record<string, unknown>).archive).toBe(false);
    expect(fetchConfig.base_url).toBe("https://www.bidbuy.illinois.gov");
    expect(fetchConfig.enrichment).toBeDefined();
  });
});

describe("list extraction group", () => {
  const configured = {
    ...source,
    fetchConfig: {
      ...source.fetchConfig,
      list_extraction: {
        mode: "adapter",
        render: true,
        item_selector: "tr.mets-table-row",
        max_items: 50,
        selectors: { title: "a.link", source_bid_id: "td.id", nonsense: "ignored" },
      },
    },
  } as unknown as AdminDataSource;

  it("hydrates the form from the snake_case list_extraction block", () => {
    const hydrated = formFromSource(configured);

    expect(hydrated.listMode).toBe("adapter");
    expect(hydrated.listRender).toBe(true);
    expect(hydrated.listItemSelector).toBe("tr.mets-table-row");
    expect(hydrated.listMaxItems).toBe("50");
    // Unknown selector keys are dropped by the shared parser, not carried into the editor.
    expect(hydrated.listSelectors).toEqual({ title: "a.link", source_bid_id: "td.id" });
  });

  it("serializes the group back, trimming selectors and dropping blank ones", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      listMode: "scrapling",
      listRender: false,
      listItemSelector: "  li.result  ",
      listMaxItems: "120",
      listSelectors: { title: "  h3 a  ", deadline_date: "   ", url: "h3 a@href" },
    });

    expect((patch.fetchConfig as { list_extraction: Record<string, unknown> }).list_extraction).toEqual({
      mode: "scrapling",
      render: false,
      item_selector: "li.result",
      max_items: 120,
      selectors: { title: "h3 a", url: "h3 a@href" },
    });
  });

  it("sends a blank row selector as null and keeps the saved max when the input is cleared", () => {
    const patch = buildCrawlerConfigPatch(configured, {
      ...formFromSource(configured),
      listItemSelector: "   ",
      listMaxItems: "",
    });
    const listExtraction = (patch.fetchConfig as { list_extraction: Record<string, unknown> }).list_extraction;

    expect(listExtraction.item_selector).toBeNull();
    expect(listExtraction.max_items).toBe(50);
  });

  it("leaves the enrichment and attachment blocks untouched", () => {
    const patch = buildCrawlerConfigPatch(source, { ...formFromSource(source), listMode: "adapter" });
    const fetchConfig = patch.fetchConfig as Record<string, unknown>;

    expect(fetchConfig.enrichment).toBeDefined();
    expect(fetchConfig.attachments).toBeDefined();
    expect(fetchConfig.base_url).toBe("https://www.bidbuy.illinois.gov");
  });
});

describe("CrawlerConfigPanel wiring", () => {
  const component = readFileSync(new URL("CrawlerConfigPanel.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");

  it("saves through updateAdminDataSource and reports via i18n", () => {
    expect(component).toContain("updateAdminDataSource(source.id, buildCrawlerConfigPatch(source, form))");
    expect(component).toContain('t("admin.crawlerConfigSaved")');
    expect(component).toContain('t("admin.crawlerConfigSaveFailed")');
    expect(component).toContain('t(`admin.crawlerConfigField_${field}`)');
  });

  it("resolves both save-feedback placeholders instead of leaking them into the UI", () => {
    expect(component).toContain('.replace("{source}"');
    expect(component).toContain('.replace("{message}"');
  });

  it("keeps the numeric inputs inside the ranges the server validator enforces", () => {
    expect(component).toContain("min={1} max={200}");
    expect(component).toContain("min={0} max={60}");
    expect(component).toContain("min={5} max={60}");
  });

  it("renders the attachment policy group entirely through i18n keys", () => {
    expect(component).toContain('t("admin.crawlerConfigAttachmentsTitle")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsDescription")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsArchive")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsMode")');
    expect(component).toContain('t(`admin.crawlerConfigAttachmentsMode_${mode}`)');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsMaxPerRun")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsMinInterval")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsTimeout")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsMaxMb")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsSelector")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsSelectorHelp")');
    expect(component).toContain('t("admin.crawlerConfigAttachmentsModeHelp")');
  });

  it("keeps the attachment inputs inside the ranges the policy validator enforces", () => {
    // maxPerRun 1..200, minIntervalSeconds 0..60, timeoutSeconds 5..120, maxBytes 1..200 MB.
    expect(component).toContain("min={5} max={120}");
    expect(component).toContain("ATTACHMENT_MODES.map");
  });

  it("renders the list extraction group entirely through i18n keys", () => {
    for (const key of [
      "admin.crawlerConfigListTitle",
      "admin.crawlerConfigListDescription",
      "admin.crawlerConfigListMode",
      "admin.crawlerConfigListModeHelp",
      "admin.crawlerConfigListRender",
      "admin.crawlerConfigListRenderHelp",
      "admin.crawlerConfigListItemSelector",
      "admin.crawlerConfigListMaxItems",
      "admin.crawlerConfigListSelectors",
    ]) {
      expect(component).toContain(`t("${key}")`);
    }
    expect(component).toContain("t(`admin.crawlerConfigListMode_${mode}`)");
    expect(component).toContain("t(`admin.crawlerConfigListField_${field}`)");
    expect(component).toContain("LIST_EXTRACTION_MODES.map");
    expect(component).toContain("LIST_EXTRACTION_FIELDS.map");
    // max_items is validated 1..500 server-side; the input carries the matching hints.
    expect(component).toContain("min={1} max={500}");

    const en = readFileSync(new URL("../../lib/i18n/dictionaries/en.ts", import.meta.url), "utf8");
    const zh = readFileSync(new URL("../../lib/i18n/dictionaries/zh.ts", import.meta.url), "utf8");
    for (const dictionary of [en, zh]) {
      expect(dictionary).toContain("crawlerConfigListTitle:");
      expect(dictionary).toContain("crawlerConfigListMode_scrapling:");
      expect(dictionary).toContain("crawlerConfigListField_issuer_name:");
    }
    expect(zh).toContain("列表解析");
  });

  it("is mounted per data source row in the admin page", () => {
    expect(page).toContain("CrawlerConfigPanel");
    expect(page).toContain("onSaved={replaceSource}");
  });
});
