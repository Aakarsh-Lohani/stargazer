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
            
            // Mark pipeline complete in sidebar flow UI
            if (typeof updateAgentFlowUI === 'function') updateAgentFlowUI('completed_all');
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

        // Update sidebar UI flow diagram
        if (typeof updateAgentFlowUI === 'function') updateAgentFlowUI(evt.agent);
    }

    // ── Agent transfer ──
    if (evt.type === 'transfer') {
        const fromIcon = AGENT_ICONS[evt.from_agent] || '🤖';
        const toIcon = AGENT_ICONS[evt.to_agent] || '🤖';
        updateThinkingBar(thinkingEl, `↗️ → ${evt.to_agent}`);
        appendTraceEntry(`${tsLabel()}<span style="color:#f59e0b">↗️ <strong>Transfer:</strong> ${fromIcon} ${escapeHtml(evt.from_agent)} → ${toIcon} ${escapeHtml(evt.to_agent)}</span>`);
        addProgressLine(thinkingEl, `<span style="color:#f59e0b">↗️ Handing off to ${escapeHtml(evt.to_agent)}</span>`);
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
            // Chat progress — summarise what was found
            addProgressLine(thinkingEl, `<span style="color:#34d399">✓ ${escapeHtml(evt.tool)} returned data</span>`);
        }
    }

    // ── Model thinking ──
    if (evt.type === 'thinking') {
        const text = (evt.text || '').slice(0, 250);
        appendTraceEntry(`${tsLabel()}<span class="trace-think">💭 ${escapeHtml(text)}${(evt.text || '').length > 250 ? '…' : ''}</span>`);
    }

    // ── Streaming text ──
    if (evt.type === 'text') {
        if (!state._textStreamStarted) {
            appendTraceEntry(`${tsLabel()}<span style="color:#475569">📝 Agent composing response...</span>`);
            addProgressLine(thinkingEl, `<span style="color:#34d399">📝 Composing your mission brief...</span>`);
            state._textStreamStarted = true;
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

function formatContent(text) {
    if (!text) return '';
    let html = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/\b(GO)\b(?![\-\w])/g, '<span class="go-status go">GO</span>');
    html = html.replace(/\bNO-GO\b/g, '<span class="go-status nogo">NO-GO</span>');
    html = html.replace(/\bMARGINAL\b/g, '<span class="go-status marginal">MARGINAL</span>');
    html = html.split('\n\n').map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
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

// ─── Agent Flow UI ──────────────────────────────────────────────────
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
         arrows.forEach(arrow => {
             arrow.classList.remove('active');
             arrow.classList.add('completed');
         });
         return;
    }

    arrows.forEach(arrow => {
        const prev = arrow.previousElementSibling;
        const next = arrow.nextElementSibling;
        if (prev && next) {
            if ((prev.classList.contains('completed') || prev.classList.contains('active')) && 
                (next.classList.contains('active') || next.classList.contains('completed'))) {
                arrow.classList.add('active');
                arrow.classList.remove('completed');
            } else {
                arrow.classList.remove('active');
                arrow.classList.remove('completed');
            }
        }
    });
}


// ─── Utilities ────────────────────────────────────────────────────────
function setWelcomeTime() {
    const el = $('#welcomeTime');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
