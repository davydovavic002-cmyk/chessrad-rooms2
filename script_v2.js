// --- Инициализация ---
const socket = io();
const game = new Chess();
let board = null;
let playerColor = null;

// --- Управление элементами интерфейса ---
const findGameBtn = $('#findGameBtn');
const statusEl = $('#status');
const playerColorEl = $('#player-color');
const boardPlaceholder = $('#board-placeholder');
const pgnEl = $('#pgn'); // Элемент для истории ходов

// Показываем заглушку при загрузке страницы
boardPlaceholder.show();

// --- Обработчики событий Socket.IO ---

// Событие: начало игры
socket.on('gameStart', (data) => {
    console.log("Сигнал 'gameStart' получен.", data);

    // 1. Получаем цвет
    playerColor = data.yourColor;

    // 2. Обновляем интерфейс
    playerColorEl.text(playerColor === 'w' ? 'Белые' : 'Черные');
    boardPlaceholder.hide(); // Прячем заглушку
    findGameBtn.prop('disabled', true); // Блокируем кнопку

    // 3. Создаем доску
    const config = {
        draggable: true,
        position: 'start',
        orientation: playerColor === 'w' ? 'white' : 'black',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    board = Chessboard('myBoard', config);

    // 4. Загружаем состояние игры
    game.load(data.fen);
    updateStatus();
});

// Событие: ход сделан (обновление от сервера)
socket.on('updateGame', (data) => {
    game.load(data.fen);
    board.position(data.fen);
    updateStatus();
});

// Событие: конец игры
socket.on('gameEnd', (message) => {
    statusEl.html(message);
    findGameBtn.prop('disabled', false);
});

// --- Логика шахматной доски (Chessboard.js + Chess.js) ---

function onDragStart(source, piece) {
    // Нельзя тащить фигуры, если игра закончена
    if (game.game_over()) return false;

    // Нельзя тащить чужие фигуры или если не твой ход
    if ((game.turn() === 'w' && playerColor !== 'w') ||
        (game.turn() === 'b' && playerColor !== 'b')) {
        return false;
    }

    // Нельзя тащить фигуры соперника
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
}

function onDrop(source, target) {
    // Пробуем сделать ход в логике
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Всегда превращаем в ферзя для простоты
    });

    // Если ход невозможен - возвращаем фигуру назад
    if (move === null) return 'snapback';

    // Если возможен - отправляем на сервер
    socket.emit('move', {
        from: source,
        to: target,
        promotion: 'q'
    });
}

function onSnapEnd() {
    board.position(game.fen());
}

// --- Обновление статуса и истории ---

function updateStatus() {
    let status = '';
    const moveColor = game.turn() === 'w' ? 'Белых' : 'Черных';

    if (game.game_over()) {
        if (game.in_checkmate()) {
            status = 'Игра окончена, ' + moveColor + ' получили мат.';
        } else if (game.in_draw()) {
            status = 'Игра окончена, ничья.';
        } else {
            status = 'Игра окончена.';
        }
    } else {
        status = 'Ход ' + moveColor;
        if (game.in_check()) {
            status += ', ' + moveColor + ' под шахом';
        }
    }

    // Обновляем текст статуса
    statusEl.html(status);

    // ИСПРАВЛЕНО: форматируем PGN для красивого вывода в одну строку
    pgnEl.text(game.pgn({ max_width: 5, newline_char: ' ' }));
}

// --- Обработчик кнопки ---

findGameBtn.on('click', () => {
    statusEl.text('Поиск соперника...');
    socket.emit('findGame');
    findGameBtn.prop('disabled', true);
});
