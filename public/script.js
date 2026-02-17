/* ============================================
   4 PICS 1 WORD — Client Logic (Enhanced)
   ============================================ */

const socket = io();

// ---- State ----
let myName = '';
let isAdmin = false;
let lastState = null;
let lastChatCount = 0;
let currentImagesKey = '';

// ---- DOM ----
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
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
const timerDisplay = document.getElementById('timer-display');
const timerFill = document.getElementById('timer-fill');
const roundSummary = document.getElementById('round-summary');
const roundSummaryList = document.getElementById('round-summary-list');

const btnStart = document.getElementById('btn-start');
const btnNext = document.getElementById('btn-next');
const btnReveal = document.getElementById('btn-reveal');
const btnReset = document.getElementById('btn-reset');

// ============================================
// (A) SOUND EFFECTS — Web Audio API
// ============================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
}

function playTone(freq, duration, type = 'sine', volume = 0.3) {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playCorrectSound() {
    // Rising chime: C5 → E5 → G5
    playTone(523, 0.15, 'sine', 0.25);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.25), 100);
    setTimeout(() => playTone(784, 0.3, 'sine', 0.25), 200);
}

function playRoundStartSound() {
    // Whoosh: quick rising sweep
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
}

function playGameOverSound() {
    // Victory fanfare: C → E → G → C (octave)
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
        setTimeout(() => playTone(freq, 0.35, 'triangle', 0.2), i * 200);
    });
}

function playRevealSound() {
    // Single letter reveal pop
    playTone(880, 0.08, 'square', 0.1);
}

function playTimerWarningSound() {
    playTone(440, 0.1, 'square', 0.15);
}

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
    if (joinError) joinError.classList.add('hidden');
    socket.emit('join', name);
}

// (D) Handle join errors
socket.on('join:error', (msg) => {
    if (joinError) {
        joinError.textContent = msg;
        joinError.classList.remove('hidden');
        nameInput.classList.add('input-shake');
        setTimeout(() => nameInput.classList.remove('input-shake'), 500);
    }
});

socket.on('joined', (data) => {
    myName = data.name;
    isAdmin = data.isAdmin;

    joinScreen.classList.remove('active');
    gameScreen.classList.add('active');

    if (isAdmin) {
        adminControls.classList.remove('hidden');
        chatInputArea.classList.add('hidden');
    }

    // Unlock audio context on user interaction
    ensureAudio();
});

// ============================================
// GAME STATE UPDATES (incremental)
// ============================================
socket.on('game:state', (state) => {
    // Detect phase transitions for sound effects
    const prevPhase = lastState ? lastState.phase : 'lobby';
    const prevRound = lastState ? lastState.currentRound : 0;

    renderRoundBadge(state);
    renderLeaderboard(state);
    renderImages(state);
    renderWordHint(state);
    renderChatIncremental(state.chatMessages);
    renderTimer(state);
    renderAdminButtons(state);
    renderRoundSummary(state);
    preloadNextImages(state.nextImages);

    // (A) Sound effects on transitions
    if (state.phase === 'playing' && (prevPhase === 'lobby' || state.currentRound !== prevRound)) {
        playRoundStartSound();
    }

    // Correct answer sound (check if correctOrder grew)
    if (lastState && state.correctOrder && lastState.correctOrder &&
        state.correctOrder.length > lastState.correctOrder.length) {
        playCorrectSound();
    }

    // Game over
    if (state.phase === 'finished') {
        if (prevPhase !== 'finished') playGameOverSound();
        showGameOver(state.players);
    } else {
        gameoverOverlay.classList.add('hidden');
    }

    lastState = state;
});

// ============================================
// (C) TIMER
// ============================================
socket.on('timer:tick', (seconds) => {
    updateTimerDisplay(seconds);

    // Warning sound at 5, 4, 3, 2, 1
    if (seconds > 0 && seconds <= 5) {
        playTimerWarningSound();
    }
});

function updateTimerDisplay(seconds) {
    if (!timerDisplay) return;

    if (seconds <= 0) {
        timerDisplay.classList.add('hidden');
        return;
    }

    timerDisplay.classList.remove('hidden');
    const timerText = timerDisplay.querySelector('.timer-text');
    if (timerText) timerText.textContent = seconds;

    // Update circular progress
    if (timerFill) {
        const maxTime = 60; // match TIMER_SECONDS
        const pct = seconds / maxTime;
        const circumference = 2 * Math.PI * 28; // r=28
        timerFill.style.strokeDasharray = circumference;
        timerFill.style.strokeDashoffset = circumference * (1 - pct);

        // Color changes
        if (seconds <= 5) {
            timerFill.style.stroke = '#ff1744';
            timerDisplay.classList.add('timer-urgent');
        } else if (seconds <= 15) {
            timerFill.style.stroke = '#ff9100';
            timerDisplay.classList.remove('timer-urgent');
        } else {
            timerFill.style.stroke = '#ffffff';
            timerDisplay.classList.remove('timer-urgent');
        }
    }
}

function renderTimer(state) {
    if (state.phase !== 'playing' || state.timer <= 0) {
        if (timerDisplay) timerDisplay.classList.add('hidden');
    } else {
        updateTimerDisplay(state.timer);
    }
}

// ============================================
// RENDER: Round Badge
// ============================================
function renderRoundBadge(state) {
    let text;
    if (state.phase === 'lobby') text = 'LOBBY';
    else if (state.phase === 'finished') text = 'FINISHED';
    else text = `ROUND ${state.currentRound} / ${state.totalRounds}`;

    if (roundBadge.textContent !== text) {
        roundBadge.textContent = text;
    }
}

