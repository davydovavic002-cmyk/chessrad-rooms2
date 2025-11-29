// --- 1. Подключение необходимых библиотек ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Chess } = require('chess.js');

// --- 2. Настройка сервера ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Разрешаем подключения с любых адресов (для разработки)
  }
});

// Указываем Express, что все статические файлы нужно брать из папки 'public'
app.use(express.static('public'));

// --- 3. Хранилища данных на сервере ---
let waitingPlayer = null;
let games = {};
let players = {};

// --- 4. Логика Socket.IO ---
io.on('connection', (socket) => {
  console.log('Подключился новый игрок. ID:', socket.id);

  if (waitingPlayer) {
    const opponentSocket = waitingPlayer;
    waitingPlayer = null;

    const gameId = `${opponentSocket.id}#${socket.id}`;
    opponentSocket.join(gameId);
    socket.join(gameId);

    const chess = new Chess();
    games[gameId] = {
      chess: chess,
      players: [opponentSocket.id, socket.id]
    };
    players[opponentSocket.id] = gameId;
    players[socket.id] = gameId;

    console.log(`Игра началась: ${gameId}. Игроки: ${opponentSocket.id} (Белые) vs ${socket.id} (Черные)`);

    opponentSocket.emit('gameStart', { color: 'w', fen: chess.fen() });
    socket.emit('gameStart', { color: 'b', fen: chess.fen() });

  } else {
    waitingPlayer = socket;
    socket.emit('status', 'Ожидаем второго игрока...');
  }

  socket.on('move', (move) => {
    const gameId = players[socket.id];
    if (!gameId) return;

    const game = games[gameId];
    if (!game) return; // Добавим проверку на случай, если игра уже удалена

    const playerColor = (game.players[0] === socket.id) ? 'w' : 'b';

    if (game.chess.turn() === playerColor) {
      const result = game.chess.move(move);

      if (result) {
        io.to(gameId).emit('boardUpdate', game.chess.fen());

        // --- ВОТ ИСПРАВЛЕННЫЙ БЛОК ---
        // Проверяем, не закончилась ли игра, используя ПРАВИЛЬНЫЙ объект и метод
        if (game.chess.isGameOver()) {
          let message = 'Игра окончена.';
          if (game.chess.isCheckmate()) {
            message = `Мат! Победили ${playerColor === 'w' ? 'белые' : 'черные'}.`;
          } else if (game.chess.isStalemate()) {
            message = 'Пат! Ничья.';
          } else if (game.chess.isDraw()) {
            message = 'Ничья.';
          }
          io.to(gameId).emit('gameOver', message);
        }
        // --- КОНЕЦ ИСПРАВЛЕННОГО БЛОКА ---

      } else {
        socket.emit('invalidMove');
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Игрок отключился. ID:', socket.id);

    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
      console.log('Ожидающий игрок отменил поиск.');
      return;
    }

    const gameId = players[socket.id];
    if (gameId) {
      const game = games[gameId];
      if (game) {
        // Сообщаем другому игроку, что его соперник отключился
        const opponentId = game.players.find(p => p !== socket.id);
        if (opponentId) {
            io.to(opponentId).emit('opponentDisconnected');
        }

        // Удаляем игру и информацию об игроках
        delete players[game.players[0]];
        delete players[game.players[1]];
        delete games[gameId];
        console.log(`Игра ${gameId} завершена из-за отключения игрока.`);
      }
    }
  });
});

// --- 5. Запуск сервера ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен и слушает порт ${PORT}`);
  console.log(`Чтобы открыть сайт, перейдите по адресу http://ВАШ_IP_АДРЕС:${PORT}`);
});
