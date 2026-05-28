import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getLocalBidAttachment } from "@/server/bids/attachments";
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

export async function GET(_request: Request, context: RouteContext) {
  const { id, attachmentId } = await context.params;
  const attachment = await getLocalBidAttachment(db, id, attachmentId);

  if (!attachment) {
    return notFound();
  }

  const content = await readFile(attachment.filePath).catch(() => undefined);
  if (!content) {
    return notFound();
  }

  return new Response(content, {
    headers: {
      "Content-Disposition": contentDisposition(attachment.filename),
      "Content-Type": attachment.mimeType ?? "application/octet-stream",
    },
  });
}
