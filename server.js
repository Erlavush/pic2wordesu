const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Load questions
const questions = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8')
);

// ============================================
// GAME CONFIG
// ============================================
const TIMER_SECONDS = 60; // Countdown per round (0 = disabled)

// ============================================
// GAME STATE
// ============================================
const gameState = {
    phase: 'lobby',          // lobby | playing | between | finished
    currentRound: -1,        // index into questions[]
    players: {},             // socketId -> { name, score, rank, isAdmin }
    correctOrder: [],        // array of { name, points } who answered correctly this round
    chatMessages: [],        // { name, text, correct, system, reveal }
    totalRounds: questions.length,
    timer: 0,                // remaining seconds
    revealed: false,         // whether current answer has been revealed
};

// Disconnected players storage for reconnection (name -> { score })
const disconnectedPlayers = {};

// Timer interval reference
let timerInterval = null;

// ============================================
// HELPERS
// ============================================
function getPlayerCount() {
    return Object.values(gameState.players).filter(p => !p.isAdmin).length;
}

function getPlayerList() {
    const list = Object.values(gameState.players)
        .filter(p => !p.isAdmin)
        .sort((a, b) => b.score - a.score);
    list.forEach((p, i) => p.rank = i + 1);
    return list;
}

function getCurrentQuestion() {
    if (gameState.currentRound < 0 || gameState.currentRound >= questions.length) return null;
    return questions[gameState.currentRound];
}

function getNextImages() {
    const nextIdx = gameState.currentRound + 1;
    if (nextIdx >= 0 && nextIdx < questions.length) {
        return questions[nextIdx].images;
    }
    return [];
}

function isNameTaken(name) {
    const upper = name.toUpperCase();
    // Check active players
    for (const p of Object.values(gameState.players)) {
        if (p.name.toUpperCase() === upper) return true;
    }
    return false;
}

