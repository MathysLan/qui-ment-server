// Qui Ment ? — moteur PUR. Aucun DOM, aucun réseau, aucun état de connexion :
// tout ce qui décide d'un score est ici, et rien d'autre. C'est la même forme
// que engine.js de passeur-server et que les moteurs du Ban et de Précision.
//
// Le point sensible de ce jeu, c'est le SECRET. Deux fonctions seulement le
// connaissent — `dealRound()` qui le tire, et `resolve()` qui le révèle — et
// entre les deux, `viewFor()` est la seule chose que le serveur a le droit
// d'envoyer à un joueur. Elle ne renvoie jamais le mot à l'intrus, et ne dit
// jamais à personne qui est l'intrus.
//
// Conséquence : pour qu'un bug fasse fuiter le mot, il faudrait contourner
// viewFor(). Les tests s'en assurent explicitement.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuiMentEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_PLAYERS = 3;          // en dessous, le vote n'a aucun sens
  const CLUE_MAX = 24;            // un indice, pas une phrase
  const POINTS_GOOD_VOTE = 2;     // un informé qui désigne l'intrus
  const POINTS_ESCAPE = 4;        // l'intrus qui passe au travers
  const POINTS_GUESS = 4;         // l'intrus démasqué qui retrouve le mot

  const pick = (arr, rnd) => arr[Math.floor((rnd || Math.random)() * arr.length)];

  // Un tirage sans répétition : on épuise le paquet avant de le rebattre, sinon
  // une partie de 5 manches peut tomber trois fois sur la même catégorie.
  function deal(items, count, random) {
    const rnd = random || Math.random;
    const pool = items.slice();
    const out = [];
    while (out.length < count && pool.length) {
      out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
    return out;
  }

  // Mélange de Fisher-Yates. Sert à présenter la liste des mots à l'intrus
  // démasqué : dans l'ordre du catalogue, il repérerait des habitudes.
  function shuffle(arr, random) {
    const rnd = random || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // La manche : une catégorie, un mot, un intrus. C'est l'objet SECRET — il ne
  // sort pas du serveur tel quel.
  function dealRound(category, playerIds, random) {
    if (!category || !category.words || !category.words.length) {
      throw new Error('catégorie vide');
    }
    if (playerIds.length < MIN_PLAYERS) {
      throw new Error(`il faut au moins ${MIN_PLAYERS} joueurs`);
    }
    return {
      categoryId: category.id,
      cat: category.cat,
      words: category.words.slice(),
      word: pick(category.words, random),
      impostorId: pick(playerIds, random),
    };
  }

  // CE QUE CHAQUE JOUEUR A LE DROIT DE VOIR, et rien d'autre. L'intrus reçoit
  // la catégorie et le fait qu'il est l'intrus ; les autres reçoivent le mot.
  // Personne ne reçoit la liste des rôles.
  function viewFor(round, playerId) {
    const impostor = round.impostorId === playerId;
    return {
      cat: round.cat,
      impostor,
      word: impostor ? null : round.word,
    };
  }

  // Un indice est refusé s'il est vide, trop long, ou s'il CONTIENT le mot
  // secret. Le dernier cas n'est pas de la police : un informé qui écrit le mot
  // lui-même gâche la manche pour tout le monde, et il vaut mieux le lui dire
  // avant que de résoudre une manche morte. On compare sans accents ni casse,
  // sinon « Frigo » passerait.
  function normalize(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function checkClue(text, round, playerId) {
    const clue = String(text == null ? '' : text).trim();
    if (!clue) return { ok: false, reason: 'indice vide' };
    if (clue.length > CLUE_MAX) return { ok: false, reason: `${CLUE_MAX} caractères maximum` };
    if (round.impostorId !== playerId) {
      const n = normalize(clue), w = normalize(round.word);
      if (w && n.includes(w)) return { ok: false, reason: 'ton indice contient le mot — trouve autre chose' };
    }
    return { ok: true, clue };
  }

  // Dépouillement. `votes` = { votantId: cibleId }. Renvoie le compte par
  // joueur et les joueurs à égalité en tête.
  function tally(votes) {
    const counts = {};
    Object.keys(votes).forEach((voter) => {
      const target = votes[voter];
      if (!target) return;
      counts[target] = (counts[target] || 0) + 1;
    });
    let best = 0;
    Object.keys(counts).forEach((id) => { if (counts[id] > best) best = counts[id]; });
    const top = Object.keys(counts).filter((id) => counts[id] === best);
    return { counts, top: best ? top : [], best };
  }

  // L'intrus est démasqué s'il est SEUL en tête des voix. À égalité, le doute
  // lui profite — c'est la règle qui rend le bluff payant, et elle évite un
  // départage arbitraire.
  function unmasked(votes, impostorId) {
    const t = tally(votes);
    return t.top.length === 1 && t.top[0] === impostorId;
  }

  // Le seul endroit qui donne des points, et le seul qui révèle le mot.
  //   - un informé qui a voté pour l'intrus : +2 ;
  //   - l'intrus non démasqué : +4 ;
  //   - l'intrus démasqué qui retrouve le mot : +4 (les informés gardent leurs
  //     points : ils l'ont trouvé, lui s'est rattrapé, les deux ont joué).
  // `guess` est le mot proposé par l'intrus démasqué, ou null.
  function resolve(round, playerIds, votes, guess) {
    const t = tally(votes);
    const caught = unmasked(votes, round.impostorId);
    const guessed = caught && guess != null && normalize(guess) === normalize(round.word);
    const points = {};
    playerIds.forEach((id) => {
      if (id === round.impostorId) {
        points[id] = (!caught ? POINTS_ESCAPE : 0) + (guessed ? POINTS_GUESS : 0);
      } else {
        points[id] = votes[id] === round.impostorId ? POINTS_GOOD_VOTE : 0;
      }
    });
    return {
      word: round.word,
      cat: round.cat,
      impostorId: round.impostorId,
      caught,
      guess: caught ? (guess == null ? null : String(guess)) : null,
      guessed,
      counts: t.counts,
      points,
    };
  }

  // Titre de fin, à la manière du Passeur : une moyenne par manche, pour que le
  // score reste comparable quel que soit le nombre de manches jouées.
  function grade(total, rounds) {
    const avg = rounds ? Math.round((total / rounds) * 10) / 10 : 0;
    let title = 'Livre ouvert';
    if (avg >= 3.5) title = 'Menteur professionnel';
    else if (avg >= 2.5) title = 'Visage impassible';
    else if (avg >= 1.5) title = 'Bon flair';
    else if (avg >= 0.7) title = 'Ça vient';
    return { avg, title };
  }

  return {
    deal, shuffle, dealRound, viewFor, checkClue, tally, unmasked, resolve, grade,
    normalize,
    MIN_PLAYERS, CLUE_MAX, POINTS_GOOD_VOTE, POINTS_ESCAPE, POINTS_GUESS,
  };
});
