import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { RequestPrincipal } from "@/server/auth/principal";
import * as responseWorkspaceService from "@/server/response-workspace/service";
import { ResponseWorkspaceValidationError } from "@/server/response-workspace/service";
import { GET } from "./route";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/response-workspace/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/response-workspace/service")>();

  return {
    ...actual,
    getResponsePackageExportFile: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getResponsePackageExportFile = vi.mocked(responseWorkspaceService.getResponsePackageExportFile);
const readFileMock = vi.mocked(readFile);

const businessPrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "business" as const,
  features: ["bid_search", "response.workspace.create"],
};

describe("GET /api/intents/[id]/response-workspace/package/exports/[exportId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("downloads a generated response package export", async () => {
    readFileMock.mockResolvedValueOnce(Buffer.from("# Response package"));
    getResponsePackageExportFile.mockResolvedValueOnce({
      id: "response_package_export_1",
      fileName: "response-package.md",
      contentType: "text/markdown; charset=utf-8",
      byteSize: 18,
      storagePath: "data/response-package-exports/response-package.md",
    });

    const response = await GET(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports/response_package_export_1"),
      { params: Promise.resolve({ id: "intent_1", exportId: "response_package_export_1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="response-package.md"');
    expect(await response.text()).toContain("Response package");
  });

  it("returns EXPORT_NOT_FOUND for missing exports", async () => {
    getResponsePackageExportFile.mockRejectedValueOnce(new ResponseWorkspaceValidationError("Export is not available."));

    const response = await GET(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports/missing"),
      { params: Promise.resolve({ id: "intent_1", exportId: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("EXPORT_NOT_FOUND");
  });
});
