import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intent detail page component boundaries", () => {
  it("renders workflow panels through extracted intent components", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain('import { ResponseWorkspacePanel } from "@/components/intents/ResponseWorkspacePanel"');
    expect(page).toContain('import { ArtifactVaultPanel } from "@/components/intents/ArtifactVaultPanel"');
    expect(page).toContain('import { QuoteWorkspacePanel } from "@/components/intents/QuoteWorkspacePanel"');
    expect(page).toContain('import { DeadlineNotificationsPanel } from "@/components/intents/DeadlineNotificationsPanel"');
    expect(page).toContain("<ResponseWorkspacePanel");
    expect(page).toContain("availableArtifacts={artifactVault?.artifacts ?? []}");
    expect(page).toContain("onSaveLinkedArtifacts");
    expect(page).toContain("<ArtifactVaultPanel");
    expect(page).toContain("<QuoteWorkspacePanel");
    expect(page).toContain("<DeadlineNotificationsPanel");
  });
});
