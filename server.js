const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

const BIRTHDAY_PASSWORD = 'tr0kut.design';

const BOT_TEMPLATES = [
  { id: 'bot_mika', name: 'Mika Bot', avatar: '🦊', social: 84, fun: 86, drunk: 10 },
  { id: 'bot_lala', name: 'Lala Bot', avatar: '🦄', social: 88, fun: 82, drunk: 5 },
  { id: 'bot_zoki', name: 'Zoki Bot', avatar: '🐼', social: 78, fun: 90, drunk: 15 }
];

const BOT_ACTIONS = ['chat', 'joke', 'hug', 'gossip', 'flirt', 'dance'];

const simsPhrases = [
  "Sul Sul",
  "Dag Dag",
  "Kremisch",
  "Chum Cha",
  "Freet Loo",
  "Nooboo",
  "Deg Deb",
  "Whim Wham",
  "Yibs",
  "Zibbs",
  "Sul Sul Bebe",
  "Comn Naps",
  "Moocha",
  "Vadish",
  "Lalo Simoleons",
  "Rett Kew",
  "Booboo",
  "Zing Zing",
  "Plumbob",
  "Glib Glob"
];

const QUESTION_DURATION_SEC = 10;
const QUESTION_DURATION_MS = QUESTION_DURATION_SEC * 1000;

const quizQuestions = [
  {
    q: "1. Kako najlakše probiti led čim ekipa stigne na žurku?",
    options: [
      "1. Skeniraju QR i uđu za tren, pa krene smeh uživo",
      "2. Podelimo svima priručnik od 14 strana",
      "3. Svako sedne u svoj ćošak i gleda u plafon"
    ],
    correct: 0,
    isVote: false
  },
  {
    q: "2. Zašto gosti ne zaborave ovakvu aplikaciju već sledećeg jutra?",
    options: [
      "1. Jer broji klikove kao na kasi",
      "2. Jer te gura ka ljudima u sobi, forama i zajedničkim momentima",
      "3. Jer ima petnaest složenih menija"
    ],
    correct: 1,
    isVote: false
  },
  {
    q: "3. Šta se desi kad neko krene previše uporno da ponavlja istu foru?",
    options: [
      "1. Ugasi mu se telefon iz osvete",
      "2. Dnevnik postane dosadan kao čekaonica",
      "3. Iskoci duhoviti SPAM ALERT koji nasmeje celu prostoriju"
    ],
    correct: 2,
    isVote: false
  },
  {
    q: "4. Po čemu se ovakav projekat razlikuje od običnog linka za igru?",
    options: [
      "1. Ima svoj vizuelni identitet, poster sa QR-om i priču skrojenu za događaj",
      "2. Izgleda kao neuređen test od pre deset godina",
      "3. Radi samo kad niko ne učestvuje"
    ],
    correct: 0,
    isVote: false
  },
  {
    q: "5. Ko daje dušu ovakvom kvizu na pravom rođendanu ili okupljanju?",
    options: [
      "1. Nasumični stranac sa ulice",
      "2. Slavljenik/ca i ekipa kroz lične fore i zajedničke uspomene",
      "3. Automatski robot bez ijedne šale"
    ],
    correct: 1,
    isVote: false
  },
  {
    q: "6. Kako izgleda kad poželiš ovakav doživljaj i za svoj sledeći događaj?",
    options: [
      "1. Ostane samo u beleškama zauvek",
      "2. Čeka neku drugu deceniju",
      "3. Pišeš @tr0kut da osmislite identitet i interaktivni kutak po meri"
    ],
    correct: 2,
    isVote: false
  },
  {
    q: "7. GLASANJE: Koji od ova tri odgovora najviše pogađa duh večeri?",
    options: [
      "1. Više druženja uživo uz pametan digitalni začin",
      "2. Dobre fore koje se prepričavaju i kad se svetla ugase",
      "3. Ideja koja pretvara običnu žurku u malu priču za pamćenje"
    ],
    correct: -1,
    isVote: true
  }
];

let bots = {};
let players = {};
let lobbySockets = new Set();
let activeWooHoo = null;
let activeTelephoneGame = null;
let activeQuiz = null;
let lastActions = {};
let savedPlayerStatsByName = {};

