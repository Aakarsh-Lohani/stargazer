"""
Space data tools — ALL REAL-TIME from live APIs.
No hardcoded data. Every query hits live endpoints.

API Sources:
  - ISS Position:     WhereTheISS.at (free, no key)
  - ISS Visual Passes: N2YO.com (free, needs API key — 300 requests/hour)
  - Launches:         Launch Library 2 / The Space Devs (free, 15 req/hour)
  - Space Events:     The Space Devs Events API (free, 15 req/hour)
  - Moon Phases:      US Naval Observatory API (free, no key)
  - NASA APOD/NEO:    NASA Open APIs (free, needs API key — DEMO_KEY available)
"""
import os
import math
import requests
import logging
from datetime import datetime, timezone, timedelta
from google.adk.tools.tool_context import ToolContext

# ─── API Configuration ───────────────────────────────────────────────
WHERETHEISS_BASE = "https://api.wheretheiss.at/v1/satellites/25544"
LAUNCH_LIBRARY_BASE = "https://ll.thespacedevs.com/2.3.0"
USNO_API_BASE = "https://aa.usno.navy.mil/api"
NASA_API_BASE = "https://api.nasa.gov"
N2YO_API_BASE = "https://api.n2yo.com/rest/v1/satellite"

# API Keys (N2YO and NASA need keys, everything else is free)
N2YO_API_KEY = os.getenv("N2YO_API_KEY", "")
NASA_API_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")

HEADERS = {"User-Agent": "StarGazer-App/1.0 (hackathon-project)"}


# ═══════════════════════════════════════════════════════════════════════
# 1. ISS — REAL-TIME TRACKING (WhereTheISS.at — No API key needed)
# ═══════════════════════════════════════════════════════════════════════

