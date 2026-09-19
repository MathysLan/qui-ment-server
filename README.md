# qui-ment-server

Serveur arbitre du jeu **« Qui Ment ? »**, un des jeux web du portfolio de
Mathys Langiny. Le client est ailleurs : il vit dans le dépôt du portfolio,
sous [`games/quiment/`](https://github.com/MathysLan/MathysLan.github.io/tree/main/games/quiment),
et il est servi par GitHub Pages. Ici, il n'y a que l'arbitre.

C'est la même séparation que pour les autres jeux du portfolio
(`demicercle-server`, `ban-server`, `precision-server`, `passeur-server`) :
**le front est statique, le serveur est la seule autorité.**

## Le jeu

Tout le monde reçoit le même mot. Sauf un : **l'intrus**, qui ne connaît que la
catégorie.

1. **Deux tours d'indices.** Chacun écrit un mot, en aveugle. Quand tout le
   monde a écrit, les indices sont révélés d'un coup. Trop précis, et l'intrus
   comprend le mot ; trop vague, et les autres vous prennent pour l'intrus.
2. **Le vote.** Qui ment ? Chacun désigne quelqu'un.
3. **La révélation.** Si l'intrus est démasqué, il lui reste une chance :
   retrouver le mot dans la liste de la catégorie.

**Les points :** +2 par informé qui désigne l'intrus, +4 à l'intrus s'il passe
au travers, +4 à l'intrus démasqué qui retrouve quand même le mot. À égalité
des voix, le doute profite à l'intrus — c'est ce qui rend le bluff payant.

## Ce qui est du ressort du serveur (et pas du client)

Dans ce jeu, le secret *est* le jeu. Un client qui pourrait lire le mot avant le
vote n'aurait plus rien à jouer. D'où quatre règles, toutes tenues ici :

- **Le mot ne part jamais en diffusion.** Il est envoyé joueur par joueur, et
  l'intrus reçoit `word: null`. Il n'y a pas un seul `broadcast` du serveur qui
  contienne le mot avant la révélation.
- **Personne n'apprend qui est l'intrus**, pas même par omission : tout le monde
  reçoit un message `role` de la même forme, avec le même jeu de champs.
- **Les indices sont ramassés en silence**, puis révélés d'un bloc. Sinon le
  dernier à écrire lirait les autres — et l'intrus n'aurait qu'à recopier.
- **La liste des mots de la catégorie** n'est envoyée qu'à l'intrus, et
  seulement s'il a été démasqué, au moment exact où il doit deviner.

Le serveur refuse aussi l'indice d'un informé qui **contient le mot secret**
(comparé sans accents ni casse). Ce n'est pas de la police : un joueur qui écrit
le mot gâche la manche pour toute la table, et il vaut mieux le lui dire avant.

## Lancer en local

    npm install
    npm start          # écoute sur $PORT, 8092 par défaut

Puis ouvrir le client du portfolio en lui donnant ce serveur :

    games/quiment/index.html?server=ws://localhost:8092

`?server=` marche sur tous les jeux du portfolio ; sans lui, le client parle à
la production.

Il faut **3 joueurs minimum** : en dessous, le vote n'a aucun sens. Pour tester
seul, ouvrir trois onglets.

## Tests

    npm test           # = node test-engine.mjs && node test.js

Deux niveaux, aucune dépendance en dehors de `ws` :

- `test-engine.mjs` — le **moteur pur** (`engine.js`) : tirage, barème,
  dépouillement, règle de l'égalité, validation des indices, catalogue.
  52 vérifications, dont une série en négatif sur ce que `viewFor()` ne doit
  jamais renvoyer.
- `test.js` — une **partie complète en WebSocket**, jouée par trois vrais
  clients `ws`. Il fait un travail que le test du moteur ne peut pas faire :
  relire **tout ce qui est réellement passé sur le fil**. Le moteur peut être
  irréprochable et le serveur laisser filer le mot dans un message de
  progression ; ici, à chaque étape, on cherche le mot dans l'historique complet
  de l'intrus. 57 vérifications.

Les deux suites tournent en moins de deux secondes et ne dépendent d'aucun
délai fixe (`waitFor` attend une condition, pas une durée) : elles ne sont pas
intermittentes.

## Ajouter une catégorie

Tout est dans `mots.js` : ajouter un objet, c'est tout.

    {
      id: 'garage',
      cat: 'Dans un garage',
      words: ['cric', 'bidon d huile', 'clé à molette', /* … au moins 10 … */],
    }

Deux règles pour qu'une catégorie tienne la route, et `test-engine.mjs` vérifie
la seconde :

1. les mots doivent être assez **proches** pour qu'un indice vague passe. Une
   catégorie « objets » qui contient « cuillère » et « sous-marin » se devine au
   premier indice, et l'intrus n'a aucune chance ;
2. **au moins 10 mots**, sinon l'intrus démasqué a une bien trop belle chance au
   hasard.

Le catalogue est en français uniquement : traduire des mots à deviner un pour un
n'aurait pas de sens, et les pages de jeux du portfolio sont en français.

## Déploiement

`render.yaml` décrit le service (Node, plan gratuit, `npm install` puis
`npm start`). Sur le plan gratuit, l'instance s'endort : le premier joueur
attend ~30 s le temps du réveil, et le client le dit dans son message d'erreur.

## Le protocole, en bref

Un seul WebSocket, du JSON, une machine à états par phase. Aucun timer de
gameplay : une phase avance quand tout le monde a fait sa part, et le MJ peut
toujours forcer le passage.

| Client → serveur | |
|---|---|
| `join` | `{ name, avatar, code? }` — sans `code`, on crée la partie et on devient MJ |
| `start` | MJ uniquement : `{ rounds }` |
| `clue` | `{ text }` — un indice, 24 caractères maximum |
| `vote` | `{ target }` — jamais soi-même |
| `guess` | intrus démasqué uniquement : `{ word }` |
| `skip` | MJ uniquement : forcer la phase en cours (un absent ne gèle pas la table) |
| `next` | MJ uniquement : manche suivante, ou classement final |
| `lobby` | MJ uniquement : rejouer, on revient au salon |

| Serveur → client | |
|---|---|
| `you` | ton identifiant, le code de la partie, si tu es MJ |
| `lobby` | joueurs présents, qui est MJ |
| `role` | **envoyé joueur par joueur** : la catégorie, et le mot — ou `null` si tu es l'intrus |
| `progress` | qui a déjà écrit ou voté, **jamais quoi** |
| `clues` | les indices d'un tour, révélés d'un bloc |
| `vote` | ouverture du vote, avec les deux tours d'indices sous les yeux |
| `guessing` | l'intrus a été démasqué et tente de retrouver le mot (son nom n'est pas encore dit) |
| `guess` | **envoyé au seul intrus** : la liste des mots de la catégorie, mélangée |
| `results` | enfin : le mot, qui était l'intrus, le détail des voix et les points |
| `end` | classement trié, moyenne par manche et titre |
| `error` | message lisible, en français |

