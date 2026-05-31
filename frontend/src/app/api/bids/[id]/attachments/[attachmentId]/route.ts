import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getBidAttachmentDownload, type BidAttachmentDownload } from "@/server/bids/attachments";
import { db } from "@/server/db/client";

interface RouteContext {
  params: Promise<{ id: string; attachmentId: string }>;
}

function notFound() {
  return NextResponse.json(
    { error: { code: "ATTACHMENT_NOT_FOUND", message: "Attachment not found" } },
    { status: 404 },
  );
}

function contentDisposition(filename: string) {
  return `attachment; filename="${filename.replace(/["\\]/g, "_")}"`;
}

function downloadNoteFilename(filename: string) {
  const withoutExtension = filename.replace(/\.[^/.]+$/, "");
  const base = withoutExtension.trim() || "attachment";

  return `${base}-download-note.txt`;
}

function fallbackText(attachment: BidAttachmentDownload, reason: string) {
  return [
    "WinBids attachment download note",
    "",
    `Attachment: ${attachment.filename}`,
    `Archive status: ${attachment.archiveStatus}`,
    `Reason: ${reason}`,
    attachment.archiveError ? `Archive error: ${attachment.archiveError}` : null,
    `Original URL: ${attachment.originalUrl}`,
    "",
    "This note is served by WinBids so users are not sent directly to a broken external attachment link.",
  ].filter(Boolean).join("\n");
}

function fallbackResponse(attachment: BidAttachmentDownload, reason: string) {
  return new Response(fallbackText(attachment, reason), {
    headers: {
      "Content-Disposition": contentDisposition(downloadNoteFilename(attachment.filename)),
      "Content-Type": "text/plain; charset=utf-8",
      "X-WinBids-Original-Url": attachment.originalUrl,
    },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const { id, attachmentId } = await context.params;
  const attachment = await getBidAttachmentDownload(db, id, attachmentId);

  if (!attachment) {
    return notFound();
  }

  if (attachment.kind === "fallback") {
    return fallbackResponse(attachment, attachment.reason);
  }

  const content = await readFile(attachment.filePath).catch(() => undefined);
  if (!content) {
    return fallbackResponse(attachment, "The archived attachment file is no longer available on disk.");
  }

  return new Response(content, {
    headers: {
      "Content-Disposition": contentDisposition(attachment.filename),
      "Content-Type": attachment.mimeType ?? "application/octet-stream",
    },
  });
}
