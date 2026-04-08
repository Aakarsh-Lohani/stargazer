"""
StarGazer — FastAPI Server
Serves the custom StarGazer UI and provides a chat API that connects to the ADK agent.
Designed for Cloud Run deployment (port 8080).
"""
import os
import uuid
import logging
import asyncio
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# ─── Setup Logging ───────────────────────────────────────────────────
try:
    import google.cloud.logging
    cloud_logging_client = google.cloud.logging.Client()
    cloud_logging_client.setup_logging()
except Exception:
    logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)

# ─── Global State ────────────────────────────────────────────────────
session_service = InMemorySessionService()
runner = None
APP_NAME = "stargazer"
USER_ID = "stargazer_user"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the ADK runner on startup."""
    global runner
    try:
        from stargazer_agent.agent import root_agent
        runner = Runner(
            agent=root_agent,
            app_name=APP_NAME,
            session_service=session_service,
        )
        logger.info("🌌 StarGazer ADK Runner initialized successfully!")
    except Exception as e:
        logger.error(f"Failed to initialize ADK Runner: {e}")
        runner = None
    yield
    logger.info("StarGazer shutting down...")


# ─── FastAPI App ─────────────────────────────────────────────────────
app = FastAPI(
    title="StarGazer API",
    description="Multi-Agent Space Observation Assistant",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── API Routes ──────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    """Serve the StarGazer custom UI."""
    ui_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(ui_path):
        return FileResponse(ui_path)
    return HTMLResponse("<h1>🌌 StarGazer API is running!</h1><p>UI files not found in /static/</p>")


@app.get("/health")
async def health_check():
    """Health check for Cloud Run."""
    return {
        "status": "healthy",
        "service": "StarGazer",
        "agent_ready": runner is not None
    }


@app.post("/api/chat")
async def chat(request: Request):
    """
    Main chat endpoint. Sends user message to the ADK agent and returns the response.
    Request body: { "message": "...", "session_id": "..." (optional) }
    """
    if runner is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Agent not initialized. Check server logs."}
        )

    try:
        body = await request.json()
        user_message = body.get("message", "").strip()
        session_id = body.get("session_id", "")

        if not user_message:
            return JSONResponse(
                status_code=400,
                content={"error": "Message cannot be empty"}
            )

        # Create or reuse session
        if not session_id:
            session_id = str(uuid.uuid4())

        session = await session_service.get_session(
            app_name=APP_NAME,
            user_id=USER_ID,
            session_id=session_id
        )

        if session is None:
            session = await session_service.create_session(
                app_name=APP_NAME,
                user_id=USER_ID,
                session_id=session_id
            )

        # Create user content
        user_content = types.Content(
            role="user",
            parts=[types.Part.from_text(text=user_message)]
        )

        # Run the agent and collect response
        agent_response_parts = []
        async for event in runner.run_async(
            user_id=USER_ID,
            session_id=session_id,
            new_message=user_content
        ):
            if event.is_final_response():
                for part in event.content.parts:
                    if part.text:
                        agent_response_parts.append(part.text)

        response_text = "\n".join(agent_response_parts) if agent_response_parts else "I'm processing your request..."

        return JSONResponse(content={
            "response": response_text,
            "session_id": session_id
        })

    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": f"Internal error: {str(e)}"}
        )


@app.post("/api/session/new")
async def new_session():
    """Create a new chat session."""
    session_id = str(uuid.uuid4())
    try:
        await session_service.create_session(
            app_name=APP_NAME,
            user_id=USER_ID,
            session_id=session_id
        )
        return {"session_id": session_id}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


# ─── Mount Static Files ─────────────────────────────────────────────
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
