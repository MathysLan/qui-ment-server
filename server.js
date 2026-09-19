// qui-ment-server — serveur arbitre du jeu « Qui Ment ? ».
//
// Même forme que les autres serveurs du portfolio (morpion, demicercle,
// imitation, ban, precision, passeur) : un seul WebSocket, du JSON, des rooms à
// code de 4 lettres, et une règle d'or — LE CLIENT N'A AUCUNE AUTORITÉ.
//
// Ici, le secret EST le jeu, donc la règle prend une forme très concrète :
//   1. le mot de la manche n'est jamais diffusé. Il part joueur par joueur, via
//      E.viewFor(), et l'intrus reçoit `word: null`. Il n'y a pas un seul
//      `broadcast` qui contienne le mot avant la révélation ;
//   2. personne n'apprend QUI est l'intrus avant les résultats — pas même par
//      omission : tout le monde reçoit un message `role` de la même forme ;
//   3. les indices sont ramassés en silence et révélés d'un coup. Sinon le
//      dernier à écrire lirait les autres, et l'intrus n'aurait qu'à recopier ;
//   4. la liste des mots de la catégorie n'est envoyée qu'à l'intrus, et
//      seulement s'il est démasqué, au moment où il doit deviner.
//
// Progression pilotée par le MJ (l'hôte), comme les versions récentes des
// autres jeux : aucun timer de gameplay. Une phase avance quand tout le monde a
// répondu, et le MJ peut toujours forcer le passage (`skip`) pour qu'un joueur
// parti aux toilettes ne gèle pas la partie.
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { CATEGORIES } = require('./mots.js');
const E = require('./engine.js');
const { cleanAvatar } = require('./avatar.js');

const PORT = process.env.PORT || 8092;
const DEFAULT_ROUNDS = 5;
const MAX_PLAYERS = 8;
const CLUE_TURNS = 2;           // deux tours d'indices : le 1er donne à l'intrus
                                // de quoi se caler, le 2e le met sous pression.

const rooms = new Map();

const code = () => {
  let c;
  do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join(''); }
  while (rooms.has(c));
  return c;
};

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const broadcast = (room, obj) => room.players.forEach((p) => send(p.ws, obj));

// Ce que tout le monde a le droit de savoir sur tout le monde. `ready` dit si
// le joueur a fait ce qu'on attend de lui dans la phase en cours — jamais QUOI.
function publicPlayers(room) {
  return room.players.map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, score: p.score,
    host: p.id === room.hostId,
    ready: room.phase === 'clue' ? p.clue != null
      : room.phase === 'vote' ? p.vote != null
        : undefined,
  }));
}

function lobbyState(room) {
  return { type: 'lobby', code: room.code, players: publicPlayers(room), rounds: room.rounds };
}

const progress = (room) => broadcast(room, { type: 'progress', players: publicPlayers(room) });

// ------------------------------------------------------------------ manches
function startGame(room, rounds) {
  room.rounds = Math.max(3, Math.min(10, rounds || DEFAULT_ROUNDS));
  room.deck = E.deal(CATEGORIES, room.rounds, Math.random);
  room.roundIndex = -1;
  room.players.forEach((p) => { p.score = 0; });
  nextRound(room);
}

function nextRound(room) {
  room.roundIndex += 1;
  if (room.roundIndex >= room.deck.length) return endGame(room);

  const ids = room.players.map((p) => p.id);
  room.round = E.dealRound(room.deck[room.roundIndex], ids, Math.random);
  room.turn = 0;
  room.clues = [];                       // les tours révélés, cumulés
  room.phase = 'clue';
  room.players.forEach((p) => { p.clue = null; p.vote = null; });

  // Le rôle part joueur par joueur. C'est LE message à ne jamais diffuser.
  room.players.forEach((p) => {
    const v = E.viewFor(room.round, p.id);
    send(p.ws, {
      type: 'role',
      round: room.roundIndex + 1,
      of: room.deck.length,
      cat: v.cat,
      word: v.word,                      // null pour l'intrus, et pour lui seul
      impostor: v.impostor,
      turn: 1,
      turns: CLUE_TURNS,
      players: publicPlayers(room),
    });
  });
}

