import json
from datetime import datetime, timezone
from uuid import uuid4


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _table_columns(connection, table_name):
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


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


def upsert_bid(connection, bid):
    existing = connection.execute(
        "SELECT id FROM bids WHERE dedupe_key = ?",
        (bid["dedupe_key"],),
    ).fetchone()
    table_columns = _table_columns(connection, "bids")

    if existing:
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
                "last_seen_at",
                "updated_at",
            )
            if column in table_columns and column in bid
        ]
        assignments = ", ".join(f"{column} = ?" for column in update_columns)
        connection.execute(
            f"UPDATE bids SET {assignments} WHERE dedupe_key = ?",
            tuple(_sqlite_value(bid[column]) for column in update_columns) + (bid["dedupe_key"],),
        )
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
            "first_seen_at",
            "last_seen_at",
            "created_at",
            "updated_at",
        )
        if column in table_columns and column in bid
    }
    _execute_insert(connection, "bids", insert_values)
    connection.commit()
    return "inserted"


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
