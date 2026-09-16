import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { looksLikeHtml, probeArchivedAttachment } from "./verify";

let root: string;
const previousDir = process.env.CRAWLER_ATTACHMENT_DIR;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "apsi-attachments-"));
  process.env.CRAWLER_ATTACHMENT_DIR = root;
});

afterEach(async () => {
  if (previousDir === undefined) delete process.env.CRAWLER_ATTACHMENT_DIR;
  else process.env.CRAWLER_ATTACHMENT_DIR = previousDir;
  await rm(root, { recursive: true, force: true });
});

async function writeArchived(relative: string, contents: string) {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
  return absolute;
}

describe("looksLikeHtml", () => {
  it("tolerates leading whitespace and a BOM", () => {
    expect(looksLikeHtml(Buffer.from("<!DOCTYPE html><html></html>"))).toBe(true);
    expect(looksLikeHtml(Buffer.from("\n\n  <html>"))).toBe(true);
    expect(looksLikeHtml(Buffer.from("﻿<!doctype html>"))).toBe(true);
    expect(looksLikeHtml(Buffer.from("%PDF-1.7\n"))).toBe(false);
    expect(looksLikeHtml(Buffer.from("name,amount\n1,2\n"))).toBe(false);
  });
});

describe("probeArchivedAttachment", () => {
  it("returns a missing probe for empty or unresolvable paths", async () => {
    expect(await probeArchivedAttachment(null)).toMatchObject({ resolvedPath: null });
    expect(await probeArchivedAttachment("   ")).toMatchObject({ resolvedPath: null });
    expect(await probeArchivedAttachment("missouri/nope.pdf")).toMatchObject({
      resolvedPath: null,
      storagePathIsAbsolute: false,
    });
  });

  it("hashes a relative archived file and reports it as portable", async () => {
    await writeArchived("missouri/doc.pdf", "%PDF-1.7 hello");

    const probe = await probeArchivedAttachment("missouri/doc.pdf");

    expect(probe.byteSize).toBe(14);
    expect(probe.checksumSha256).toBe(createHash("sha256").update("%PDF-1.7 hello").digest("hex"));
    expect(probe.looksLikeHtml).toBe(false);
    expect(probe.storagePathIsAbsolute).toBe(false);
    expect(probe.relativePath).toBe("missouri/doc.pdf");
  });

  it("flags an absolute path and reports the portable relative form", async () => {
    const absolute = await writeArchived("missouri/doc.pdf", "%PDF-1.7 hello");

    const probe = await probeArchivedAttachment(absolute);

    expect(probe.storagePathIsAbsolute).toBe(true);
    expect(probe.relativePath).toBe("missouri/doc.pdf");
  });

  it("detects an HTML error page saved under a .pdf name", async () => {
    await writeArchived("illinois/doc.pdf", "<!DOCTYPE html><html>ERROR IN ... session</html>");

    expect((await probeArchivedAttachment("illinois/doc.pdf")).looksLikeHtml).toBe(true);
  });

  it("reports a zero-byte archive", async () => {
    await writeArchived("missouri/empty.pdf", "");

    const probe = await probeArchivedAttachment("missouri/empty.pdf");
    expect(probe.byteSize).toBe(0);
    expect(probe.resolvedPath).not.toBeNull();
  });

  it("refuses a path outside the allowed roots", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "apsi-outside-"));
    try {
      const file = path.join(outside, "doc.pdf");
      await writeFile(file, "%PDF-1.7");
      expect(await probeArchivedAttachment(file)).toMatchObject({ resolvedPath: null, storagePathIsAbsolute: true });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