// Fin d'un tour d'indices : on révèle tout d'un coup, dans l'ordre des joueurs.
function revealClues(room) {
  room.turn += 1;
  room.clues.push({
    turn: room.turn,
    clues: room.players.map((p) => ({ id: p.id, clue: p.clue || '—' })),
  });

  if (room.turn < CLUE_TURNS) {
    room.players.forEach((p) => { p.clue = null; });
    return broadcast(room, {
      type: 'clues', rounds: room.clues, turn: room.turn + 1, turns: CLUE_TURNS,
      players: publicPlayers(room),
    });
  }

  room.phase = 'vote';
  broadcast(room, {
    type: 'vote', rounds: room.clues, players: publicPlayers(room),
  });
}

// Fin du vote. Si l'intrus est démasqué, il a droit à sa chance : retrouver le
// mot. La liste des mots ne part qu'à lui, et seulement maintenant.
function closeVote(room) {
  const votes = {};
  room.players.forEach((p) => { votes[p.id] = p.vote; });
  room.votes = votes;

  if (E.unmasked(votes, room.round.impostorId)) {
    const imp = room.players.find((p) => p.id === room.round.impostorId);
    if (imp) {
      room.phase = 'guess';
      send(imp.ws, {
        type: 'guess',
        cat: room.round.cat,
        words: E.shuffle(room.round.words, Math.random),
      });
      broadcast(room, {
        type: 'guessing',
        players: publicPlayers(room),
        // On dit qu'il a été démasqué, PAS encore qui c'était : le nom arrive
        // avec les résultats, en même temps que le mot, pour que la révélation
        // soit d'un seul bloc.
      });
      return;
    }
  }
  resolveRound(room, null);
}

function resolveRound(room, guess) {
  if (room.phase === 'results' || room.phase === 'end') return;
  room.phase = 'results';
  const ids = room.players.map((p) => p.id);
  const res = E.resolve(room.round, ids, room.votes || {}, guess);
  room.players.forEach((p) => { p.score += res.points[p.id] || 0; });

  broadcast(room, {
    type: 'results',
    round: room.roundIndex + 1,
    of: room.deck.length,
    word: res.word,                      // révélé, enfin
    cat: res.cat,
    impostorId: res.impostorId,
    caught: res.caught,
    guess: res.guess,
    guessed: res.guessed,
    counts: res.counts,
    points: res.points,
    rounds: room.clues,
    players: publicPlayers(room),
    last: room.roundIndex + 1 >= room.deck.length,
  });
}

function endGame(room) {
  room.phase = 'end';
  const ranked = room.players.slice().sort((a, b) => b.score - a.score).map((p) => {
    const g = E.grade(p.score, room.deck.length);
    return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, avg: g.avg, title: g.title };
  });
  broadcast(room, { type: 'end', ranking: ranked });
}

// Une phase avance quand tout le monde a fait sa part. `force` est le bouton du
// MJ : il résout avec ce qu'il y a, pour qu'un absent ne gèle pas la partie.
function advanceIfReady(room, force) {
  if (room.phase === 'clue') {
    if (force || room.players.every((p) => p.clue != null)) return revealClues(room);
  } else if (room.phase === 'vote') {
    if (force || room.players.every((p) => p.vote != null)) return closeVote(room);
  } else if (room.phase === 'guess' && force) {
    return resolveRound(room, null);
  }
  progress(room);
}

