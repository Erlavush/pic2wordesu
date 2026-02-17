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
// GAME STATE
// ============================================
const gameState = {
    phase: 'lobby',          // lobby | playing | between | finished
    currentRound: -1,        // index into questions[]
    players: {},             // socketId -> { name, score, rank }
    correctOrder: [],        // array of player names who answered correctly this round
    chatMessages: [],        // { name, text, correct }
    totalRounds: questions.length,
};

// ============================================
// HELPERS
// ============================================
function getPlayerCount() {
    return Object.values(gameState.players).filter(p => p.name !== 'ADMIN').length;
}

function getPlayerList() {
    const list = Object.values(gameState.players)
        .filter(p => p.name !== 'ADMIN')
        .sort((a, b) => b.score - a.score);
    // Assign ranks
    list.forEach((p, i) => p.rank = i + 1);
    return list;
}

function getCurrentQuestion() {
    if (gameState.currentRound < 0 || gameState.currentRound >= questions.length) return null;
    return questions[gameState.currentRound];
}

function broadcastState() {
    const question = getCurrentQuestion();
    io.emit('game:state', {
        phase: gameState.phase,
        currentRound: gameState.currentRound + 1,
        totalRounds: gameState.totalRounds,
        players: getPlayerList(),
        images: question && gameState.phase === 'playing' ? question.images : [],
        word: null,  // never send the word to clients
        wordLength: question ? question.word.length : 0,
        chatMessages: gameState.chatMessages.slice(-100),
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

        gameState.players[socket.id] = {
            name: trimmed,
            score: 0,
            rank: 0,
            isAdmin: trimmed.toUpperCase() === 'ADMIN',
        };

        console.log(`👤 Joined: ${trimmed}`);

        // Send role back
        socket.emit('joined', {
            name: trimmed,
            isAdmin: trimmed.toUpperCase() === 'ADMIN',
        });

        // System message
        if (!gameState.players[socket.id].isAdmin) {
            gameState.chatMessages.push({
                name: '📢',
                text: `${trimmed} has joined the game!`,
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

        // Check if answer is correct (case-insensitive)
        if (
            gameState.phase === 'playing' &&
            question &&
            !gameState.correctOrder.includes(player.name)
        ) {
            if (trimmedText.toUpperCase() === question.word.toUpperCase()) {
                isCorrect = true;
                gameState.correctOrder.push(player.name);

                // Calculate points: first = N, second = N-1, ...
                const totalPlayers = getPlayerCount();
                const position = gameState.correctOrder.length; // 1-based
                const points = Math.max(1, totalPlayers - position + 1);
                player.score += points;

                // System message
                gameState.chatMessages.push({
                    name: '✅',
                    text: `${player.name} guessed the word! (+${points} pts)`,
                    correct: true,
                    system: true,
                    points: points,
                });
            }
        }

        // Add chat message (mask correct answers with asterisks)
        if (isCorrect) {
            gameState.chatMessages.push({
                name: player.name,
                text: trimmedText.replace(/./g, '*'),
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

        gameState.currentRound = 0;
        gameState.phase = 'playing';
        gameState.correctOrder = [];
        gameState.chatMessages.push({
            name: '🎮',
            text: `Round 1 has started! Guess the word!`,
            correct: false,
            system: true,
        });

        broadcastState();
    });

    // --- ADMIN: NEXT QUESTION ---
    socket.on('admin:next', () => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAdmin) return;

        gameState.currentRound++;
        gameState.correctOrder = [];

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
                text: `Round ${gameState.currentRound + 1} has started!`,
                correct: false,
                system: true,
            });
        }

        broadcastState();
    });

    // --- ADMIN: REVEAL ANSWER ---
    socket.on('admin:reveal', () => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAdmin) return;

        const question = getCurrentQuestion();
        if (question) {
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

        gameState.phase = 'lobby';
        gameState.currentRound = -1;
        gameState.correctOrder = [];
        gameState.chatMessages = [];

        // Reset all scores
        Object.values(gameState.players).forEach(p => p.score = 0);

        broadcastState();
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const player = gameState.players[socket.id];
        if (player && !player.isAdmin) {
            gameState.chatMessages.push({
                name: '📢',
                text: `${player.name} has left the game.`,
                correct: false,
                system: true,
            });
        }
        delete gameState.players[socket.id];
        console.log(`❌ Disconnected: ${socket.id}`);
        broadcastState();
    });
});

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

    // Show all local IPs for hotspot access
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
    console.log('═══════════════════════════════════════════');
    console.log('');
});
