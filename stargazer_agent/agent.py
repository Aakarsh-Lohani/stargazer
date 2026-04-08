"""
StarGazer — Multi-Agent Space Observation Assistant
Built with Google ADK + Gemini on Vertex AI

Architecture:
  root_agent (Greeter/Orchestrator)
    └── stargazer_workflow (SequentialAgent)
          ├── orbital_agent   → ISS, launches, celestial events
          ├── weather_agent   → OpenWeatherMap GO/NO-GO
          └── logistics_agent → Maps MCP + Calendar + BigQuery

MCP Integrations:
  - Google Maps MCP (remote hosted at maps.googleapis.com/maps/api/mcp/v1)
    Uses MCPToolset + StreamableHTTPConnectionParams

API Tool Integrations:
  - Google Calendar API (OAuth 2.0 refresh token)
  - OpenWeatherMap API
  - WhereTheISS.at API
  - Launch Library 2 API
  - Google BigQuery API
"""
import os
import logging

try:
    import google.cloud.logging
    cloud_logging_client = google.cloud.logging.Client()
    cloud_logging_client.setup_logging()
except Exception:
    logging.basicConfig(level=logging.INFO)

from dotenv import load_dotenv
load_dotenv()

from google.adk import Agent
from google.adk.agents import SequentialAgent
from google.adk.tools.tool_context import ToolContext

MODEL = os.getenv("MODEL", "gemini-2.0-flash-001")

# ─── Import Tools ────────────────────────────────────────────────────
from stargazer_agent.tools.space_tools import (
    get_iss_current_position,
    get_iss_passes_for_location,
    get_upcoming_launches,
    get_space_events,
    get_moon_phases,
    get_nasa_apod,
    get_near_earth_objects,
    get_celestial_events
)
from stargazer_agent.tools.weather_tools import (
    check_weather_for_observation,
    find_clear_window_nearby_days
)
from stargazer_agent.tools.maps_tools import get_maps_mcp_toolset
from stargazer_agent.tools.calendar_tools import (
    create_stargazing_calendar_event,
    list_upcoming_stargazer_events
)
from stargazer_agent.tools.db_tools import (
    log_event_to_bq,
    cache_space_events_to_bq
)

# ─── Maps MCP Toolset (Google Remote MCP) ────────────────────────────
maps_toolset = get_maps_mcp_toolset()
maps_tools = [maps_toolset] if maps_toolset else []


# ─────────────────────────────────────────────
# STATE SAVER TOOL
# ─────────────────────────────────────────────
def save_user_request(tool_context: ToolContext, request: str, user_location: str = "") -> dict:
    """
    Saves the user's stargazing request and location to shared state.
    Called by the greeter before handing off to sub-agents.
    request: the user's full intent e.g. 'I want to see the ISS tonight from Mumbai'
    user_location: city or 'lat,lon' e.g. 'mumbai' or '19.07,72.88'
    """
    tool_context.state["USER_REQUEST"] = request
    tool_context.state["USER_LOCATION"] = user_location
    tool_context.state["USER_ID"] = "user_001"
    tool_context.state["WEATHER_STATUS"] = "PENDING"
    logging.info(f"[State] Request saved: {request} | Location: {user_location}")
    return {"status": "saved", "request": request, "location": user_location}


