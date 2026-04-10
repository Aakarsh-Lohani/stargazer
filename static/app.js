/**
 * StarGazer — Frontend Application
 * Streaming agent pipeline, persistent Insights panel, BQ log retrieval.
 */

// ─── State ──────────────────────────────────────────────────────────
const state = {
    sessionId: null,
    isLoading: false,
    activePanel: 'chat',
    insightsVisible: true,
    currentTraceSession: null,
    pipelineGraph: null,    // PipelineGraph (sidebar SVG) — kept for compatibility
    flowGraph: null,        // FlowGraph (right panel Agent Flow tab)
    _pendingReason: '',     // Reasoning text buffered before next agent switch
};

// ─── DOM ─────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const chatMessages = $('#chatMessages');
const chatInput = $('#chatInput');
const chatForm = $('#chatForm');
const sendBtn = $('#sendBtn');
const chatContainer = $('#chatContainer');
const quickPrompts = $('#quickPrompts');
const newSessionBtn = $('#newSessionBtn');
const clearChatBtn = $('#clearChatBtn');
const mobileMenuBtn = $('#mobileMenuBtn');
const sidebar = $('#sidebar');
const insightsPanel = $('#insightsPanel');
const traceContent = $('#traceContent');
const bqContent = $('#bqContent');
const traceEmpty = $('#traceEmpty');
const bqEmpty = $('#bqEmpty');


// ─── Initialize ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initStars();
    initNavigation();
    initChat();
    initDashboard();
    initInsightsPanel();
    initPipelineGraph();
    setWelcomeTime();
    initSession();
});


// ─── Stars Background ────────────────────────────────────────────────
function initStars() {
    const container = $('#starsContainer');
    if (!container) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 180; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        const size = Math.random() * 2.5 + 0.5;
        star.style.cssText = `
            width:${size}px;height:${size}px;
            left:${Math.random()*100}%;top:${Math.random()*100}%;
            --duration:${Math.random()*4+2}s;--delay:${Math.random()*4}s;
            --min-opacity:${Math.random()*0.3+0.1};`;
        fragment.appendChild(star);
    }
    container.appendChild(fragment);
}


// ─── Navigation ───────────────────────────────────────────────────────
function initNavigation() {
    const navBtns = $$('.nav-btn');
    const panels = $$('.panel');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            panels.forEach(p => p.classList.remove('active'));
            $(`#${panelId}Panel`).classList.add('active');
            state.activePanel = panelId;
            if (window.innerWidth <= 768) sidebar.classList.remove('open');
            // Auto-load live data when panels are opened
            if (panelId === 'events') loadLiveEvents();
            if (panelId === 'dashboard') loadNextLaunch();
        });
    });

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    }
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });
}


// ─── Session Management ──────────────────────────────────────────────
async function initSession() {
    try {
        const resp = await fetch('/api/session/new', { method: 'POST' });
        const data = await resp.json();
        state.sessionId = data.session_id;
        updateAgentStatus('Online', 'active');
    } catch (err) {
        console.error('Failed to init session:', err);
        updateAgentStatus('Offline', 'error');
    }
}


// ─── Insights Panel ──────────────────────────────────────────────────
function initInsightsPanel() {
    // Explicit tab content map — avoid dynamic $(`#${key}Tab`) selector issues
    const TAB_CONTENT = {
        trace: document.getElementById('traceTab'),
        bqlog: document.getElementById('bqlogTab'),
        flow:  document.getElementById('flowTab'),
    };

    document.querySelectorAll('.insights-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const key = tab.dataset.tab;
            document.querySelectorAll('.insights-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.insights-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            if (TAB_CONTENT[key]) TAB_CONTENT[key].classList.add('active');
            if (key === 'bqlog') loadBQLog();
        });
    });

    // ✕ collapse button inside panel
    const collapseBtn = document.getElementById('collapseInsightsBtn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            insightsPanel.classList.add('collapsed');
            state.insightsVisible = false;
        });
    }

    // 🧠 Insights toggle from chat panel header
    const toggleBtn = document.getElementById('toggleInsightsBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.insightsVisible = !state.insightsVisible;
            insightsPanel.classList.toggle('collapsed', !state.insightsVisible);
        });
    }

    // ↔️ Expand / Shrink button
    const expandBtn = document.getElementById('expandInsightsBtn');
    if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            insightsPanel.classList.toggle('expanded');
        });
    }
}

// Start a new trace block in the Insights panel for this turn
function startTraceSession(userMessage) {
    if (traceEmpty) traceEmpty.style.display = 'none';

    const block = document.createElement('div');
    block.className = 'trace-session';
    block.id = `trace-${Date.now()}`;

    const header = document.createElement('div');
    header.className = 'trace-session-header';
    header.innerHTML = `
        <span>💬 ${escapeHtml(userMessage.slice(0, 60))}${userMessage.length > 60 ? '…' : ''}</span>
        <span>${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
    `;
    block.appendChild(header);

    traceContent.appendChild(block);
    state.currentTraceSession = block;

    // Scroll insights to bottom
    const body = $('.insights-body');
    if (body) requestAnimationFrame(() => body.scrollTop = body.scrollHeight);

    return block;
}

