"""BigQuery audit logging and event caching."""
import os
import logging
from datetime import datetime, timezone
from google.cloud import bigquery
from google.adk.tools.tool_context import ToolContext

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT")
DATASET = "stargazer_db"

_client = None


def _get_client():
    """Lazy-init BigQuery client so import doesn't crash without credentials."""
    global _client
    if _client is None:
        try:
            _client = bigquery.Client(project=PROJECT_ID)
        except Exception as e:
            logging.error(f"[BigQuery] Client init failed: {e}")
            return None
    return _client


def log_event_to_bq(
    tool_context: ToolContext,
    event_type: str,
    event_name: str,
    event_time: str,
    location: str = "",
    weather_status: str = "PENDING",
    calendar_event_id: str = ""
) -> dict:
    """
    Logs a space event interaction to BigQuery for auditing.
    event_type: one of 'ISS', 'LAUNCH', 'METEOR_SHOWER', 'ECLIPSE', 'FULL_MOON'
    event_time: ISO 8601 string e.g. '2025-11-13T02:30:00Z'
    """
    try:
        client = _get_client()
        if client is None:
            return {"status": "skipped", "reason": "BigQuery client not available"}

        user_id = tool_context.state.get("USER_ID", "anonymous")
        request = tool_context.state.get("USER_REQUEST", "")

        rows = [{
            "user_id": user_id,
            "request": request,
            "event_type": event_type,
            "event_name": event_name,
            "event_time": event_time,
            "location": location,
            "weather_status": weather_status,
            "calendar_event_id": calendar_event_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        }]

        table_id = f"{PROJECT_ID}.{DATASET}.event_log"
        errors = client.insert_rows_json(table_id, rows)
        if errors:
            logging.error(f"BigQuery insert errors: {errors}")
            return {"status": "error", "details": str(errors)}

        logging.info(f"[BigQuery] Logged event: {event_type} - {event_name}")
        return {"status": "success"}
    except Exception as e:
        logging.error(f"[BigQuery] log_event error: {e}")
        return {"status": "error", "details": str(e)}


def cache_space_events_to_bq(
    tool_context: ToolContext,
    events: list
) -> dict:
    """
    Caches fetched space events into BigQuery to avoid re-fetching.
    events: list of dicts with keys: event_type, event_name, event_time, details
    """
    try:
        client = _get_client()
        if client is None:
            return {"status": "skipped", "reason": "BigQuery client not available"}

        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for e in events:
            rows.append({
                "event_type": e.get("event_type", ""),
                "event_name": e.get("event_name", ""),
                "event_time": e.get("event_time", ""),
                "details": str(e.get("details", "")),
                "cached_at": now
            })

        table_id = f"{PROJECT_ID}.{DATASET}.space_events"
        errors = client.insert_rows_json(table_id, rows)
        if errors:
            return {"status": "error", "details": str(errors)}
        return {"status": "success", "cached": len(rows)}
    except Exception as e:
        return {"status": "error", "details": str(e)}
