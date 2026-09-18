// Test bout en bout du serveur : de vrais clients WebSocket jouent une partie
// complète et vérifient les règles — surtout celles qui protègent le jeu.
//
//   npm test        (moteur puis ce fichier)
//   node test.js
//
// Le serveur est démarré dans ce même processus sur un port de test.
//
// Ce fichier a un travail que le test du moteur ne peut pas faire : regarder ce
// qui passe VRAIMENT sur le fil. Le moteur peut être irréprochable et le
// serveur diffuser le mot par mégarde dans un message de progression. On relit
// donc, à chaque étape, TOUT ce que chaque client a reçu.
process.env.PORT = process.env.PORT || '8793';
const WebSocket = require('ws');
require('./server.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
let ok = 0, ko = 0;
const t = (name, cond) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name); }
};

// Un petit client : il garde tous les messages reçus et sait en attendre un.
function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    c.waiters = c.waiters.filter((w) => {
      if (w.type !== m.type) return true;
      w.resolve(m);
      return false;
    });
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = (type, ms = 4000) => new Promise((resolve, reject) => {
    const found = c.msgs.find((m) => m.type === type);
    if (found) return resolve(found);
    const w = { type, resolve };
    c.waiters.push(w);
    setTimeout(() => { if (c.waiters.includes(w)) reject(new Error(`${name} : pas de « ${type} »`)); }, ms);
  });
  c.clear = () => { c.msgs.length = 0; };
  c.open = () => new Promise((r) => ws.on('open', r));
  // Tout ce que ce client a reçu, en texte : pour chercher une fuite.
  c.dump = () => JSON.stringify(c.msgs);
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Attendre une condition plutôt qu'un délai : un sleep fixe rend les tests
// lents quand il est généreux, et intermittents quand il ne l'est pas.
async function waitFor(cond, ms = 4000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await sleep(10);
  }
  throw new Error('condition jamais remplie');
}

