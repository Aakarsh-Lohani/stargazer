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
# SequentialAgent imported but not used — we use LLM-orchestrated Agent for retry loop capability
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
# STATE SAVER TOOL — forces transfer to workflow (with loop guard)
# ─────────────────────────────────────────────
def save_user_request(tool_context: ToolContext, request: str, user_location: str = "") -> dict:
    """
    Saves the user's stargazing request and location to shared state,
    then FORCES transfer to the stargazer_workflow agent.
    This tool MUST be called for ANY space observation request.
    request: the user's full intent e.g. 'I want to see the ISS tonight from Mumbai'
    user_location: city or 'lat,lon' e.g. 'mumbai' or '19.07,72.88'
    """
    current_saved_request = tool_context.state.get("USER_REQUEST")

    # RE-ENTRY GUARD: If the workflow already ran for THIS EXACT REQUEST,
    # do NOT transfer again. This prevents the infinite loop where:
    # greeter → workflow → greeter → workflow → ... within the same turn.
    if current_saved_request == request and (tool_context.state.get("ORBITAL_DATA") or tool_context.state.get("MISSION_BRIEF")):
        logging.info("[Guard] Workflow already completed for this request. NOT re-transferring.")
        return {
            "status": "already_completed",
            "message": "The workflow already ran. Present the results from ORBITAL_DATA, WEATHER_DATA, and MISSION_BRIEF to the user.",
            "orbital_data_exists": bool(tool_context.state.get("ORBITAL_DATA")),
            "weather_data_exists": bool(tool_context.state.get("WEATHER_DATA")),
            "mission_brief_exists": bool(tool_context.state.get("MISSION_BRIEF")),
        }

    # If this is a NEW request, clear old state so subagents fetch fresh data
    if current_saved_request != request:
        tool_context.state["ORBITAL_DATA"] = None
        tool_context.state["WEATHER_DATA"] = None
        tool_context.state["MISSION_BRIEF"] = None

    tool_context.state["USER_REQUEST"] = request
    tool_context.state["USER_LOCATION"] = user_location
    tool_context.state["USER_ID"] = "user_001"
    tool_context.state["WEATHER_STATUS"] = "PENDING"
    logging.info(f"[State] Request saved: {request} | Location: {user_location}")

    # FORCE transfer to the workflow agent
    tool_context.actions.transfer_to_agent = "stargazer_workflow"
    logging.info("[Transfer] Forced transfer to stargazer_workflow")

    return {"status": "saved", "request": request, "location": user_location, "transferring_to": "stargazer_workflow"}


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
# ORCHESTRATOR WORKFLOW — LLM-driven with retry loop
# Uses Agent (not SequentialAgent) so the LLM can:
#   - Re-call orbital_agent to find alternative dates when weather is NO-GO
#   - Iterate weather + orbital multiple times until a GO/MARGINAL window is found
#   - Only proceed to logistics_agent when conditions are acceptable
# ─────────────────────────────────────────────
stargazer_workflow = Agent(
    name="stargazer_workflow",
    model=MODEL,
    description="The intelligent StarGazer pipeline orchestrator. Uses a ReAct-style retry loop to find the best possible observation window — re-running orbital and weather agents until conditions are GO or MARGINAL.",
    instruction="""
    You are the StarGazer Pipeline Orchestrator. Your role is to ACTIVELY MANAGE the pipeline
    and iterate until you find a valid observation window for the user. You are NOT a simple
    sequential pipeline — you have full control to loop and retry.

    ═══ PIPELINE LOGIC (FOLLOW EXACTLY) ═══

    CYCLE START:
    Step 1 — ORBITAL FETCH:
       Transfer to `orbital_agent` with the user's intent from USER_REQUEST and
       USER_LOCATION. Ask it to find the BEST upcoming space event/observation window.
       If this is a RETRY cycle (weather was NO-GO), tell orbital_agent specifically:
       "The previous event time had bad weather. Please find ALTERNATIVE dates or event
       times at least 24-48 hours different from the previous suggestion."

    Step 2 — WEATHER CHECK:
       Once ORBITAL_DATA is set, transfer to `weather_agent` to check conditions
       at the specific event time and location in ORBITAL_DATA.

    Step 3 — EVALUATE RESULT (critical decision point):
       Read WEATHER_DATA status:

       A) If status is GO or MARGINAL:
          → Proceed to Step 4 (logistics).

       B) If status is NO-GO AND this is the 1st attempt:
          → Output reasoning explaining why you are retrying with a different date.
          → Go back to Step 1 (RETRY cycle — ask orbital_agent for alternative times).
          → This gives the user a better window instead of giving up.

       C) If status is NO-GO after 2nd retry:
          → Skip logistics. Tell the user there are no clear windows in the near future
            and provide the best alternative dates found so far.

    Step 4 — LOGISTICS:
       Transfer to `logistics_agent` to find a dark sky observation location via Google
       Maps MCP and create a Google Calendar event with the mission brief.

    ═══ MANDATORY REASONING FORMAT ═══
    Before transferring to ANY sub-agent, output your reasoning like this:
    :::reasoning
    [Explain what you are doing and why — e.g., "Weather over Mumbai is NO-GO (87% cloud
    cover). Asking orbital_agent to find an alternative ISS pass 2 days later."]
    :::

    ═══ RETRY EXAMPLE ═══
    User: "ISS tonight from Delhi"
    → You: :::reasoning Fetching ISS passes and space data for Delhi. :::  → orbital_agent
    → orbital_agent returns: ISS pass at 21:30 UTC tonight
    → You: :::reasoning Checking weather for Delhi at 21:30 UTC. ::: → weather_agent
    → weather_agent returns: NO-GO (92% cloud cover, heavy monsoon)
    → You: :::reasoning Tonight is NO-GO. Asking orbital_agent for an alternative ISS pass
      over the next 5 days when weather might be clearer. ::: → orbital_agent (retry)
    → orbital_agent returns: ISS pass at 20:15 UTC in 3 days
    → You: :::reasoning Checking weather for Delhi in 3 days. ::: → weather_agent
    → weather_agent returns: GO (18% cloud cover)
    → You: :::reasoning Found a GO window! Getting dark sky location and booking calendar. :::
      → logistics_agent
    """,
    sub_agents=[
        orbital_agent,
        weather_agent,
        logistics_agent
    ]
)