function startTimer() {
    stopTimer();
    if (TIMER_SECONDS <= 0) return;

    gameState.timer = TIMER_SECONDS;
    timerInterval = setInterval(() => {
        gameState.timer--;
        io.emit('timer:tick', gameState.timer);

        if (gameState.timer <= 0) {
            stopTimer();
            // Time's up — auto-reveal
            const question = getCurrentQuestion();
            if (question && !gameState.revealed) {
                gameState.revealed = true;
                gameState.chatMessages.push({
                    name: '⏰',
                    text: `Time's up! The answer was: ${question.word}`,
                    correct: false,
                    system: true,
                    reveal: true,
                });
                broadcastState();
            }
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    gameState.timer = 0;
}

function broadcastState() {
    const question = getCurrentQuestion();

    // Determine which admin buttons should be enabled
    const adminBtnState = {
        start: gameState.phase === 'lobby',
        reveal: gameState.phase === 'playing' && !gameState.revealed,
        next: gameState.phase === 'playing',
        reset: true,
    };

    io.emit('game:state', {
        phase: gameState.phase,
        currentRound: gameState.currentRound + 1,
        totalRounds: gameState.totalRounds,
        players: getPlayerList(),
        images: question && gameState.phase === 'playing' ? question.images : [],
        word: null,
        wordLength: question ? question.word.length : 0,
        revealedWord: gameState.revealed && question ? question.word : null,
        chatMessages: gameState.chatMessages.slice(-100),
        timer: gameState.timer,
        revealed: gameState.revealed,
        correctOrder: gameState.correctOrder,
        nextImages: getNextImages(),
        adminBtnState,
    });
}

// ============================================
// SOCKET.IO EVENTS
// ============================================
io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // --- JOIN ---
    socket.on('join', (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;

        const isAdmin = trimmed.toUpperCase() === 'ADMIN';

        // (D) Prevent duplicate names (except ADMIN)
        if (!isAdmin && isNameTaken(trimmed)) {
            socket.emit('join:error', 'That name is already taken! Try a different one.');
            return;
        }

        // (E) Reconnection — restore score if player previously disconnected
        let restoredScore = 0;
        const upperName = trimmed.toUpperCase();
        if (!isAdmin && disconnectedPlayers[upperName] !== undefined) {
            restoredScore = disconnectedPlayers[upperName].score;
            delete disconnectedPlayers[upperName];
        }

        gameState.players[socket.id] = {
            name: trimmed,
            score: restoredScore,
            rank: 0,
            isAdmin,
        };

        console.log(`👤 Joined: ${trimmed}${restoredScore > 0 ? ` (reconnected, score: ${restoredScore})` : ''}`);

        socket.emit('joined', {
            name: trimmed,
            isAdmin,
        });

        // System message
        if (!isAdmin) {
            const reconnectMsg = restoredScore > 0 ? ` (reconnected — ${restoredScore} pts restored!)` : '';
            gameState.chatMessages.push({
                name: '📢',
                text: `${trimmed} has joined the game!${reconnectMsg}`,
                correct: false,
                system: true,
            });
        }

        broadcastState();
    });

    // --- CHAT / GUESS ---
    socket.on('chat', (text) => {
        const player = gameState.players[socket.id];
        if (!player || player.isAdmin) return;

        const trimmedText = text.trim();
        if (!trimmedText) return;

        const question = getCurrentQuestion();
        let isCorrect = false;

        // Check if answer is correct
        if (
            gameState.phase === 'playing' &&
            question &&
            !gameState.revealed &&
            !gameState.correctOrder.find(c => c.name === player.name)
        ) {
            if (trimmedText.toUpperCase() === question.word.toUpperCase()) {
                isCorrect = true;

                const totalPlayers = getPlayerCount();
                const position = gameState.correctOrder.length + 1;
                const points = Math.max(1, totalPlayers - position + 1);
                player.score += points;

                gameState.correctOrder.push({ name: player.name, points });

                gameState.chatMessages.push({
                    name: '✅',
                    text: `${player.name} got it correct! (+${points} pts, ${getOrdinal(position)} place)`,
                    correct: true,
                    system: true,
                    points,
                });
            }
        }

        // Add chat message (mask correct answers)
        if (isCorrect) {
            gameState.chatMessages.push({
                name: player.name,
                text: trimmedText.replace(/./g, '✱'),
                correct: true,
                system: false,
            });
        } else {
            gameState.chatMessages.push({
                name: player.name,
                text: trimmedText,
                correct: false,
                system: false,
            });
        }

        broadcastState();
    });

    // --- ADMIN: START GAME ---
    socket.on('admin:start', () => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAdmin) return;
        if (gameState.phase !== 'lobby') return; // (F) Only in lobby

        gameState.currentRound = 0;
        gameState.phase = 'playing';
        gameState.correctOrder = [];
        gameState.revealed = false;
        gameState.chatMessages.push({
            name: '🎮',
            text: `Round 1 has started! Guess the word!`,
            correct: false,
            system: true,
        });

        startTimer();
        broadcastState();
    });

    // --- ADMIN: NEXT QUESTION ---
    socket.on('admin:next', () => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAdmin) return;
        if (gameState.phase !== 'playing') return; // (F) Only during play

        stopTimer();
        gameState.currentRound++;
        gameState.correctOrder = [];
        gameState.revealed = false;

        if (gameState.currentRound >= questions.length) {
            gameState.phase = 'finished';
            gameState.chatMessages.push({
                name: '🏆',
                text: `Game Over! Final scores are in!`,
                correct: false,
                system: true,
            });
        } else {
            gameState.phase = 'playing';
            gameState.chatMessages.push({
                name: '🎮',
                text: `Round ${gameState.currentRound + 1} has started! Guess the word!`,
                correct: false,
                system: true,
            });
            startTimer();
        }

        broadcastState();
    });

    // --- ADMIN: REVEAL ANSWER ---
    socket.on('admin:reveal', () => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAdmin) return;
        if (gameState.revealed) return; // (F) Already revealed

        const question = getCurrentQuestion();
        if (question) {
            gameState.revealed = true;
            stopTimer();
            gameState.chatMessages.push({
                name: '💡',
                text: `The answer was: ${question.word}`,
                correct: false,
                system: true,
                reveal: true,
            });
        }

        broadcastState();
    });

    // --- ADMIN: RESET GAME ---
    socket.on('admin:reset', () => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAdmin) return;

        stopTimer();
        gameState.phase = 'lobby';
        gameState.currentRound = -1;
        gameState.correctOrder = [];
        gameState.chatMessages = [];
        gameState.revealed = false;

        // Reset all scores and clear disconnected cache
        Object.values(gameState.players).forEach(p => p.score = 0);
        Object.keys(disconnectedPlayers).forEach(k => delete disconnectedPlayers[k]);

        broadcastState();
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const player = gameState.players[socket.id];
        if (player) {
            // (E) Store disconnected player for reconnection
            if (!player.isAdmin && player.score > 0) {
                disconnectedPlayers[player.name.toUpperCase()] = {
                    score: player.score,
                };
            }

            if (!player.isAdmin) {
                gameState.chatMessages.push({
                    name: '📢',
                    text: `${player.name} disconnected.`,
                    correct: false,
                    system: true,
                });
            }
        }
        delete gameState.players[socket.id];
        console.log(`❌ Disconnected: ${socket.id}`);
        broadcastState();
    });
});

// ============================================
// UTILS
// ============================================
function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ============================================
// START SERVER
// ============================================
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  🎮  4 PICS 1 WORD — Classroom Game');
    console.log('═══════════════════════════════════════════');
    console.log(`  Local:    http://localhost:${PORT}`);

    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`  Network:  http://${net.address}:${PORT}`);
            }
        }
    }

    console.log('');
    console.log('  📱  Students connect to the Network URL');
    console.log('  💻  Admin: type ADMIN to control the game');
    console.log(`  ⏱️  Timer: ${TIMER_SECONDS > 0 ? TIMER_SECONDS + 's per round' : 'disabled'}`);
    console.log('═══════════════════════════════════════════');
    console.log('');
});
