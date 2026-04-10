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



