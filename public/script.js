const socket = io();
let myRole = 'player', myNick = '', currentRoom = '', currentFrames = [];

function notify(msg) {
    const el = document.getElementById('notif-box');
    el.innerText = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

socket.on('notification', (msg) => notify(msg));

function create() {
    myNick = document.getElementById('nick').value;
    if (myNick) socket.emit('create_room', { username: myNick });
}

function join() {
    const code = document.getElementById('room-input').value.toUpperCase();
    myNick = document.getElementById('nick').value;
    if (code && myNick) socket.emit('join_room', { roomId: code, username: myNick });
}

socket.on('room_created', (id) => {
    myRole = 'staff'; currentRoom = id;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('setup-panel').classList.remove('hidden');
    document.getElementById('room-tag').innerText = `SALA: ${id}`;
});

socket.on('room_joined', ({ roomId, state, role }) => {
    currentRoom = roomId; myRole = role;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-view').classList.remove('hidden');
    document.getElementById('room-tag').innerText = `SALA: ${roomId}`;
    if (state && state.frames.length > 0) {
        currentFrames = state.frames;
        document.getElementById('main-frame').src = state.frames[state.currentFrame];
        document.getElementById('correct-title').innerText = state.title;
        if (myRole !== 'staff') document.getElementById('player-ui').classList.remove('hidden');
        if (state.revealed) document.getElementById('overlay').classList.remove('hidden');
    }
});

// CORREÇÃO: PROMOÇÃO IMEDIATA
socket.on('promoted_to_staff', (data) => {
    myRole = 'staff';
    document.getElementById('player-ui').classList.add('hidden');
    document.getElementById('staff-ui').classList.remove('hidden');
    document.getElementById('staff-log').classList.remove('hidden');

    document.getElementById('staff-movie-name').innerText = data.state.title || "Aguardando...";
    notify("Você agora é da Equipe!");
    if (data.state.frames.length > 0) {
        currentFrames = data.state.frames;
        renderDots(currentFrames.length);
    }

    if (data.state.pendingGuesses && data.state.pendingGuesses.length > 0) {
        const list = document.getElementById('log-list');
        list.innerHTML = '';
        data.state.pendingGuesses.forEach(guess => {
            renderSingleLog(guess);
        });
    }
});

socket.on('demoted_to_player', () => {
    myRole = 'player';
    document.getElementById('staff-ui').classList.add('hidden');
    document.getElementById('staff-log').classList.add('hidden');
    document.getElementById('player-ui').classList.remove('hidden');
    notify("Você não é mais da equipe.");
});

async function startGame() {
    const title = document.getElementById('movie-title').value;
    const files = Array.from(document.getElementById('file-input').files);
    if (!title || files.length !== 6) return alert("Selecione 6 frames!");

    document.getElementById('start-btn').innerText = "ENVIANDO...";
    const frames = await Promise.all(files.map(file => {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });
    }));
    socket.emit('setup_game', { roomId: currentRoom, title, frames });
}

socket.on('game_started', (state) => {
    currentFrames = state.frames;
    document.getElementById('setup-panel').classList.add('hidden');
    document.getElementById('game-view').classList.remove('hidden');
    document.getElementById('main-frame').src = state.frames[0];
    document.getElementById('correct-title').innerText = state.title;
    if (myRole === 'staff') {
        document.getElementById('staff-movie-name').innerText = state.title;
        document.getElementById('staff-ui').classList.remove('hidden');
        document.getElementById('staff-log').classList.remove('hidden');
        renderDots(6);
    } else {
        document.getElementById('player-ui').classList.remove('hidden');
    }
});

function renderDots(total) {
    const nav = document.getElementById('nav-dots'); nav.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = `h-12 w-12 bg-yellow-400 border-b-4 border-yellow-600 flex items-center justify-center text-xl font-black rounded-xl cursor-pointer transition-all text-yellow-900`;
        dot.innerText = i + 1;
        dot.onclick = () => socket.emit('change_frame', { roomId: currentRoom, index: i });
        nav.appendChild(dot);
    }
}

socket.on('update_frame', (index) => {
    document.getElementById('main-frame').src = currentFrames[index];
    document.querySelectorAll('.nav-box').forEach((d, i) => d.classList.toggle('active', i === index));
});

function sendGuess() {
    const val = document.getElementById('guess').value;
    if (!val) return;
    socket.emit('send_guess', { roomId: currentRoom, username: myNick, guess: val });
    document.getElementById('guess').value = '';
}

function toggleReveal() { socket.emit('toggle_reveal', { roomId: currentRoom }); }

socket.on('update_reveal', (data) => {
    const overlay = document.getElementById('overlay');
    const guessInput = document.getElementById('guess');
    document.getElementById('correct-title').innerText = data.title;
    data.revealed ? overlay.classList.remove('hidden') : overlay.classList.add('hidden');

    if (data.revealed) {
        overlay.classList.remove('hidden');
        if (myRole === 'player') {
            guessInput.disabled = true;
            guessInput.placeholder = "Rodada encerrada!";
        }
    } else {
        overlay.classList.add('hidden');
        if (myRole === 'player') {
            guessInput.disabled = false;
            guessInput.placeholder = "Seu palpite...";
        }
    }
});


