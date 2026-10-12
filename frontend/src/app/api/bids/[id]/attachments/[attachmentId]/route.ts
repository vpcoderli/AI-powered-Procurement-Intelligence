import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getBidAttachmentDownload, type BidAttachmentDownload } from "@/server/bids/attachments";
import { getBidById } from "@/server/bids/service";
import { looksLikeHtml } from "@/server/attachments/verify";
import { db } from "@/server/db/client";

interface RouteContext {
  params: Promise<{ id: string; attachmentId: string }>;
}

function notFound() {
  return NextResponse.json(
    {
      error: {
        code: "ATTACHMENT_NOT_FOUND",
        message: "Attachment record not found; no archived file or source download note is available.",
      },
    },
    { status: 404, headers: { "X-WinBids-Attachment-Availability": "missing" } },
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

type NoteAvailability = "source_download_note" | "archive_missing" | "archive_failed";
type NoteKind = "source_download_note" | "archive_status_note";

function fallbackTitle(availability: NoteAvailability) {
  return availability === "source_download_note"
    ? "WinBids source attachment download note"
    : "WinBids archived attachment status note";
}

function fallbackStatusLine(availability: NoteAvailability) {
  if (availability === "archive_missing") return "Archived file unavailable";
  if (availability === "archive_failed") return "Archive failed";
  return "Source download note";
}

function fallbackExplanation(availability: NoteAvailability) {
  if (availability === "source_download_note") {
    return [
      "This is a source download note, not an archived local file.",
      "External source availability is not guaranteed.",
    ];
  }

  return [
    "The archived file cannot be opened from local storage.",
    "This status note explains the archive problem and preserves the original source URL.",
    "External source availability is not guaranteed.",
  ];
}

function fallbackText(attachment: BidAttachmentDownload, reason: string, availability: NoteAvailability) {
  return [
    fallbackTitle(availability),
    "",
    `Attachment: ${attachment.filename}`,
    `Status: ${fallbackStatusLine(availability)}`,
    `Archive status: ${attachment.archiveStatus}`,
    `Reason: ${reason}`,
    attachment.archiveError ? `Archive error: ${attachment.archiveError}` : null,
    `Original URL: ${attachment.originalUrl}`,
    "",
    ...fallbackExplanation(availability),
  ].filter(Boolean).join("\n");
}

function fallbackResponse(
  attachment: BidAttachmentDownload,
  reason: string,
  availability: NoteAvailability,
  noteKind: NoteKind,
) {
  return new Response(fallbackText(attachment, reason, availability), {
    headers: {
      "Content-Disposition": contentDisposition(downloadNoteFilename(attachment.filename)),
      "Content-Type": "text/plain; charset=utf-8",
      "X-WinBids-Attachment-Availability": availability,
      "X-WinBids-Download-Kind": noteKind,
      "X-WinBids-Original-Url": attachment.originalUrl,
    },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const { id, attachmentId } = await context.params;
  if (!(await getBidById(id))) return notFound();
  const attachment = await getBidAttachmentDownload(db, id, attachmentId);

  if (!attachment) {
    return notFound();
  }

  if (attachment.kind === "fallback") {
    return fallbackResponse(attachment, attachment.reason, attachment.availability, attachment.noteKind);
  }

  const content = await readFile(attachment.filePath).catch(() => undefined);
  if (!content) {
    return fallbackResponse(
      attachment,
      "Archived file unavailable: the archived attachment file is no longer available on disk.",
      "archive_missing",
      "archive_status_note",
    );
  }

  const checksum = createHash("sha256").update(content).digest("hex");
  const isInvalid = content.byteLength === 0 || looksLikeHtml(content)
    || /text\/html|application\/xhtml/i.test(attachment.mimeType ?? "")
    || (attachment.archiveStatus === "archived" && (
      !/^[a-f\d]{64}$/i.test(attachment.checksumSha256 ?? "")
      || checksum !== attachment.checksumSha256?.toLowerCase()
      || (attachment.byteSize != null && attachment.byteSize !== content.byteLength)
      || (attachment.mimeType === "application/pdf" && !content.subarray(0, 4).equals(Buffer.from("%PDF")))
      || (/application\/(?:zip|vnd\.openxmlformats-officedocument\.)/i.test(attachment.mimeType ?? "")
        && !["504b0304", "504b0506", "504b0708"].includes(content.subarray(0, 4).toString("hex")))
      || (/^application\/(?:msword|vnd\.ms-excel|vnd\.ms-powerpoint)$/i.test(attachment.mimeType ?? "")
        && content.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1")
    ));
  if (isInvalid) {
    return fallbackResponse(attachment, "Archived file failed content verification (type, size or checksum).", "archive_failed", "archive_status_note");
  }

  return new Response(content, {
    headers: {
      "Content-Disposition": contentDisposition(attachment.filename),
      "Content-Type": attachment.mimeType ?? "application/octet-stream",
      "X-WinBids-Attachment-Availability": attachment.availability,
      "X-WinBids-Download-Kind": attachment.downloadKind,
    },
  });
}