# ─────────────────────────────────────────────
# SUB-AGENT 1: ORBITAL AGENT
# ─────────────────────────────────────────────
orbital_agent = Agent(
    name="orbital_agent",
    model=MODEL,
    description="Fetches REAL-TIME space data: ISS position/passes, rocket launches (SpaceX/ISRO/NASA), Artemis mission events, moon phases, NASA APOD, and near-Earth asteroids.",
    instruction="""
    You are the Orbital Intelligence Agent for StarGazer. Your job is to gather ALL relevant
    space event data from LIVE APIs based on the user's request in { USER_REQUEST } and
    location in { USER_LOCATION }.

    ALL DATA IS REAL-TIME — fetched from live API endpoints, never hardcoded.

    Available tools and when to use them:
    1. ISS TRACKING:
       - get_iss_current_position — real-time ISS lat/lon/altitude/velocity
       - get_iss_passes_for_location — upcoming visual passes with direction & magnitude
       - Parse USER_LOCATION city names to coordinates:
         Mumbai (19.07, 72.88), Delhi (28.61, 77.21), Bangalore (12.97, 77.59)
         NYC (40.71, -74.0), LA (34.05, -118.24), KSC (28.57, -80.65)

    2. LAUNCHES (Launch Library 2 — real-time):
       - get_upcoming_launches — SpaceX, ISRO, NASA, Roscosmos, all providers
       - Use search='artemis' for Artemis missions, search='isro' for Indian launches

    3. SPACE EVENTS (The Space Devs — real-time):
       - get_space_events — Artemis mission events, EVAs, dockings, press events
       - Use search='artemis' to find current Artemis II mission events

    4. MOON PHASES (US Naval Observatory — official government data):
       - get_moon_phases — upcoming full moons, new moons, quarters

    5. NASA PICTURE OF THE DAY:
       - get_nasa_apod — stunning daily space image with explanation

    6. ASTEROIDS (NASA NeoWs — real-time):
       - get_near_earth_objects — asteroids passing near Earth this week

    7. COMBINED:
       - get_celestial_events — aggregates moon phases + space events + asteroids

    8. CACHING:
       - cache_space_events_to_bq — save events to BigQuery for audit trail

    IMPORTANT: Always extract the BEST observation window and store it as
    the RECOMMENDED_EVENT in your output. Include exact UTC time and location.
    """,
    tools=[
        get_iss_current_position,
        get_iss_passes_for_location,
        get_upcoming_launches,
        get_space_events,
        get_moon_phases,
        get_nasa_apod,
        get_near_earth_objects,
        get_celestial_events,
        cache_space_events_to_bq
    ],
    output_key="ORBITAL_DATA"
)


# ─────────────────────────────────────────────
# SUB-AGENT 2: WEATHER AGENT
# ─────────────────────────────────────────────
weather_agent = Agent(
    name="weather_agent",
    model=MODEL,
    description="Checks weather conditions for USA and India locations. Returns GO, MARGINAL, or NO-GO for observation windows.",
    instruction="""
    You are the Weather Intelligence Agent for StarGazer. You check if conditions are clear
    enough for stargazing or event viewing.

    Use the ORBITAL_DATA from the previous agent to find:
    1. The recommended event time and location.
    2. Call check_weather_for_observation for that specific time and location.
    3. If the result is NO-GO, call find_clear_window_nearby_days to find a better window.
    4. If a better window is found, update the recommended event time.

    USER_LOCATION from state: { USER_LOCATION }
    ORBITAL_DATA: { ORBITAL_DATA }

    Output a clear summary: GO/NO-GO status, cloud cover %, temperature, and the
    final recommended observation time window.

    If the user is in India (Mumbai, Delhi, Bangalore, etc.), also check if the ISS pass
    or event is visible from the Indian subcontinent.
    """,
    tools=[
        check_weather_for_observation,
        find_clear_window_nearby_days
    ],
    output_key="WEATHER_DATA"
)


# ─────────────────────────────────────────────
# SUB-AGENT 3: LOGISTICS AGENT
# ─────────────────────────────────────────────
logistics_tools = [
    create_stargazing_calendar_event,
    list_upcoming_stargazer_events,
    log_event_to_bq
] + maps_tools