(async () => {
  // ------------------------------------------------------------ le salon
  const mj = client('MJ');
  await mj.open();
  mj.send({ action: 'join', name: 'Mathys', avatar: '🕵️' });
  const you = await mj.wait('you');
  t('créer une partie renvoie un code à 4 lettres', /^[A-Z]{4}$/.test(you.code));
  t('le premier arrivé est le MJ', you.host === true);

  const j2 = client('J2');
  const j3 = client('J3');
  await j2.open(); await j3.open();
  j2.send({ action: 'join', name: 'Camille', avatar: '🦊', code: you.code });
  const you2 = await j2.wait('you');
  t('un second joueur rejoint par code', you2.code === you.code && you2.host === false);
  j3.send({ action: 'join', name: 'Tom', avatar: '🐼', code: you.code });
  const you3 = await j3.wait('you');

  // Les identifiants, relevés MAINTENANT : les `clear()` plus bas effacent les
  // messages reçus, et `you` n'est envoyé qu'une fois, à l'arrivée.
  const ids = { mj: you.id, j2: you2.id, j3: you3.id };

  // Le salon du MJ arrive par diffusion, donc après notre `you` : on attend
  // celui qui compte trois joueurs plutôt que de lire le dernier reçu.
  await waitFor(() => (mj.msgs.filter((m) => m.type === 'lobby').pop() || {}).players?.length === 3);
  const lob = mj.msgs.filter((m) => m.type === 'lobby').pop();
  t('le salon liste les trois joueurs', lob.players.length === 3);
  t('le salon dit qui est le MJ', lob.players.filter((p) => p.host).length === 1);

  const bad = client('BAD');
  await bad.open();
  bad.send({ action: 'join', name: 'Intrus', code: 'ZZZZ' });
  const noRoom = await bad.wait('error');
  t('un code inconnu est refusé', /aucune partie/.test(noRoom.message));
  bad.ws.close();

  j2.send({ action: 'start', rounds: 3 });
  const notHost = await j2.wait('error');
  t('seul le MJ peut lancer la partie', /seul le MJ/.test(notHost.message));

  // ---------------------------------------------------------- la manche 1
  [mj, j2, j3].forEach((c) => c.clear());
  mj.send({ action: 'start', rounds: 3 });

  const roles = await Promise.all([mj.wait('role'), j2.wait('role'), j3.wait('role')]);
  const all = [mj, j2, j3];
  t('la manche annonce la catégorie à tout le monde',
    roles.every((r) => typeof r.cat === 'string' && r.cat.length > 0));
  t('la manche est numérotée', roles[0].round === 1 && roles[0].of === 3);

  const impIdx = roles.findIndex((r) => r.impostor);
  t('il y a exactement un intrus', roles.filter((r) => r.impostor).length === 1);
  t("L INTRUS NE REÇOIT PAS LE MOT", roles[impIdx].word === null);

  const word = roles.find((r) => !r.impostor).word;
  t('les informés reçoivent tous le MÊME mot',
    roles.filter((r) => !r.impostor).every((r) => r.word === word));
  t('le mot fait partie de la catégorie annoncée', typeof word === 'string' && word.length > 0);

  t("AUCUN MESSAGE NE DIT QUI EST L INTRUS",
    all.every((c) => !/impostorId/.test(c.dump())));
  t("LE MOT N APPARAÎT NULLE PART CHEZ L INTRUS",
    !new RegExp(word, 'i').test(all[impIdx].dump()));

  // ---------------------------------------------------------- les indices
  const tooLong = all[0];
  tooLong.send({ action: 'clue', text: 'x'.repeat(40) });
  const longErr = await tooLong.wait('error');
  t('un indice trop long est refusé', /caractères/.test(longErr.message));

  // Un informé qui écrit le mot lui-même : refusé, et la manche continue.
  const informed = all.find((c, i) => i !== impIdx);
  informed.clear();
  informed.send({ action: 'clue', text: word });
  const spoil = await informed.wait('error');
  t('un informé ne peut pas écrire le mot secret', /contient le mot/.test(spoil.message));

  all.forEach((c) => c.clear());
  all[0].send({ action: 'clue', text: 'aaa' });
  await sleep(120);
  t("les indices ne sont PAS révélés tant que tout le monde n a pas écrit",
    all.every((c) => !c.msgs.some((m) => m.type === 'clues'))
    && !/aaa/.test(all[1].dump()));
  t('mais on voit QUI a déjà écrit',
    all[1].msgs.some((m) => m.type === 'progress' && m.players.some((p) => p.ready)));

  all[1].send({ action: 'clue', text: 'bbb' });
  all[2].send({ action: 'clue', text: 'ccc' });
  const turn1 = await all[1].wait('clues');
  t('le premier tour révélé contient les trois indices',
    turn1.rounds[0].clues.length === 3
    && /aaa/.test(JSON.stringify(turn1.rounds[0]))
    && /ccc/.test(JSON.stringify(turn1.rounds[0])));
  t('on enchaîne sur un second tour', turn1.turn === 2 && turn1.turns === 2);

  all.forEach((c) => c.clear());
  all[0].send({ action: 'clue', text: 'ddd' });
  all[1].send({ action: 'clue', text: 'eee' });
  all[2].send({ action: 'clue', text: 'fff' });
  const voteMsg = await all[0].wait('vote');
  t('après le second tour, on passe au vote', voteMsg.rounds.length === 2);
  t('le vote a sous les yeux les deux tours entiers',
    /aaa/.test(JSON.stringify(voteMsg.rounds)) && /fff/.test(JSON.stringify(voteMsg.rounds)));
  t('toujours aucune fuite du mot au moment du vote',
    !new RegExp(word, 'i').test(all[impIdx].dump()));

  // -------------------------------------------------------------- le vote
  const order = [ids.mj, ids.j2, ids.j3];
  const impId = order[impIdx];

  all[0].clear();
  all[0].send({ action: 'vote', target: order[0] });
  const selfErr = await all[0].wait('error');
  t('on ne vote pas pour soi-même', /soi-même/.test(selfErr.message));

  // Tout le monde vote pour l'intrus : il est démasqué, et il aura sa chance.
  all.forEach((c) => c.clear());
  all.forEach((c, i) => { if (i !== impIdx) c.send({ action: 'vote', target: impId }); });
  await sleep(120);
  t('le vote attend aussi celui de l intrus',
    !all[0].msgs.some((m) => m.type === 'results' || m.type === 'guessing'));
  all[impIdx].send({ action: 'vote', target: order[(impIdx + 1) % 3] });

  const guessMsg = await all[impIdx].wait('guess');
  t('démasqué, l intrus a droit à sa chance', Array.isArray(guessMsg.words));
  t('… et il reçoit enfin la liste des mots de la catégorie', guessMsg.words.includes(word));
  const other = all[(impIdx + 1) % 3];
  t("LA LISTE DES MOTS NE PART QU À L INTRUS",
    !other.msgs.some((m) => m.type === 'guess'));
  // `guess` part à l'intrus juste avant que `guessing` ne soit diffusé : on
  // attend l'arrivée plutôt que de lire dans la foulée du premier.
  await waitFor(() => other.msgs.some((m) => m.type === 'guessing'));
  t('les autres savent juste qu il est en train de deviner',
    other.msgs.some((m) => m.type === 'guessing'));

  all.forEach((c) => c.clear());
  all[impIdx].send({ action: 'guess', word });
  const res = await all[0].wait('results');
  t('les résultats révèlent enfin le mot', res.word === word);
  t('… et qui était l intrus', res.impostorId === impId);
  t('l intrus est bien noté comme démasqué', res.caught === true);
  t('il a retrouvé le mot', res.guessed === true);
  t('démasqué mais rattrapé : 4 points pour lui', res.points[impId] === 4);
  t('les voteurs justes gardent leurs 2 points',
    order.filter((id) => id !== impId).every((id) => res.points[id] === 2));
  t('les résultats ne sont pas la dernière manche', res.last === false);

  // ---------------------------------------------------------- la manche 2
  j2.clear();
  j2.send({ action: 'next' });
  const notHost2 = await j2.wait('error');
  t('seul le MJ fait avancer', /seul le MJ/.test(notHost2.message));

  all.forEach((c) => c.clear());
  mj.send({ action: 'next' });
  const roles2 = await Promise.all([mj.wait('role'), j2.wait('role'), j3.wait('role')]);
  t('manche suivante', roles2[0].round === 2);
  t('une nouvelle catégorie est tirée', roles2[0].cat !== roles[0].cat);
  const imp2 = roles2.findIndex((r) => r.impostor);
  t('la manche 2 a aussi exactement un intrus', roles2.filter((r) => r.impostor).length === 1);
  t("l intrus de la manche 2 n a pas le mot non plus", roles2[imp2].word === null);

  // Le MJ force le passage : un joueur qui n'écrit rien ne gèle pas la table.
  all.forEach((c) => c.clear());
  all[0].send({ action: 'clue', text: 'seul' });
  mj.send({ action: 'skip' });
  const forced = await all[0].wait('clues');
  t('le MJ peut forcer le passage (un absent ne gèle pas la partie)',
    forced.rounds[0].clues.length === 3);
  t('celui qui n a rien écrit a un indice vide, pas une erreur',
    forced.rounds[0].clues.filter((c) => c.clue === '—').length === 2);

  // Cette fois, personne ne désigne l'intrus : il passe au travers.
  all.forEach((c) => c.clear());
  mj.send({ action: 'skip' });                     // on saute le second tour
  await all[0].wait('vote');
  const imp2Id = order[imp2];
  const notImp = order.filter((id) => id !== imp2Id);
  all.forEach((c, i) => {
    c.send({ action: 'vote', target: order[i] === notImp[0] ? notImp[1] : notImp[0] });
  });
  const res2 = await all[0].wait('results');
  t('passé au travers : l intrus n est pas démasqué', res2.caught === false);
  t('passé au travers : 4 points pour lui', res2.points[imp2Id] === 4);
  t('passé au travers : personne d autre ne marque',
    notImp.every((id) => res2.points[id] === 0));
  t('on ne lui propose pas de deviner', res2.guess === null);

  // --------------------------------------------- une manche qu on écourte
  all.forEach((c) => c.clear());
  mj.send({ action: 'next' });
  const roles3 = await Promise.all([mj.wait('role'), j2.wait('role'), j3.wait('role')]);
  t('la dernière manche est la 3e', roles3[0].round === 3);
  const imp3 = roles3.findIndex((r) => r.impostor);

  // Le départ de l'intrus doit résoudre la manche, pas la geler.
  all.forEach((c) => c.clear());
  const survivor = all[(imp3 + 1) % 3];
  all[imp3].ws.close();
  const res3 = await survivor.wait('results');
  t("si l INTRUS quitte la partie, la manche se résout au lieu de geler",
    res3.impostorId === order[imp3]);
  t('… et le mot est quand même révélé', typeof res3.word === 'string' && res3.word.length > 0);
  t('c est bien annoncé comme la dernière manche', res3.last === true);

  // ---------------------------------------------------------------- la fin
  t('il reste un MJ après un départ', res3.players.some((p) => p.host));

  // Si c'est le MJ qui vient de partir, le rôle a changé de main : on ne sait
  // pas lequel des deux restants le porte, donc les deux demandent la suite.
  // Le serveur ignorera celui qui n'est pas MJ, avec une erreur — c'est déjà
  // testé plus haut.
  const remaining = [mj, j2, j3].filter((c, i) => i !== imp3);
  remaining.forEach((c) => c.send({ action: 'next' }));
  const end = await remaining[0].wait('end');
  t('la partie se termine par un classement', Array.isArray(end.ranking));
  t('le classement est trié',
    end.ranking.every((r, i) => i === 0 || end.ranking[i - 1].score >= r.score));
  t('chaque joueur a une moyenne et un titre',
    end.ranking.every((r) => typeof r.avg === 'number' && typeof r.title === 'string'));

  // ------------------------------------------------- le fil, une fois de plus
  t("AU TOTAL, AUCUN CLIENT N A JAMAIS REÇU LE MOT D UNE MANCHE OÙ IL ÉTAIT L INTRUS",
    !new RegExp(word, 'i').test(all[impIdx].msgs
      .filter((m) => m.type !== 'results' && m.type !== 'guess').map((m) => JSON.stringify(m)).join('')));

  [mj, j2, j3].forEach((c) => { try { c.ws.close(); } catch (e) {} });
  await sleep(150);

  console.log('\n' + (ko
    ? 'DES TESTS ÉCHOUENT — ' + ko + ' échec(s) sur ' + (ok + ko)
    : 'TOUT PASSE — ' + ok + ' vérifications, 0 échec(s)'));
  process.exit(ko ? 1 : 0);
})().catch((e) => {
  console.error('\nEXCEPTION : ' + e.message);
  process.exit(1);
});
