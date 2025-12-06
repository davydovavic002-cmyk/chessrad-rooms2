// =========================================================================
// --- server.js (Финальная, полная и исправленная версия 4 - с функциями) ---
// =========================================================================

// --- 1. ИМПОРТЫ ---
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Chess } from 'chess.js';
import { v4 as uuidv4 } from 'uuid';

// --- 2. НАСТРОЙКА СЕРВЕРА ---
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// --- 3. УПРАВЛЕНИЕ СОСТОЯНИЕМ ---
let waitingPlayers = [];
const games = {};
const rematchRequests = {};

// ==========================================================
// --- ГЛАВНЫЙ ОБРАБОТЧИК ПОДКЛЮЧЕНИЙ ---
// ==========================================================
io.on('connection', (socket) => {
    console.log(`Новое подключение: ${socket.id}`);

    // --- ПОИСК ИГРЫ ---
    socket.on('findGame', () => {
        console.log(`Игрок ${socket.id} ищет игру.`);
        if (waitingPlayers.some(p => p.id === socket.id)) return;
        waitingPlayers.push(socket);

        if (waitingPlayers.length >= 2) {
            const player1 = waitingPlayers.shift();
            const player2 = waitingPlayers.shift();
            const gameId = uuidv4();
            const chessInstance = new Chess();
            const whitePlayer = Math.random() < 0.5 ? player1 : player2;
            const blackPlayer = whitePlayer === player1 ? player2 : player1;

            games[gameId] = {
                id: gameId,
                board: chessInstance,
                players: [whitePlayer.id, blackPlayer.id],
                playerColors: { [whitePlayer.id]: 'white', [blackPlayer.id]: 'black' },
                gameOver: false
            };

            player1.join(gameId);
            player2.join(gameId);
            console.log(`Игра ${gameId} создана: ${whitePlayer.id} (W) vs ${blackPlayer.id} (B)`);

            io.to(whitePlayer.id).emit('gameStart', { gameId, color: 'white', fen: chessInstance.fen(), pgn: chessInstance.pgn() });
            io.to(blackPlayer.id).emit('gameStart', { gameId, color: 'black', fen: chessInstance.fen(), pgn: chessInstance.pgn() });
        } else {
            socket.emit('statusUpdate', 'Поиск соперника...');
        }
    });

    // --- ОБРАБОТКА ХОДА ---
    socket.on('move', (data) => {
        const { gameId, move } = data;
        const game = games[gameId];
        if (!game || game.gameOver) return;

        const playerColorChar = game.playerColors[socket.id]?.[0];
        if (!playerColorChar || game.board.turn() !== playerColorChar) return;

        const result = game.board.move(move, { sloppy: true }); // sloppy: true - для формата "e2e4"
        if (!result) {
            socket.emit('gameState', { fen: game.board.fen(), pgn: game.board.pgn() });
            return;
        }

        const gameState = { fen: game.board.fen(), pgn: game.board.pgn() };
        io.to(gameId).emit('gameState', gameState);

        if (game.board.isGameOver()) {
            handlePlayerLeaving(socket, gameId, false, true); // Завершение игры по правилам
        }
    });

    // --- ИГРОК СДАЛСЯ ---
    socket.on('resign', (data) => {
        // ИСПРАВЛЕНО: Принимаем { gameId } из объекта data
        const { gameId } = data;
        handlePlayerLeaving(socket, gameId, true, false);
    });

    // --- ЗАПРОС НА РЕВАНШ ---
    socket.on('rematch', (data) => {
        // ИСПРАВЛЕНО: Принимаем { gameId } из объекта data
        const { gameId } = data;
        const game = games[gameId];
        if (!game || !game.gameOver) return;

        if (!rematchRequests[gameId]) {
            rematchRequests[gameId] = new Set();
        }
        rematchRequests[gameId].add(socket.id);

        const opponentId = game.players.find(p => p !== socket.id);

        if (rematchRequests[gameId].size === 2) {
            resetGameForRematch(gameId);
            delete rematchRequests[gameId];
        } else if (opponentId) {
            io.to(opponentId).emit('rematchOffered');
        }
    });

    // --- ОБРАБОТКА ОТКЛЮЧЕНИЯ ---
    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
        waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
        const gameId = Object.keys(games).find(id => games[id]?.players.includes(socket.id));
        if (gameId) {
            handlePlayerLeaving(socket, gameId, false, false);
        }
    });
});

// ==========================================================
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
// ==========================================================

function handlePlayerLeaving(socket, gameId, isResign, isStandardEnd) {
    const game = games[gameId];
    if (!game || game.gameOver) return;

    game.gameOver = true;
    let message = '';

    if (isStandardEnd) { // Игра закончилась по правилам (мат, пат, ничья)
        if (game.board.isCheckmate()) {
            message = `Мат! Победили ${game.board.turn() === 'w' ? 'Черные' : 'Белые'}.`;
        } else if (game.board.isDraw()) {
            message = 'Ничья!';
        }
        console.log(`Игра ${gameId} завершена: ${message}`);
        io.to(gameId).emit('gameOver', message);
    } else { // Игра закончилась из-за выхода игрока
        const opponentId = game.players.find(p => p !== socket.id);
        const reason = isResign ? 'Соперник сдался.' : 'Соперник отключился.';

        if (opponentId) {
            io.to(opponentId).emit('gameOver', `${reason} Вы победили!`);
        }
        if (isResign) {
            socket.emit('gameOver', 'Вы сдались.');
        }
        console.log(`Игра ${gameId} завершена из-за выхода игрока ${socket.id}`);
    }
    // Игру не удаляем, чтобы дать возможность реванша
}

function resetGameForRematch(gameId) {
    const game = games[gameId];
    if (!game) return;

    // Меняем цвета
    const [p1, p2] = game.players;
    const p1OldColor = game.playerColors[p1];
    game.playerColors[p1] = game.playerColors[p2];
    game.playerColors[p2] = p1OldColor;

    game.board.reset();
    game.gameOver = false;
    console.log(`Реванш в игре ${gameId}. Новые цвета: ${JSON.stringify(game.playerColors)}`);

    // Отправляем событие сброса игрокам
    game.players.forEach(playerId => {
        io.to(playerId).emit('gameReset', { // ИСПОЛЬЗУЕМ 'gameReset' как в вашей функции
            newColor: game.playerColors[playerId],
            fen: game.board.fen(),
            pgn: game.board.pgn()
        });
    });
}

// --- 4. ЗАПУСК СЕРВЕРА ---
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
