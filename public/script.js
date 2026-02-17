/* ============================================
   4 PICS 1 WORD — Client Logic
   ============================================ */

const socket = io();

// ---- State ----
let myName = '';
let isAdmin = false;
let lastState = null;          // Track previous state to diff
let lastChatCount = 0;         // Track how many messages we've rendered
let currentImagesKey = '';     // Track which images are showing

// ---- DOM ----
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const roundBadge = document.getElementById('round-badge');
const leaderboard = document.getElementById('leaderboard');
const imagesContainer = document.getElementById('images-container');
const adminControls = document.getElementById('admin-controls');
const wordHint = document.getElementById('word-hint');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatInputArea = document.getElementById('chat-input-area');
const gameoverOverlay = document.getElementById('gameover-overlay');
const finalRankings = document.getElementById('final-rankings');

const btnStart = document.getElementById('btn-start');
const btnNext = document.getElementById('btn-next');
const btnReveal = document.getElementById('btn-reveal');
const btnReset = document.getElementById('btn-reset');

// ============================================
// JOIN FLOW
// ============================================
joinBtn.addEventListener('click', joinGame);
nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinGame();
});

function joinGame() {
    const name = nameInput.value.trim();
    if (!name) return;
    socket.emit('join', name);
}

socket.on('joined', (data) => {
    myName = data.name;
    isAdmin = data.isAdmin;

    // Switch screens
    joinScreen.classList.remove('active');
    gameScreen.classList.add('active');

    // Show/hide admin controls
    if (isAdmin) {
        adminControls.classList.remove('hidden');
        chatInputArea.classList.add('hidden');
    }
});

// ============================================
// GAME STATE UPDATES (incremental)
// ============================================
socket.on('game:state', (state) => {
    renderRoundBadge(state);
    renderLeaderboard(state);
    renderImages(state);
    renderWordHint(state);
    renderChatIncremental(state.chatMessages);

    // Game over
    if (state.phase === 'finished') {
        showGameOver(state.players);
    } else {
        gameoverOverlay.classList.add('hidden');
    }

    lastState = state;
});

// ============================================
// RENDER: Round Badge
// ============================================
function renderRoundBadge(state) {
    let text;
    if (state.phase === 'lobby') {
        text = 'LOBBY';
    } else if (state.phase === 'finished') {
        text = 'FINISHED';
    } else {
        text = `ROUND ${state.currentRound} / ${state.totalRounds}`;
    }

    if (roundBadge.textContent !== text) {
        roundBadge.textContent = text;
    }
}

// ============================================
// RENDER: Leaderboard (only update changed entries)
// ============================================
function renderLeaderboard(state) {
    const players = state.players;
    const entries = leaderboard.querySelectorAll('.lb-entry');

    // Rebuild only if player count changed
    if (entries.length !== players.length) {
        leaderboard.innerHTML = '';
        players.forEach((p, i) => {
            leaderboard.appendChild(createLeaderboardEntry(p, i));
        });
        return;
    }

    // Otherwise, update in-place
    players.forEach((p, i) => {
        const entry = entries[i];
        const rankEl = entry.querySelector('.lb-rank');
        const nameEl = entry.querySelector('.lb-name');
        const scoreEl = entry.querySelector('.lb-score');
        const pointsEl = entry.querySelector('.lb-points');

        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';

        // Update rank
        const newRankText = `#${i + 1}`;
        if (rankEl.textContent !== newRankText) {
            rankEl.textContent = newRankText;
            rankEl.className = `lb-rank ${rankClass}`;
        }

        // Update name
        const safeName = escapeHtml(p.name);
        if (nameEl.innerHTML !== safeName) {
            nameEl.innerHTML = safeName;
        }

        // Update score (animate if changed)
        const newScoreText = `Points: ${p.score}`;
        if (scoreEl.textContent !== newScoreText) {
            scoreEl.textContent = newScoreText;
            pointsEl.textContent = p.score;
            entry.classList.add('highlight');
            setTimeout(() => entry.classList.remove('highlight'), 600);
        }
    });
}

function createLeaderboardEntry(p, i) {
    const entry = document.createElement('div');
    entry.className = 'lb-entry';
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    entry.innerHTML = `
        <div class="lb-rank ${rankClass}">#${i + 1}</div>
        <div class="lb-info">
            <div class="lb-name">${escapeHtml(p.name)}</div>
            <div class="lb-score">Points: ${p.score}</div>
        </div>
        <div class="lb-points">${p.score}</div>
    `;
    return entry;
}