function renderSingleLog(data) {
    const list = document.getElementById('log-list');
    const item = document.createElement('div');
    item.id = `log-${data.id}`;
    item.className = 'bg-slate-50 p-4 rounded-2xl border-b-8 border-slate-300 shadow-sm';
    item.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <span class="text-[10px] font-black text-slate-400 uppercase">${data.username} (FRAME ${data.frame})</span>
        </div>
        <p class="text-slate-700 font-black text-lg leading-tight uppercase mb-3">${data.guess}</p>
        <button id="btn-${data.id}" onclick="approve('${data.playerSocketId}', ${data.frame}, '${data.id}')" 
                class="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-xl font-game border-b-4 border-emerald-700 text-sm">APROVAR</button>`;
    list.prepend(item);
}

// LOG DE STAFF E APROVAÇÃO
socket.on('new_log_staff', (data) => {
    renderSingleLog(data);
});

function approve(pid, frame, lid) {
    const btn = document.getElementById(`btn-${lid}`);
    if (btn) { btn.disabled = true; btn.innerText = "OK"; }
    socket.emit('approve_answer', { roomId: currentRoom, playerSocketId: pid, frame, logId: lid });
}

socket.on('remove_log_entry', (lid) => {
    const el = document.getElementById(`log-${lid}`);
    if (el) el.remove();
});

socket.on('update_players', (players) => {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    players.sort((a, b) => b.points - a.points).forEach((p, idx) => {
        const isMe = p.id === socket.id;
        const div = document.createElement('div');
        div.className = `flex flex-col gap-2 p-3 rounded-2xl border-b-4 transition-all ${isMe ? 'bg-indigo-600 border-indigo-800 text-white scale-100' : 'bg-slate-100 border-slate-300 text-slate-800'}`;

        let controls = '';
        if (myRole === 'staff' && !isMe) {
            controls = `
                <div class="flex gap-1 mt-1">
                    ${p.role !== 'staff' ?
                    `<button onclick="socket.emit('promote_member', {roomId: currentRoom, targetId: '${p.id}'})" class="flex-1 bg-emerald-600 p-1 rounded text-[8px] font-black uppercase text-white">Promover</button>` :
                    `<button onclick="socket.emit('demote_member', {roomId: currentRoom, targetId: '${p.id}'})" class="flex-1 bg-amber-400 p1 rounded text-[8px] font-black uppercase text-white">Rebaixar</button>`
                }
                    <button onclick="socket.emit('kick_player', {roomId: currentRoom, targetId: '${p.id}'})" class="flex-1 bg-red-500 p-1 rounded text-[8px] font-black uppercase text-white">Expulsar</button>
                </div>`;
        }

        div.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="font-game opacity-50 text-xs">#${idx + 1}</span>
                    <p class="font-black truncate w-24">${p.name}</p>
                </div>
                <p class="font-game text-sm bg-black/10 px-2 rounded-lg">${p.points} <span class="text-[8px]">PTS</span></p>
            </div>
            ${controls}
        `;
        list.appendChild(div);
    });
});

function kickPlayer(id) {
    if (confirm("Deseja realmente remover este jogador?")) {
        socket.emit('kick_player', { roomId: currentRoom, targetId: id });
    }
}

// OUVINTES DE STATUS
socket.on('you_were_kicked', () => {
    alert("Você foi removido da sala pela Staff.");
    window.location.reload(); // Recarrega para voltar à tela de login
});

function fetchFullRanking() {
    socket.emit('get_full_ranking', { roomId: currentRoom });
}

// Receber e mostrar o ranking (incluindo quem saiu)
socket.on('full_ranking_data', (history) => {
    const modal = document.getElementById('ranking-modal');
    const list = document.getElementById('full-ranking-list');
    modal.classList.remove('hidden');
    list.innerHTML = '';

    const sorted = Object.entries(history).sort(([, a], [, b]) => b - a);

    sorted.forEach(([name, points], index) => {
        const item = document.createElement('div');
        item.className = "flex justify-between items-center p-4 bg-slate-50 rounded-2xl border-b-4 border-slate-200";
        item.innerHTML = `
            <span class="font-game text-indigo-600">#${index + 1} ${name}</span>
            <span class="font-game text-emerald-500">${points} PTS</span>
        `;
        list.appendChild(item);
    });
});

function requestNextRound() { socket.emit('next_round', { roomId: currentRoom }); }

socket.on('prepare_next_round', () => {
    document.getElementById('overlay').classList.add('hidden');

    const guessInput = document.getElementById('guess');

    if (myRole === 'player') {
        guessInput.disabled = false;
        guessInput.placeholder = "Seu palpite...";
    }

    document.getElementById('log-list').innerHTML = '';
    if (myRole === 'staff') {
        document.getElementById('staff-movie-name').innerText = "Aguardando...";
        document.getElementById('game-view').classList.add('hidden');
        document.getElementById('setup-panel').classList.remove('hidden');
        document.getElementById('start-btn').innerText = "Iniciar Partida";
    } else {
        document.getElementById('player-ui').classList.add('hidden');
        notify("A Equipe está preparando o próximo filme...");
    }
});

document.getElementById('file-input').onchange = (e) => {
    document.getElementById('file-count').innerText = `${e.target.files.length} selecionados`;
};


window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
        document.getElementById('room-input').value = roomFromUrl.toUpperCase();
        notify("Código da sala preenchido via link!");
    }
};

function copyRoomCode() {
    const roomText = document.getElementById('room-tag').innerText;
    const code = roomText.replace('SALA: ', '');

    if (code && code !== '----') {
        navigator.clipboard.writeText(code).then(() => {
            notify("Código copiado! 📋");
        }).catch(err => {
            const tempInput = document.createElement("input");
            tempInput.value = code;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand("copy");
            document.body.removeChild(tempInput);
            notify("Código copiado!");
        });
    }
}
