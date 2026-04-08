"""
StarGazer — FastAPI Server
Serves the custom StarGazer UI and provides a chat API that connects to the ADK agent.
Designed for Cloud Run deployment (port 8080).
"""
import os
import uuid
import json
import logging
import asyncio
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, StreamingResponse
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


async def get_or_create_session(session_id: str):
    """Get existing session or create a new one if terminated/missing."""
    session = await session_service.get_session(
        app_name=APP_NAME, user_id=USER_ID, session_id=session_id
    )
    if session is None:
        session = await session_service.create_session(
            app_name=APP_NAME, user_id=USER_ID, session_id=session_id
        )
    return session


async def run_agent_with_retry(user_id, session_id, new_message, max_retries=3):
    """
    Runs the ADK agent with exponential backoff retry for 429 RESOURCE_EXHAUSTED.
    Yields events from runner.run_async().
    Raises the last exception if all retries fail.
    """
    delay = 2.0
    last_err = None
    for attempt in range(max_retries):
        try:
            events = []
            async for event in runner.run_async(
                user_id=user_id,
                session_id=session_id,
                new_message=new_message
            ):
                events.append(event)
            for event in events:
                yield event
            return  # success
        except Exception as e:
            last_err = e
            err_str = str(e)
            if '429' in err_str or 'RESOURCE_EXHAUSTED' in err_str:
                if attempt < max_retries - 1:
                    wait = delay * (2 ** attempt)
                    logger.warning(f"[429] Rate limited. Retrying in {wait:.1f}s (attempt {attempt+1}/{max_retries})")
                    await asyncio.sleep(wait)
                    # Recreate session in case it was lost during wait
                    await get_or_create_session(session_id)
                    continue
            elif 'Session terminated' in err_str or 'session' in err_str.lower():
                logger.warning(f"[Session] Session lost, recreating and retrying")
                await get_or_create_session(session_id)
                if attempt < max_retries - 1:
                    continue
            break
    raise last_err


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


