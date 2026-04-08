/**
 * StarGazer — Frontend Application
 * Handles chat interaction, dashboard updates, and UI state management.
 */

// ─── State ──────────────────────────────────────────────────────────
const state = {
    sessionId: null,
    isLoading: false,
    activePanel: 'chat',
};

// ─── DOM Elements ───────────────────────────────────────────────────
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


// ─── Initialize ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initStars();
    initNavigation();
    initChat();
    initDashboard();
    setWelcomeTime();
    initSession();
});


// ─── Stars Background ──────────────────────────────────────────────
function initStars() {
    const container = $('#starsContainer');
    if (!container) return;

    const starCount = 180;
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';

        const size = Math.random() * 2.5 + 0.5;
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const duration = Math.random() * 4 + 2;
        const delay = Math.random() * 4;
        const minOpacity = Math.random() * 0.3 + 0.1;

        star.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${x}%;
            top: ${y}%;
            --duration: ${duration}s;
            --delay: ${delay}s;
            --min-opacity: ${minOpacity};
        `;

        fragment.appendChild(star);
    }

    container.appendChild(fragment);
}


// ─── Navigation ─────────────────────────────────────────────────────
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

            // Close mobile sidebar
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        });
    });

    // Mobile menu
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Close sidebar on outside click (mobile)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 &&
            sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) &&
            !mobileMenuBtn.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });
}


// ─── Session Management ─────────────────────────────────────────────
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


// ─── Chat ───────────────────────────────────────────────────────────
function initChat() {
    // Form submit
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message && !state.isLoading) {
            sendMessage(message);
        }
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    // Enter to send (Shift+Enter for new line)
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit'));
        }
    });

    // Quick prompts
    $$('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.dataset.prompt;
            if (prompt && !state.isLoading) {
                sendMessage(prompt);
            }
        });
    });

    // New session
    if (newSessionBtn) {
        newSessionBtn.addEventListener('click', async () => {
            if (state.isLoading) return;
            await initSession();
            clearChat();
        });
    }

    // Clear chat
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            clearChat();
        });
    }
}

async function sendMessage(message) {
    if (state.isLoading) return;
    state.isLoading = true;

    // Hide quick prompts after first message
    if (quickPrompts) {
        quickPrompts.style.display = 'none';
    }

    // Add user message
    appendMessage('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Show typing indicator
    const typingEl = showTypingIndicator();

    try {
        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                session_id: state.sessionId
            })
        });

        const data = await resp.json();

        // Remove typing indicator
        typingEl.remove();

        if (data.error) {
            appendMessage('agent', `⚠️ Error: ${data.error}`);
            updateAgentStatus('Error', 'error');
        } else {
            appendMessage('agent', data.response);
            state.sessionId = data.session_id;
            updateAgentStatus('Online', 'active');

            // Parse response for status updates
            parseResponseForDashboard(data.response);
        }
    } catch (err) {
        typingEl.remove();
        appendMessage('agent', `⚠️ Connection error. Please check if the server is running.`);
        updateAgentStatus('Offline', 'error');
        console.error('Chat error:', err);
    }

    state.isLoading = false;
}

function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user-message' : 'agent-message'}`;

    const avatar = role === 'user' ? '👤' : '🔭';
    const sender = role === 'user' ? 'You' : 'StarGazer';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Format content — basic markdown support
    const formattedContent = formatContent(content);

    div.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-sender">${sender}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-body">${formattedContent}</div>
        </div>
    `;

    chatMessages.appendChild(div);
    scrollToBottom();
}

function formatContent(text) {
    if (!text) return '';

    // Escape HTML
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // GO/NO-GO badges
    html = html.replace(/\b(GO)\b(?![\-\w])/g, '<span class="go-status go">✅ GO</span>');
    html = html.replace(/\bNO-GO\b/g, '<span class="go-status nogo">❌ NO-GO</span>');
    html = html.replace(/\bMARGINAL\b/g, '<span class="go-status marginal">⚠️ MARGINAL</span>');

    // Line breaks → paragraphs
    html = html
        .split('\n\n')
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');

    return html;
}

function showTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message agent-message';
    div.innerHTML = `
        <div class="message-avatar">🔭</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-sender">StarGazer</span>
                <span class="message-time">thinking...</span>
            </div>
            <div class="message-body">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>
    `;
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
}

function clearChat() {
    // Keep only the welcome message
    const messages = chatMessages.querySelectorAll('.message:not(.welcome-message)');
    messages.forEach(m => m.remove());
    if (quickPrompts) quickPrompts.style.display = 'flex';
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
}


// ─── Dashboard ──────────────────────────────────────────────────────
function initDashboard() {
    const refreshIss = $('#refreshIss');
    if (refreshIss) {
        refreshIss.addEventListener('click', fetchISSPosition);
    }
    // Fetch ISS on load
    fetchISSPosition();
    // Auto-refresh ISS every 30 seconds
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
        if (visEl) {
            visEl.innerHTML = `
                <span class="vis-dot"></span>
                <span>${data.visibility === 'daylight' ? '☀️ Daylight pass' : '🌙 Nighttime pass'}</span>
            `;
        }

        updateStatus('issStatus', 'Tracking', 'active');
    } catch (err) {
        console.error('ISS fetch error:', err);
        updateStatus('issStatus', 'Offline', 'error');
    }
}


// ─── Status Updates ─────────────────────────────────────────────────
function updateAgentStatus(text, dotClass) {
    updateStatus('agentStatus', text, dotClass);
}

function updateStatus(elementId, text, dotClass) {
    const el = $(`#${elementId}`);
    if (el) {
        el.innerHTML = `<span class="status-dot ${dotClass}"></span> ${text}`;
    }
}

function parseResponseForDashboard(response) {
    const lower = response.toLowerCase();

    // Update weather status
    if (lower.includes('go') && !lower.includes('no-go')) {
        updateStatus('weatherStatus', 'GO', 'active');
    } else if (lower.includes('no-go')) {
        updateStatus('weatherStatus', 'NO-GO', 'error');
    } else if (lower.includes('marginal')) {
        updateStatus('weatherStatus', 'MARGINAL', 'pending');
    }
}


// ─── Utilities ──────────────────────────────────────────────────────
function setWelcomeTime() {
    const el = $('#welcomeTime');
    if (el) {
        el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}
