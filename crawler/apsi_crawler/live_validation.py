from dataclasses import dataclass

from apsi_crawler.sources.registry import get_live_fetcher, get_source


BETA_DEDICATED_STATE_SOURCES = (
    "pa_state_procurement",
    "sc_state_procurement",
    "or_state_procurement",
    "ma_state_procurement",
    "nj_state_procurement",
    "oh_state_procurement",
    "va_state_procurement",
    "wa_state_procurement",
)


class EmptyCrawlerResultError(Exception):
    pass


class LiveValidationError(Exception):
    pass


@dataclass(frozen=True)
class SourceValidationResult:
    source: str
    status: str
    fetched_count: int
    error_code: str = None
    error_message: str = None


@dataclass(frozen=True)
class LiveValidationResult:
    ok: bool
    sources: list


def _clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _validate_bid_content(source_id, bid, index):
    if not _clean_text(bid.get("source_bid_id")):
        raise LiveValidationError(f"{source_id} returned bid {index} without source_bid_id")
    if not _clean_text(bid.get("title")):
        raise LiveValidationError(f"{source_id} returned bid {index} without title")
    if not _clean_text(bid.get("source_url")):
        raise LiveValidationError(f"{source_id} returned bid {index} without source_url")


def _validate_non_empty_bids(source_id, bids):
    if not bids:
        raise EmptyCrawlerResultError(
            f"Crawler returned no opportunities for source: {source_id}"
        )

    for index, bid in enumerate(bids, start=1):
        _validate_bid_content(source_id, bid, index)


def validate_state_live_sources(
    source_ids=None,
    query=None,
    limit=25,
    timeout=30,
    get_live_fetcher_fn=get_live_fetcher,
):
    selected_source_ids = tuple(source_ids or BETA_DEDICATED_STATE_SOURCES)
    results = []

    for source_id in selected_source_ids:
        try:
            source = get_source(source_id)
            fetcher = get_live_fetcher_fn(source_id)
            bids = fetcher(source, query=query, limit=limit, timeout=timeout)
            _validate_non_empty_bids(source.id, bids)
            results.append(
                SourceValidationResult(
                    source=source.id,
                    status="success",
                    fetched_count=len(bids),
                )
            )
        except Exception as error:
            results.append(
                SourceValidationResult(
                    source=source_id,
                    status="failure",
                    fetched_count=0,
                    error_code=type(error).__name__,
                    error_message=str(error),
                )
            )

    return LiveValidationResult(
        ok=all(result.status == "success" for result in results),
        sources=results,
    )