# ─────────────────────────────────────────────
# ROOT AGENT — Greeter + Orchestrator
# ─────────────────────────────────────────────
root_agent = Agent(
    name="stargazer_greeter",
    model=MODEL,
    description="StarGazer Mission Control — routes ALL space observation requests to sub-agents.",
    instruction="""
    You are StarGazer Mission Control 🌌.

    YOUR ONLY JOB: For ANY space-related request, call save_user_request. That's it.
    The tool will automatically transfer to the specialized agents that have the real data.

    RULE 1: If the user mentions ANY of these → ALWAYS call save_user_request:
    - ISS, space station, satellite
    - Rocket launch, SpaceX, ISRO, NASA, Artemis
    - Moon, full moon, eclipse, lunar
    - Meteor, shooting star, meteor shower
    - Stars, stargazing, constellation, planets
    - Asteroid, comet, near-earth object
    - Space event, observation, dark sky
    - NASA, APOD, astronomy picture
    - Weather for observation
    - ANY request that involves observing something in the sky

    RULE 2: Extract the city/location from their message. If they don't mention one, ask.

    RULE 3: Call save_user_request(request="<their full message>", user_location="<city>")
    The tool handles everything else — you do NOT need to answer the question yourself.

    RULE 4: If save_user_request returns status='already_completed', it means the workflow
    has already run for this request. DO NOT call save_user_request again. Instead, present
    the results that are already in session state (ORBITAL_DATA, WEATHER_DATA, MISSION_BRIEF)
    as ONE single, clean formatted response to the user. DO NOT repeat the same data or summaries twice in your response.
    
    FORMATTING RULES FOR FINAL RESPONSE:
    - Do NOT output raw plain text blocks. You must use our UI boxes for clean formatting.
    - Wrap the final recommended event in:
      :::box recommended
      ### [Event Name]
      [Event Details, Time, Location]
      :::
    - Wrap other information (like other celestial events, moon phases) in:
      :::box info
      ### [Title]
      [Details]
      :::
    - Wrap any final thoughts or weather briefs in:
      :::box weather
      [Weather Details]
      :::

    RULE 5: Only if they ask a truly general science question ("what is a black hole?",
    "how far is Mars?") with NO observation/tracking intent — then answer directly.

    When a user first connects with no request, greet them:
    "Welcome to StarGazer Mission Control 🌌! I can help you:
    🛰️ Track the ISS | 🚀 Launches | 🌠 Meteor showers | 🌑 Eclipses
    🌤️ Weather GO/NO-GO | 🗺️ Dark sky spots | 📅 Calendar events
    What do you want to observe, and what city are you in?"
    """,
    tools=[save_user_request],
    sub_agents=[stargazer_workflow]
)