## Licence

MIT.

## Avatar (photo de profil)

Depuis le 2026-09-19, `avatar` dans le `join` est un objet, et c'est le même
objet qui repart dans toutes les listes de joueurs (salon, scores, podium…) :

```js
{ kind: 'emoji', emoji: '🦊' }
{ kind: 'image', emoji: '🦊', src: 'data:image/webp;base64,…' }   // la photo du profil
```

`avatar.js` le revalide (le client n'a aucune autorité) : data-URL **webp ou
png** seulement, **≤ 12 Ko décodés**, base64 canonique, signature du fichier
vérifiée (RIFF…WEBP / PNG). Refusé : SVG, tout autre type, image trop lourde,
structure inattendue, `kind` inconnu — l'image est alors écartée et le joueur
entre avec son emoji (défaut du jeu : 🕵️). Seuls `kind`, `emoji` et `src`
sont recopiés. L'image n'est ni décodée ni réencodée : gardée telle quelle.
Un ancien client qui envoie une simple chaîne (un emoji) reste accepté.

⚠️ `avatar.js` est le même fichier dans les six serveurs qui reçoivent une
identité (imitation, demicercle, ban, precision, passeur, qui-ment).

Tests : `node test-avatar.js` (validation, avec de vraies images dans
`test-fixtures/`) et le test WebSocket réel :

```
node test-avatar-ws.js          # démarre le serveur lui-même
```
