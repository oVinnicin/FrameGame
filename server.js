const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8
});

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    // CRIAR SALA
    socket.on('create_room', ({ username }) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            hostId: socket.id,
            players: [{ id: socket.id, name: username, role: 'staff', points: 0 }],
            rankingHistory: { [username]: 0 },
            pendingGuesses: [],
            currentFrame: 0,
            frames: [],
            title: '',
            revealed: false,
            attempts: {},
            correctGuessesInRound: 0,
            winners: [],
        };
        socket.join(roomId);
        socket.emit('room_created', roomId);
        io.to(roomId).emit('update_players', rooms[roomId].players);
    });

    // ENTRAR NA SALA
    socket.on('join_room', ({ roomId, username, requestedRole }) => {
        const room = rooms[roomId];
        if (room) {
            // const newUser = { id: socket.id, name: username, role: 'player', points: room.rankingHistory[username] || 0 };
            // room.players.push(newUser);
            // if (!room.rankingHistory[username]) room.rankingHistory[username] = 0;

            const existingPlayer = room.players.find(p => p.name === username);
            let userRole = requestedRole || 'player';

            if (room.rankingHistory[username] === undefined) {
                room.rankingHistory[username] = 0;
            }

            if (existingPlayer) {
                existingPlayer.id = socket.id;
                existingPlayer.points = room.rankingHistory[username];
                userRole = existingPlayer.role;
            } else {
                const newUser = { id: socket.id, name: username, role: userRole, points: room.rankingHistory[username] };
                room.players.push(newUser);
            }

            socket.join(roomId);
            socket.emit('room_joined', {
                roomId,
                state: { frames: room.frames, currentFrame: room.currentFrame, title: room.title, revealed: room.revealed },
                role: userRole
            });

            if (userRole === 'staff') {
                socket.emit('promoted_to_staff', {
                    state: {
                        frames: room.frames,
                        title: room.title,
                        pendingGuesses: room.pendingGuesses
                    }
                });
            }

            io.to(roomId).emit('update_players', room.players);
        } else {
            socket.emit('room_not_found', "Sala não encontrada.");
        }
    });

    socket.on('kick_player', ({ roomId, targetId }) => {
        const room = rooms[roomId];
        // Verifica se quem está kickando é Staff e não está tentando se kickar
        if (room && socket.id !== targetId) {
            const isStaff = room.players.find(p => p.id === socket.id && p.role === 'staff');
            if (isStaff) {
                const targetPlayer = room.players.find(p => p.id === targetId);
                if (targetPlayer) {
                    // Remove da lista
                    room.players = room.players.filter(p => p.id !== targetId);
                    // Notifica o alvo e o desconecta da sala no socket
                    io.to(targetId).emit('you_were_kicked');
                    io.to(roomId).emit('notification', `${targetPlayer.name} foi removido da sala.`);
                    io.to(roomId).emit('update_players', room.players);
                }
            }
        }
    });

    // PROMOÇÃO DE MEMBRO (Correção de Interface)
    socket.on('promote_member', ({ roomId, targetId }) => {
        const room = rooms[roomId];
        if (room) {
            const player = room.players.find(p => p.id === targetId);
            if (player) {
                player.role = 'staff';
                io.to(targetId).emit('promoted_to_staff', {
                    state: { frames: room.frames, currentFrame: room.currentFrame, title: room.title, pendingGuesses: room.pendingGuesses }
                });
                io.to(roomId).emit('update_players', room.players);
            }
        }
    });

    socket.on('demote_member', ({ roomId, targetId }) => {
        const room = rooms[roomId];
        // Apenas o Host original ou outra staff pode rebaixar (exceto a si mesmo se quiser)
        if (room && room.players.find(p => p.id === socket.id && p.role === 'staff')) {
            const player = room.players.find(p => p.id === targetId);
            if (player && player.role === 'staff') {
                player.role = 'player';
                io.to(targetId).emit('demoted_to_player');
                io.to(roomId).emit('update_players', room.players);
                io.to(roomId).emit('notification', `${player.name} não faz mais parte da Equipe.`);
            }
        }
    });

    // SETUP DO FILME
    socket.on('setup_game', ({ roomId, title, frames }) => {
        if (rooms[roomId]) {
            rooms[roomId].title = title;
            rooms[roomId].frames = frames;
            rooms[roomId].currentFrame = 0;
            rooms[roomId].revealed = false;
            io.to(roomId).emit('game_started', rooms[roomId]);
        }
    });

    // CONTROLES DE JOGO
    socket.on('change_frame', ({ roomId, index }) => {
        if (rooms[roomId]) {
            rooms[roomId].currentFrame = index;
            rooms[roomId].attempts = {};
            io.to(roomId).emit('update_frame', index);
            io.to(roomId).emit('reset_attempts');
        }
    });

    socket.on('toggle_reveal', ({ roomId }) => {
        if (rooms[roomId]) {
            rooms[roomId].revealed = !rooms[roomId].revealed;
            io.to(roomId).emit('update_reveal', { revealed: rooms[roomId].revealed, title: rooms[roomId].title });
        }
    });

    // LOG E APROVAÇÃO (Com ID Único)
    socket.on('send_guess', ({ roomId, username, guess }) => {
        const room = rooms[roomId];
        if (room && !room.revealed) {
            if (!room.attempts) room.attempts = {};
            if (!room.attempts[socket.id]) room.attempts[socket.id] = 0;

            const LIMITE = 1;

            if (room.attempts[socket.id] >= LIMITE) {
                socket.emit('notification', "Limite de palpites atingido para este frame!");
                socket.emit('update_attempts', 0);
                return;
            }

            room.attempts[socket.id]++;

            const data = {
                id: Math.random().toString(36).substring(2, 9),
                playerSocketId: socket.id,
                username,
                guess,
                frame: room.currentFrame + 1
            };
            room.pendingGuesses.push(data);

            room.players.forEach(p => {
                if (p.role === 'staff') io.to(p.id).emit('new_log_staff', data);
            });
            socket.emit('update_attempts', LIMITE - room.attempts[socket.id]);
        }
    });

    // socket.on('approve_answer', ({ roomId, playerSocketId, frame, logId }) => {
    //     const room = rooms[roomId];
    //     if (room) {
    //         const player = room.players.find(p => p.id === playerSocketId);
    //         if (player) {
    //             const pts = (7 - frame);
    //             player.points += pts;
    //             room.rankingHistory[player.name] += pts;

    //             room.pendingGuesses = room.pendingGuesses.filter(g => g.id !== logId);

    //             io.to(roomId).emit('update_players', room.players);
    //             io.to(roomId).emit('remove_log_entry', logId);

    //             io.to(playerSocketId).emit('notification', `🎉 ACERTOU! +${pts} pontos`);
    //         }
    //     }
    // });

    socket.on('approve_answer', ({ roomId, playerSocketId, frame, logId }) => {
        const room = rooms[roomId];
        if (room) {
            // Encontra o palpite específico no log para saber o nome do jogador
            const guessEntry = room.pendingGuesses.find(g => g.id === logId);
            if (!guessEntry) return;

            let pts = (7 - frame);
            const playerName = guessEntry.username;

            if (!room.winners) room.winners = [];
            room.winners.push(playerName);

            room.correctGuessesInRound++;
            let bonusText = "";

            if (room.correctGuessesInRound === 1) {
                pts += 3;
                bonusText = " (BÔNUS 1º LUGAR)";
            } else if (room.correctGuessesInRound === 2) {
                pts += 2;
                bonusText = " (BÔNUS 2º LUGAR)";
            } else if (room.correctGuessesInRound === 3) {
                pts += 1;
                bonusText = " (BÔNUS 3º LUGAR)";
            }

            // 1. Atualiza o Histórico Geral (mesmo se estiver offline)
            if (room.rankingHistory[playerName] === undefined) {
                room.rankingHistory[playerName] = 0;
            }
            room.rankingHistory[playerName] += pts;

            // 2. Atualiza o jogador na lista ativa (se ele ainda estiver online)
            const activePlayer = room.players.find(p => p.name === playerName);
            if (activePlayer) {
                activePlayer.points = room.rankingHistory[playerName];
                io.to(activePlayer.id).emit('notification', `🎉 ACERTOU! +${pts} pontos${bonusText}`);
            }

            // 3. Limpa o log e avisa a sala
            room.pendingGuesses = room.pendingGuesses.filter(g => g.id !== logId);
            io.to(roomId).emit('update_players', room.players);
            io.to(roomId).emit('remove_log_entry', logId);
            io.to(playerSocketId).emit('lock_guess');
        }
    });

    socket.on('remove_guess', ({ roomId, logId }) => {
        const room = rooms[roomId];
        if (room) {
            room.pendingGuesses = room.pendingGuesses.filter(g => g.id !== logId);
            io.to(roomId).emit('remove_log_entry', logId);
        }
    });

    socket.on('get_full_ranking', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            socket.emit('full_ranking_data', {
                history: room.rankingHistory,
                players: room.players

            });
        }
    });

    socket.on('next_round', ({ roomId }) => {
        if (rooms[roomId]) {
            rooms[roomId].pendingGuesses = [];
            rooms[roomId].frames = [];
            rooms[roomId].title = '';
            rooms[roomId].revealed = false;
            rooms[roomId].correctGuessesInRound = 0;
            rooms[roomId].winners = [];
            io.to(roomId).emit('prepare_next_round');
        }
    });

    socket.on('disconnecting', () => {
        socket.rooms.forEach(roomId => {
            const room = rooms[roomId];
            if (room) {
                room.players = room.players.filter(p => p.id !== socket.id);

                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('update_players', room.players);
                }
            }
        });
    });

});


const PORT = process.env.PORT || 8080;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server ON at port ${PORT}`);
});