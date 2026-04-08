"""
Weather GO/NO-GO agent for observation windows.
Uses OpenWeatherMap free tier — works for USA and India.
"""
import os
import requests
import logging
from typing import Optional
from datetime import datetime, timezone
from google.adk.tools.tool_context import ToolContext

OWM_BASE = "https://api.openweathermap.org/data/2.5"
OWM_KEY = os.getenv("OPENWEATHER_API_KEY")

# Predefined city coordinates for quick lookup
CITY_COORDS = {
    # USA
    "new_york": (40.7128, -74.0060),
    "los_angeles": (34.0522, -118.2437),
    "chicago": (41.8781, -87.6298),
    "houston": (29.7604, -95.3698),
    "phoenix": (33.4484, -112.0740),
    "miami": (25.7617, -80.1918),
    "kennedy_space_center": (28.5721, -80.6480),
    "san_francisco": (37.7749, -122.4194),
    "seattle": (47.6062, -122.3321),
    "denver": (39.7392, -104.9903),
    "austin": (30.2672, -97.7431),
    "boston": (42.3601, -71.0589),
    # India
    "mumbai": (19.0760, 72.8777),
    "delhi": (28.6139, 77.2090),
    "new_delhi": (28.6139, 77.2090),
    "bangalore": (12.9716, 77.5946),
    "bengaluru": (12.9716, 77.5946),
    "chennai": (13.0827, 80.2707),
    "kolkata": (22.5726, 88.3639),
    "hyderabad": (17.3850, 78.4867),
    "pune": (18.5204, 73.8567),
    "jaipur": (26.9124, 75.7873),
    "ahmedabad": (23.0225, 72.5714),
    "jamshedpur": (22.8046, 86.2029),
    "lucknow": (26.8467, 80.9462),
    "chandigarh": (30.7333, 76.7794),
}

CLOUD_THRESHOLDS = {
    "GO": 30,       # < 30% cloud cover = GO
    "MARGINAL": 60  # 30-60% = MARGINAL, >60% = NO-GO
}


def check_weather_for_observation(
    tool_context: ToolContext,
    city_name: str = "",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    observation_time_utc: str = ""
) -> dict:
    """
    Checks cloud cover and weather conditions for a stargazing/observation window.
    Returns GO, MARGINAL, or NO-GO with details.
    Provide either city_name OR (latitude + longitude).
    observation_time_utc: ISO 8601 string — if blank, checks current conditions.
    city_name examples: 'mumbai', 'kennedy_space_center', 'denver'
    """
    try:
        if not OWM_KEY:
            return {"error": "OPENWEATHER_API_KEY not set", "status": "NO-GO"}

        # Resolve coordinates
        lat, lon = latitude, longitude
        if city_name:
            city_key = city_name.lower().replace(" ", "_")
            if city_key in CITY_COORDS:
                lat, lon = CITY_COORDS[city_key]
            else:
                # Use OWM geocoding
                geo_url = "http://api.openweathermap.org/geo/1.0/direct"
                geo_resp = requests.get(geo_url, params={
                    "q": city_name, "limit": 1, "appid": OWM_KEY
                }, timeout=10)
                geo_data = geo_resp.json()
                if geo_data:
                    lat = geo_data[0]["lat"]
                    lon = geo_data[0]["lon"]
                else:
                    return {"error": f"City '{city_name}' not found", "status": "NO-GO"}

        if lat is None or lon is None:
            return {"error": "No location provided", "status": "NO-GO"}

        # Fetch weather
        if observation_time_utc:
            # Use forecast API for future times
            url = f"{OWM_BASE}/forecast"
            params = {"lat": lat, "lon": lon, "appid": OWM_KEY, "units": "metric"}
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()

            obs_dt = datetime.fromisoformat(observation_time_utc.replace("Z", "+00:00"))

            # Find closest forecast to observation time
            best_forecast = None
            min_diff = float("inf")
            for item in data.get("list", []):
                item_dt = datetime.fromtimestamp(item["dt"], tz=timezone.utc)
                diff = abs((item_dt - obs_dt).total_seconds())
                if diff < min_diff:
                    min_diff = diff
                    best_forecast = item

            if not best_forecast:
                return {"error": "No forecast data available", "status": "NO-GO"}

            cloud_pct = best_forecast["clouds"]["all"]
            temp_c = best_forecast["main"]["temp"]
            wind_mps = best_forecast["wind"]["speed"]
            humidity = best_forecast["main"]["humidity"]
            description = best_forecast["weather"][0]["description"]
        else:
            # Current conditions
            url = f"{OWM_BASE}/weather"
            params = {"lat": lat, "lon": lon, "appid": OWM_KEY, "units": "metric"}
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            cloud_pct = data["clouds"]["all"]
            temp_c = data["main"]["temp"]
            wind_mps = data["wind"]["speed"]
            humidity = data["main"]["humidity"]
            description = data["weather"][0]["description"]

        # GO/NO-GO logic
        if cloud_pct < CLOUD_THRESHOLDS["GO"]:
            go_status = "GO"
            recommendation = "Excellent conditions for observation."
        elif cloud_pct < CLOUD_THRESHOLDS["MARGINAL"]:
            go_status = "MARGINAL"
            recommendation = "Partial clouds. Observation possible but not ideal."
        else:
            go_status = "NO-GO"
            recommendation = "Heavy cloud cover. Find an alternate window."

        result = {
            "location": {"latitude": lat, "longitude": lon, "city": city_name},
            "cloud_cover_pct": cloud_pct,
            "temperature_c": temp_c,
            "wind_speed_mps": wind_mps,
            "humidity_pct": humidity,
            "sky_description": description,
            "go_status": go_status,
            "recommendation": recommendation,
            "observation_time": observation_time_utc or "now"
        }

        tool_context.state["WEATHER_STATUS"] = go_status
        tool_context.state["WEATHER_RESULT"] = result
        logging.info(f"[Weather] {city_name or f'{lat},{lon}'}: {go_status} ({cloud_pct}% clouds)")
        return result

    except Exception as e:
        logging.error(f"[Weather] check_weather error: {e}")
        return {"error": str(e), "go_status": "NO-GO"}


