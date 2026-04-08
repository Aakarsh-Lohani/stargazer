"""
Google Maps MCP integration for dark sky location finder.
Uses the remote Google-hosted Maps MCP server.
This is a TRUE MCP integration via Model Context Protocol.
"""
import os
import logging
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StreamableHTTPConnectionParams

MAPS_MCP_URL = "https://maps.googleapis.com/maps/api/mcp/v1"
MAPS_API_KEY = os.getenv("MAPS_API_KEY")


def get_maps_mcp_toolset():
    """
    Returns a configured Maps MCP toolset for the ADK agent.
    Uses Google's remote hosted MCP server with StreamableHTTPConnectionParams.
    This is a true Model Context Protocol (MCP) integration.
    """
    if not MAPS_API_KEY:
        logging.warning("[Maps MCP] MAPS_API_KEY not set — Maps tools will be unavailable.")
        return None

    try:
        toolset = MCPToolset(
            connection_params=StreamableHTTPConnectionParams(
                url=MAPS_MCP_URL,
                headers={"X-Goog-Api-Key": MAPS_API_KEY}
            )
        )
        logging.info("[Maps MCP] Toolset configured successfully.")
        return toolset
    except Exception as e:
        logging.error(f"[Maps MCP] Failed to create toolset: {e}")
        return None


def get_dark_sky_location_prompt(latitude: float, longitude: float, radius_km: int = 50) -> str:
    """
    Returns a structured prompt string for the Maps MCP agent to find dark sky locations.
    Used by the logistics_agent to formulate its Maps search query.
    """
    return (
        f"Search for dark sky parks, observatories, or rural areas with minimal light pollution "
        f"within {radius_km} km of coordinates ({latitude}, {longitude}). "
        f"Include the place name, address, distance, and a Google Maps link. "
        f"Also check if the location has a clear open horizon (no tall buildings or mountains blocking the sky)."
    )
