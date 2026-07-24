const { verifySocketToken } = require('../utils/authMiddleware');
const db = require('../db');
const { getUserAccess, canSeeCategory } = require('../utils/entitlements');

// حالة الغرف تُحفظ في الذاكرة (كافية لتشغيل محلي بين أصدقاء)
const rooms = {}; // roomCode -> { hostId, players: [{id,username,socketId}], state, category, word, spyId, votes: {} }

// يجيب فئات "لمّة" وكلماتها من قاعدة البيانات (تعكس تعديلات لوحة التحكم فوراً)
// ويصفّيها حسب صلاحيات المستخدم (فئات مجانية + فئات فتحها بالمتجر أو باشتراك لمّة بلس)
function getAccessibleCategories(userId) {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const words = db.prepare('SELECT * FROM category_words ORDER BY id').all();
  const byCategory = {};
  for (const w of words) (byCategory[w.category_id] ||= []).push(w.word);

  const access = getUserAccess(userId);
  const result = {};
  for (const c of cats) {
    if (!canSeeCategory(access, c)) continue;
    result[c.name] = byCategory[c.id] || [];
  }
  return result;
}

function genRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    players: room.players.map(p => ({ id: p.id, username: p.username })),
    category: room.state === 'lobby' ? null : room.categoryName, // اسم الفئة يظهر للكل (مو الكلمة)
  };
}

function setupGameSockets(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('غير مصرح'));
      const payload = verifySocketToken(token);
      socket.user = payload; // { id, username }
      next();
    } catch (e) {
      next(new Error('جلسة غير صالحة'));
    }
  });

  io.on('connection', (socket) => {
    // ===== إنشاء غرفة =====
    socket.on('create_room', () => {
      let code;
      do { code = genRoomCode(); } while (rooms[code]);

      rooms[code] = {
        code,
        hostId: socket.user.id,
        players: [{ id: socket.user.id, username: socket.user.username, socketId: socket.id }],
        state: 'lobby', // lobby -> playing -> voting -> results
        categoryName: null,
        word: null,
        spyId: null,
        votes: {}
      };

      socket.join(code);
      socket.emit('room_created', publicRoomState(rooms[code]));
    });

    // ===== الانضمام لغرفة =====
    socket.on('join_room', ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return socket.emit('error_msg', 'الغرفة غير موجودة');
      if (room.state !== 'lobby') return socket.emit('error_msg', 'اللعبة بدأت بالفعل');
      if (room.players.some(p => p.id === socket.user.id)) return socket.emit('error_msg', 'أنت بالفعل داخل الغرفة');

      room.players.push({ id: socket.user.id, username: socket.user.username, socketId: socket.id });
      socket.join(roomCode);
      io.to(roomCode).emit('room_update', publicRoomState(room));
    });

    // ===== بدء اللعبة (للمضيف فقط) =====
    socket.on('start_game', ({ roomCode, chosenCategory }) => {
      const room = rooms[roomCode];
      if (!room) return socket.emit('error_msg', 'الغرفة غير موجودة');
      if (room.hostId !== socket.user.id) return socket.emit('error_msg', 'بس المضيف يقدر يبدأ اللعبة');
      if (room.players.length < 3) return socket.emit('error_msg', 'لازم 3 لاعبين على الأقل');

      // الفئات المتاحة تُحسب حسب صلاحيات المضيف (اللي هو اللي يختار الفئة)
      const accessibleCategories = getAccessibleCategories(room.hostId);
      const catNames = Object.keys(accessibleCategories);
      if (catNames.length === 0) return socket.emit('error_msg', 'ما فيه فئات متاحة لك حالياً، افتح فئات من المتجر');

      if (chosenCategory && !accessibleCategories[chosenCategory]) {
        return socket.emit('error_msg', 'هذي الفئة ما هي مفتوحة لك، افتحها من المتجر أول');
      }

      const categoryName = chosenCategory && accessibleCategories[chosenCategory] ? chosenCategory : catNames[Math.floor(Math.random() * catNames.length)];
      const words = accessibleCategories[categoryName];
      const word = words[Math.floor(Math.random() * words.length)];
      const spy = room.players[Math.floor(Math.random() * room.players.length)];

      room.state = 'playing';
      room.categoryName = categoryName;
      room.word = word;
      room.spyId = spy.id;
      room.votes = {};

      room.players.forEach(p => {
        const isSpy = p.id === spy.id;
        io.to(p.socketId).emit('game_started', {
          category: categoryName,
          word: isSpy ? null : word,
          isSpy
        });
      });

      io.to(roomCode).emit('room_update', publicRoomState(room));
    });

    // ===== الانتقال لمرحلة التصويت =====
    socket.on('start_voting', ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return;
      if (room.hostId !== socket.user.id) return socket.emit('error_msg', 'بس المضيف يقدر يبدأ التصويت');
      room.state = 'voting';
      room.votes = {};
      io.to(roomCode).emit('room_update', publicRoomState(room));
    });

    // ===== التصويت =====
    socket.on('cast_vote', ({ roomCode, suspectId }) => {
      const room = rooms[roomCode];
      if (!room || room.state !== 'voting') return;
      room.votes[socket.user.id] = suspectId;

      io.to(roomCode).emit('vote_progress', { votedCount: Object.keys(room.votes).length, total: room.players.length });

      if (Object.keys(room.votes).length === room.players.length) {
        const tally = {};
        Object.values(room.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
        let maxVotes = -1, accusedId = null;
        for (const [id, count] of Object.entries(tally)) {
          if (count > maxVotes) { maxVotes = count; accusedId = id; }
        }
        const spyCaught = String(accusedId) === String(room.spyId);
        room.state = 'results';

        io.to(roomCode).emit('game_results', {
          tally,
          accusedId,
          spyId: room.spyId,
          spyCaught,
          word: room.word,
          category: room.categoryName
        });
      }
    });

    // ===== إعادة تشغيل جولة جديدة بنفس الغرفة =====
    socket.on('play_again', ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return;
      if (room.hostId !== socket.user.id) return;
      room.state = 'lobby';
      room.categoryName = null;
      room.word = null;
      room.spyId = null;
      room.votes = {};
      io.to(roomCode).emit('room_update', publicRoomState(room));
    });

    // ===== قائمة الفئات المتاحة =====
    socket.on('get_categories', () => {
      const accessibleCategories = getAccessibleCategories(socket.user.id);
      socket.emit('categories_list', Object.keys(accessibleCategories));
    });

    // ===== مغادرة/قطع الاتصال =====
    socket.on('disconnect', () => {
      for (const code of Object.keys(rooms)) {
        const room = rooms[code];
        const before = room.players.length;
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.players.length === 0) {
          delete rooms[code];
        } else if (room.players.length !== before) {
          if (room.hostId === socket.user.id && room.players.length > 0) {
            room.hostId = room.players[0].id; // نقل الاستضافة لأول لاعب متبقي
          }
          io.to(code).emit('room_update', publicRoomState(room));
        }
      }
    });
  });
}

module.exports = setupGameSockets;