function appendTraceEntry(html) {
    if (!state.currentTraceSession) return;
    const entry = document.createElement('div');
    entry.className = 'trace-entry';
    entry.innerHTML = html;
    state.currentTraceSession.appendChild(entry);

    // Keep insights scrolled to bottom
    const body = $('.insights-body');
    if (body) requestAnimationFrame(() => body.scrollTop = body.scrollHeight);
}

function tsLabel() {
    return `<span class="trace-timestamp">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>`;
}


// ─── BQ Log Loading ──────────────────────────────────────────────────
async function loadBQLog() {
    if (bqEmpty) bqEmpty.style.display = 'none';
    bqContent.innerHTML = '<div style="color:#475569;padding:8px;font-size:0.72rem;">Loading from BigQuery...</div>';

    try {
        const url = state.sessionId
            ? `/api/pipeline-log?session_id=${state.sessionId}&limit=50`
            : `/api/pipeline-log?limit=50`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (!data.logs || data.logs.length === 0) {
            bqContent.innerHTML = '';
            if (bqEmpty) bqEmpty.style.display = 'block';
            return;
        }

        bqContent.innerHTML = '';
        data.logs.forEach(log => {
            const entry = document.createElement('div');
            entry.className = 'bq-entry';
            const icon = {
                agent_switch: '🤖', tool_call: '🔧', tool_result: '✅',
                thinking: '💭', final: '🏁', error: '❌'
            }[log.event_type] || '•';
            const typeColor = {
                agent_switch: '#a78bfa', tool_call: '#60a5fa',
                tool_result: '#34d399', thinking: '#64748b', final: '#fbbf24'
            }[log.event_type] || '#94a3b8';

            let detail = '';
            if (log.tool_name) detail += ` <span style="color:#94a3b8">${log.tool_name}</span>`;
            if (log.agent_name) detail += ` <span style="color:#475569">via ${log.agent_name}</span>`;
            if (log.tool_result_preview) detail += `<div style="color:#475569;font-size:0.65rem;margin-top:2px">${escapeHtml(log.tool_result_preview.slice(0,120))}${log.tool_result_preview.length>120?'…':''}</div>`;

            entry.innerHTML = `
                <div class="bq-entry-type">${icon} <span style="color:${typeColor}">${log.event_type?.toUpperCase()}</span></div>
                <div class="bq-entry-info">${detail || escapeHtml((log.thinking_text||'').slice(0,100))}</div>
                <div style="color:#1e293b;font-size:0.62rem;margin-top:2px">${log.created_at}</div>
            `;
            bqContent.appendChild(entry);
        });
    } catch (err) {
        bqContent.innerHTML = `<div style="color:#f87171;padding:8px;font-size:0.72rem;">Error loading BQ log: ${err.message}</div>`;
    }
}


// ─── Chat ────────────────────────────────────────────────────────────
function initChat() {
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message && !state.isLoading) sendMessage(message);
    });

    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit'));
        }
    });

    $$('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.prompt && !state.isLoading) sendMessage(btn.dataset.prompt);
        });
    });

    if (newSessionBtn) {
        newSessionBtn.addEventListener('click', async () => {
            if (state.isLoading) return;
            await initSession();
            clearChat();
        });
    }

    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }
}


// Agent icons
const AGENT_ICONS = {
    stargazer_greeter: '🌌',
    orbital_agent: '🛰️',
    weather_agent: '🌤️',
    logistics_agent: '🗺️',
    stargazer_workflow: '⚙️',
};


// ─── Send Message (Streaming) ─────────────────────────────────────────
async function sendMessage(message) {
    if (state.isLoading) return;
    state.isLoading = true;

    if (quickPrompts) quickPrompts.style.display = 'none';

    appendMessage('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Start a trace block in the Insights panel
    const traceBlock = startTraceSession(message);
    state._textStreamStarted = false;

    // Show "thinking" in chat as a minimal status indicator
    const thinkingEl = showThinkingBar();
    setSendBtnLoading(true);
    // Reset both graphs for new conversation turn
    if (state.pipelineGraph) state.pipelineGraph.reset();
    if (state.flowGraph) state.flowGraph.reset();
    state._pendingReason = '';

    try {
        const resp = await fetch('/api/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, session_id: state.sessionId })
        });

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResponse = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const raw = line.slice(6).trim();
                if (raw === '[DONE]') break;

                try {
                    const evt = JSON.parse(raw);
                    processStreamEvent(evt, thinkingEl);
                    if (evt.type === 'meta') state.sessionId = evt.session_id;
                    if (evt.type === 'final') finalResponse = evt.text;
                } catch (_) {}
            }
        }

        // Don't remove thinkingEl — just collapse the typing dots and mark as done
        const typingDots = thinkingEl.querySelector('.typing-indicator');
        if (typingDots) typingDots.style.display = 'none';

        if (finalResponse) {
            // Add a completion line to the progress widget
            addProgressLine(thinkingEl, `<span style="color:#34d399;font-weight:600">✓ Mission brief ready</span>`);
            // Update header to show completed
            updateThinkingBar(thinkingEl, '✅ Pipeline Complete');
            // Change avatar to show completion
            const avatar = thinkingEl.querySelector('.message-avatar');
            if (avatar) avatar.textContent = '✅';

            appendMessage('agent', finalResponse);
            parseResponseForDashboard(finalResponse);
            appendTraceEntry(`${tsLabel()}<span style="color:#34d399;font-weight:600">✓ Final response delivered</span>`);
            
            // Mark both graphs complete
            if (state.pipelineGraph) state.pipelineGraph.markCompleted();
            if (state.flowGraph) state.flowGraph.markComplete();
            updateAgentFlowUI('completed_all');
        } else {
            addProgressLine(thinkingEl, `<span style="color:#fbbf24">⚠️ No response received</span>`);
            updateThinkingBar(thinkingEl, '⚠️ No Response');
            appendMessage('agent', '⚠️ No response received. The agent may still be initializing — try again.');
        }
        updateAgentStatus('Online', 'active');

    } catch (err) {
        const typingDots2 = thinkingEl.querySelector('.typing-indicator');
        if (typingDots2) typingDots2.style.display = 'none';
        updateThinkingBar(thinkingEl, '❌ Error');
        addProgressLine(thinkingEl, `<span style="color:#f87171">❌ ${escapeHtml(err.message || String(err))}</span>`);

        const errMsg = err.message || String(err);
        appendMessage('agent', `⚠️ Connection error: ${errMsg}`);
        appendTraceEntry(`${tsLabel()}<span class="trace-tool-err">✗ ${escapeHtml(errMsg)}</span>`);
        updateAgentStatus('Offline', 'error');
    }

    setSendBtnLoading(false);
    state.isLoading = false;
}


