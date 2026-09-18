// Tests du moteur pur de Qui Ment ?. Aucune dépendance, aucun réseau :
//     node test-engine.mjs
//
// Ce qui compte le plus ici, ce sont les tests EN NÉGATIF — ce que le moteur ne
// doit jamais laisser sortir. Un jeu de bluff dont le secret fuite n'est plus
// un jeu, et une fuite ne se voit pas à l'écran : elle se voit dans le trafic.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./engine.js');
const { CATEGORIES } = require('./mots.js');

let ok = 0, ko = 0;
const t = (name, cond) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name); }
};

// Un hasard déterminé, pour que les tests ne soient pas un tirage au sort.
const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };

// ------------------------------------------------------------- le catalogue
t('le catalogue a au moins 10 catégories', CATEGORIES.length >= 10);
t('chaque catégorie a un id, un intitulé et des mots',
  CATEGORIES.every((c) => c.id && c.cat && Array.isArray(c.words)));
t('aucun id de catégorie en double',
  new Set(CATEGORIES.map((c) => c.id)).size === CATEGORIES.length);
t('chaque catégorie a au moins 10 mots (sinon l intrus devine au hasard)',
  CATEGORIES.every((c) => c.words.length >= 10));
t('aucun mot en double dans une même catégorie',
  CATEGORIES.every((c) => new Set(c.words).size === c.words.length));
t('aucun mot vide ou à rallonge',
  CATEGORIES.every((c) => c.words.every((w) => w.trim().length > 0 && w.length <= 28)));

// ------------------------------------------------------------------ tirage
const IDS = ['a', 'b', 'c', 'd'];
const cat = { id: 'x', cat: 'Test', words: ['un', 'deux', 'trois', 'quatre'] };

const r0 = E.dealRound(cat, IDS, seq([0, 0]));
t('une manche tire un mot de la catégorie', cat.words.includes(r0.word));
t('une manche tire un intrus parmi les joueurs', IDS.includes(r0.impostorId));
t('la manche garde la catégorie et sa liste de mots',
  r0.cat === 'Test' && r0.words.length === 4);

let threw = false;
try { E.dealRound(cat, ['a', 'b'], Math.random); } catch (e) { threw = /3 joueurs/.test(e.message); }
t('moins de 3 joueurs est refusé', threw);

threw = false;
try { E.dealRound({ id: 'v', cat: 'Vide', words: [] }, IDS); } catch (e) { threw = true; }
t('une catégorie sans mot est refusée', threw);

t('un tirage de 5 catégories ne répète rien',
  new Set(E.deal(CATEGORIES, 5).map((c) => c.id)).size === 5);
t('demander plus de catégories qu il n en existe ne boucle pas',
  E.deal(CATEGORIES, 999).length === CATEGORIES.length);
t('le mélange garde exactement les mêmes mots',
  E.shuffle(cat.words).slice().sort().join('|') === cat.words.slice().sort().join('|'));

// --------------------------------------------------- CE QUI NE DOIT PAS FUIR
const round = { categoryId: 'x', cat: 'Test', words: cat.words, word: 'deux', impostorId: 'c' };

const vImp = E.viewFor(round, 'c');
t("L INTRUS NE REÇOIT PAS LE MOT", vImp.word === null);
t("l intrus sait qu il est l intrus", vImp.impostor === true);
t('l intrus reçoit quand même la catégorie', vImp.cat === 'Test');

const vOther = E.viewFor(round, 'a');
t('un informé reçoit le mot', vOther.word === 'deux');
t('un informé est marqué comme non-intrus', vOther.impostor === false);
t('AUCUNE VUE NE DIT QUI EST L INTRUS',
  !('impostorId' in vImp) && !('impostorId' in vOther));
t('aucune vue ne renvoie la liste des mots (elle donnerait des idées)',
  !('words' in vImp) && !('words' in vOther));

// -------------------------------------------------------------- les indices
t('un indice vide est refusé', E.checkClue('   ', round, 'a').ok === false);
t('un indice trop long est refusé', E.checkClue('x'.repeat(25), round, 'a').ok === false);
t('un indice normal passe, et il est rogné',
  E.checkClue('  froid ', round, 'a').clue === 'froid');
t('un informé ne peut pas écrire le mot secret',
  E.checkClue('deux', round, 'a').ok === false);
