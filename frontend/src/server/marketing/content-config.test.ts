import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { upsertConfigEntry } from "@/server/config/registry";
import {
  MarketingContentConfigValidationError,
  getMarketingContentConfig,
  resolveMarketingContentConfig,
} from "./content-config";

describe("marketing content config resolver", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("resolves active local copy-library overrides for homepage and resources", () => {
    upsertConfigEntry(testDb.db, {
      module: "ux_state",
      configKey: "copy_library",
      configValue: {
        marketing: {
          homepage: {
            en: {
              hero: {
                headline: "Find agency opportunities with review-ready context.",
              },
              finalCta: {
                body: "Save the opportunities that fit, then prepare evidence before following the buyer's channel.",
              },
            },
          },
          resources: {
            hub: {
              en: {
                hero: {
                  title: "Supplier resources for careful public-bid decisions.",
                },
              },
            },
            workflow: {
              en: {
                hero: {
                  body: "Use this workflow to organize preparation while official buyer instructions remain authoritative.",
                },
              },
            },
          },
        },
      },
      changeReason: "Test local marketing copy override.",
      now: "2026-06-30T00:00:00.000Z",
    });

    const config = getMarketingContentConfig(testDb.db, { now: "2026-06-30T00:00:01.000Z" });

    expect(config).toEqual({
      homepage: {
        en: {
          hero: {
            headline: "Find agency opportunities with review-ready context.",
          },
          finalCta: {
            body: "Save the opportunities that fit, then prepare evidence before following the buyer's channel.",
          },
        },
      },
      resources: {
        hub: {
          en: {
            hero: {
              title: "Supplier resources for careful public-bid decisions.",
            },
          },
        },
        workflow: {
          en: {
            hero: {
              body: "Use this workflow to organize preparation while official buyer instructions remain authoritative.",
            },
          },
        },
      },
    });
  });

  it("rejects unsafe local marketing claims before they reach content getters", () => {
    expect(() =>
      resolveMarketingContentConfig({
        marketing: {
          homepage: {
            en: {
              hero: {
                subheadline: "We guarantee wins and complete compliance for every response.",
              },
            },
          },
          resources: {
            hub: {
              en: {
                safeClaims: ["WinBids can submit for you when the deadline is close."],
              },
            },
          },
        },
      }),
    ).toThrow(MarketingContentConfigValidationError);
  });
});
