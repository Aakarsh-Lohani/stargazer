"""
Google Calendar integration for scheduling stargazing events.
Uses OAuth 2.0 with refresh token stored in environment / Secret Manager.
GRACEFULLY DISABLED when credentials are not provided.
"""
import os
import logging
from datetime import datetime, timezone, timedelta
from google.adk.tools.tool_context import ToolContext

CALENDAR_ID = os.getenv("CALENDAR_ID", "primary")
CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
REFRESH_TOKEN = os.getenv("GOOGLE_CALENDAR_REFRESH_TOKEN")
TOKEN_URI = "https://oauth2.googleapis.com/token"
SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _is_calendar_configured() -> bool:
    """Check if Calendar OAuth credentials are available."""
    return all([CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN])


def _get_calendar_service():
    """Build and return an authenticated Google Calendar service."""
    if not _is_calendar_configured():
        return None

    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,
        refresh_token=REFRESH_TOKEN,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        token_uri=TOKEN_URI,
        scopes=SCOPES
    )
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def create_stargazing_calendar_event(
    tool_context: ToolContext,
    event_title: str,
    event_description: str,
    start_time_utc: str,
    duration_minutes: int = 60,
    location_name: str = "",
    location_address: str = "",
    maps_link: str = ""
) -> dict:
    """
    Creates a Google Calendar event for a stargazing opportunity.
    start_time_utc: ISO 8601 e.g. '2025-11-17T22:00:00Z'
    duration_minutes: length of the observation window
    location_name: e.g. 'Ranthambore Dark Sky Reserve'
    event_description: Mission brief with what to bring, settings, etc.
    Returns success with event link, or graceful message if Calendar not configured.
    """
    try:
        if not _is_calendar_configured():
            logging.info("[Calendar] Not configured — skipping event creation.")
            return {
                "status": "skipped",
                "reason": "Google Calendar credentials not configured. "
                          "Event details are still available in the mission brief above.",
                "event_title": event_title,
                "start_time_utc": start_time_utc,
                "duration_minutes": duration_minutes,
                "location": location_name
            }

        service = _get_calendar_service()

        start_dt = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
        end_dt = start_dt + timedelta(minutes=duration_minutes)

        # Build mission brief in description
        full_description = f"""{event_description}

📍 LOCATION: {location_name}
{f'Address: {location_address}' if location_address else ''}
{f'Maps: {maps_link}' if maps_link else ''}

🔭 STARGAZER MISSION BRIEF:
• Arrive 30 minutes before start to let eyes adjust to darkness
• Bring: red flashlight, warm clothing, binoculars or telescope
• Camera settings: ISO 800-3200, aperture f/2.8 or wider, 15-25s exposure
• Avoid phone screens — they destroy night vision
• Check weather one hour before heading out

🤖 Scheduled by StarGazer AI Assistant"""

        event_body = {
            "summary": f"⭐ {event_title}",
            "description": full_description,
            "location": f"{location_name}, {location_address}".strip(", "),
            "start": {
                "dateTime": start_dt.isoformat(),
                "timeZone": "UTC"
            },
            "end": {
                "dateTime": end_dt.isoformat(),
                "timeZone": "UTC"
            },
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "popup", "minutes": 60},
                    {"method": "email", "minutes": 1440}  # 24h before
                ]
            },
            "colorId": "9"  # Blueberry color
        }

        created_event = service.events().insert(
            calendarId=CALENDAR_ID,
            body=event_body
        ).execute()

        event_id = created_event.get("id")
        event_link = created_event.get("htmlLink")

        tool_context.state["CALENDAR_EVENT_ID"] = event_id
        tool_context.state["CALENDAR_EVENT_LINK"] = event_link

        logging.info(f"[Calendar] Event created: {event_title} → {event_link}")
        return {
            "status": "success",
            "event_id": event_id,
            "event_link": event_link,
            "event_title": event_title,
            "start_utc": start_time_utc,
            "duration_minutes": duration_minutes,
            "location": location_name
        }

    except Exception as e:
        logging.error(f"[Calendar] create_event error: {e}")
        return {"status": "error", "details": str(e)}


def list_upcoming_stargazer_events(tool_context: ToolContext) -> dict:
    """Lists all upcoming StarGazer events on the user's calendar."""
    try:
        if not _is_calendar_configured():
            return {
                "status": "skipped",
                "reason": "Google Calendar not configured.",
                "events": [],
                "count": 0
            }

        service = _get_calendar_service()
        now = datetime.now(timezone.utc).isoformat()

        events_result = service.events().list(
            calendarId=CALENDAR_ID,
            timeMin=now,
            maxResults=10,
            singleEvents=True,
            orderBy="startTime",
            q="StarGazer"
        ).execute()

        events = events_result.get("items", [])
        result = []
        for event in events:
            result.append({
                "title": event.get("summary", ""),
                "start": event.get("start", {}).get("dateTime", ""),
                "location": event.get("location", ""),
                "link": event.get("htmlLink", "")
            })

        return {"events": result, "count": len(result)}
    except Exception as e:
        return {"error": str(e)}