# ─── Helper: BigQuery pipeline logging (non-blocking) ────────────────
def _log_pipeline_async(session_id, user_message, event_type, agent_name,
                         tool_name="", tool_args=None, result_preview="", thinking=""):
    """Fire-and-forget BQ pipeline log — wrapped so it never crashes the stream."""
    try:
        from stargazer_agent.tools.db_tools import log_pipeline_event_to_bq
        log_pipeline_event_to_bq(
            session_id=session_id,
            user_message=user_message,
            event_type=event_type,
            agent_name=agent_name,
            tool_name=tool_name,
            tool_args=tool_args or {},
            tool_result_preview=result_preview,
            thinking_text=thinking,
        )
    except Exception as e:
        logger.debug(f"Pipeline BQ log skipped: {e}")


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
    Simple chat endpoint — returns only the final response.
    For live streaming with agent pipeline visible, use /api/stream.
    """
    if runner is None:
        return JSONResponse(status_code=503, content={"error": "Agent not initialized."})

    try:
        body = await request.json()
        user_message = body.get("message", "").strip()
        session_id = body.get("session_id", "") or str(uuid.uuid4())

        if not user_message:
            return JSONResponse(status_code=400, content={"error": "Message cannot be empty"})

        await get_or_create_session(session_id)

        user_content = types.Content(
            role="user", parts=[types.Part.from_text(text=user_message)]
        )

        agent_response_parts = []
        async for event in run_agent_with_retry(USER_ID, session_id, user_content):
            if event.is_final_response():
                for part in event.content.parts:
                    if part.text:
                        agent_response_parts.append(part.text)

        response_text = "\n".join(agent_response_parts) if agent_response_parts else "Processing complete."
        return JSONResponse(content={"response": response_text, "session_id": session_id})

    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        err_str = str(e)
        if '429' in err_str or 'RESOURCE_EXHAUSTED' in err_str:
            msg = "⏳ The AI model is under heavy load right now. Please wait 30 seconds and try again."
        elif 'Session terminated' in err_str:
            msg = "🔄 Session expired. Please send your message again."
        else:
            msg = f"Internal error: {err_str}"
        return JSONResponse(status_code=500, content={"error": msg})


@app.post("/api/stream")
async def stream_chat(request: Request):
    """
    Streaming SSE endpoint. Emits every agent event in real-time:
      agent_switch  — which agent is now active
      tool_call     — tool name + arguments
      tool_result   — tool name + result preview
      thinking      — model reasoning text
      text          — partial response text
      final         — complete final response + session_id

    All events are also logged to BigQuery pipeline_log table.
    """
    if runner is None:
        return JSONResponse(status_code=503, content={"error": "Agent not initialized"})

    body = await request.json()
    user_message = body.get("message", "").strip()
    session_id = body.get("session_id", "") or str(uuid.uuid4())

    if not user_message:
        return JSONResponse(status_code=400, content={"error": "Message cannot be empty"})

    await get_or_create_session(session_id)

    user_content = types.Content(
        role="user", parts=[types.Part.from_text(text=user_message)]
    )

    async def event_generator():
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"

        final_text_parts = []
        current_agent = "unknown"

        try:
            async for event in run_agent_with_retry(USER_ID, session_id, user_content):
                # ── Agent switch ──────────────────────────────────
                if hasattr(event, 'author') and event.author:
                    if event.author != current_agent:
                        current_agent = event.author
                        payload = {'type': 'agent_switch', 'agent': current_agent}
                        yield f"data: {json.dumps(payload)}\n\n"
                        # Log to BQ (in thread pool to avoid blocking)
                        asyncio.get_event_loop().run_in_executor(
                            None, _log_pipeline_async,
                            session_id, user_message, 'agent_switch',
                            current_agent, '', {}, '', ''
                        )

                if event.content and event.content.parts:
                    for part in event.content.parts:
                        # ── Tool call ─────────────────────────────
                        if hasattr(part, 'function_call') and part.function_call:
                            fc = part.function_call
                            args = dict(fc.args) if fc.args else {}
                            payload = {'type': 'tool_call', 'tool': fc.name, 'args': args}
                            yield f"data: {json.dumps(payload)}\n\n"
                            asyncio.get_event_loop().run_in_executor(
                                None, _log_pipeline_async,
                                session_id, user_message, 'tool_call',
                                current_agent, fc.name, args, '', ''
                            )

                        # ── Tool result ───────────────────────────
                        elif hasattr(part, 'function_response') and part.function_response:
                            fr = part.function_response
                            preview = str(fr.response)[:400] if fr.response else ""
                            payload = {'type': 'tool_result', 'tool': fr.name, 'preview': preview}
                            yield f"data: {json.dumps(payload)}\n\n"
                            asyncio.get_event_loop().run_in_executor(
                                None, _log_pipeline_async,
                                session_id, user_message, 'tool_result',
                                current_agent, fr.name, {}, preview, ''
                            )

                        # ── Thinking ──────────────────────────────
                        elif hasattr(part, 'thought') and part.thought and part.text:
                            thinking = part.text[:500]
                            payload = {'type': 'thinking', 'text': thinking}
                            yield f"data: {json.dumps(payload)}\n\n"
                            asyncio.get_event_loop().run_in_executor(
                                None, _log_pipeline_async,
                                session_id, user_message, 'thinking',
                                current_agent, '', {}, '', thinking
                            )

                        # ── Text stream ───────────────────────────
                        elif part.text and not (hasattr(part, 'thought') and part.thought):
                            payload = {'type': 'text', 'text': part.text}
                            yield f"data: {json.dumps(payload)}\n\n"

                # ── Final response ────────────────────────────────
                if event.is_final_response() and event.content:
                    for part in event.content.parts:
                        if part.text:
                            final_text_parts.append(part.text)

            final_response = "\n".join(final_text_parts) if final_text_parts else "Processing complete."
            payload = {'type': 'final', 'text': final_response, 'session_id': session_id}
            yield f"data: {json.dumps(payload)}\n\n"
            # Log final event
            asyncio.get_event_loop().run_in_executor(
                None, _log_pipeline_async,
                session_id, user_message, 'final',
                current_agent, '', {}, final_response[:400], ''
            )

        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
            err_str = str(e)
            if '429' in err_str or 'RESOURCE_EXHAUSTED' in err_str:
                msg = "⏳ The AI model is under heavy load. Waited and retried but still rate-limited. Please wait 30 seconds and try again."
            elif 'Session terminated' in err_str:
                msg = "🔄 Session expired. Your message was not lost — please resend it."
            else:
                msg = f"Error: {err_str[:300]}"
            yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


@app.get("/api/pipeline-log")
async def get_pipeline_log(session_id: str = None, limit: int = 50):
    """
    Returns recent agent pipeline log entries from BigQuery.
    Used by the Insights panel BQ Log tab.
    Query params: ?session_id=xxx&limit=50
    """
    try:
        from stargazer_agent.tools.db_tools import get_recent_pipeline_logs
        rows = await asyncio.get_event_loop().run_in_executor(
            None, get_recent_pipeline_logs, session_id, limit
        )
        # Convert datetime objects to strings for JSON serialization
        for row in rows:
            if 'created_at' in row and hasattr(row['created_at'], 'isoformat'):
                row['created_at'] = row['created_at'].isoformat()
        return JSONResponse(content={"logs": rows, "count": len(rows)})
    except Exception as e:
        logger.error(f"pipeline-log fetch error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e), "logs": []})


@app.post("/api/session/new")
async def new_session():
    """Create a new chat session."""
    session_id = str(uuid.uuid4())
    try:
        await session_service.create_session(
            app_name=APP_NAME, user_id=USER_ID, session_id=session_id
        )
        return {"session_id": session_id}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# ─── Mount Static Files ─────────────────────────────────────────────
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