// ─── Process Stream Event → Insights Panel ───────────────────────────
function processStreamEvent(evt, thinkingEl) {
    // Friendly agent descriptions for chat progress
    const AGENT_LABELS = {
        'stargazer_greeter': 'Mission Control received your request',
        'orbital_agent': 'Orbital Agent scanning space data...',
        'weather_agent': 'Weather Agent checking sky conditions...',
        'logistics_agent': 'Logistics Agent finding observation spots...',
        'stargazer_workflow': 'Starting observation pipeline...',
    };
    const TOOL_LABELS = {
        'save_user_request': '📋 Saving your request',
        'get_iss_current_position': '🛰️ Fetching live ISS position',
        'get_iss_passes_for_location': '🛰️ Calculating ISS passes for your location',
        'get_upcoming_launches': '🚀 Checking upcoming rocket launches',
        'get_space_events': '🌠 Searching space events',
        'get_moon_phases': '🌙 Getting moon phase data',
        'get_nasa_apod': '📸 Fetching NASA Picture of the Day',
        'get_near_earth_objects': '☄️ Scanning near-Earth asteroids',
        'get_celestial_events': '🔭 Gathering celestial events',
        'check_weather_for_observation': '🌤️ Checking weather conditions',
        'find_clear_window_nearby_days': '🌤️ Searching for clear sky windows',
        'cache_space_events_to_bq': '💾 Caching events to database',
        'create_stargazing_calendar_event': '📅 Creating calendar event',
        'log_event_to_bq': '📊 Logging to audit trail',
    };

    // ── Meta ──
    if (evt.type === 'meta') {
        state.currentModel = evt.model || 'unknown';
        appendTraceEntry(`${tsLabel()}<span style="color:#818cf8">📋 <strong>Model:</strong> ${escapeHtml(evt.model)}</span>`);
        appendTraceEntry(`${tsLabel()}<span style="color:#475569">🔑 Session: ${escapeHtml((evt.session_id || '').slice(0, 8))}...</span>`);
        addProgressLine(thinkingEl, `<span style="color:#818cf8">Using model: ${escapeHtml(evt.model)}</span>`);
    }

    // ── Agent switch ──
    if (evt.type === 'agent_switch') {
        const icon = AGENT_ICONS[evt.agent] || '🤖';
        const modelBadge = evt.model ? ` <span style="background:rgba(124,58,237,0.2);color:#a78bfa;padding:1px 6px;border-radius:4px;font-size:0.62rem">${escapeHtml(evt.model)}</span>` : '';
        updateThinkingBar(thinkingEl, `${icon} ${evt.agent}`);
        appendTraceEntry(`${tsLabel()}<span class="trace-agent">${icon} <strong>${escapeHtml(evt.agent)}</strong></span>${modelBadge}`);
        // Chat progress
        const label = AGENT_LABELS[evt.agent] || `${icon} ${evt.agent} activated`;
        addProgressLine(thinkingEl, `<span style="color:#a78bfa">${icon} ${label}</span>`);

        // Update static sidebar flow
        updateAgentFlowUI(evt.agent);
        // Feed agent switch into the live FlowGraph (right panel Agent Flow tab)
        if (state.flowGraph) state.flowGraph.onAgentSwitch(evt.agent, state._pendingReason);
        state._pendingReason = '';
    }

    // ── Agent transfer ──
    if (evt.type === 'transfer') {
        const fromIcon = AGENT_ICONS[evt.from_agent] || '🤖';
        const toIcon = AGENT_ICONS[evt.to_agent] || '🤖';
        updateThinkingBar(thinkingEl, `↗️ → ${evt.to_agent}`);
        appendTraceEntry(`${tsLabel()}<span style="color:#f59e0b">↗️ <strong>Transfer:</strong> ${fromIcon} ${escapeHtml(evt.from_agent)} → ${toIcon} ${escapeHtml(evt.to_agent)}</span>`);
        addProgressLine(thinkingEl, `<span style="color:#f59e0b">↗️ Handing off to ${escapeHtml(evt.to_agent)}</span>`);
        // Store transfer reason from pending reasoning for FlowGraph connector
        if (state.flowGraph) state.flowGraph.onTransfer(evt.from_agent, evt.to_agent, state._pendingReason);
    }

    // ── State update ──
    if (evt.type === 'state_update') {
        const keys = (evt.keys || []).map(k => `<code style="color:#fbbf24;font-size:0.65rem">${escapeHtml(k)}</code>`).join(', ');
        appendTraceEntry(`${tsLabel()}<span style="color:#475569">📦 State: ${keys}</span>`);
    }

    // ── Tool call ──
    if (evt.type === 'tool_call') {
        const argsFormatted = Object.entries(evt.args || {})
            .filter(([, v]) => v !== '' && v !== null)
            .map(([k, v]) => `<span style="color:#94a3b8">${k}</span>=<span style="color:#fbbf24">${escapeHtml(JSON.stringify(v))}</span>`)
            .join(', ');
        updateThinkingBar(thinkingEl, `🔧 ${evt.tool}`);
        appendTraceEntry(`${tsLabel()}<span class="trace-tool">🔧 ${escapeHtml(evt.tool)}(${argsFormatted})</span> <span id="tc-${evt.tool}-spinner" style="color:#64748b">⏳</span>`);
        // Chat progress — friendly tool description
        const toolLabel = TOOL_LABELS[evt.tool] || `🔧 Running ${evt.tool}`;
        addProgressLine(thinkingEl, `<span style="color:#60a5fa">${toolLabel}...</span>`);
        // Feed to FlowGraph
        if (state.flowGraph) state.flowGraph.onToolCall(evt.tool, evt.args || {});
    }

    // ── Tool result ──
    if (evt.type === 'tool_result') {
        const entries = state.currentTraceSession?.querySelectorAll('.trace-entry') || [];
        for (let i = entries.length - 1; i >= 0; i--) {
            const spinner = entries[i].querySelector(`[id="tc-${evt.tool}-spinner"]`);
            if (spinner) { spinner.textContent = '✓'; spinner.style.color = '#34d399'; break; }
        }
        if (evt.preview) {
            const preview = evt.preview.slice(0, 150) + (evt.preview.length > 150 ? '…' : '');
            appendTraceEntry(`${tsLabel()}<span class="trace-tool-ok">↳ ${escapeHtml(preview)}</span>`);
            // Chat progress
            addProgressLine(thinkingEl, `<span style="color:#34d399">✓ ${escapeHtml(evt.tool)} returned data</span>`);
            // Feed to FlowGraph
            if (state.flowGraph) state.flowGraph.onToolResult(evt.tool, evt.preview);
        }
    }

    // ── Model thinking ──
    if (evt.type === 'thinking') {
        const text = (evt.text || '').slice(0, 250);
        appendTraceEntry(`${tsLabel()}<span class="trace-think">💭 ${escapeHtml(text)}${(evt.text || '').length > 250 ? '…' : ''}</span>`);
        // Buffer thinking text as pending reasoning for FlowGraph connector labels
        if (text) state._pendingReason = (state._pendingReason + ' ' + text).trim().slice(0, 400);
    }

    // ── Streaming text ──
    if (evt.type === 'text') {
        if (!state._textStreamStarted) {
            appendTraceEntry(`${tsLabel()}<span style="color:#475569">📝 Agent composing response...</span>`);
            addProgressLine(thinkingEl, `<span style="color:#34d399">📝 Composing your mission brief...</span>`);
            state._textStreamStarted = true;
        }
        // Extract :::reasoning blocks from text stream for FlowGraph connector labels
        const reasoningMatch = (evt.text || '').match(/:::reasoning\s*([\s\S]*?):::/);
        if (reasoningMatch) {
            const reason = reasoningMatch[1].trim();
            if (reason) state._pendingReason = reason.slice(0, 400);
        }
    }

    // ── Error ──
    if (evt.type === 'error') {
        updateThinkingBar(thinkingEl, '❌ Error');
        appendTraceEntry(`${tsLabel()}<span class="trace-tool-err">❌ ${escapeHtml(evt.message || 'Unknown error')}</span>`);
        addProgressLine(thinkingEl, `<span style="color:#f87171">❌ ${escapeHtml(evt.message || 'Error occurred')}</span>`);
    }
}


