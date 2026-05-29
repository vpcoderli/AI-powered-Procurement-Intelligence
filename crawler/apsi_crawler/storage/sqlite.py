import json
from datetime import datetime, timezone
from uuid import uuid4


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _table_columns(connection, table_name):
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def _table_exists(connection, table_name):
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _sqlite_value(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"), sort_keys=True)
    return value


def _execute_insert(connection, table_name, values):
    columns = list(values.keys())
    placeholders = ", ".join("?" for _ in columns)
    quoted_columns = ", ".join(columns)
    connection.execute(
        f"INSERT INTO {table_name} ({quoted_columns}) VALUES ({placeholders})",
        tuple(_sqlite_value(values[column]) for column in columns),
    )


ARCHIVE_ATTACHMENT_COLUMNS = (
    "original_url",
    "storage_path",
    "byte_size",
    "content_type",
    "checksum_sha256",
    "fetched_at",
    "archive_status",
)

ARCHIVE_BID_COLUMNS = (
    "detail_archive_status",
    "detail_archive_path",
    "detail_fetched_at",
    "detail_checksum_sha256",
)


def _row_dict(cursor, row):
    if row is None:
        return None
    return {description[0]: row[index] for index, description in enumerate(cursor.description)}


def _existing_bid_archive_values(connection, bid_id, table_columns):
    columns = [column for column in ARCHIVE_BID_COLUMNS if column in table_columns]
    if not columns:
        return {}
    cursor = connection.execute(
        f"SELECT {', '.join(columns)} FROM bids WHERE id = ?",
        (bid_id,),
    )
    return _row_dict(cursor, cursor.fetchone()) or {}


def _existing_attachment_archive_values(connection, bid_id, table_columns):
    columns = ["id", "url", *[column for column in ARCHIVE_ATTACHMENT_COLUMNS if column in table_columns]]
    cursor = connection.execute(
        f"SELECT {', '.join(columns)} FROM bid_attachments WHERE bid_id = ?",
        (bid_id,),
    )
    rows = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {
        row["url"]: row
        for row in rows
        if row and row.get("url")
    }


def _preserve_existing_archive_value(values, existing, column):
    if column not in values or not existing:
        return
    incoming = values.get(column)
    current = existing.get(column)
    if current is None:
        return
    if incoming is None or incoming == "" or (column.endswith("archive_status") and incoming == "not_archived"):
        values[column] = current


def _replace_bid_attachments(connection, bid):
    if not _table_exists(connection, "bid_attachments"):
        return

    table_columns = _table_columns(connection, "bid_attachments")
    bid_id = bid["id"]
    existing_archive_values = _existing_attachment_archive_values(
        connection,
        bid_id,
        table_columns,
    )
    connection.execute("DELETE FROM bid_attachments WHERE bid_id = ?", (bid_id,))

    for index, attachment in enumerate(bid.get("attachments") or []):
        url = attachment.get("url")
        if not url:
            raise ValueError("Bid attachment is missing url")
        values = {
            "id": f"{bid_id}:attachment:{index + 1}",
            "bid_id": bid_id,
            "name": attachment.get("name") or f"Attachment {index + 1}",
            "url": url,
            "size_label": attachment.get("size_label"),
            "mime_type": attachment.get("mime_type"),
            "original_url": attachment.get("original_url") or url,
            "storage_path": attachment.get("storage_path"),
            "byte_size": attachment.get("byte_size"),
            "content_type": attachment.get("content_type") or attachment.get("mime_type"),
            "checksum_sha256": attachment.get("checksum_sha256"),
            "fetched_at": attachment.get("fetched_at"),
            "archive_status": attachment.get("archive_status") or "not_archived",
            "sort_order": (
                index
                if attachment.get("sort_order") is None
                else attachment.get("sort_order")
            ),
            "created_at": now_iso(),
        }
        existing = existing_archive_values.get(url)
        for column in ARCHIVE_ATTACHMENT_COLUMNS:
            _preserve_existing_archive_value(values, existing, column)
        _execute_insert(
            connection,
            "bid_attachments",
            {column: value for column, value in values.items() if column in table_columns},
        )


def upsert_bid(connection, bid):
    existing = connection.execute(
        "SELECT id FROM bids WHERE dedupe_key = ?",
        (bid["dedupe_key"],),
    ).fetchone()
    table_columns = _table_columns(connection, "bids")

    try:
        if existing:
            existing_archive_values = _existing_bid_archive_values(
                connection,
                existing[0],
                table_columns,
            )
            for column in ARCHIVE_BID_COLUMNS:
                _preserve_existing_archive_value(bid, existing_archive_values, column)
            update_columns = [
                column
                for column in (
                    "source_bid_id",
                    "title",
                    "description",
                    "full_description",
                    "original_category",
                    "amount",
                    "amount_min",
                    "amount_max",
                    "currency",
                    "published_date",
                    "deadline_date",
                    "issuer_name",
                    "issuer_type",
                    "state_code",
                    "contact_name",
                    "contact_email",
                    "contact_phone",
                    "source_url",
                    "is_active",
                    "raw_payload",
                    "source_confidence",
                    "quality_flags_json",
                    "admin_review_status",
                    "detail_archive_status",
                    "detail_archive_path",
                    "detail_fetched_at",
                    "detail_checksum_sha256",
                    "last_seen_at",
                    "updated_at",
                )
                if column in table_columns and column in bid
            ]
            assignments = ", ".join(f"{column} = ?" for column in update_columns)
            connection.execute(
                f"UPDATE bids SET {assignments} WHERE dedupe_key = ?",
                tuple(_sqlite_value(bid[column]) for column in update_columns)
                + (bid["dedupe_key"],),
            )
            _replace_bid_attachments(connection, {**bid, "id": existing[0]})
            connection.commit()
            return "updated"

        insert_values = {
            column: bid[column]
            for column in (
                "id",
                "source",
                "source_bid_id",
                "dedupe_key",
                "title",
                "description",
                "full_description",
                "original_category",
                "amount",
                "amount_min",
                "amount_max",
                "currency",
                "published_date",
                "deadline_date",
                "issuer_name",
                "issuer_type",
                "state_code",
                "contact_name",
                "contact_email",
                "contact_phone",
                "source_url",
                "is_active",
                "raw_payload",
                "source_confidence",
                "quality_flags_json",
                "admin_review_status",
                "detail_archive_status",
                "detail_archive_path",
                "detail_fetched_at",
                "detail_checksum_sha256",
                "first_seen_at",
                "last_seen_at",
                "created_at",
                "updated_at",
            )
            if column in table_columns and column in bid
        }
        _execute_insert(connection, "bids", insert_values)
        _replace_bid_attachments(connection, bid)
        connection.commit()
        return "inserted"
    except Exception:
        connection.rollback()
        raise


def write_crawler_log(
    connection,
    source,
    run_id,
    status,
    fetched_count,
    inserted_count,
    updated_count,
    skipped_count=0,
    failed_count=0,
    started_at=None,
    finished_at=None,
    duration_ms=None,
    error_code=None,
    error_message=None,
    error_stack=None,
    metadata=None,
):
    timestamp = started_at or now_iso()
    table_columns = _table_columns(connection, "crawler_logs")
    values = {
        "id": str(uuid4()),
        "source": source,
        "run_id": run_id,
        "status": status,
        "started_at": timestamp,
        "finished_at": finished_at,
        "duration_ms": duration_ms,
        "fetched_count": fetched_count,
        "inserted_count": inserted_count,
        "updated_count": updated_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "error_code": error_code,
        "error_message": error_message,
        "error_stack": error_stack,
        "metadata": metadata,
    }
    _execute_insert(
        connection,
        "crawler_logs",
        {column: value for column, value in values.items() if column in table_columns},
    )
    connection.commit()