t('… même avec une majuscule ou un accent en travers',
  E.checkClue('DEUX', round, 'a').ok === false
  && E.checkClue('chiffre', Object.assign({}, round, { word: 'école' }), 'a').ok === true
  && E.checkClue('Ecole', Object.assign({}, round, { word: 'école' }), 'a').ok === false);
t('l intrus, lui, PEUT tomber sur le mot par hasard (il ne le connaît pas)',
  E.checkClue('deux', round, 'c').ok === true);

// ------------------------------------------------------------ dépouillement
const T = E.tally({ a: 'c', b: 'c', c: 'a', d: 'b' });
t('le dépouillement compte les voix', T.counts.c === 2 && T.counts.a === 1);
t('le dépouillement sort le joueur en tête', T.top.length === 1 && T.top[0] === 'c');
t('un vote vide ne compte pas', E.tally({ a: null, b: 'c' }).counts.c === 1);
t('sans aucun vote, personne n est en tête', E.tally({}).top.length === 0);

t('l intrus seul en tête est démasqué',
  E.unmasked({ a: 'c', b: 'c', c: 'a', d: 'c' }, 'c') === true);
t('A ÉGALITÉ, LE DOUTE PROFITE À L INTRUS',
  E.unmasked({ a: 'c', b: 'c', c: 'a', d: 'a' }, 'c') === false);
t('un intrus non visé s en sort', E.unmasked({ a: 'b', b: 'a', c: 'a', d: 'a' }, 'c') === false);

// ----------------------------------------------------------------- le barème
const caught = E.resolve(round, IDS, { a: 'c', b: 'c', c: 'a', d: 'b' }, null);
t('démasqué : les voteurs justes marquent 2', caught.points.a === 2 && caught.points.b === 2);
t('démasqué : un informé qui vote à côté ne marque rien', caught.points.d === 0);
t('démasqué sans deviner : l intrus ne marque rien', caught.points.c === 0);
t('les résultats révèlent enfin le mot', caught.word === 'deux');
t('les résultats disent qui était l intrus', caught.impostorId === 'c');

const escaped = E.resolve(round, IDS, { a: 'b', b: 'a', c: 'a', d: 'a' }, null);
t('passé au travers : l intrus marque 4', escaped.points.c === 4);
t('passé au travers : personne d autre ne marque',
  escaped.points.a === 0 && escaped.points.b === 0 && escaped.points.d === 0);
t('on ne propose pas de deviner à un intrus qui n a pas été démasqué',
  escaped.guess === null && escaped.guessed === false);

const saved = E.resolve(round, IDS, { a: 'c', b: 'c', c: 'a', d: 'c' }, 'deux');
t('démasqué mais il retrouve le mot : 4 points', saved.points.c === 4);
t('… et les informés gardent les leurs, ils l avaient bien trouvé',
  saved.points.a === 2 && saved.points.d === 2);
t('la bonne réponse est reconnue malgré la casse',
  E.resolve(round, IDS, { a: 'c', b: 'c', c: 'a', d: 'c' }, 'DEUX').guessed === true);
const missed = E.resolve(round, IDS, { a: 'c', b: 'c', c: 'a', d: 'c' }, 'trois');
t('une mauvaise réponse ne rapporte rien', missed.points.c === 0 && missed.guessed === false);

t('un joueur qui ne vote pas ne marque rien',
  E.resolve(round, IDS, { a: 'c', b: 'c', c: 'a' }, null).points.d === 0);
t('une manche sans aucun vote ne plante pas',
  E.resolve(round, IDS, {}, null).points.c === 4);

// -------------------------------------------------------------- note de fin
t('la note finale est une moyenne par manche', E.grade(10, 5).avg === 2);
t('chaque palier a un titre',
  [0, 1, 2, 3, 5].every((n) => typeof E.grade(n * 5, 5).title === 'string'));
t('une partie sans point ne plante pas', E.grade(0, 0).avg === 0);
t('le meilleur palier se mérite', E.grade(20, 5).title === 'Menteur professionnel');

console.log('\n' + (ko
  ? 'DES TESTS ÉCHOUENT — ' + ko + ' échec(s) sur ' + (ok + ko)
  : 'TOUT PASSE — ' + ok + ' vérifications, 0 échec(s)'));
process.exit(ko ? 1 : 0);