def find_clear_window_nearby_days(
    tool_context: ToolContext,
    city_name: str,
    days_to_check: int = 5
) -> dict:
    """
    Scans the next N days of forecast to find the best clear-sky window.
    Returns a ranked list of time windows with GO status.
    city_name: e.g. 'mumbai', 'denver'
    days_to_check: how many days to scan (max 5 on OWM free tier)
    """
    try:
        lat, lon = None, None
        city_key = city_name.lower().replace(" ", "_")
        if city_key in CITY_COORDS:
            lat, lon = CITY_COORDS[city_key]
        else:
            if not OWM_KEY:
                return {"error": "OPENWEATHER_API_KEY not set"}
            geo_url = "http://api.openweathermap.org/geo/1.0/direct"
            geo_resp = requests.get(geo_url, params={
                "q": city_name, "limit": 1, "appid": OWM_KEY
            }, timeout=10)
            geo_data = geo_resp.json()
            if geo_data:
                lat, lon = geo_data[0]["lat"], geo_data[0]["lon"]

        if lat is None:
            return {"error": f"City not found: {city_name}"}

        url = f"{OWM_BASE}/forecast"
        params = {"lat": lat, "lon": lon, "appid": OWM_KEY, "units": "metric", "cnt": days_to_check * 8}
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        windows = []
        for item in data.get("list", []):
            cloud_pct = item["clouds"]["all"]
            if cloud_pct < CLOUD_THRESHOLDS["MARGINAL"]:
                item_dt = datetime.fromtimestamp(item["dt"], tz=timezone.utc)
                hour = item_dt.hour
                # Prefer nighttime windows (roughly 18:00—06:00 UTC)
                is_night = hour >= 18 or hour <= 6
                windows.append({
                    "time_utc": item_dt.isoformat(),
                    "cloud_pct": cloud_pct,
                    "go_status": "GO" if cloud_pct < 30 else "MARGINAL",
                    "description": item["weather"][0]["description"],
                    "temp_c": item["main"]["temp"],
                    "is_night": is_night
                })

        # Sort: nighttime GO windows first, then by cloud percentage
        windows.sort(key=lambda x: (not x["is_night"], x["cloud_pct"]))
        best_windows = windows[:5]
        tool_context.state["BEST_WEATHER_WINDOWS"] = best_windows
        return {
            "city": city_name,
            "best_windows": best_windows,
            "total_clear_windows": len(windows)
        }
    except Exception as e:
        return {"error": str(e)}
