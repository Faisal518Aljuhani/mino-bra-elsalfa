const categoriesData = require('../data/letters-categories');

// حالة الغرف تُحفظ بالذاكرة (كافية لتشغيل محلي/صغير بين أصدقاء)
// roomCode -> { hostId, players, state, columns, letter, roundNumber, answers, doneSet, totalScores, timeoutHandle, graceHandle }
const rooms = {};

function genRoomCode() {
  return 'ح' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

// توحيد الحروف العربية عشان مقارنة الإجابات تكون عادلة (تجاهل التشكيل وأشكال الألف/الياء)
function normalizeArabic(str) {
  if (!str) return '';
  return str
    .trim()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // تشكيل + تطويل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    players: room.players.map(p => ({ id: p.id, username: p.username })),
    columns: room.columns,
    totalScores: room.totalScores,
    roundNumber: room.roundNumber
  };
}

function sanitizeAnswers(columns, answers) {
  const out = {};
  columns.forEach(colId => {
    const val = answers && typeof answers[colId] === 'string' ? answers[colId].trim().slice(0, 40) : '';
    out[colId] = val;
  });
  return out;
}

function pickRandomLetter() {
  const letters = categoriesData.letters;
  return letters[Math.floor(Math.random() * letters.length)];
}

function startRound(io, room) {
  room.state = 'playing';
  room.letter = pickRandomLetter();
  room.roundNumber += 1;
  room.answers = {};
  room.doneSet = new Set();

  const duration = categoriesData.roundSeconds;
  const startedAt = Date.now();

  io.to(room.code).emit('lg_round_started', {
    letter: room.letter,
    columns: room.columns,
    duration,
    startedAt,
    roundNumber: room.roundNumber
  });

  clearTimeout(room.timeoutHandle);
  clearTimeout(room.graceHandle);
  room.timeoutHandle = setTimeout(() => {
    io.to(room.code).emit('lg_time_up');
    // مهلة بسيطة تسمح للأجهزة البطيئة بإرسال آخر إجاباتها قبل الاحتساب
    room.graceHandle = setTimeout(() => finalizeRound(io, room), 2500);
  }, duration * 1000);
}

function finalizeRound(io, room) {
  if (room.state !== 'playing') return; // احتساب سابق تم بالفعل
  room.state = 'reviewing';
  clearTimeout(room.timeoutHandle);
  clearTimeout(room.graceHandle);

  const letter = normalizeArabic(room.letter);
  const perPlayer = {};
  room.players.forEach(p => { perPlayer[p.id] = { answers: {}, columnPoints: {}, roundTotal: 0 }; });

  room.columns.forEach(colId => {
    const groups = {}; // النص الموحّد -> [معرفات اللاعبين اللي كتبوا نفس الإجابة]
    room.players.forEach(p => {
      const raw = (room.answers[p.id] && room.answers[p.id][colId]) || '';
      const norm = normalizeArabic(raw);
      perPlayer[p.id].answers[colId] = raw;
      const valid = norm.length > 0 && norm[0] === letter;
      if (valid) {
        if (!groups[norm]) groups[norm] = [];
        groups[norm].push(p.id);
      }
    });

    Object.values(groups).forEach(userIds => {
      const points = userIds.length === 1 ? 10 : 5;
      userIds.forEach(uid => {
        perPlayer[uid].columnPoints[colId] = points;
        perPlayer[uid].roundTotal += points;
      });
    });

    room.players.forEach(p => {
      if (perPlayer[p.id].columnPoints[colId] === undefined) perPlayer[p.id].columnPoints[colId] = 0;
    });
  });

  room.players.forEach(p => {
    room.totalScores[p.id] = (room.totalScores[p.id] || 0) + perPlayer[p.id].roundTotal;
  });

  io.to(room.code).emit('lg_round_results', {
    letter: room.letter,
    columns: room.columns,
    perPlayer,
    players: room.players.map(p => ({ id: p.id, username: p.username })),
    totalScores: room.totalScores,
    roundNumber: room.roundNumber
  });
}