logistics_agent = Agent(
    name="logistics_agent",
    model=MODEL,
    description="Handles logistics: finds the best dark sky observation location using Google Maps MCP and creates a Google Calendar event with a mission brief.",
    instruction="""
    You are the Logistics Agent for StarGazer. You only proceed if WEATHER_DATA shows GO or MARGINAL.

    WEATHER_DATA: { WEATHER_DATA }
    ORBITAL_DATA: { ORBITAL_DATA }
    USER_LOCATION: { USER_LOCATION }

    Steps:
    1. If WEATHER_DATA status is NO-GO, skip logistics and return an apology message with
       alternative date suggestions from ORBITAL_DATA.

    2. If GO or MARGINAL:
       a. Use the Maps MCP tools to search for a dark sky park, observatory, or open rural area
          near USER_LOCATION. Use the search query format:
          "dark sky park OR observatory near [USER_LOCATION]"
       b. Extract the top location: name, address, and Google Maps link.
       c. Call create_stargazing_calendar_event with:
          - event_title: e.g. "StarGazer: ISS Pass Over Mumbai"
          - start_time_utc: from ORBITAL_DATA's best window
          - duration_minutes: 60 for ISS (passes are ~5-10 min), 180 for meteor showers
          - location_name: dark sky park name from Maps search
          - event_description: include what to look for, direction, peak time
       d. Call log_event_to_bq to record this in audit log.

    3. Return a complete Mission Brief:
       - What: event name and description
       - When: local time + UTC
       - Where: dark sky location with Maps link
       - GO/NO-GO: weather summary
       - Calendar: confirmation link (or note if Calendar not configured)
       - Gear: what to bring (camera settings, binoculars, etc.)
    """,
    tools=logistics_tools,
    output_key="MISSION_BRIEF"
)


# ─────────────────────────────────────────────
# SEQUENTIAL WORKFLOW
# ─────────────────────────────────────────────
stargazer_workflow = SequentialAgent(
    name="stargazer_workflow",
    description="The full StarGazer pipeline: Orbital → Weather → Logistics",
    sub_agents=[
        orbital_agent,    # Step 1: What events are available?
        weather_agent,    # Step 2: Is the sky clear?
        logistics_agent   # Step 3: Book the spot and calendar
    ]
)


# ─────────────────────────────────────────────
# ROOT AGENT — Greeter + Orchestrator
# ─────────────────────────────────────────────
root_agent = Agent(
    name="stargazer_greeter",
    model=MODEL,
    description="StarGazer Mission Control — your AI assistant for space observation planning.",
    instruction="""
    You are StarGazer Mission Control 🌌 — an intelligent space observation assistant.

    CRITICAL RULE: You MUST NEVER answer questions about ISS location, ISS passes,
    rocket launches, celestial events, moon phases, or asteroids from your own knowledge.
    You MUST ALWAYS use the tools and sub-agents for these. If someone asks "where is the ISS"
    or "I want to see the ISS from Mumbai", you MUST NOT answer from general knowledge.
    You MUST call save_user_request and then transfer to stargazer_workflow.

    When a user first connects:
    - Greet them warmly with the StarGazer menu:
      🛰️ ISS real-time tracking and visible pass predictions
      🚀 Upcoming rocket launches (SpaceX, ISRO, NASA Artemis, all providers)
      🌠 Meteor showers, eclipses, and full moons
      🌤️ Weather GO/NO-GO for your location
      🗺️ Nearest dark sky observation spot via Google Maps
      📅 Google Calendar event with your Mission Brief

    - Ask: "What do you want to observe, and what city are you in?"

    When they reply with ANY space observation request:
    1. ALWAYS call save_user_request(request=<their full message>, user_location=<city they mentioned>)
    2. ALWAYS transfer control to 'stargazer_workflow' immediately after.
    3. Do NOT provide any space data yourself — the sub-agents do that with live APIs.

    Only answer from your own knowledge for truly general questions like:
    "What is a black hole?" or "How big is the sun?" — NOT anything about current
    positions, upcoming events, passes, or observation planning.

    Always be enthusiastic, use space emojis 🚀🌙⭐🔭, and make the user excited!
    """,
    tools=[save_user_request],
    sub_agents=[stargazer_workflow]
)