def get_iss_current_position(tool_context: ToolContext) -> dict:
    """
    Returns the current real-time position of the ISS.
    Data source: WhereTheISS.at API (live, no key required).
    Returns: latitude, longitude, altitude (km), velocity (km/h), visibility.
    """
    try:
        resp = requests.get(WHERETHEISS_BASE, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        result = {
            "latitude": round(data["latitude"], 4),
            "longitude": round(data["longitude"], 4),
            "altitude_km": round(data["altitude"], 2),
            "velocity_kph": round(data["velocity"], 2),
            "visibility": data["visibility"],
            "footprint_km": round(data.get("footprint", 0), 2),
            "timestamp": datetime.fromtimestamp(data["timestamp"], tz=timezone.utc).isoformat(),
            "data_source": "WhereTheISS.at (live)"
        }
        tool_context.state["ISS_POSITION"] = result
        logging.info(f"[ISS] Live position: lat={result['latitude']}, lon={result['longitude']}")
        return result
    except Exception as e:
        logging.error(f"[ISS] get_iss_current_position error: {e}")
        return {"error": str(e)}


# ═══════════════════════════════════════════════════════════════════════
# 2. ISS VISUAL PASSES — N2YO.com API (needs free API key)
# ═══════════════════════════════════════════════════════════════════════

def get_iss_passes_for_location(
    tool_context: ToolContext,
    latitude: float,
    longitude: float,
    days: int = 5,
    min_visibility_seconds: int = 60
) -> dict:
    """
    Returns upcoming ISS visible passes over a given location.
    Uses N2YO.com Visual Passes API for accurate predictions with magnitude and direction.
    Falls back to WhereTheISS.at proximity estimation if N2YO key not available.
    latitude: float e.g. 37.7749 for San Francisco, or 19.0760 for Mumbai
    longitude: float e.g. -122.4194, or 72.8777
    days: how many days ahead to search (max 10)
    min_visibility_seconds: minimum pass duration to include (default 60s)
    """
    # Try N2YO first (best data — includes magnitude, direction, elevation)
    if N2YO_API_KEY:
        try:
            # N2YO Visual Passes: /visualpasses/{id}/{observer_lat}/{observer_lng}/{observer_alt}/{days}/{min_visibility}
            url = f"{N2YO_API_BASE}/visualpasses/25544/{latitude}/{longitude}/0/{days}/{min_visibility_seconds}"
            params = {"apiKey": N2YO_API_KEY}
            resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            passes = []
            for p in data.get("passes", []):
                passes.append({
                    "start_utc": datetime.fromtimestamp(p["startUTC"], tz=timezone.utc).isoformat(),
                    "end_utc": datetime.fromtimestamp(p["endUTC"], tz=timezone.utc).isoformat(),
                    "max_elevation_deg": p.get("maxEl", 0),
                    "start_direction": p.get("startAzCompass", ""),
                    "end_direction": p.get("endAzCompass", ""),
                    "magnitude": p.get("mag", None),
                    "duration_seconds": p.get("duration", 0),
                    "peak_utc": datetime.fromtimestamp(p.get("maxUTC", p["startUTC"]), tz=timezone.utc).isoformat(),
                    "peak_direction": p.get("maxAzCompass", ""),
                })

            tool_context.state["ISS_PASSES"] = passes[:5]
            logging.info(f"[ISS/N2YO] Found {len(passes)} visual passes for ({latitude}, {longitude})")
            return {
                "location": {"latitude": latitude, "longitude": longitude},
                "passes_found": len(passes),
                "next_passes": passes[:5],
                "data_source": "N2YO.com Visual Passes API (live)",
                "note": "Magnitude < -2 means very bright (easy to see). Direction tells you where to look."
            }
        except Exception as e:
            logging.warning(f"[ISS/N2YO] N2YO failed, falling back to WhereTheISS: {e}")

    # Fallback: WhereTheISS.at proximity estimation
    try:
        timestamps = []
        now_ts = int(datetime.now(timezone.utc).timestamp())
        for i in range(0, min(days, 5) * 24 * 3600, 300):
            timestamps.append(str(now_ts + i))

        passes = []
        batch_size = 10
        prev_visible = False
        pass_start = None

        for i in range(0, min(len(timestamps), 100), batch_size):
            batch = timestamps[i:i + batch_size]
            url = f"{WHERETHEISS_BASE}/positions?timestamps={','.join(batch)}&units=miles"
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code != 200:
                break
            positions = resp.json()

            for pos in positions:
                iss_lat = pos["latitude"]
                iss_lon = pos["longitude"]

                dlat = math.radians(iss_lat - latitude)
                dlon = math.radians(iss_lon - longitude)
                a = (math.sin(dlat / 2) ** 2 +
                     math.cos(math.radians(latitude)) *
                     math.cos(math.radians(iss_lat)) *
                     math.sin(dlon / 2) ** 2)
                dist_km = 2 * math.asin(math.sqrt(a)) * 6371

                is_visible = dist_km < 2000

                if is_visible and not prev_visible:
                    pass_start = pos["timestamp"]
                elif not is_visible and prev_visible and pass_start:
                    passes.append({
                        "start_utc": datetime.fromtimestamp(pass_start, tz=timezone.utc).isoformat(),
                        "end_utc": datetime.fromtimestamp(pos["timestamp"], tz=timezone.utc).isoformat(),
                        "iss_lat": iss_lat,
                        "iss_lon": iss_lon
                    })

                prev_visible = is_visible

        tool_context.state["ISS_PASSES"] = passes[:5]
        return {
            "location": {"latitude": latitude, "longitude": longitude},
            "passes_found": len(passes),
            "next_passes": passes[:5],
            "data_source": "WhereTheISS.at proximity estimation (live)",
            "note": "For more accurate passes with direction/magnitude, add N2YO_API_KEY."
        }
    except Exception as e:
        logging.error(f"[ISS] get_iss_passes error: {e}")
        return {"error": str(e)}


# ═══════════════════════════════════════════════════════════════════════
# 3. LAUNCHES — Launch Library 2 / The Space Devs (No key, live data)
#    Includes SpaceX, ISRO, NASA Artemis, Roscosmos, etc.
# ═══════════════════════════════════════════════════════════════════════

def get_upcoming_launches(
    tool_context: ToolContext,
    limit: int = 5,
    search: str = ""
) -> dict:
    """
    Returns upcoming rocket launches from Launch Library 2 (The Space Devs).
    REAL-TIME data — includes SpaceX, ISRO, NASA Artemis, Roscosmos, and all providers.
    limit: number of launches to return (default 5)
    search: optional search term e.g. 'artemis', 'isro', 'spacex', 'falcon'
    """
    try:
        url = f"{LAUNCH_LIBRARY_BASE}/launches/upcoming/"
        params = {
            "limit": limit,
            "ordering": "net",
            "mode": "detailed"
        }
        if search:
            params["search"] = search

        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        launches = []
        for launch in data.get("results", []):
            image_url = ""
            if launch.get("image"):
                image_url = launch["image"].get("image_url", "") if isinstance(launch["image"], dict) else launch["image"]

            launches.append({
                "name": launch.get("name", ""),
                "launch_time_utc": launch.get("net", ""),
                "status": launch.get("status", {}).get("name", ""),
                "status_description": launch.get("status", {}).get("description", ""),
                "rocket": launch.get("rocket", {}).get("configuration", {}).get("name", ""),
                "provider": launch.get("launch_service_provider", {}).get("name", ""),
                "provider_country": launch.get("launch_service_provider", {}).get("country", {}).get("name", "") if isinstance(launch.get("launch_service_provider", {}).get("country"), dict) else "",
                "mission": launch.get("mission", {}).get("name", "") if launch.get("mission") else "",
                "mission_description": (launch.get("mission") or {}).get("description", "")[:300],
                "orbit": (launch.get("mission") or {}).get("orbit", {}).get("name", "") if isinstance((launch.get("mission") or {}).get("orbit"), dict) else "",
                "pad_name": launch.get("pad", {}).get("name", ""),
                "pad_location": launch.get("pad", {}).get("location", {}).get("name", ""),
                "pad_latitude": launch.get("pad", {}).get("latitude", ""),
                "pad_longitude": launch.get("pad", {}).get("longitude", ""),
                "image_url": image_url,
                "is_artemis": "artemis" in launch.get("name", "").lower(),
                "is_isro": launch.get("launch_service_provider", {}).get("name", "").lower() in ["indian space research organization", "isro"],
            })

        tool_context.state["UPCOMING_LAUNCHES"] = launches
        logging.info(f"[Launches] Fetched {len(launches)} upcoming launches (search='{search}')")
        return {
            "launches": launches,
            "total_upcoming": data.get("count", 0),
            "data_source": "Launch Library 2 / The Space Devs (live)",
        }
    except Exception as e:
        logging.error(f"[Launches] get_upcoming_launches error: {e}")
        return {"error": str(e), "launches": []}


# ═══════════════════════════════════════════════════════════════════════
# 4. SPACE EVENTS — The Space Devs Events API (live, no key)
#    Artemis events, EVAs, dockings, press events, etc.
# ═══════════════════════════════════════════════════════════════════════

def get_space_events(
    tool_context: ToolContext,
    limit: int = 10,
    search: str = ""
) -> dict:
    """
    Returns upcoming space events from The Space Devs Events API.
    REAL-TIME data — includes Artemis mission events, EVAs, dockings,
    press conferences, spacecraft maneuvers, and more.
    limit: number of events (default 10)
    search: optional search e.g. 'artemis', 'iss', 'eva'
    """
    try:
        url = f"{LAUNCH_LIBRARY_BASE}/events/upcoming/"
        params = {
            "limit": limit,
            "format": "json"
        }
        if search:
            params["search"] = search

        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        events = []
        for event in data.get("results", []):
            info_urls = []
            for info in event.get("info_urls", []):
                info_urls.append({
                    "title": info.get("title", ""),
                    "url": info.get("url", ""),
                    "source": info.get("source", "")
                })

            video_urls = []
            for vid in event.get("vid_urls", []):
                video_urls.append({
                    "title": vid.get("title", ""),
                    "url": vid.get("url", ""),
                    "publisher": vid.get("publisher", "")
                })

            image_url = ""
            if event.get("image"):
                image_url = event["image"].get("image_url", "") if isinstance(event["image"], dict) else ""

            events.append({
                "name": event.get("name", ""),
                "date": event.get("date", ""),
                "type": event.get("type", {}).get("name", ""),
                "description": event.get("description", ""),
                "location": event.get("location", ""),
                "is_live": event.get("webcast_live", False),
                "image_url": image_url,
                "info_urls": info_urls[:2],
                "video_urls": video_urls[:2],
            })

        tool_context.state["SPACE_EVENTS"] = events
        logging.info(f"[Events] Fetched {len(events)} upcoming space events")
        return {
            "events": events,
            "total": data.get("count", 0),
            "data_source": "The Space Devs Events API (live)"
        }
    except Exception as e:
        logging.error(f"[Events] get_space_events error: {e}")
        return {"error": str(e), "events": []}


# ═══════════════════════════════════════════════════════════════════════
# 5. MOON PHASES — US Naval Observatory API (free, no key, official gov)
# ═══════════════════════════════════════════════════════════════════════

def get_moon_phases(
    tool_context: ToolContext,
    num_phases: int = 12
) -> dict:
    """
    Returns upcoming moon phases (New Moon, First Quarter, Full Moon, Last Quarter)
    from the US Naval Observatory API. REAL-TIME, authoritative government data.
    num_phases: number of phases to return (default 12 = ~3 months)
    """
    try:
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%Y-%m-%d")

        url = f"{USNO_API_BASE}/moon/phases/date"
        params = {
            "date": date_str,
            "nump": min(num_phases, 99)
        }

        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        phases = []
        full_moons = []
        for phase in data.get("phasedata", []):
            phase_name = phase.get("phase", "")
            phase_date = f"{phase['year']}-{phase['month']:02d}-{phase['day']:02d}"
            phase_time = phase.get("time", "00:00")
            phase_dt_str = f"{phase_date}T{phase_time}:00Z"

            entry = {
                "phase": phase_name,
                "date": phase_date,
                "time_utc": phase_time,
                "datetime_utc": phase_dt_str,
            }
            phases.append(entry)

            if phase_name == "Full Moon":
                full_moons.append(entry)

        tool_context.state["MOON_PHASES"] = phases
        tool_context.state["FULL_MOONS"] = full_moons
        logging.info(f"[Moon] Fetched {len(phases)} upcoming moon phases from USNO")
        return {
            "phases": phases,
            "full_moons": full_moons,
            "count": len(phases),
            "data_source": "US Naval Observatory (live, official)"
        }
    except Exception as e:
        logging.error(f"[Moon] get_moon_phases error: {e}")
        return {"error": str(e), "phases": []}


# ═══════════════════════════════════════════════════════════════════════
# 6. NASA APOD — Astronomy Picture of the Day (free, DEMO_KEY available)
# ═══════════════════════════════════════════════════════════════════════

def get_nasa_apod(tool_context: ToolContext) -> dict:
    """
    Returns NASA's Astronomy Picture of the Day with explanation.
    Free API — works with DEMO_KEY (30 req/hour) or a full key (1000/hour).
    Great for sharing stunning space imagery with users.
    """
    try:
        url = f"{NASA_API_BASE}/planetary/apod"
        params = {"api_key": NASA_API_KEY}
        resp = requests.get(url, params=params, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        result = {
            "title": data.get("title", ""),
            "date": data.get("date", ""),
            "explanation": data.get("explanation", ""),
            "url": data.get("url", ""),
            "hdurl": data.get("hdurl", ""),
            "media_type": data.get("media_type", ""),
            "copyright": data.get("copyright", ""),
            "data_source": "NASA APOD API (live)"
        }
        tool_context.state["NASA_APOD"] = result
        logging.info(f"[NASA] APOD: {result['title']}")
        return result
    except Exception as e:
        logging.error(f"[NASA] get_nasa_apod error: {e}")
        return {"error": str(e)}


# ═══════════════════════════════════════════════════════════════════════
# 7. NEAR-EARTH OBJECTS — NASA NEO API (free, live asteroid tracking)
# ═══════════════════════════════════════════════════════════════════════

def get_near_earth_objects(
    tool_context: ToolContext,
    days_ahead: int = 7
) -> dict:
    """
    Returns near-Earth asteroids from NASA's NeoWs API.
    Shows asteroids passing near Earth in the next N days.
    Includes size, velocity, closest approach distance, and hazard status.
    days_ahead: max 7 (API limitation)
    """
    try:
        now = datetime.now(timezone.utc)
        start = now.strftime("%Y-%m-%d")
        end = (now + timedelta(days=min(days_ahead, 7))).strftime("%Y-%m-%d")

        url = f"{NASA_API_BASE}/neo/rest/v1/feed"
        params = {
            "start_date": start,
            "end_date": end,
            "api_key": NASA_API_KEY
        }
        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        asteroids = []
        for date_str, neo_list in data.get("near_earth_objects", {}).items():
            for neo in neo_list:
                close_approach = neo.get("close_approach_data", [{}])[0] if neo.get("close_approach_data") else {}
                diameter = neo.get("estimated_diameter", {}).get("meters", {})

                asteroids.append({
                    "name": neo.get("name", ""),
                    "nasa_id": neo.get("id", ""),
                    "is_potentially_hazardous": neo.get("is_potentially_hazardous_asteroid", False),
                    "estimated_diameter_min_m": round(diameter.get("estimated_diameter_min", 0), 1),
                    "estimated_diameter_max_m": round(diameter.get("estimated_diameter_max", 0), 1),
                    "close_approach_date": close_approach.get("close_approach_date_full", ""),
                    "miss_distance_km": close_approach.get("miss_distance", {}).get("kilometers", ""),
                    "relative_velocity_kph": close_approach.get("relative_velocity", {}).get("kilometers_per_hour", ""),
                    "orbiting_body": close_approach.get("orbiting_body", ""),
                })

        # Sort by closest approach
        asteroids.sort(key=lambda x: float(x.get("miss_distance_km", "9999999999") or "9999999999"))
        closest = asteroids[:10]

        tool_context.state["NEAR_EARTH_OBJECTS"] = closest
        logging.info(f"[NASA/NEO] Found {len(asteroids)} near-Earth objects, showing closest 10")
        return {
            "asteroids": closest,
            "total_count": data.get("element_count", 0),
            "date_range": f"{start} to {end}",
            "data_source": "NASA NeoWs API (live)"
        }
    except Exception as e:
        logging.error(f"[NASA/NEO] get_near_earth_objects error: {e}")
        return {"error": str(e), "asteroids": []}


# ═══════════════════════════════════════════════════════════════════════
# 8. COMBINED CELESTIAL EVENTS — Aggregates from multiple live sources
# ═══════════════════════════════════════════════════════════════════════

def get_celestial_events(
    tool_context: ToolContext,
    event_type: str = "ALL",
    days_ahead: int = 90
) -> dict:
    """
    Returns upcoming celestial events aggregated from MULTIPLE LIVE sources:
    - Moon phases from US Naval Observatory API
    - Space events from The Space Devs API
    - Near-Earth objects from NASA NeoWs API
    event_type: 'ALL', 'FULL_MOON', 'SPACE_EVENT', 'ASTEROID', or specific search
    days_ahead: how many days ahead to look (default 90)
    """
    all_events = []

    # 1. Moon phases from USNO
    if event_type in ("ALL", "FULL_MOON", "MOON"):
        try:
            moon_result = get_moon_phases(tool_context, num_phases=16)
            for phase in moon_result.get("phases", []):
                if event_type == "FULL_MOON" and phase["phase"] != "Full Moon":
                    continue
                all_events.append({
                    "event_type": "MOON_PHASE",
                    "event_name": phase["phase"],
                    "event_time": phase["datetime_utc"],
                    "details": f"Moon phase: {phase['phase']} at {phase['time_utc']} UTC",
                    "source": "US Naval Observatory"
                })
        except Exception as e:
            logging.warning(f"[Celestial] Moon phases fetch failed: {e}")

    # 2. Space events from The Space Devs
    if event_type in ("ALL", "SPACE_EVENT"):
        try:
            events_result = get_space_events(tool_context, limit=15)
            for event in events_result.get("events", []):
                all_events.append({
                    "event_type": "SPACE_EVENT",
                    "event_name": event["name"],
                    "event_time": event["date"],
                    "details": event["description"],
                    "location": event.get("location", ""),
                    "type": event.get("type", ""),
                    "is_live": event.get("is_live", False),
                    "source": "The Space Devs"
                })
        except Exception as e:
            logging.warning(f"[Celestial] Space events fetch failed: {e}")

    # 3. Near-Earth objects from NASA
    if event_type in ("ALL", "ASTEROID", "NEO"):
        try:
            neo_result = get_near_earth_objects(tool_context, days_ahead=min(days_ahead, 7))
            for neo in neo_result.get("asteroids", [])[:5]:
                if neo.get("is_potentially_hazardous"):
                    all_events.append({
                        "event_type": "NEAR_EARTH_OBJECT",
                        "event_name": f"⚠️ Hazardous Asteroid: {neo['name']}",
                        "event_time": neo["close_approach_date"],
                        "details": f"Size: {neo['estimated_diameter_min_m']}-{neo['estimated_diameter_max_m']}m, "
                                   f"Miss distance: {float(neo.get('miss_distance_km', 0)):,.0f} km, "
                                   f"Velocity: {float(neo.get('relative_velocity_kph', 0)):,.0f} km/h",
                        "source": "NASA NeoWs"
                    })
        except Exception as e:
            logging.warning(f"[Celestial] NEO fetch failed: {e}")

    # Filter by date window
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=days_ahead)
    filtered = []
    for event in all_events:
        try:
            evt_time = event.get("event_time", "")
            if evt_time:
                evt_dt = datetime.fromisoformat(evt_time.replace("Z", "+00:00"))
                if now <= evt_dt <= cutoff:
                    filtered.append(event)
        except Exception:
            filtered.append(event)  # Include if we can't parse the date

    filtered.sort(key=lambda x: x.get("event_time", "9999"))
    tool_context.state["CELESTIAL_EVENTS"] = filtered
    logging.info(f"[Celestial] Aggregated {len(filtered)} events from live sources")

    return {
        "events": filtered,
        "count": len(filtered),
        "filter_applied": event_type,
        "days_ahead": days_ahead,
        "data_sources": [
            "US Naval Observatory (moon phases)",
            "The Space Devs (space events)",
            "NASA NeoWs (near-Earth objects)"
        ]
    }
