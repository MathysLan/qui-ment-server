// Test WebSocket RÉEL de la photo de profil : de vrais clients `ws` rejoignent
// une room, jouent une manche, et on lit ce qui passe VRAIMENT sur le fil.
//
//   node test-avatar-ws.js      (le serveur est démarré dans ce même processus)
//
// Ce que ce test prouve, et que « la connexion a réussi » ne prouverait pas :
// la data-URL envoyée par A ressort À L'OCTET PRÈS chez B (lobby, écoute de sa
// prise, résultats, podium), l'emoji de B ressort chez A, et chaque avatar
// refusé (SVG, > 12 Ko, mauvais type, structure) ressort en emoji sans `src`.
const fs = require('fs');
const path = require('path');
process.env.PORT = process.env.PORT || '8797';
const WebSocket = require('ws');
const { rooms } = require('./server.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const DEFAUT = '🕵️';                 // l'emoji par défaut de CE serveur
const KEYS = ['avatar', 'host', 'id', 'name', 'score']; // champs publics d'un joueur (au salon)
let ok = 0, ko = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('PASS - ' + name); }
  else { ko++; console.log('FAIL - ' + name + (detail ? ' — ' + detail : '')); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fx = (f) => fs.readFileSync(path.join(__dirname, 'test-fixtures', f));
const PP = 'data:image/webp;base64,' + fx('avatar-96.webp').toString('base64');
const IMG_A = { kind: 'image', emoji: '🦊', src: PP };
const EMO_B = { kind: 'emoji', emoji: '🐼' };

// Un client qui garde tout ce qu'il reçoit, et la taille brute de chaque trame.
function client() {
  const ws = new WebSocket(URL);
  const c = { ws, log: [], used: new Set(), bytes: 0, waiters: [] };
  ws.on('message', (raw, isBinary) => {
    c.bytes += raw.length;
    const m = isBinary ? { type: 'binary', buf: raw } : JSON.parse(raw);
    m.__len = raw.length;
    c.log.push(m);
    c.waiters.slice().forEach((w) => w());
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.sendBin = (b) => ws.send(b);
  c.open = () => (ws.readyState === 1 ? Promise.resolve() : new Promise((r) => ws.once('open', r)));
  // Le prochain message pas encore consommé qui satisfait `pred`.
  c.wait = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const look = () => {
      const i = c.log.findIndex((m, k) => !c.used.has(k) && pred(m));
      if (i < 0) return false;
      c.used.add(i); c.waiters = c.waiters.filter((w) => w !== look); resolve(c.log[i]); return true;
    };
    if (look()) return;
    c.waiters.push(look);
    setTimeout(() => reject(new Error('attente expirée')), ms);
  });
  return c;
}
const type = (ty) => (m) => m.type === ty;
const phase = (p) => (m) => m.type === 'phase' && m.phase === p;
const find = (list, id) => (list || []).find((p) => p.id === id) || {};

async function join(c, avatar, code) {
  await c.open();
  const msg = { action: 'join', name: 'J' + Math.random().toString(36).slice(2, 5) };
  if (avatar !== undefined) msg.avatar = avatar;
  if (code) msg.code = code;
  c.send(msg);
  const you = await c.wait(type('you'));
  const l = await c.wait((m) => m.type === 'lobby' && m.players.some((p) => p.id === you.id));
  return { id: you.id, code: you.code, players: l.players };
}

(async () => {
  // ═══ 1. A (vraie PP) crée la room, B (emoji) la rejoint
  const a = client(), b = client();
  const ja = await join(a, IMG_A);
  t('join avec image : A est bien dans la room', !!ja.id);
  t('A se voit lui-même avec sa PP', same(find(ja.players, ja.id).avatar, IMG_A));
  const etat = rooms.get(ja.code).players.find((p) => p.id === ja.id);
  t('état joueur côté serveur : la PP est conservée telle quelle', same(etat.avatar, IMG_A) && etat.avatar.src === PP);
  const jb = await join(b, EMO_B, ja.code);
  t('join avec emoji : B est bien dans la room', !!jb.id);

  t('B voit la PP de A, data-URL identique à l\'octet près', find(jb.players, ja.id).avatar?.src === PP);
  t('B voit l\'avatar de A complet et rien d\'autre', same(find(jb.players, ja.id).avatar, IMG_A),
    JSON.stringify(Object.keys(find(jb.players, ja.id).avatar || {})));
  t('B se voit avec son emoji', same(find(jb.players, jb.id).avatar, EMO_B));
  const ra = await a.wait((m) => m.type === 'lobby' && m.players.length === 2);
  t('A voit l\'emoji de B', same(find(ra.players, jb.id).avatar, EMO_B));
  t('A voit toujours sa propre PP après l\'arrivée de B', same(find(ra.players, ja.id).avatar, IMG_A));
  t('la liste ne contient que les champs publics (pas de ws ni d\'état interne)',
    ra.players.every((p) => same(Object.keys(p).sort(), KEYS)),
    JSON.stringify(Object.keys(ra.players[0])));
  t(`taille du message room avec une PP : ${ra.__len} octets (la PP n'y est qu'une fois)`,
    ra.__len < PP.length + 600 && ra.__len > PP.length);

  // ═══ 2. une vraie partie : il faut 3 joueurs. C (emoji) complète la table.
  const c = client();
  const jc = await join(c, { kind: 'emoji', emoji: '🤖' }, ja.code);
  a.send({ action: 'start', rounds: 3 });
  const role = await b.wait(type('role'));
  t('en jeu (rôle) : PP de A, emoji de B', same(find(role.players, ja.id).avatar, IMG_A) && same(find(role.players, jb.id).avatar, EMO_B));
  t('en jeu (rôle) : le mot ne voyage pas avec les avatars', !JSON.stringify(role.players).includes('"word"'));
  // Des indices, puis le vote : tout le monde joue pour de vrai.
  for (const [cl, mot] of [[a, 'aaa'], [b, 'bbb'], [c, 'ccc']]) cl.send({ action: 'clue', text: mot });
  const cl1 = await b.wait(type('clues'));
  t('en jeu (indices révélés) : PP de A', same(find(cl1.players, ja.id).avatar, IMG_A));
  for (const [cl, mot] of [[a, 'ddd'], [b, 'eee'], [c, 'fff']]) cl.send({ action: 'clue', text: mot });
  const vote = await b.wait(type('vote'));
  t('en jeu (vote) : PP de A', same(find(vote.players, ja.id).avatar, IMG_A));
  a.send({ action: 'vote', target: jb.id }); b.send({ action: 'vote', target: ja.id }); c.send({ action: 'vote', target: ja.id });
  // Si l'intrus est démasqué, il a sa « dernière chance » : le MJ la passe.
  const res = await b.wait((m) => m.type === 'results' || m.type === 'guessing');
  let results = res;
  if (res.type === 'guessing') {
    t('en jeu (dernière chance) : PP de A', same(find(res.players, ja.id).avatar, IMG_A));
    a.send({ action: 'skip' });
    results = await b.wait(type('results'));
  }
  t('résultats : PP de A, emoji de B', same(find(results.players, ja.id).avatar, IMG_A) && same(find(results.players, jb.id).avatar, EMO_B));
  // Manches 2 et 3 : le MJ force le passage, pour arriver au classement.
  for (let i = 0; i < 2; i++) {
    a.send({ action: 'next' });
    await b.wait(type('role'));
    a.send({ action: 'skip' }); await b.wait(type('clues'));
    a.send({ action: 'skip' }); await b.wait(type('vote'));
    a.send({ action: 'skip' }); await b.wait(type('results'));
  }
  a.send({ action: 'next' });
  const end = await b.wait(type('end'));
  t('classement final : PP de A retransmise, emoji de B conservé',
    same(find(end.ranking, ja.id).avatar, IMG_A) && same(find(end.ranking, jb.id).avatar, EMO_B));
  a.ws.close(); b.ws.close(); c.ws.close();

  // ═══ 3. ce que le serveur refuse : chaque cas crée sa propre room
  const LOURDE = 'data:image/webp;base64,' + fx('avatar-13k.webp').toString('base64');
  const CAS = [
    ['image > 12 Ko (vrai webp de 12,9 Ko) refusée → emoji', { kind: 'image', emoji: '🐸', src: LOURDE }, '🐸'],
    ['SVG refusé → emoji', { kind: 'image', emoji: '🐸', src: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64') }, '🐸'],
    ['type MIME inattendu (gif) refusé → emoji', { kind: 'image', emoji: '🐸', src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, '🐸'],
    ['png déguisé en webp refusé → emoji', { kind: 'image', emoji: '🐸', src: 'data:image/webp;base64,' + fx('avatar-96.png').toString('base64') }, '🐸'],
    ['kind inconnu refusé → emoji', { kind: 'video', emoji: '🐸', src: PP }, '🐸'],
    ['avatar mal formé (tableau) → emoji par défaut', [PP], DEFAUT],
    ['avatar mal formé (nombre) → emoji par défaut', 42, DEFAUT],
    ['avatar absent → emoji par défaut', undefined, DEFAUT],
    ['ancien client (emoji en chaîne) → accepté', '🔥', '🔥'],
    ['ancien client (data-URL en chaîne) → pas tronquée, défaut', PP, DEFAUT],
  ];
  for (const [nom, avatar, attendu] of CAS) {
    const c = client();
    const j = await join(c, avatar);
    const av = find(j.players, j.id).avatar;
    t(nom, same(av, { kind: 'emoji', emoji: attendu }), JSON.stringify(av).slice(0, 100));
    c.ws.close();
  }

  // Et un refus ne casse rien pour les autres : C (SVG) rejoint A' (PP).
  const a2 = client(), c2 = client();
  const j2 = await join(a2, IMG_A);
  await join(c2, { kind: 'image', emoji: '🐸', src: 'data:image/svg+xml;base64,PHN2Zy8+' }, j2.code);
  const vu = await a2.wait((m) => m.type === 'lobby' && m.players.length === 2);
  t('un avatar refusé n\'affecte pas la PP des autres', same(find(vu.players, j2.id).avatar, IMG_A));
  t('le joueur refusé est bien dans la room, avec son emoji',
    vu.players.some((p) => p.id !== j2.id && same(p.avatar, { kind: 'emoji', emoji: '🐸' })));
  a2.ws.close(); c2.ws.close();

  console.log(ko === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${ko} ÉCHEC(S)`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL - exception : ' + e.message); process.exit(1); });
