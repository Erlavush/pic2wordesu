/* ============================================
   4 PICS 1 WORD — Client Logic
   ============================================ */

const socket = io();

// ---- State ----
let myName = '';
let isAdmin = false;

// ---- DOM ----
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const roundBadge = document.getElementById('round-badge');
const leaderboard = document.getElementById('leaderboard');
const imagesContainer = document.getElementById('images-container');
const waitingState = document.getElementById('waiting-state');
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
        chatInputArea.classList.add('hidden'); // admin doesn't chat
    }
});

// ============================================
// GAME STATE UPDATES
// ============================================
socket.on('game:state', (state) => {
    renderRoundBadge(state);
    renderLeaderboard(state.players);
    renderImages(state);
    renderWordHint(state);
    renderChat(state.chatMessages);

    // Game over
    if (state.phase === 'finished') {
        showGameOver(state.players);
    } else {
        gameoverOverlay.classList.add('hidden');
    }
});

// ============================================
// RENDER: Round Badge
// ============================================
function renderRoundBadge(state) {
    if (state.phase === 'lobby') {
        roundBadge.textContent = 'LOBBY';
    } else if (state.phase === 'finished') {
        roundBadge.textContent = 'FINISHED';
    } else {
        roundBadge.textContent = `ROUND ${state.currentRound} / ${state.totalRounds}`;
    }
}

// ============================================
// RENDER: Leaderboard
// ============================================
function renderLeaderboard(players) {
    leaderboard.innerHTML = '';

    players.forEach((p, i) => {
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

        leaderboard.appendChild(entry);
    });
}

// ============================================
// RENDER: Images
// ============================================
function renderImages(state) {
    if (state.phase === 'lobby' || state.images.length === 0) {
        imagesContainer.innerHTML = `
            <div class="waiting-state">
                <div class="waiting-icon">🎮</div>
                <p>Waiting for admin to start...</p>
            </div>
        `;
        return;
    }

    if (state.phase === 'finished') {
        imagesContainer.innerHTML = `
            <div class="waiting-state">
                <div class="waiting-icon">🏆</div>
                <p>Game finished!</p>
            </div>
        `;
        return;
    }

    // Show 4 images
    imagesContainer.innerHTML = state.images.map((src, i) => `
        <div class="image-cell">
            <img src="${src}" alt="Pic ${i + 1}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:#556b7d;font-size:14px;\\'>Image ${i + 1}</div>'">
        </div>
    `).join('');
}

// ============================================
// RENDER: Word Hint (blank boxes)
// ============================================
function renderWordHint(state) {
    if (state.phase !== 'playing' || state.wordLength === 0) {
        wordHint.classList.add('hidden');
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
// RENDER: Chat
// ============================================
function renderChat(messages) {
    chatMessages.innerHTML = '';

    messages.forEach(msg => {
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