// ---------------------------------------------------------------- transport
const server = http.createServer((req, res) => {
  // Render veut une réponse HTTP pour son health check.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('qui-ment-server ok\n');
});
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let room = null, me = null;

  const fail = (message) => send(ws, { type: 'error', message });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return fail('message illisible'); }

    if (msg.action === 'join') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Joueur';
      // Emoji, ou photo de profil revalidée : voir avatar.js.
      const avatar = cleanAvatar(msg.avatar, '🕵️');
      if (msg.code) {
        room = rooms.get(String(msg.code).toUpperCase().trim());
        if (!room) return fail('aucune partie avec ce code');
        if (room.players.length >= MAX_PLAYERS) return fail('partie complète');
        if (room.phase !== 'lobby') return fail('partie déjà commencée');
      } else {
        const c = code();
        room = { code: c, players: [], hostId: null, phase: 'lobby', rounds: DEFAULT_ROUNDS };
        rooms.set(c, room);
      }
      me = { id: Math.random().toString(36).slice(2, 9), ws, name, avatar, score: 0, clue: null, vote: null };
      room.players.push(me);
      if (!room.hostId) room.hostId = me.id;
      send(ws, { type: 'you', id: me.id, code: room.code, host: room.hostId === me.id });
      broadcast(room, lobbyState(room));
      return;
    }

    if (!room || !me) return fail('pas encore dans une partie');

    if (msg.action === 'start') {
      if (me.id !== room.hostId) return fail('seul le MJ peut lancer la partie');
      if (room.phase !== 'lobby') return;
      if (room.players.length < E.MIN_PLAYERS) {
        return fail(`il faut au moins ${E.MIN_PLAYERS} joueurs`);
      }
      return startGame(room, Number(msg.rounds));
    }

    if (msg.action === 'clue') {
      if (room.phase !== 'clue') return;
      if (me.clue != null) return;                 // un indice par tour, pas deux
      const c = E.checkClue(msg.text, room.round, me.id);
      if (!c.ok) return fail(c.reason);
      me.clue = c.clue;
      return advanceIfReady(room);
    }

    if (msg.action === 'vote') {
      if (room.phase !== 'vote') return;
      if (me.vote != null) return;                 // un vote par manche
      const target = String(msg.target || '');
      if (target === me.id) return fail('on ne vote pas pour soi-même');
      if (!room.players.some((p) => p.id === target)) return fail('ce joueur n est pas dans la partie');
      me.vote = target;
      return advanceIfReady(room);
    }

    if (msg.action === 'guess') {
      if (room.phase !== 'guess') return;
      if (me.id !== room.round.impostorId) return fail('ce n est pas à toi de deviner');
      return resolveRound(room, String(msg.word || ''));
    }

    if (msg.action === 'skip') {
      if (me.id !== room.hostId) return fail('seul le MJ fait avancer');
      return advanceIfReady(room, true);
    }

    if (msg.action === 'next') {
      if (me.id !== room.hostId) return fail('seul le MJ fait avancer');
      if (room.phase !== 'results') return;
      return nextRound(room);
    }

    if (msg.action === 'lobby') {
      if (me.id !== room.hostId) return fail('seul le MJ peut revenir au salon');
      room.phase = 'lobby';
      return broadcast(room, lobbyState(room));
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.players = room.players.filter((p) => p !== me);
    if (!room.players.length) { rooms.delete(room.code); return; }
    if (room.hostId === me.id) room.hostId = room.players[0].id;

    // Un départ ne doit jamais geler la partie.
    // Cas particulier : si c'est l'INTRUS qui s'en va, la manche n'a plus
    // d'objet — on la résout tout de suite avec les votes déjà là, et le mot
    // est révélé. Mieux vaut une manche écourtée qu'une table qui attend un
    // indice qui ne viendra pas.
    if (room.phase !== 'lobby' && room.round && me.id === room.round.impostorId) {
      const votes = {};
      room.players.forEach((p) => { votes[p.id] = p.vote; });
      room.votes = votes;
      return resolveRound(room, null);
    }
    if (room.phase === 'lobby') return broadcast(room, lobbyState(room));
    if (room.players.length < E.MIN_PLAYERS && room.phase !== 'results' && room.phase !== 'end') {
      room.votes = room.votes || {};
      return resolveRound(room, null);
    }
    return advanceIfReady(room);
  });
});

server.listen(PORT, () => console.log(`qui-ment-server à l'écoute sur :${PORT}`));

module.exports = { server, wss, rooms };
