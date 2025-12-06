$(function () {
    // Эта функция-обертка гарантирует, что код будет выполнен только после
    // полной загрузки HTML-страницы.

    // ==========================================================
    // --- ПЕРЕМЕННЫЕ СОСТОЯНИЯ И ИНИЦИАЛИЗАЦИЯ ---
    // ==========================================================

    const socket = io();
    let board = null;
    let gameId = null;
    let myColor = 'white';

    // Локальный экземпляр игры для проверок ходов и состояния
    let game = new Chess();

    // Элементы интерфейса (UI), полученные с помощью jQuery
    const fenEl = $('#fen');
    const pgnEl = $('#pgn');
    const statusEl = $('#status');
    const searchControls = $('#searchControls');
    const gameControls = $('#gameControls');
    const findGameBtn = $('#findGameBtn');
    const resignBtn = $('#resignBtn');
    const rematchBtn = $('#rematchBtn');

    // ==========================================================
    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    // ==========================================================

    function updateStatus(message) {
        statusEl.text(message);
    }

    // ==========================================================
    // --- Логика шахматной доски (Chessboard.js) ---
    // ==========================================================

    function onDragStart(source, piece) {
        // Запретить ход, если:
        // 1. Игра не началась или закончилась
        if (game.game_over()) return false;

        // 2. Ходят не этой фигурой (например, белые пытаются ходить черными)
        // 'w' - white (белые), 'b' - black (черные)
        if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
            (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }

        // 3. Ход не принадлежит этому игроку
        if ((game.turn() === 'w' && myColor !== 'white') ||
            (game.turn() === 'b' && myColor !== 'black')) {
            return false;
        }
    }

    function onDrop(source, target) {
        // Пробуем сделать ход на локальной доске
        const move = game.move({
            from: source,
            to: target,
            promotion: 'q' // Временно всегда превращаем в ферзя
        });

        // Если ход нелегальный, move будет null. Возвращаем фигуру на место.
        if (move === null) {
            return 'snapback';
        }

        // Если ход легальный, отправляем его на сервер
        console.log('Отправляем легальный ход на сервер:', move);
        socket.emit('move', {
            gameId: gameId,
            move: move
        });
    }

    // Эта функция нужна, чтобы доска обновилась после 'snapback'
    function onSnapEnd() {
        if (board) board.position(game.fen());
    }

    // ==========================================================
    // --- Обработчики событий от СЕРВЕРА (socket.on) ---
    // =================================OLOGY

    // Статус от сервера (например, "Поиск соперника...")
    socket.on('statusUpdate', (status) => {
        updateStatus(status.message);
        // Если игрок один в лобби, кнопка поиска должна быть активна
        if (status.inLobbyAlone) {
             findGameBtn.prop('disabled', false).text('Найти игру');
        }
    });

    // Игра найдена и начинается
    socket.on('gameStart', (data) => {
        console.log('Игра найдена:', data);
        gameId = data.gameId;
        myColor = data.color;

        game.load(data.fen); // Загружаем FEN в локальный экземпляр

        const boardConfig = {
            draggable: true,
            position: data.fen,
            orientation: myColor,
            onDragStart: onDragStart,
            onDrop: onDrop,
            onSnapEnd: onSnapEnd
        };
        board = Chessboard('myBoard', boardConfig);

        searchControls.hide();
        gameControls.show();
        rematchBtn.hide(); // Кнопка реванша скрыта в начале игры
        resignBtn.prop('disabled', false);
        findGameBtn.prop('disabled', false).text('Найти игру'); // Сброс кнопки поиска на случай реванша

        const isMyTurn = (game.turn() === 'w' && myColor === 'white') || (game.turn() === 'b' && myColor === 'black');
        const turnMessage = isMyTurn ? 'Ваш ход.' : 'Ход соперника.';

        updateStatus(`Игра началась. Вы играете за ${myColor}. ${turnMessage}`);
        fenEl.html(data.fen);
        pgnEl.html('Начните игру, чтобы увидеть ходы');
    });

    // Получаем новое состояние доски после чьего-либо хода
    socket.on('gameState', (data) => {
        if (board && data.fen) {
            game.load(data.fen);
            board.position(data.fen);

            fenEl.html(data.fen);
            if (data.pgn) pgnEl.html(data.pgn);

            const isMyTurn = (game.turn() === 'w' && myColor === 'white') || (game.turn() === 'b' && myColor === 'black');
            if (game.game_over()) {
                // Сервер пришлет отдельное событие gameOver, здесь можно ничего не делать
            } else if (isMyTurn) {
                updateStatus('Ваш ход');
            } else {
                updateStatus('Ход соперника');
            }
        }
    });

    // Игра окончена
    socket.on('gameOver', (message) => {
        const fullMessage = `Игра окончена. ${message}`;
        updateStatus(fullMessage);
        alert(fullMessage);

        game.load(game.fen()); // Устанавливаем флаг game_over в локальном экземпляре

        rematchBtn.show().text('Реванш').prop('disabled', false).removeClass('glowing-button');
        resignBtn.prop('disabled', true);
    });

    // ДОБАВЛЕНО: Соперник отключился
    socket.on('opponentDisconnected', () => {
        const message = 'Соперник отключился. Вы победили.';
        updateStatus(message);
        alert(message);

        gameControls.hide();
        searchControls.show();
    });

    // Соперник предложил реванш
    socket.on('rematchOffered', () => {
        updateStatus('Соперник предлагает реванш. Нажмите "Реванш", чтобы принять.');
        rematchBtn.show().addClass('glowing-button').prop('disabled', false).text('Принять реванш');
    });

    // Реванш начинается (старая игра сбрасывается)
    socket.on('gameReset', (data) => {
        myColor = data.newColor; // Цвет может поменяться
        game.load(data.fen); // Сбрасываем локальную игру

        if (!board) { // Если доска не была создана, создаем ее
             const boardConfig = { draggable: true, position: data.fen, orientation: myColor, onDragStart, onDrop, onSnapEnd };
             board = Chessboard('myBoard', boardConfig);
        } else { // Если доска уже есть, просто обновляем
             board.orientation(myColor);
             board.position(data.fen);
        }

        // Обновление UI
        gameControls.show(); // Убедимся, что игровые кнопки видны
        searchControls.hide(); // А кнопки поиска скрыты
        rematchBtn.hide().removeClass('glowing-button'); // Скрываем кнопку реванша
        resignBtn.prop('disabled', false); // Включаем кнопку "Сдаться"

        const isMyTurn = (game.turn() === 'w' && myColor === 'white') || (game.turn() === 'b' && myColor === 'black');
        const turnMessage = isMyTurn ? 'Ваш ход.' : 'Ход соперника.';
        updateStatus(`РЕВАНШ! Теперь вы играете за ${myColor}. ${turnMessage}`);
        fenEl.html(data.fen);
        pgnEl.html('Начните игру, чтобы увидеть ходы');
    });

    // ==========================================================
    // --- Обработчики событий от ПОЛЬЗОВАТЕЛЯ (UI) ---
    // ==========================================================

    findGameBtn.on('click', function() {
        console.log('Кнопка "Найти игру" нажата. Отправляю событие "findGame".');
        updateStatus('Поиск игры...');
        socket.emit('findGame');
        $(this).prop('disabled', true).text('Поиск...'); // $(this) ссылается на кнопку
    });

    resignBtn.on('click', function() {
        if (confirm('Вы уверены, что хотите сдаться?')) {
            socket.emit('resign', { gameId: gameId });
        }
    });

    rematchBtn.on('click', function() {
        socket.emit('rematch', { gameId: gameId });
        // Обновляем UI, показывая, что мы ждем ответа
        $(this).text('Ожидание соперника...').prop('disabled', true).removeClass('glowing-button');
        updateStatus('Запрос на реванш отправлен. Ожидание ответа соперника.');
    });

}); // --- Конец главной функции ---
