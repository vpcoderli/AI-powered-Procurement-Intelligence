import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("root layout", () => {
  it("applies the WinBids demo shell to real application pages", () => {
    const layout = readFileSync(new URL("layout.tsx", import.meta.url), "utf8");
    const sidebar = readFileSync(new URL("../components/layout/app-sidebar.tsx", import.meta.url), "utf8");
    const globals = readFileSync(new URL("globals.css", import.meta.url), "utf8");

    expect(layout).toContain("winbids-app-shell");
    expect(layout).toContain("winbids-topbar");
    expect(sidebar).toContain("winbids-sidebar");
    expect(sidebar).toContain("WinBids");
    expect(sidebar).toContain("useAuth");
    expect(sidebar).toContain("adminConsoleRoles");
    expect(globals).toContain(".winbids-workspace");
    expect(globals).toContain(".winbids-panel");
  });
});