// ============================================
// RENDER: Leaderboard (incremental)
// ============================================
function renderLeaderboard(state) {
    const players = state.players;
    const entries = leaderboard.querySelectorAll('.lb-entry');

    if (entries.length !== players.length) {
        leaderboard.innerHTML = '';
        players.forEach((p, i) => {
            leaderboard.appendChild(createLeaderboardEntry(p, i));
        });
        return;
    }

    players.forEach((p, i) => {
        const entry = entries[i];
        const rankEl = entry.querySelector('.lb-rank');
        const nameEl = entry.querySelector('.lb-name');
        const scoreEl = entry.querySelector('.lb-score');
        const pointsEl = entry.querySelector('.lb-points');

        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';

        const newRankText = `#${i + 1}`;
        if (rankEl.textContent !== newRankText) {
            rankEl.textContent = newRankText;
            rankEl.className = `lb-rank ${rankClass}`;
        }

        const safeName = escapeHtml(p.name);
        if (nameEl.innerHTML !== safeName) nameEl.innerHTML = safeName;

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
    let newKey;
    if (state.phase === 'lobby' || state.images.length === 0) newKey = 'waiting';
    else if (state.phase === 'finished') newKey = 'finished';
    else newKey = 'round-' + state.currentRound;

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
                <img src="${src}" alt="Pic ${i + 1}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:#444;font-size:14px;\\'>Image ${i + 1}</div>'">
            </div>
        `).join('');
    }
}

// ============================================
// (B) RENDER: Word Hint with REVEAL animation
// ============================================
function renderWordHint(state) {
    if (state.phase !== 'playing' || state.wordLength === 0) {
        if (!wordHint.classList.contains('hidden')) {
            wordHint.classList.add('hidden');
        }
        wordHint.dataset.round = '';
        return;
    }

    const currentBoxes = wordHint.querySelectorAll('.word-box').length;
    const roundChanged = wordHint.dataset.round !== String(state.currentRound);

    if (!roundChanged && currentBoxes === state.wordLength && !wordHint.classList.contains('hidden')) {
        // Same round, same length — just check if we need to animate reveal
        if (state.revealed && !wordHint.dataset.revealed && state.revealedWord) {
            animateReveal(state.revealedWord);
        }
        return;
    }

    // New round or new word length — rebuild boxes
    wordHint.classList.remove('hidden');
    wordHint.dataset.revealed = '';
    wordHint.dataset.round = String(state.currentRound);
    wordHint.innerHTML = '';
    for (let i = 0; i < state.wordLength; i++) {
        const box = document.createElement('div');
        box.className = 'word-box';
        box.textContent = '_';
        wordHint.appendChild(box);
    }

    // If state is already revealed on first render (late joiner), show immediately
    if (state.revealed && state.revealedWord) {
        animateReveal(state.revealedWord);
    }
}

function animateReveal(word) {
    wordHint.dataset.revealed = 'true';

    const boxes = wordHint.querySelectorAll('.word-box');
    boxes.forEach((box, i) => {
        setTimeout(() => {
            box.classList.add('revealed', 'flip');
            if (word && word[i]) {
                box.textContent = word[i].toUpperCase();
            }
            playRevealSound();
        }, i * 120);
    });
}

// Also listen for state to detect reveal
socket.on('game:state', function revealCheck(state) {
    // This is handled in renderWordHint above
});

// ============================================
// (G) RENDER: Round Summary (who answered + points)
// ============================================
function renderRoundSummary(state) {
    if (!roundSummary || !roundSummaryList) return;

    // Show round summary when answer is revealed and there are correct answers
    if (state.revealed && state.correctOrder && state.correctOrder.length > 0) {
        roundSummary.classList.remove('hidden');
        roundSummaryList.innerHTML = '';
        state.correctOrder.forEach((entry, i) => {
            const item = document.createElement('div');
            item.className = 'summary-entry';
            item.style.animationDelay = `${i * 0.1}s`;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            item.innerHTML = `
                <span class="summary-rank">${medal}</span>
                <span class="summary-name">${escapeHtml(entry.name)}</span>
                <span class="summary-pts">+${entry.points}</span>
            `;
            roundSummaryList.appendChild(item);
        });
    } else {
        roundSummary.classList.add('hidden');
    }
}

// ============================================
// (F) RENDER: Admin Button States
// ============================================
function renderAdminButtons(state) {
    if (!isAdmin || !state.adminBtnState) return;

    const s = state.adminBtnState;
    btnStart.disabled = !s.start;
    btnReveal.disabled = !s.reveal;
    btnNext.disabled = !s.next;
    btnReset.disabled = !s.reset;
}

// ============================================
// (H) Image Preloading
// ============================================
function preloadNextImages(nextImages) {
    if (!nextImages || nextImages.length === 0) return;
    nextImages.forEach(src => {
        const img = new Image();
        img.src = src;
    });
}

// ============================================
// RENDER: Chat (INCREMENTAL)
// ============================================
function renderChatIncremental(messages) {
    if (messages.length < lastChatCount) {
        chatMessages.innerHTML = '';
        lastChatCount = 0;
    }

    const newMessages = messages.slice(lastChatCount);
    newMessages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'chat-msg';

        if (msg.system && msg.correct) {
            div.classList.add('correct-system');
        } else if (msg.system && msg.reveal) {
            div.classList.add('reveal-system');
        } else if (msg.system) {
            div.classList.add('system');
        } else if (msg.correct) {
            div.classList.add('correct-guess');
        }

        const separator = msg.system ? '' : ':';
        div.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}${separator}</span><span class="msg-text">${escapeHtml(msg.text)}</span>`;
        chatMessages.appendChild(div);
    });

    lastChatCount = messages.length;
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