function setupLettersGameSockets(io) {
  io.on('connection', (socket) => {
    // ===== إنشاء غرفة =====
    socket.on('lg_create_room', () => {
      let code;
      do { code = genRoomCode(); } while (rooms[code]);

      rooms[code] = {
        code,
        hostId: socket.user.id,
        players: [{ id: socket.user.id, username: socket.user.username, socketId: socket.id }],
        state: 'lobby', // lobby -> playing -> reviewing
        columns: categoriesData.defaultColumnIds.slice(),
        letter: null,
        roundNumber: 0,
        answers: {},
        doneSet: new Set(),
        totalScores: { [socket.user.id]: 0 },
        timeoutHandle: null,
        graceHandle: null
      };

      socket.join(code);
      socket.emit('lg_room_created', publicRoomState(rooms[code]));
    });

    // ===== الانضمام لغرفة =====
    socket.on('lg_join_room', ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return socket.emit('lg_error', 'الغرفة غير موجودة');
      if (room.state !== 'lobby') return socket.emit('lg_error', 'اللعبة بدأت بالفعل');
      if (room.players.some(p => p.id === socket.user.id)) return socket.emit('lg_error', 'أنت بالفعل داخل الغرفة');
      if (room.players.length >= 12) return socket.emit('lg_error', 'الغرفة ممتلئة (١٢ لاعب كحد أقصى)');

      room.players.push({ id: socket.user.id, username: socket.user.username, socketId: socket.id });
      if (room.totalScores[socket.user.id] === undefined) room.totalScores[socket.user.id] = 0;
      socket.join(roomCode);
      io.to(roomCode).emit('lg_room_update', publicRoomState(room));
    });

    // ===== المضيف يحدد الخانات المستخدمة =====
    socket.on('lg_set_columns', ({ roomCode, columns }) => {
      const room = rooms[roomCode];
      if (!room) return;
      if (room.hostId !== socket.user.id) return socket.emit('lg_error', 'بس المضيف يقدر يغيّر الخانات');
      if (room.state !== 'lobby') return;

      const valid = Array.isArray(columns) ? columns.filter(c => categoriesData.columns.some(cc => cc.id === c)) : [];
      if (valid.length < 3) return socket.emit('lg_error', 'اختر ٣ خانات على الأقل');

      room.columns = valid;
      io.to(roomCode).emit('lg_room_update', publicRoomState(room));
    });

    // ===== بدء جولة (للمضيف فقط) =====
    socket.on('lg_start_round', ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return socket.emit('lg_error', 'الغرفة غير موجودة');
      if (room.hostId !== socket.user.id) return socket.emit('lg_error', 'بس المضيف يقدر يبدأ الجولة');
      if (room.players.length < 2) return socket.emit('lg_error', 'لازم لاعبين اثنين على الأقل');

      startRound(io, room);
    });

    // ===== إرسال الإجابات (ضغط "تم" أو انتهاء الوقت) =====
    socket.on('lg_submit_done', ({ roomCode, answers }) => {
      const room = rooms[roomCode];
      if (!room || room.state !== 'playing') return;
      if (room.doneSet.has(socket.user.id)) return;

      room.answers[socket.user.id] = sanitizeAnswers(room.columns, answers);
      room.doneSet.add(socket.user.id);

      io.to(roomCode).emit('lg_progress', { doneCount: room.doneSet.size, total: room.players.length });

      if (room.doneSet.size === room.players.length) {
        finalizeRound(io, room);
      }
    });

    // ===== جولة جديدة (نفس اللاعبين والخانات) =====
    socket.on('lg_next_round', ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return;
      if (room.hostId !== socket.user.id) return socket.emit('lg_error', 'بس المضيف يقدر يبدأ جولة جديدة');
      startRound(io, room);
    });

    // ===== إنهاء اللعبة وإعلان الفائز =====
    socket.on('lg_end_game', ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return;
      if (room.hostId !== socket.user.id) return socket.emit('lg_error', 'بس المضيف يقدر ينهي اللعبة');

      io.to(roomCode).emit('lg_game_over', {
        players: room.players.map(p => ({ id: p.id, username: p.username })),
        totalScores: room.totalScores
      });

      room.state = 'lobby';
      room.letter = null;
      room.roundNumber = 0;
      room.answers = {};
      room.doneSet = new Set();
      room.totalScores = {};
      room.players.forEach(p => { room.totalScores[p.id] = 0; });
      io.to(roomCode).emit('lg_room_update', publicRoomState(room));
    });

    // ===== قائمة الخانات المتاحة =====
    socket.on('lg_get_categories', () => {
      socket.emit('lg_categories_list', categoriesData.columns);
    });

    // ===== مغادرة/قطع الاتصال =====
    socket.on('disconnect', () => {
      for (const code of Object.keys(rooms)) {
        const room = rooms[code];
        const before = room.players.length;
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.players.length === 0) {
          clearTimeout(room.timeoutHandle);
          clearTimeout(room.graceHandle);
          delete rooms[code];
        } else if (room.players.length !== before) {
          if (room.hostId === socket.user.id) {
            room.hostId = room.players[0].id; // نقل الاستضافة لأول لاعب متبقي
          }
          io.to(code).emit('lg_room_update', publicRoomState(room));
        }
      }
    });
  });
}

module.exports = setupLettersGameSockets;
