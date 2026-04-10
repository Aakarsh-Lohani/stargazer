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
    pipelineGraph: null,   // PipelineGraph instance
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
    // Reset pipeline graph for new conversation turn
    if (state.pipelineGraph) state.pipelineGraph.reset();

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
            
            // Mark last node completed in pipeline graph
            if (state.pipelineGraph) state.pipelineGraph.markCompleted();
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

        // Feed agent switch into the live dynamic pipeline graph
        if (state.pipelineGraph) state.pipelineGraph.addNode(evt.agent);
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
    
    // Parse formatting boxes FIRST, converting newlines to <br> so they stay as solid blocks
    html = html.replace(/:::reasoning\s*([\s\S]*?):::/g, (match, p1) => {
        let content = p1.trim().replace(/\n/g, '<br>');
        return `\n\n<div class="reasoning-panel"><div class="reasoning-header">🧠 Orchestrator Reasoning</div><div class="reasoning-content">${content}</div></div>\n\n`;
    });
    
    html = html.replace(/:::box\s+(\w+)\s*([\s\S]*?):::/g, (match, type, content) => {
        let cleanContent = content.trim().replace(/\n/g, '<br>');
        return `\n\n<div class="info-box box-${type}"><div class="box-content">${cleanContent}</div></div>\n\n`;
    });

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/\b(GO)\b(?![\-\w])/g, '<span class="go-status go">GO</span>');
    html = html.replace(/\bNO-GO\b/g, '<span class="go-status nogo">NO-GO</span>');
    html = html.replace(/\bMARGINAL\b/g, '<span class="go-status marginal">MARGINAL</span>');
    
    // Split into paragraphs, preserving our custom divs
    html = html.split('\n\n').map(p => {
        let trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<div class="reasoning-panel"') || trimmed.startsWith('<div class="info-box')) {
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

// ─── Pipeline Graph (replaces static flow diagram) ───────────────────
function initPipelineGraph() {
    state.pipelineGraph = new PipelineGraph('pipelineGraphSvg');
    // Wire refresh button for events panel
    const refreshBtn = document.getElementById('refreshEventsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadLiveEvents);
    // Auto-load events & launch data immediately
    loadLiveEvents();
    loadNextLaunch();
}


/**
 * PipelineGraph — Real-time directed graph for the sidebar.
 * Each agent_switch event adds a numbered node. Loops are shown
 * as extra nodes (e.g., orbital → weather → orbital → weather → logistics).
 * Renders as inline SVG, updating incrementally.
 */
class PipelineGraph {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.nodes = [];   // [{id, agent, step, status}]
        this.stepCount = 0;

        // Agent styling config
        this.AGENT_CFG = {
            stargazer_greeter:  { bg:'#1e0835', border:'#7c3aed', text:'#c4b5fd', emoji:'🌌', label:'Mission Control' },
            stargazer_workflow: { bg:'#1e1b4b', border:'#4f46e5', text:'#a5b4fc', emoji:'⚙️', label:'Orchestrator' },
            orbital_agent:      { bg:'#0c4a6e', border:'#0284c7', text:'#7dd3fc', emoji:'🛰️', label:'Orbital Agent' },
            weather_agent:      { bg:'#064e3b', border:'#059669', text:'#6ee7b7', emoji:'🌤️', label:'Weather Agent' },
            logistics_agent:    { bg:'#451a03', border:'#d97706', text:'#fcd34d', emoji:'🗺️', label:'Logistics Agent' },
        };
    }

    _cfg(agent) {
        return this.AGENT_CFG[agent] || { bg:'#1e293b', border:'#64748b', text:'#94a3b8', emoji:'🤖', label: agent };
    }

    /** Add a new step node (called on each agent_switch SSE event). */
    addNode(agent) {
        // Mark the previously active node as completed
        this.nodes.forEach(n => { if (n.status === 'active') n.status = 'completed'; });

        this.stepCount++;
        const node = { id: `n${this.stepCount}`, agent, step: this.stepCount, status: 'active' };
        this.nodes.push(node);
        this._render();
    }

    /** Mark the current active node as completed (pipeline done). */
    markCompleted() {
        this.nodes.forEach(n => { if (n.status === 'active') n.status = 'completed'; });
        this._render();
    }

    /** Clear graph for a new conversation turn. */
    reset() {
        this.nodes = [];
        this.stepCount = 0;
        this._render();
    }

    _render() {
        if (!this.container) return;

        // Show empty state
        const emptyEl = document.getElementById('pipelineEmpty');
        if (this.nodes.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            // Clear any old SVG
            const oldSvg = this.container.querySelector('svg');
            if (oldSvg) oldSvg.remove();
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        // Layout constants
        const SVG_W = 240;
        const NODE_X = 20;          // left margin for step circle
        const NODE_W = 200;         // rect width
        const NODE_H = 50;          // rect height
        const STEP_R = 11;          // step circle radius
        const ARROW_H = 30;         // height of arrow connector
        const PAD_TOP = 8;

        const totalH = PAD_TOP + this.nodes.length * (NODE_H + ARROW_H) - ARROW_H + 12;

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', SVG_W);
        svg.setAttribute('height', totalH);
        svg.setAttribute('xmlns', ns);

        // ── Arrow marker defs ──
        const defs = document.createElementNS(ns, 'defs');
        const mkArrow = (id, color) => {
            const m = document.createElementNS(ns, 'marker');
            m.setAttribute('id', id);
            m.setAttribute('markerWidth', '8');
            m.setAttribute('markerHeight', '8');
            m.setAttribute('refX', '6');
            m.setAttribute('refY', '3');
            m.setAttribute('orient', 'auto');
            const p = document.createElementNS(ns, 'path');
            p.setAttribute('d', 'M0,0 L0,6 L8,3 z');
            p.setAttribute('fill', color);
            m.appendChild(p);
            return m;
        };
        defs.appendChild(mkArrow('arr-done', '#7c3aed'));
        defs.appendChild(mkArrow('arr-active', '#34d399'));
        svg.appendChild(defs);

        this.nodes.forEach((node, i) => {
            const cfg = this._cfg(node.agent);
            const isActive  = node.status === 'active';
            const borderClr = isActive ? '#34d399' : cfg.border;
            const y = PAD_TOP + i * (NODE_H + ARROW_H);

            // ── Step circle (left of node) ──
            const circle = document.createElementNS(ns, 'circle');
            circle.setAttribute('cx', NODE_X + STEP_R);
            circle.setAttribute('cy', y + NODE_H / 2);
            circle.setAttribute('r', STEP_R);
            circle.setAttribute('fill', isActive ? '#059669' : cfg.border);
            circle.setAttribute('opacity', '0.95');
            svg.appendChild(circle);

            const stepNum = document.createElementNS(ns, 'text');
            stepNum.setAttribute('x', NODE_X + STEP_R);
            stepNum.setAttribute('y', y + NODE_H / 2 + 4);
            stepNum.setAttribute('text-anchor', 'middle');
            stepNum.setAttribute('fill', 'white');
            stepNum.setAttribute('font-size', '9.5');
            stepNum.setAttribute('font-family', "'JetBrains Mono', monospace");
            stepNum.setAttribute('font-weight', 'bold');
            stepNum.textContent = node.step;
            svg.appendChild(stepNum);

            // ── Node rectangle ──
            const rectX = NODE_X + STEP_R * 2 + 6;
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', rectX);
            rect.setAttribute('y', y);
            rect.setAttribute('width', SVG_W - rectX - 6);
            rect.setAttribute('height', NODE_H);
            rect.setAttribute('rx', '8');
            rect.setAttribute('fill', cfg.bg);
            rect.setAttribute('stroke', borderClr);
            rect.setAttribute('stroke-width', isActive ? '2' : '1.5');
            rect.setAttribute('opacity', '0.96');
            svg.appendChild(rect);

            // Optional glow for active node
            if (isActive) {
                rect.setAttribute('filter', 'drop-shadow(0 0 5px rgba(52,211,153,0.45))');
            }

            // ── Emoji ──
            const emojiX = rectX + 10;
            const emojiEl = document.createElementNS(ns, 'text');
            emojiEl.setAttribute('x', emojiX);
            emojiEl.setAttribute('y', y + 20);
            emojiEl.setAttribute('font-size', '13');
            emojiEl.textContent = cfg.emoji;
            svg.appendChild(emojiEl);

            // ── Agent label ──
            const labelEl = document.createElementNS(ns, 'text');
            labelEl.setAttribute('x', emojiX + 20);
            labelEl.setAttribute('y', y + 19);
            labelEl.setAttribute('fill', cfg.text);
            labelEl.setAttribute('font-size', '9.5');
            labelEl.setAttribute('font-family', "'Inter', sans-serif");
            labelEl.setAttribute('font-weight', '600');
            labelEl.textContent = cfg.label;
            svg.appendChild(labelEl);

            // ── Status text ──
            const statusEl = document.createElementNS(ns, 'text');
            statusEl.setAttribute('x', emojiX + 20);
            statusEl.setAttribute('y', y + 33);
            statusEl.setAttribute('fill', isActive ? '#34d399' : cfg.text);
            statusEl.setAttribute('font-size', '8');
            statusEl.setAttribute('font-family', "'Inter', sans-serif");
            statusEl.setAttribute('opacity', '0.8');
            statusEl.textContent = isActive ? '● Running' : '✓ Done';
            svg.appendChild(statusEl);

            // ── Retry badge (shown when same agent appears more than once) ──
            let prevSameIdx = -1;
            for (let j = i - 1; j >= 0; j--) { if (this.nodes[j].agent === node.agent) { prevSameIdx = j; break; } }
            if (prevSameIdx >= 0) {
                const badge = document.createElementNS(ns, 'rect');
                const badgeW = 38, badgeH = 13;
                badge.setAttribute('x', SVG_W - badgeW - 8);
                badge.setAttribute('y', y + 3);
                badge.setAttribute('width', badgeW);
                badge.setAttribute('height', badgeH);
                badge.setAttribute('rx', '5');
                badge.setAttribute('fill', 'rgba(251,191,36,0.2)');
                badge.setAttribute('stroke', '#fbbf24');
                badge.setAttribute('stroke-width', '0.8');
                svg.appendChild(badge);

                const badgeTxt = document.createElementNS(ns, 'text');
                badgeTxt.setAttribute('x', SVG_W - badgeW / 2 - 8);
                badgeTxt.setAttribute('y', y + 12);
                badgeTxt.setAttribute('text-anchor', 'middle');
                badgeTxt.setAttribute('fill', '#fbbf24');
                badgeTxt.setAttribute('font-size', '7.5');
                badgeTxt.setAttribute('font-family', "'Inter', sans-serif");
                badgeTxt.textContent = '↺ retry';
                svg.appendChild(badgeTxt);
            }

            // ── Connector arrow down (between nodes) ──
            if (i < this.nodes.length - 1) {
                const arrowX = NODE_X + STEP_R;  // align under step circle
                const ay1 = y + NODE_H;
                const ay2 = y + NODE_H + ARROW_H;
                const clr = isActive ? '#34d399' : '#7c3aed';

                const line = document.createElementNS(ns, 'line');
                line.setAttribute('x1', arrowX);
                line.setAttribute('y1', ay1 + 3);
                line.setAttribute('x2', arrowX);
                line.setAttribute('y2', ay2 - 4);
                line.setAttribute('stroke', clr);
                line.setAttribute('stroke-width', '1.5');
                line.setAttribute('stroke-dasharray', isActive ? '4,3' : 'none');
                line.setAttribute('opacity', '0.75');
                line.setAttribute('marker-end', `url(#${isActive ? 'arr-active' : 'arr-done'})`);
                svg.appendChild(line);
            }
        });

        // Replace old SVG
        const oldSvg = this.container.querySelector('svg');
        if (oldSvg) oldSvg.remove();
        this.container.appendChild(svg);

        // Auto-scroll graph to show latest node
        requestAnimationFrame(() => {
            this.container.scrollTop = this.container.scrollHeight;
        });
    }
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