// ─── Thinking bar in chat (minimal, just a status line) ──────────────
function showThinkingBar() {
    const div = document.createElement('div');
    div.className = 'message agent-message';
    div.id = 'thinkingBar';
    div.innerHTML = `
        <div class="message-avatar">⚙️</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-sender" id="thinkingLabel">Initializing agents...</span>
                <span class="message-time">live</span>
            </div>
            <div class="message-body" id="thinkingProgress" style="font-size:0.8rem;line-height:1.8;">
                <div class="typing-indicator" style="display:inline-flex;gap:4px;vertical-align:middle;">
                    <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
                </div>
                <div id="progressLines" style="margin-top:6px;color:#94a3b8;font-size:0.75rem;"></div>
            </div>
        </div>`;
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
}

function updateThinkingBar(el, text) {
    const label = el.querySelector('#thinkingLabel');
    if (label) label.textContent = text;
}

function addProgressLine(el, html) {
    const container = el.querySelector('#progressLines');
    if (!container) return;
    const line = document.createElement('div');
    line.style.cssText = 'padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);';
    line.innerHTML = html;
    container.appendChild(line);
    scrollToBottom();
}

function setSendBtnLoading(loading) {
    if (!sendBtn) return;
    sendBtn.disabled = loading;
    sendBtn.innerHTML = loading ? '⏳' : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg>`;
}


// ─── Message Rendering ────────────────────────────────────────────────
function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user-message' : 'agent-message'}`;
    const avatar = role === 'user' ? '👤' : '🔭';
    const sender = role === 'user' ? 'You' : 'StarGazer';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-sender">${sender}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-body">${formatContent(content)}</div>
        </div>`;
    chatMessages.appendChild(div);
    scrollToBottom();
}

// ─── Date Formatter ────────────────────────────────────────────────────
// Converts ISO 8601 strings like 2026-04-11T00:06:00Z to readable text
function formatISODate(isoStr) {
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
        return `${date} at ${time} UTC`;
    } catch (_) { return isoStr; }
}

function formatContent(text) {
    if (!text) return '';
    let html = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    
    // ── Auto-format raw ISO dates ──
    html = html.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, (match) => formatISODate(match));
    
    // ── Parse :::reasoning blocks ──
    html = html.replace(/:::reasoning\s*([\s\S]*?):::/g, (match, p1) => {
        let content = p1.trim().replace(/\n/g, '<br>');
        return `\n\n<div class="reasoning-panel"><div class="reasoning-header">🧠 Orchestrator Reasoning</div><div class="reasoning-content">${content}</div></div>\n\n`;
    });
    
    // ── Parse :::box TYPE ... ::: blocks ──
    html = html.replace(/:::box\s+(\w+)\s*([\s\S]*?):::/g, (match, type, content) => {
        let clean = content.trim();
        // Convert bold
        clean = clean.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        clean = clean.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // Convert bullet lines (• or *) to <li> elements
        const lines = clean.split('\n').map(line => {
            const bulletMatch = line.match(/^[•\*\-]\s+(.+)/);
            if (bulletMatch) return `<li>${bulletMatch[1]}</li>`;
            if (line.trim() === '') return '<br>';
            return line;
        });
        // Wrap consecutive <li> items in <ul>
        let boxHtml = '';
        let inList = false;
        lines.forEach(line => {
            if (line.startsWith('<li>')) {
                if (!inList) { boxHtml += '<ul style="margin:4px 0 4px 16px;padding:0;list-style:disc;">'; inList = true; }
                boxHtml += line;
            } else {
                if (inList) { boxHtml += '</ul>'; inList = false; }
                if (line !== '<br>' || boxHtml.slice(-4) !== '<br>') boxHtml += line + '\n';
            }
        });
        if (inList) boxHtml += '</ul>';
        return `\n\n<div class="info-box box-${type}"><div class="box-content">${boxHtml.trim()}</div></div>\n\n`;
    });

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/\b(GO)\b(?![\-\w])/g, '<span class="go-status go">GO</span>');
    html = html.replace(/\bNO-GO\b/g, '<span class="go-status nogo">NO-GO</span>');
    html = html.replace(/\bMARGINAL\b/g, '<span class="go-status marginal">MARGINAL</span>');
    
    // Convert remaining plain bullet lines to list items
    html = html.replace(/((?:^|\n)[•\*\-] .+)+/g, (block) => {
        const items = block.trim().split('\n').map(l => {
            const m = l.match(/^[•\*\-]\s+(.+)/);
            return m ? `<li>${m[1]}</li>` : l;
        }).join('');
        return `\n<ul style="margin:6px 0 6px 18px;padding:0;list-style:disc;color:#cbd5e1;">${items}</ul>\n`;
    });

    // Split into paragraphs, preserving our custom divs
    html = html.split('\n\n').map(p => {
        let trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<div class="reasoning-panel"') || trimmed.startsWith('<div class="info-box') || trimmed.startsWith('<ul') || trimmed.startsWith('<pre>')) {
            return trimmed;
        }
        return `<p>${trimmed.replace(/\n/g,'<br>')}</p>`;
    }).join('');
    
    return html;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function clearChat() {
    const messages = chatMessages.querySelectorAll('.message:not(.welcome-message)');
    messages.forEach(m => m.remove());
    if (quickPrompts) quickPrompts.style.display = 'flex';
}

function scrollToBottom() {
    requestAnimationFrame(() => { chatContainer.scrollTop = chatContainer.scrollHeight; });
}


// ─── Dashboard ────────────────────────────────────────────────────────
function initDashboard() {
    const refreshIss = $('#refreshIss');
    if (refreshIss) refreshIss.addEventListener('click', fetchISSPosition);
    fetchISSPosition();
    setInterval(fetchISSPosition, 30000);
}

async function fetchISSPosition() {
    try {
        const resp = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
        const data = await resp.json();
        $('#issLat').textContent = data.latitude.toFixed(4) + '°';
        $('#issLon').textContent = data.longitude.toFixed(4) + '°';
        $('#issAlt').textContent = Math.round(data.altitude) + ' km';
        $('#issVel').textContent = Math.round(data.velocity) + ' km/h';
        const visEl = $('#issVisibility');
        if (visEl) visEl.innerHTML = `<span class="vis-dot"></span><span>${data.visibility === 'daylight' ? '☀️ Daylight' : '🌙 Nighttime'}</span>`;
        updateStatus('issStatus', 'Tracking', 'active');
    } catch (err) {
        updateStatus('issStatus', 'Offline', 'error');
    }
}


// ─── Status Helpers ───────────────────────────────────────────────────
function updateAgentStatus(text, dotClass) { updateStatus('agentStatus', text, dotClass); }

function updateStatus(id, text, dotClass) {
    const el = $(`#${id}`);
    if (el) el.innerHTML = `<span class="status-dot ${dotClass}"></span> ${text}`;
}