// ============================================
// RENDER: Images (only re-render if changed)
// ============================================
function renderImages(state) {
    // Build a key to identify what should be shown
    let newKey;
    if (state.phase === 'lobby' || state.images.length === 0) {
        newKey = 'waiting';
    } else if (state.phase === 'finished') {
        newKey = 'finished';
    } else {
        newKey = 'round-' + state.currentRound;
    }

    // Skip if already showing this
    if (newKey === currentImagesKey) return;
    currentImagesKey = newKey;

    if (newKey === 'waiting') {
        imagesContainer.innerHTML = `
            <div class="waiting-state">
                <div class="waiting-icon">🎮</div>
                <p>Waiting for admin to start...</p>
            </div>
        `;
    } else if (newKey === 'finished') {
        imagesContainer.innerHTML = `
            <div class="waiting-state">
                <div class="waiting-icon">🏆</div>
                <p>Game finished!</p>
            </div>
        `;
    } else {
        imagesContainer.innerHTML = state.images.map((src, i) => `
            <div class="image-cell">
                <img src="${src}" alt="Pic ${i + 1}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:#556b7d;font-size:14px;\\'>Image ${i + 1}</div>'">
            </div>
        `).join('');
    }
}

// ============================================
// RENDER: Word Hint (only if changed)
// ============================================
function renderWordHint(state) {
    if (state.phase !== 'playing' || state.wordLength === 0) {
        if (!wordHint.classList.contains('hidden')) {
            wordHint.classList.add('hidden');
        }
        return;
    }

    // Only rebuild if word length changed
    const currentBoxes = wordHint.querySelectorAll('.word-box').length;
    if (currentBoxes === state.wordLength && !wordHint.classList.contains('hidden')) {
        return;
    }

    wordHint.classList.remove('hidden');
    wordHint.innerHTML = '';
    for (let i = 0; i < state.wordLength; i++) {
        const box = document.createElement('div');
        box.className = 'word-box';
        box.textContent = '_';
        wordHint.appendChild(box);
    }
}

// ============================================
// RENDER: Chat (INCREMENTAL — only append new)
// ============================================
function renderChatIncremental(messages) {
    // If we have fewer messages than before (reset happened), rebuild
    if (messages.length < lastChatCount) {
        chatMessages.innerHTML = '';
        lastChatCount = 0;
    }

    // Only append new messages
    const newMessages = messages.slice(lastChatCount);

    newMessages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'chat-msg';

        if (msg.system && msg.correct) {
            div.classList.add('correct-system');
            div.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}</span><span class="msg-text">${escapeHtml(msg.text)}</span>`;
        } else if (msg.system && msg.reveal) {
            div.classList.add('reveal-system');
            div.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}</span><span class="msg-text">${escapeHtml(msg.text)}</span>`;
        } else if (msg.system) {
            div.classList.add('system');
            div.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}</span><span class="msg-text">${escapeHtml(msg.text)}</span>`;
        } else if (msg.correct) {
            div.classList.add('correct-guess');
            div.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}:</span><span class="msg-text">${escapeHtml(msg.text)}</span>`;
        } else {
            div.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}:</span> <span class="msg-text">${escapeHtml(msg.text)}</span>`;
        }

        chatMessages.appendChild(div);
    });

    lastChatCount = messages.length;

    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================
// CHAT INPUT
// ============================================
chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    chatInput.value = '';
    chatInput.focus();
}

// ============================================
// ADMIN CONTROLS
// ============================================
btnStart.addEventListener('click', () => socket.emit('admin:start'));
btnNext.addEventListener('click', () => socket.emit('admin:next'));
btnReveal.addEventListener('click', () => socket.emit('admin:reveal'));
btnReset.addEventListener('click', () => {
    if (confirm('Reset the entire game? All scores will be cleared.')) {
        socket.emit('admin:reset');
        // Reset client tracking
        lastChatCount = 0;
        currentImagesKey = '';
    }
});

// ============================================
// GAME OVER
// ============================================
function showGameOver(players) {
    gameoverOverlay.classList.remove('hidden');

    finalRankings.innerHTML = '';
    players.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'final-rank';

        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

        row.innerHTML = `
            <div class="f-rank">${medal}</div>
            <div class="f-name">${escapeHtml(p.name)}</div>
            <div class="f-score">${p.score} pts</div>
        `;

        finalRankings.appendChild(row);
    });
}

// ============================================
// UTILS
// ============================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// MOBILE: Fix virtual keyboard resizing
// ============================================
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        document.documentElement.style.height = window.visualViewport.height + 'px';
    });
}
