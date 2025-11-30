$(document).ready(function() {
    const socket = io();
    let board = null;
    let chessGame = new Chess();
    let playerColor = 'w';
    let gameId = null;
    let isGameStarted = false;

    const $status = $('#status');
    const $fen = $('#fen');
    const $pgn = $('#pgn');
    const $findGameBtn = $('#findGameBtn');

    function updateStatus() {
        let status = '';
        let moveColor = chessGame.turn() === 'w' ? 'Белых' : 'Черных';

        // --- ВОЗВРАЩАЕМ game_over() и in_check() ---
        if (chessGame.game_over()) {
            status = 'Игра окончена. ';
            if (chessGame.in_checkmate()) {
                status += `Мат. ${moveColor === 'Белых' ? 'Черные' : 'Белые'} победили.`;
            } else if (chessGame.in_draw()) {
                status += 'Ничья.';
            } else if (chessGame.in_stalemate()){
                status += 'Пат. Ничья.';
            } else if (chessGame.in_threefold_repetition()){
                status += 'Ничья (троекратное повторение).';
            } else if (chessGame.insufficient_material()){
                status += 'Ничья (недостаточно материала).';
            }
        } else {
            status = `Ход ${moveColor}.`;
            if (chessGame.in_check()) {
                status += ` ${moveColor} под шахом.`;
            }
        }

        $status.html(status);
        $fen.html(chessGame.fen());
        $pgn.html(chessGame.pgn());
    }

    function onDragStart(source, piece, position, orientation) {
        if (!isGameStarted) return false;

        // --- И ЗДЕСЬ ТОЖЕ game_over() ---
        if (chessGame.game_over() || chessGame.turn() !== playerColor) {
            return false;
        }

        if (piece.search(new RegExp(`^${playerColor === 'w' ? 'b' : 'w'}`)) !== -1) {
            return false;
        }
    }

    function onDrop(source, target) {
        const move = chessGame.move({
            from: source,
            to: target,
            promotion: 'q'
        });

        if (move === null) return 'snapback';

        socket.emit('move', { gameId: gameId, move: move });
        updateStatus();
    }

    function onSnapEnd() {
        board.position(chessGame.fen());
    }

    const boardConfig = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'img/chesspieces/wikipedia/{piece}.png'
    };

    board = Chessboard('myBoard', boardConfig);

    $findGameBtn.on('click', function() {
        $(this).prop('disabled', true).text('Поиск соперника...');
        socket.emit('findGame');
        $status.text('Ищем игру для вас...');
    });

    socket.on('gameStart', function(data) {
        gameId = data.gameId;
        playerColor = data.color;
        isGameStarted = true;
        chessGame = new Chess();

        board.orientation(playerColor === 'w' ? 'white' : 'black');
        board.position(chessGame.fen());
        $findGameBtn.hide();

        const playerColorText = playerColor === 'w' ? 'Белыми' : 'Черными';
        $status.html(`Игра началась! Вы играете ${playerColorText}.`);
        updateStatus();
    });

    socket.on('move', function(move) {
        chessGame.move(move);
        board.position(chessGame.fen());
        updateStatus();
    });

    socket.on('gameOver', function(data) {
        isGameStarted = false;
        $status.text(data.message);
        $findGameBtn.prop('disabled', false).text('Найти новую игру').show();
        updateStatus();
    });

    updateStatus();
});