const MAX_LOG_HISTORY = 300;
let actionLogHistory = [];

// Kratki cooldown-ovi za portfolio demo
const DEMO_COOLDOWN_MS = 8 * 1000;

function createInitialBots() {
  const map = {};
  BOT_TEMPLATES.forEach(tpl => {
    map[tpl.id] = {
      id: tpl.id,
      name: tpl.name,
      avatar: tpl.avatar,
      isBot: true,
      isBirthdayGirl: false,
      social: tpl.social,
      fun: tpl.fun,
      drunk: tpl.drunk
    };
  });
  return map;
}

bots = createInitialBots();

function getCombinedEntities() {
  return { ...bots, ...players };
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isNameTaken(normalizedName, excludeSocketId = null) {
  if (!normalizedName) return false;
  const botTaken = Object.values(bots).some(b => normalizeName(b.name) === normalizedName);
  if (botTaken) return true;
  return Object.entries(players).some(([id, p]) => {
    if (excludeSocketId && id === excludeSocketId) return false;
    return normalizeName(p.name) === normalizedName;
  });
}

function findActiveSocketIdByNormalizedName(normalizedName, excludeSocketId = null) {
  if (!normalizedName) return null;
  for (const [id, p] of Object.entries(players)) {
    if (excludeSocketId && id === excludeSocketId) continue;
    if (normalizeName(p.name) === normalizedName) {
      return id;
    }
  }
  return null;
}

function migrateSocketIdInActiveGame(oldSocketId, newSocketId) {
  if (!oldSocketId || !newSocketId || oldSocketId === newSocketId) return;

  if (activeQuiz) {
    if (activeQuiz.hostId === oldSocketId) activeQuiz.hostId = newSocketId;
    if (activeQuiz.readySet && activeQuiz.readySet.has(oldSocketId)) {
      activeQuiz.readySet.delete(oldSocketId);
      activeQuiz.readySet.add(newSocketId);
    }
    if (activeQuiz.answeredCurrent && activeQuiz.answeredCurrent.has(oldSocketId)) {
      activeQuiz.answeredCurrent.delete(oldSocketId);
      activeQuiz.answeredCurrent.add(newSocketId);
    }
    if (activeQuiz.scores && activeQuiz.scores[oldSocketId]) {
      activeQuiz.scores[newSocketId] = activeQuiz.scores[oldSocketId];
      delete activeQuiz.scores[oldSocketId];
    }
    if (activeQuiz.votes && Object.prototype.hasOwnProperty.call(activeQuiz.votes, oldSocketId)) {
      activeQuiz.votes[newSocketId] = activeQuiz.votes[oldSocketId];
      delete activeQuiz.votes[oldSocketId];
    }
  }

  if (activeTelephoneGame) {
    if (activeTelephoneGame.starterId === oldSocketId) activeTelephoneGame.starterId = newSocketId;
    if (activeTelephoneGame.typistId === oldSocketId) activeTelephoneGame.typistId = newSocketId;
  }
}

function recordLogEntry(message, avatar) {
  const entry = {
    message,
    avatar: avatar || '✨',
    timestamp: Date.now()
  };
  actionLogHistory.push(entry);
  if (actionLogHistory.length > MAX_LOG_HISTORY) {
    actionLogHistory = actionLogHistory.slice(actionLogHistory.length - MAX_LOG_HISTORY);
  }
  io.emit('action_log', entry);
}

function syncPlayerStatsToMemory(player) {
  if (!player || !player.name || player.isBot) return;
  const key = normalizeName(player.name);
  if (!key) return;
  savedPlayerStatsByName[key] = {
    social: player.social,
    fun: player.fun,
    drunk: player.drunk,
    isBirthdayGirl: true
  };
}

function syncAllPlayersToMemory() {
  for (const id in players) {
    syncPlayerStatsToMemory(players[id]);
  }
}

function applyInteraction(senderId, targetId, action, customText) {
  const all = getCombinedEntities();
  const sender = all[senderId];
  const target = all[targetId];
  if (!sender || !target) return;

  let message = '';
  let scoreChange = 3;

  if (action === 'chat') {
    message = `${sender.name} ćaska sa ${target.name}.`;
    scoreChange = 3;
  } else if (action === 'joke') {
    message = `${sender.name} priča vic liku ${target.name}! Smeh na žurci.`;
    scoreChange = 5;
  } else if (action === 'hug') {
    message = `${sender.name} grli ${target.name}. Baš slatko!`;
    scoreChange = 5;
  } else if (action === 'gossip') {
    message = `${sender.name} tračari sa ${target.name}! Šok i neverica!`;
    scoreChange = 2;
  } else if (action === 'flirt') {
    message = `${sender.name} flertuje sa ${target.name}! Ooo...`;
    scoreChange = 6;
  } else if (action === 'dance') {
    message = `${sender.name} poziva ${target.name} na ples! Ludnica!`;
    scoreChange = 8;
  } else if (action === 'insult') {
    message = `${sender.name} vređa ${target.name}! Drama!`;
    scoreChange = -10;
  } else if (action === 'custom') {
    const cleanCustom = String(customText || '').trim().replace(/\s+/g, ' ');
    if (!cleanCustom) return;
    message = `${sender.name} ${cleanCustom} sa ${target.name}!`;
    scoreChange = 4;
  } else {
    return;
  }

  target.social = Math.min(100, Math.max(0, target.social + scoreChange));
  target.fun = Math.min(100, Math.max(0, target.fun + scoreChange));
  if (target.isBot) {
    bots[target.id] = target;
  } else {
    syncPlayerStatsToMemory(target);
  }

  if (!sender.isBot) {
    const pairKey = `${senderId}-${targetId}`;
    if (!lastActions[pairKey]) {
      lastActions[pairKey] = { action, count: 1 };
    } else if (lastActions[pairKey].action === action) {
      lastActions[pairKey].count += 1;
    } else {
      lastActions[pairKey] = { action, count: 1 };
    }

    if (lastActions[pairKey].count === 3) {
      lastActions[pairKey].count = 0;
      let spamTitle = '';
      let spamMsg = '';

      switch (action) {
        case 'insult':
          spamTitle = 'VREĐANJE U NEDOGLED!';
          spamMsg = 'ALO MANIJAČE, uzmi pilule za lilule.';
          break;
        case 'flirt':
          spamTitle = 'PRETERANI FLERT!';
          spamMsg = 'JAOO VRAGOLANE!';
          break;
        case 'gossip':
          spamTitle = 'TRAČARA GORI!';
          spamMsg = 'GO-PISS GIRL!';
          break;
        case 'joke':
          spamTitle = 'BESKRAJNI VIC!';
          spamMsg = 'ŠALJIVDŽIJA, JEL?!';
          break;
        case 'hug':
          spamTitle = 'NEPUŠTAJUĆI ZAGRLJAJ!';
          spamMsg = 'DOBAR PRIJATELJ ILI MANIJAK?!';
          break;
        case 'chat':
          spamTitle = 'NEPRESTANO ĆASKANJE!';
          spamMsg = 'NE SMARAŠ, KAŽI!?';
          break;
        case 'dance':
          spamTitle = 'LUDILO NA PODIJUMU!';
          spamMsg = 'A ONA IGRA, VRTI SE KAO ČIGRA!';
          break;
      }

      if (spamMsg) {
        io.to(senderId).emit('trigger_spam_popup', { title: spamTitle, message: spamMsg });
        recordLogEntry(
          `⚠️ SPAM ALERT: ${sender.name} je smorio ${target.name} sa akcijom "${action}"! (${spamMsg})`,
          '⚡'
        );
      }
    }
  }

  recordLogEntry(message, sender.avatar);
  io.emit('update_players', getCombinedEntities());
}

// Povremena aktivnost botova da soba uvek deluje živo
setInterval(() => {
  const botIds = Object.keys(bots);
  if (botIds.length === 0) return;

  const activeHumans = Object.keys(players).filter(id => !lobbySockets.has(id));
  const candidates = [...botIds, ...activeHumans];
  if (candidates.length < 2) return;

  const actingBotId = botIds[Math.floor(Math.random() * botIds.length)];
  const possibleTargets = candidates.filter(id => id !== actingBotId);
  if (possibleTargets.length === 0) return;

  const targetId = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
  const action = BOT_ACTIONS[Math.floor(Math.random() * BOT_ACTIONS.length)];
  applyInteraction(actingBotId, targetId, action);
}, 14 * 1000);

function getActivePartyPlayerIds() {
  return Object.keys(players).filter(id => !lobbySockets.has(id));
}

function broadcastQuizReadyState() {
  if (!activeQuiz || activeQuiz.phase !== 'waiting_ready') return;

  const partyIds = getActivePartyPlayerIds();
  const readyNames = [];
  const waitingNames = [];

  partyIds.forEach(id => {
    if (!players[id]) return;
    if (activeQuiz.readySet.has(id)) {
      readyNames.push(players[id].name);
    } else {
      waitingNames.push(players[id].name);
    }
  });

  // Botovi odmah potvrđuju spremnost u demo režimu
  Object.values(bots).forEach(bot => {
    readyNames.push(bot.name);
  });

  const totalCount = partyIds.length + Object.keys(bots).length;
  const readyCount = readyNames.length;

  io.emit('quiz_ready_update', {
    readyCount,
    totalCount,
    readyNames,
    waitingNames
  });

  if (partyIds.length > 0 && partyIds.every(id => activeQuiz.readySet.has(id))) {
    activeQuiz.phase = 'running';

    const scores = {};
    partyIds.forEach(id => {
      scores[id] = { firstCorrect: 0, totalCorrect: 0 };
    });
    Object.keys(bots).forEach(botId => {
      scores[botId] = { firstCorrect: 0, totalCorrect: 0 };
    });
    activeQuiz.scores = scores;

    recordLogEntry(`🚀 SVI SU SPREMNI! Kviz počinje — svako pitanje traje fiksnih ${QUESTION_DURATION_SEC}s!`, '🧠');
    runQuizStep(0);
  }
}

function clearActiveQuizTimer() {
  if (activeQuiz && activeQuiz.timer) {
    clearTimeout(activeQuiz.timer);
    activeQuiz.timer = null;
  }
}

function simulateBotAnswersForQuestion(index) {
  if (!activeQuiz) return;
  const qObj = quizQuestions[index];
  if (!qObj) return;

  const botList = Object.values(bots);
  botList.forEach(bot => {
    if (!activeQuiz.scores[bot.id]) {
      activeQuiz.scores[bot.id] = { firstCorrect: 0, totalCorrect: 0 };
    }
    if (qObj.isVote) {
      const pickedIdx = Math.floor(Math.random() * 3);
      activeQuiz.votes[bot.id] = pickedIdx;
    } else {
      const isCorrect = Math.random() < 0.7;
      if (isCorrect) {
        activeQuiz.scores[bot.id].totalCorrect += 1;
      }
    }
  });
}

function resolveCurrentQuizQuestion() {
  if (!activeQuiz || activeQuiz.phase !== 'running') return;
  clearActiveQuizTimer();

  const index = activeQuiz.currentQuestion;
  const qObj = quizQuestions[index];
  if (!qObj) {
    finishQuiz();
    return;
  }

  simulateBotAnswersForQuestion(index);

  if (qObj.isVote) {
    const counts = [0, 0, 0];
    Object.values(activeQuiz.votes).forEach(optIdx => {
      if (counts[optIdx] !== undefined) counts[optIdx]++;
    });

    let maxVotes = -1;
    let winningIdx = 0;
    for (let i = 0; i < 3; i++) {
      if (counts[i] > maxVotes) {
        maxVotes = counts[i];
        winningIdx = i;
      }
    }

    const winningOption = qObj.options[winningIdx];
    activeQuiz.winningOption = winningOption;

    io.emit('quiz_vote_result', {
      winningOption,
      counts,
      options: qObj.options
    });

    recordLogEntry(
      `🗳️ QUIZZ GLASANJE: Najviše glasova dobila je opcija "${winningOption}"!`,
      '🗳️'
    );

    activeQuiz.timer = setTimeout(() => {
      finishQuiz();
    }, 2500);
  } else {
    runQuizStep(index + 1);
  }
}

function runQuizStep(index) {
  if (!activeQuiz) return;

  if (index >= quizQuestions.length) {
    finishQuiz();
    return;
  }

  activeQuiz.currentQuestion = index;
  activeQuiz.answeredCurrent = new Set();
  activeQuiz.firstCorrectClaimed = false;

  const qObj = quizQuestions[index];
  const endsAt = Date.now() + QUESTION_DURATION_MS;

  io.emit('quiz_question', {
    index,
    total: quizQuestions.length,
    question: qObj.q,
    options: qObj.options,
    isVote: qObj.isVote,
    hostId: activeQuiz.hostId,
    durationSec: QUESTION_DURATION_SEC,
    endsAt
  });

  // Fiksnih 10 sekundi po pitanju da svi budu potpuno sinhronizovani
  activeQuiz.timer = setTimeout(() => {
    resolveCurrentQuizQuestion();
  }, QUESTION_DURATION_MS);
}

function finishQuiz() {
  if (!activeQuiz) return;
  clearActiveQuizTimer();

  const hostId = activeQuiz.hostId;
  const scores = activeQuiz.scores || {};
  const winningOption = activeQuiz.winningOption || quizQuestions[quizQuestions.length - 1].options[2];
  const scoredQuestionsCount = quizQuestions.filter(q => !q.isVote).length;

  const botSummaryList = Object.values(bots).map(bot => {
    const s = scores[bot.id] || { totalCorrect: 0, firstCorrect: 0 };
    return `${bot.avatar} ${bot.name}: ${s.totalCorrect}/${scoredQuestionsCount}`;
  });

  const activePlayersCount = getActivePartyPlayerIds().length;

  if (players[hostId]) {
    const hostPlayer = players[hostId];
    const hostStats = scores[hostId] || { totalCorrect: 0, firstCorrect: 0 };
    const accuracyPct = scoredQuestionsCount > 0
      ? Math.round((hostStats.totalCorrect / scoredQuestionsCount) * 100)
      : 0;

    io.to(hostId).emit('quiz_end_host', {
      hostName: hostPlayer.name,
      hostAvatar: hostPlayer.avatar,
      totalCorrect: hostStats.totalCorrect,
      totalQuestions: scoredQuestionsCount,
      firstCorrect: hostStats.firstCorrect,
      accuracyPct,
      activePlayersCount,
      botSummary: botSummaryList.join(' · '),
      winningOption
    });
  }

  for (const id in players) {
    if (lobbySockets.has(id) || id === hostId) continue;
    const myStats = scores[id] || { totalCorrect: 0, firstCorrect: 0 };
    io.to(id).emit('quiz_end_player', {
      totalCorrect: myStats.totalCorrect,
      totalQuestions: scoredQuestionsCount,
      firstCorrect: myStats.firstCorrect,
      winningOption
    });
  }

  const hostFinalScore = scores[hostId] ? `${scores[hostId].totalCorrect}/${scoredQuestionsCount}` : `0/${scoredQuestionsCount}`;
  recordLogEntry(
    `🏆 QUIZZ TIME ZAVRŠEN! Slavljenik skor: ${hostFinalScore} | Glasanje: ${winningOption}.`,
    '🏆'
  );

  activeQuiz = null;
  io.emit('quiz_used_status', { used: false });
}

function sendJoinedPlayerState(socket, player) {
  socket.emit('sync_cooldowns', {
    telephoneRemaining: 0,
    woohooRemaining: 0,
    duelRemaining: 0
  });

  socket.emit('quiz_used_status', { used: false });
  socket.emit('log_history', actionLogHistory);

  socket.emit('join_success', {
    name: player.name,
    avatar: player.avatar,
    isBirthdayGirl: true,
    showBirthdayGreeting: true
  });

  if (activeQuiz && activeQuiz.phase === 'waiting_ready') {
    socket.emit('quiz_ready_prompt', {
      hostName: player.name
    });
    broadcastQuizReadyState();
  } else if (activeQuiz && activeQuiz.phase === 'running') {
    const qObj = quizQuestions[activeQuiz.currentQuestion];
    if (qObj) {
      socket.emit('quiz_question', {
        index: activeQuiz.currentQuestion,
        total: quizQuestions.length,
        question: qObj.q,
        options: qObj.options,
        isVote: qObj.isVote,
        hostId: activeQuiz.hostId,
        durationSec: QUESTION_DURATION_SEC
      });
    }
  }

  io.emit('update_players', getCombinedEntities());
}

io.on('connection', (socket) => {
  lobbySockets.add(socket.id);

  socket.emit('birthday_status', { taken: false });
  socket.emit('log_history', actionLogHistory);

  socket.on('probe_cooldowns', () => {
    socket.emit('sync_cooldowns', {
      telephoneRemaining: 0,
      woohooRemaining: 0,
      duelRemaining: 0
    });
  });

  socket.on('join', ({ name, avatar, birthdayPassword }) => {
    const cleanName = (name || '').trim().replace(/\s+/g, ' ') || 'Gost';
    const normKey = normalizeName(cleanName);

    if (isNameTaken(normKey, socket.id)) {
      socket.emit('join_error', `Ime "${cleanName}" je već zauzeto u demo sobi! Izaberi drugo ime.`);
      return;
    }

    if ((birthdayPassword || '').trim() !== BIRTHDAY_PASSWORD) {
      socket.emit('birthday_error', `Unesi šifru "${BIRTHDAY_PASSWORD}" za demo režim.`);
      return;
    }

    const previousStats = savedPlayerStatsByName[normKey];
    lobbySockets.delete(socket.id);

    players[socket.id] = {
      id: socket.id,
      name: cleanName,
      avatar: avatar || '🧔',
      isBirthdayGirl: true,
      social: previousStats ? previousStats.social : 85,
      fun: previousStats ? previousStats.fun : 85,
      drunk: previousStats ? previousStats.drunk : 0
    };

    syncPlayerStatsToMemory(players[socket.id]);
    sendJoinedPlayerState(socket, players[socket.id]);
  });

  socket.on('rejoin', ({ name, avatar }) => {
    if (players[socket.id] && !lobbySockets.has(socket.id)) {
      sendJoinedPlayerState(socket, players[socket.id]);
      return;
    }

    const cleanName = (name || '').trim().replace(/\s+/g, ' ');
    const normKey = normalizeName(cleanName);
    if (!normKey) return;

    const staleSocketId = findActiveSocketIdByNormalizedName(normKey, socket.id);
    if (staleSocketId) {
      if (players[staleSocketId]) syncPlayerStatsToMemory(players[staleSocketId]);
      migrateSocketIdInActiveGame(staleSocketId, socket.id);
      delete players[staleSocketId];
      lobbySockets.delete(staleSocketId);
    }

    const previousStats = savedPlayerStatsByName[normKey];
    lobbySockets.delete(socket.id);

    players[socket.id] = {
      id: socket.id,
      name: cleanName,
      avatar: avatar || '🧔',
      isBirthdayGirl: true,
      social: previousStats ? previousStats.social : 85,
      fun: previousStats ? previousStats.fun : 85,
      drunk: previousStats ? previousStats.drunk : 0
    };

    syncPlayerStatsToMemory(players[socket.id]);
    sendJoinedPlayerState(socket, players[socket.id]);
  });

  socket.on('start_quiz', () => {
    if (lobbySockets.has(socket.id)) return;
    const sender = players[socket.id];
    if (!sender || activeQuiz) return;

    activeQuiz = {
      hostId: socket.id,
      phase: 'waiting_ready',
      readySet: new Set([socket.id]),
      currentQuestion: 0,
      scores: {},
      answeredCurrent: new Set(),
      firstCorrectClaimed: false,
      votes: {},
      timer: null,
      winningOption: quizQuestions[quizQuestions.length - 1].options[2]
    };

    recordLogEntry(`🧠 QUIZZ TIME pokrenut! Svako pitanje traje fiksnih ${QUESTION_DURATION_SEC}s.`, '🎉');
    io.emit('quiz_ready_prompt', { hostName: sender.name });
    broadcastQuizReadyState();
  });

  socket.on('quiz_player_ready', () => {
    if (!activeQuiz || activeQuiz.phase !== 'waiting_ready') return;
    if (lobbySockets.has(socket.id) || !players[socket.id]) return;

    activeQuiz.readySet.add(socket.id);
    broadcastQuizReadyState();
  });

  socket.on('quiz_answer', ({ questionIndex, optionIndex }) => {
    if (!activeQuiz || activeQuiz.phase !== 'running') return;
    if (activeQuiz.currentQuestion !== questionIndex) return;
    if (activeQuiz.answeredCurrent.has(socket.id)) return;

    const qObj = quizQuestions[questionIndex];
    if (!qObj) return;

    activeQuiz.answeredCurrent.add(socket.id);

    if (qObj.isVote) {
      activeQuiz.votes[socket.id] = optionIndex;
      socket.emit('quiz_answer_ack', { isVote: true });
    } else {
      if (!activeQuiz.scores[socket.id]) {
        activeQuiz.scores[socket.id] = { firstCorrect: 0, totalCorrect: 0 };
      }
      const isCorrect = optionIndex === qObj.correct;
      let isFirst = false;
      if (isCorrect) {
        activeQuiz.scores[socket.id].totalCorrect += 1;
        if (!activeQuiz.firstCorrectClaimed) {
          activeQuiz.firstCorrectClaimed = true;
          activeQuiz.scores[socket.id].firstCorrect += 1;
          isFirst = true;
        }
      }
      socket.emit('quiz_answer_ack', {
        isVote: false,
        isCorrect,
        isFirst
      });
    }

    // Namerno ne prekidamo tajmer pre isteka 10s da svi igrači ostanu na istom pitanju
  });

  socket.on('interaction', ({ targetId, action, customText }) => {
    if (lobbySockets.has(socket.id)) return;
    applyInteraction(socket.id, targetId, action, customText);
  });

  socket.on('drink_duel', ({ targetId }) => {
    if (lobbySockets.has(socket.id)) return;
    const sender = players[socket.id];
    const all = getCombinedEntities();
    const target = all[targetId];
    if (!sender || !target) return;

    socket.emit('duel_cooldown_started', { durationMs: DEMO_COOLDOWN_MS });
    recordLogEntry(`⚔️ DUEL PIĆA: ${sender.name} je izazvao ${target.name}! 🍻`, '⚔️');
    socket.emit('play_duel_sound');

    if (target.isBot) {
      setTimeout(() => {
        const accepted = Math.random() > 0.35;
        if (accepted) {
          target.drunk = Math.min(100, target.drunk + 10);
          target.fun = Math.min(100, target.fun + 10);
          bots[target.id] = target;
          recordLogEntry(`✅ ${target.name} je prihvatio izazov! (Pijanost: ${target.drunk}%) 🍻`, '🍻');
        } else {
          recordLogEntry(`❌ ${target.name} je odbio izazov!`, '🐔');
        }
        io.emit('update_players', getCombinedEntities());
      }, 1200);
    } else if (!lobbySockets.has(targetId)) {
      io.to(targetId).emit('play_duel_sound');
      io.to(targetId).emit('trigger_duel_popup', { senderName: sender.name });
    }
  });

  socket.on('duel_response', ({ response }) => {
    if (lobbySockets.has(socket.id)) return;
    const sender = players[socket.id];
    if (!sender) return;

    let message = '';
    if (response === 'accepted') {
      sender.drunk = Math.min(100, sender.drunk + 10);
      sender.fun = Math.min(100, sender.fun + 15);
      if (sender.drunk >= 100) {
        sender.drunk = 100;
        sender.fun = 100;
        sender.social = Math.min(sender.social, 50);
      }
      message = `✅ ${sender.name} je prihvatio izazov! (Pijanost: ${sender.drunk}%) 🍻`;
      if (sender.drunk >= 100) io.to(socket.id).emit('trigger_balzamovan');
    } else {
      message = `❌ ${sender.name} je odbio izazov!`;
    }

    syncPlayerStatsToMemory(sender);
    recordLogEntry(message, response === 'accepted' ? '🍻' : '🐔');
    io.emit('update_players', getCombinedEntities());
  });

  socket.on('woohoo_chaos', () => {
    if (lobbySockets.has(socket.id)) return;
    const sender = players[socket.id];
    if (!sender) return;

    socket.emit('woohoo_cooldown_started', { durationMs: DEMO_COOLDOWN_MS });

    const randomWord = simsPhrases[Math.floor(Math.random() * simsPhrases.length)];
    activeWooHoo = { word: randomWord, clicks: [] };

    for (const id in players) {
      players[id].fun = Math.min(100, players[id].fun + 10);
    }
    syncAllPlayersToMemory();

    recordLogEntry(`🗣️ WOOHOO CHAOS: Svi viču Sims reč -> "${randomWord}"!`, '🗣️');

    for (const id in players) {
      if (!lobbySockets.has(id)) {
        io.to(id).emit('trigger_chaos_popup', { senderName: sender.name, word: randomWord });
      }
    }

    setTimeout(() => {
      if (!activeWooHoo) return;
      const botList = Object.values(bots);
      const chosenBot = botList[Math.floor(Math.random() * botList.length)];
      if (chosenBot) {
        chosenBot.drunk = Math.min(100, chosenBot.drunk + 10);
        bots[chosenBot.id] = chosenBot;
        recordLogEntry(`🚨 WOOHOO REZULTAT: ${chosenBot.name} je poslednji uzviknuo "${activeWooHoo.word}"!`, '🤡');
        io.emit('update_players', getCombinedEntities());
      }
      activeWooHoo = null;
    }, 5000);
  });

  socket.on('woohoo_shouted', () => {
    if (!activeWooHoo) return;
    const already = activeWooHoo.clicks.some(c => c.socketId === socket.id);
    if (!already) {
      activeWooHoo.clicks.push({ socketId: socket.id, time: Date.now() });
    }
  });

  socket.on('start_telephone_game', () => {
    if (lobbySockets.has(socket.id)) return;
    const sender = players[socket.id];
    if (!sender) return;

    socket.emit('telephone_cooldown_started', { durationMs: DEMO_COOLDOWN_MS });

    const phrase = simsPhrases[Math.floor(Math.random() * simsPhrases.length)];
    const starterName = sender.name;
    const botList = Object.values(bots);
    const typistBot = botList[Math.floor(Math.random() * botList.length)];
    const typistName = typistBot ? typistBot.name : 'Mika Bot';

    activeTelephoneGame = {
      phrase,
      starterId: socket.id,
      typistId: null,
      typistName
    };

    io.to(socket.id).emit('telephone_rules_popup', {
      starterName,
      typistName,
      triggerName: sender.name
    });

    recordLogEntry(`📞 GLUVI TELEFONI: Fraza je "${phrase}", prenosi se do ${typistName}!`, '📞');

    setTimeout(() => {
      if (!activeTelephoneGame) return;
      io.to(socket.id).emit('telephone_role_starter', { phrase });
    }, 2500);

    setTimeout(() => {
      if (!activeTelephoneGame) return;
      recordLogEntry(`🎉 GLUVI TELEFONI REZULTAT: ${typistName} je preneo frazu "${activeTelephoneGame.phrase}"!`, '🏆');
      activeTelephoneGame = null;
    }, 7000);
  });

  socket.on('telephone_submit', ({ guess }) => {
    if (!activeTelephoneGame) return;
    const isCorrect = guess.toLowerCase().replace(/\s+/g, '') === activeTelephoneGame.phrase.toLowerCase().replace(/\s+/g, '');
    recordLogEntry(
      isCorrect
        ? `🎉 GLUVI TELEFONI USPEH: Fraza "${activeTelephoneGame.phrase}" tačno preneta!`
        : `🍻 GLUVI TELEFONI PROMAŠAJ: Traženo "${activeTelephoneGame.phrase}", ukucano "${guess}".`,
      isCorrect ? '🏆' : '🤡'
    );
    activeTelephoneGame = null;
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      syncPlayerStatsToMemory(players[socket.id]);
    }
    delete players[socket.id];
    lobbySockets.delete(socket.id);

    if (activeQuiz && activeQuiz.phase === 'waiting_ready') {
      activeQuiz.readySet.delete(socket.id);
      broadcastQuizReadyState();
    }

    io.emit('update_players', getCombinedEntities());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TROKUT PARTY APP demo radi na portu ${PORT}`);
});