function parseResponseForDashboard(response) {
    const lower = response.toLowerCase();
    if (lower.includes('no-go')) updateStatus('weatherStatus', 'NO-GO', 'error');
    else if (lower.includes('marginal')) updateStatus('weatherStatus', 'MARGINAL', 'pending');
    else if (lower.includes(' go') || lower.includes('clear sky')) updateStatus('weatherStatus', 'GO', 'active');
}

// ─── Graph Initialization ───────────────────────────────────────
function initPipelineGraph() {
    state.pipelineGraph = null;   // Sidebar now uses static CSS nodes via updateAgentFlowUI
    state.flowGraph = new FlowGraph('flowGraphContent');

    // Global tooltip tracking
    const tooltip = document.getElementById('flowTooltip');
    if (tooltip) {
        document.addEventListener('mousemove', (e) => {
            if (tooltip.style.display !== 'none') {
                tooltip.style.left = (e.clientX + 15) + 'px';
                tooltip.style.top  = Math.min(e.clientY - 10, window.innerHeight - tooltip.offsetHeight - 10) + 'px';
            }
        });
    }

    // Wire refresh button for events panel
    const refreshBtn = document.getElementById('refreshEventsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadLiveEvents);

    // Auto-load events & launch data on startup
    loadLiveEvents();
    loadNextLaunch();
}


// ─── Static Sidebar Pipeline Flow ─────────────────────────────
// Shows which agent is currently ACTIVE in the 4-node sidebar diagram
function updateAgentFlowUI(activeAgentName) {
    const nodes = document.querySelectorAll('.flow-node');
    if (!nodes || nodes.length === 0) return;

    let foundActive = false;
    nodes.forEach(node => {
        const agentId = node.dataset.agent;
        if (activeAgentName === 'completed_all') {
            node.classList.remove('active');
            node.classList.add('completed');
            return;
        }
        if (agentId === activeAgentName) {
            node.classList.add('active');
            node.classList.remove('completed');
            foundActive = true;
        } else if (!foundActive) {
            node.classList.remove('active');
            node.classList.add('completed');
        } else {
            node.classList.remove('active');
            node.classList.remove('completed');
        }
    });

    const arrows = document.querySelectorAll('.flow-arrow');
    if (activeAgentName === 'completed_all') {
        arrows.forEach(a => { a.classList.remove('active'); a.classList.add('completed'); });
        return;
    }
    arrows.forEach(arrow => {
        const prev = arrow.previousElementSibling;
        const next = arrow.nextElementSibling;
        if (prev && next) {
            const prevDone = prev.classList.contains('completed') || prev.classList.contains('active');
            const nextActive = next.classList.contains('active') || next.classList.contains('completed');
            if (prevDone && nextActive) {
                arrow.classList.add('active'); arrow.classList.remove('completed');
            } else {
                arrow.classList.remove('active'); arrow.classList.remove('completed');
            }
        }
    });
}


// ─── FlowGraph — Right panel "Agent Flow" tab ──────────────────────
/**
 * Builds a live directed flow graph inside the Agent Flow tab.
 * Each SSE event (agent_switch, tool_call, tool_result, transfer) adds
 * to the graph, showing loops/retries and tool call paths clearly.
 * Hover any node to see the agent reasoning or tool output.
 */
class FlowGraph {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.blocks   = [];   // [{agent, step, status, tools[], thoughts[], transferTo, transferReason, isRetry}]
        this.current  = null;
        this.stepCount = 0;

        this.AGENT_CFG = {
            stargazer_greeter:  { bg:'rgba(30,8,53,0.8)',  border:'#7c3aed', text:'#c4b5fd', emoji:'🌌', label:'Mission Control' },
            stargazer_workflow: { bg:'rgba(30,27,75,0.8)', border:'#4f46e5', text:'#a5b4fc', emoji:'⚙️',  label:'Orchestrator'   },
            orbital_agent:      { bg:'rgba(12,74,110,0.8)',border:'#0284c7', text:'#7dd3fc', emoji:'🛰️', label:'Orbital Agent'   },
            weather_agent:      { bg:'rgba(6,78,59,0.8)',  border:'#059669', text:'#6ee7b7', emoji:'🌤️', label:'Weather Agent'   },
            logistics_agent:    { bg:'rgba(69,26,3,0.8)',  border:'#d97706', text:'#fcd34d', emoji:'🗺️', label:'Logistics Agent' },
        };
    }

    _cfg(agent) {
        return this.AGENT_CFG[agent] || { bg:'rgba(30,41,59,0.8)', border:'#64748b', text:'#94a3b8', emoji:'🤖', label: agent };
    }

    onAgentSwitch(agent, pendingReason) {
        if (this.current) this.current.status = 'completed';
        const prevCount = this.blocks.filter(b => b.agent === agent).length;
        this.stepCount++;
        this.current = {
            agent, step: this.stepCount, status: 'active',
            tools: [], thoughts: [], transferTo: null,
            transferReason: pendingReason || '',
            isRetry: prevCount > 0
        };
        this.blocks.push(this.current);
        this._render();
    }

    onThinking(text) {
        if (this.current && text) {
            this.current.thoughts.push(text.slice(0, 300));
        }
    }

    onTransfer(from, to, reason) {
        if (this.current) {
            this.current.transferTo     = to;
            this.current.transferReason = reason || this.current.transferReason;
        }
    }

    onToolCall(name, args) {
        if (!this.current) return;
        this.stepCount++;
        this.current.tools.push({ name, args, result: null, step: this.stepCount, status: 'running' });
        this._render();
    }

    onToolResult(name, preview) {
        if (!this.current) return;
        for (let i = this.current.tools.length - 1; i >= 0; i--) {
            if (this.current.tools[i].name === name) {
                this.current.tools[i].result = preview;
                this.current.tools[i].status = 'done';
                break;
            }
        }
        this._render();
    }

    markComplete() {
        if (this.current) { this.current.status = 'completed'; }
        this._render();
    }

    reset() {
        this.blocks = []; this.current = null; this.stepCount = 0;
        this._render();
    }

    _render() {
        if (!this.container) return;
        const empty = document.getElementById('flowEmpty');
        if (this.blocks.length === 0) {
            if (empty) empty.style.display = 'block';
            this.container.innerHTML = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        let html = '';
        this.blocks.forEach((block, idx) => {
            const cfg      = this._cfg(block.agent);
            const isActive = block.status === 'active';
            const tooltip  = this._buildAgentTooltip(block);
            const retryBadge = block.isRetry
                ? `<span class="fg-retry-badge">RETRY</span>` : '';
            const statusText = isActive ? 'Running' : 'Done';
            const toolCount  = block.tools.length;
            const blockId    = `fg-block-${idx}`;

            html += `
            <div class="fg-agent-block ${isActive ? 'active' : 'completed'} ${tooltip ? 'has-tooltip' : ''}"
                 style="--agent-color:${cfg.border};--agent-bg:${cfg.bg};--agent-text:${cfg.text};"
                 data-tooltip="${escapeHtml(tooltip)}">
                <div class="fg-agent-header">
                    <div class="fg-step-badge" style="background:${cfg.border};">${block.step}</div>
                    <span class="fg-agent-name" style="color:${cfg.text};">${cfg.label}</span>
                    ${retryBadge}
                    ${toolCount > 0 ? `<button class="fg-expand-btn" onclick="this.closest('.fg-agent-block').classList.toggle('fg-expanded');this.textContent=this.closest('.fg-agent-block').classList.contains('fg-expanded')?'Hide':'${toolCount} tools'" data-count="${toolCount}">${toolCount} tools</button>` : ''}
                    <span class="fg-status-chip ${isActive ? 'running' : 'done'}">${statusText}</span>
                </div>`;

            if (toolCount > 0) {
                html += `<div class="fg-tools-list">`;
                block.tools.forEach(t => {
                    const toolTip = t.result
                        ? `Output: ${t.result.slice(0, 350)}${t.result.length > 350 ? '…' : ''}`
                        : `Args: ${JSON.stringify(t.args).slice(0, 300)}`;
                    const doneIcon = t.status === 'done' ? '✓' : '◌';
                    html += `
                    <div class="fg-tool ${t.status}" data-tooltip="${escapeHtml(toolTip)}">
                        <span class="fg-tool-status">${doneIcon}</span>
                        <span class="fg-tool-name">${escapeHtml(t.name)}</span>
                        <span class="fg-tool-step">#${t.step}</span>
                    </div>`;
                });
                html += `</div>`;
            }

            html += `</div>`;

            // Connector between blocks
            if (idx < this.blocks.length - 1) {
                const nextBlock = this.blocks[idx + 1];
                const isLoop = nextBlock.isRetry;
                const reason  = (block.transferReason || '').slice(0, 70);
                const loopClass = isLoop ? 'loop' : '';
                html += `
                <div class="fg-connector ${loopClass}">
                    <div class="fg-connector-line"></div>
                    ${reason ? `<div class="fg-connector-label" data-tooltip="${escapeHtml(block.transferReason || '')}">${escapeHtml(reason)}${(block.transferReason||'').length > 70 ? '…' : ''}</div>` : ''}
                    <div class="fg-connector-arrow">${isLoop ? '↻' : '↓'}</div>
                </div>`;
            }
        });

        this.container.innerHTML = html;
        this._attachTooltips();

        // Scroll to latest
        requestAnimationFrame(() => {
            const body = this.container.closest('.insights-body');
            if (body) body.scrollTop = body.scrollHeight;
        });
    }

    _buildAgentTooltip(block) {
        const thoughts = block.thoughts.join(' ').trim();
        const reason   = (block.transferReason || '').trim();
        let tip = '';
        if (reason) tip += `Reason: ${reason}\n`;
        if (thoughts) tip += `Thinking: ${thoughts.slice(0, 280)}${thoughts.length > 280 ? '…' : ''}`;
        return tip.trim();
    }

    _attachTooltips() {
        const tooltip = document.getElementById('flowTooltip');
        if (!tooltip) return;
        this.container.querySelectorAll('[data-tooltip]').forEach(el => {
            const tip = el.dataset.tooltip;
            if (!tip) return;
            el.addEventListener('mouseenter', (e) => {
                tooltip.innerHTML = `<strong>${escapeHtml(el.querySelector('.fg-agent-name, .fg-tool-name')?.textContent || '')}</strong>${escapeHtml(tip).replace(/\n/g, '<br>')}`;
                tooltip.style.display = 'block';
                tooltip.style.left = (e.clientX + 15) + 'px';
                tooltip.style.top  = (e.clientY - 10) + 'px';
            });
            el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
        });
    }
}

// Keep PipelineGraph class stub so no reference errors (sidebar no longer uses SVG)
class PipelineGraph {
    constructor() { this.nodes = []; this.stepCount = 0; }
    addNode() {}
    markCompleted() {}
    reset() {}
}


// ─── Live Events Panel ────────────────────────────────────────────────
async function loadLiveEvents() {
    const grid = document.getElementById('eventsGrid');
    if (!grid) return;

    // Show loading state
    const loadingEl = document.getElementById('eventsLoadingState');
    if (loadingEl) loadingEl.style.display = 'block';
    // Remove any previously rendered cards (keep loading div)
    grid.querySelectorAll('.event-card').forEach(c => c.remove());

    try {
        const resp = await fetch('/api/events?days_ahead=120');
        const data = await resp.json();

        if (loadingEl) loadingEl.style.display = 'none';

        const events = data.events || [];
        if (events.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#64748b;">No upcoming events found. Try again later.</div>`;
            return;
        }

        // Clear and render live cards
        grid.innerHTML = '';
        events.slice(0, 18).forEach(evt => {
            const card = buildEventCard(evt);
            grid.appendChild(card);
        });
    } catch (err) {
        if (loadingEl) loadingEl.style.display = 'none';
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#f87171;font-size:0.85rem;">⚠️ Could not load events: ${escapeHtml(err.message)}</div>`;
    }
}

function buildEventCard(evt) {
    const div = document.createElement('div');
    const typeMap = {
        MOON_PHASE:      { cls: 'moon',    icon: '🌕', badge: 'Moon Phase' },
        SPACE_EVENT:     { cls: 'eclipse', icon: '🚀', badge: 'Space Event' },
        NEAR_EARTH_OBJECT: { cls: 'meteor', icon: '☄️', badge: 'Asteroid' },
    };
    const { cls, icon, badge } = typeMap[evt.event_type] || { cls: 'meteor', icon: '🌠', badge: evt.event_type || 'Event' };
    div.className = `event-card ${cls}`;

    // Format date
    let dateStr = evt.event_time || '';
    try {
        const d = new Date(dateStr);
        dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
                  (evt.event_time?.includes('T') ? ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '');
    } catch (_) {}

    const details = (evt.details || evt.description || '').slice(0, 120);
    const source = evt.source ? `<span style="color:#334155;font-size:0.68rem;">📡 ${escapeHtml(evt.source)}</span>` : '';

    div.innerHTML = `
        <div class="event-icon">${icon}</div>
        <div class="event-details">
            <h4>${escapeHtml(evt.event_name || evt.name || 'Unknown Event')}</h4>
            <p class="event-date">${escapeHtml(dateStr)}</p>
            <p class="event-desc">${escapeHtml(details)}${details.length >= 120 ? '…' : ''}</p>
            ${source}
        </div>
        <span class="event-type-badge">${escapeHtml(badge)}</span>
    `;
    return div;
}


// ─── Live Dashboard Launch Card ───────────────────────────────────────
async function loadNextLaunch() {
    const el = document.getElementById('nextLaunchInfo');
    if (!el) return;
    el.innerHTML = '<p class="placeholder-text" style="color:#475569;">🚀 Loading launches...</p>';

    try {
        const resp = await fetch('/api/next-launch?limit=3');
        const data = await resp.json();
        const launches = data.launches || [];

        if (launches.length === 0) {
            el.innerHTML = '<p class="placeholder-text">No launches data available right now.</p>';
            return;
        }

        el.innerHTML = launches.map((l, i) => `
            <div style="margin-bottom:${i < launches.length-1 ? '12' : '0'}px;padding-bottom:${i < launches.length-1 ? '12' : '0'}px;border-bottom:${i < launches.length-1 ? '1px solid rgba(255,255,255,0.06)' : 'none'}">
                <div style="font-weight:600;color:#e2e8f0;font-size:0.85rem;margin-bottom:3px;">${escapeHtml(l.name || 'Unknown Launch')}</div>
                <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:2px;">🚀 ${escapeHtml(l.rocket || '')} &nbsp;·&nbsp; ${escapeHtml(l.provider || '')}</div>
                <div style="font-size:0.72rem;color:#64748b;">${escapeHtml(l.pad_location || l.pad_name || '')} &nbsp;·&nbsp; ${formatLaunchTime(l.launch_time_utc)}</div>
                <span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:10px;font-size:0.68rem;background:rgba(124,58,237,0.2);color:#a78bfa;">${escapeHtml(l.status || 'TBD')}</span>
            </div>
        `).join('');
    } catch (err) {
        el.innerHTML = `<p class="placeholder-text" style="color:#f87171;">⚠️ ${escapeHtml(err.message)}</p>`;
    }
}

function formatLaunchTime(utcStr) {
    if (!utcStr) return 'TBD';
    try {
        const d = new Date(utcStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
               ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
    } catch (_) { return utcStr; }
}


// ─── Utilities ────────────────────────────────────────────────────────
function setWelcomeTime() {
    const el = $('#welcomeTime');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
