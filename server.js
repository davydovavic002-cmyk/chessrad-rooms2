// Используем новый синтаксис import
import express from 'express';
import http from 'http';
import { Server } from 'socket.io'; // <-- Изменился импорт socket.io
import { Chess } from 'chess.js'; // <-- Теперь это тоже import

const app = express();
const server = http.createServer(app);
// Используем new Server() для socket.io
const io = new Server(server);

const PORT = 3000;

// Для ES-модулей нужно добавить это, чтобы __dirname работал
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ---

app.use(express.static(path.join(__dirname, 'public')));

let waitingPlayer = null;
let games = {}; // { gameId: { game: ChessInstance, players: {w, b} } }

io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    socket.on('findGame', () => {
        console.log(`Игрок ${socket.id} ищет игру.`);
        if (waitingPlayer) {
            const player1 = waitingPlayer;
            const player2 = socket;
            const gameId = `${player1.id}#${player2.id}`;

            games[gameId] = {
                // Теперь используем new Chess(), как требует новая версия chess.js
                game: new Chess(),
                players: { 'w': player1.id, 'b': player2.id }
            };

            console.log(`Игра создана: ${gameId}`);
            player1.emit('gameStart', { gameId: gameId, color: 'w' });
            player2.emit('gameStart', { gameId: gameId, color: 'b' });

            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('waitingForPlayer');
        }
    });

    socket.on('move', (data) => {
        const { gameId, move } = data;
        if (!games[gameId]) return;

        const gameData = games[gameId];
        const game = gameData.game;
        const color = game.turn();

        if (gameData.players[color] !== socket.id) return;

        if (game.isGameOver()) {
             console.log(`Ход в уже оконченной игре ${gameId}`);
             return;
        }

        try {
            // Метод move в новой версии может выбрасывать исключение
            game.move(move);
        } catch (e) {
            console.log(`Неверный ход ${move} в игре ${gameId}`);
            return; // Неверный ход, ничего не делаем
        }

        const opponentColor = color === 'w' ? 'b' : 'w';
        const opponentId = gameData.players[opponentColor];
        io.to(opponentId).emit('move', move);

        if (game.isGameOver()) {
            const message = 'Игра окончена!';
            io.to(gameData.players.w).emit('gameOver', { message });
            io.to(gameData.players.b).emit('gameOver', { message });
            delete games[gameId];
        }
    });

    socket.on('disconnect', () => {
        console.log('Отключение:', socket.id);
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }

        const gameId = Object.keys(games).find(id => id.includes(socket.id));
        if (gameId && games[gameId]) {
            const gameData = games[gameId];
            const opponentColor = gameData.players.w === socket.id ? 'b' : 'w';
            const opponentId = gameData.players[opponentColor];

            if (io.sockets.sockets.get(opponentId)) {
                io.to(opponentId).emit('gameOver', { message: 'Соперник отключился. Вы победили!' });
            }

            delete games[gameId];
            console.log(`Игра ${gameId} удалена из-за отключения игрока.`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
