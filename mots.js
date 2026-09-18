// Qui Ment ? — le catalogue. C'EST LE FICHIER À ÉDITER pour enrichir le jeu :
// ajouter une catégorie = ajouter un objet ici, rien d'autre.
//
// Une catégorie, une liste de mots. La catégorie est PUBLIQUE (tout le monde la
// voit, l'intrus compris) ; le mot est SECRET (tout le monde sauf l'intrus).
// C'est de là que vient tout le jeu : l'intrus sait de quoi on parle, mais pas
// de quoi exactement.
//
// Deux règles pour qu'une catégorie tienne la route :
//   1. les mots doivent être assez PROCHES pour qu'un indice vague passe. Une
//      catégorie « objets » avec « cuillère » et « sous-marin » dedans se
//      devine au premier indice, et l'intrus n'a aucune chance ;
//   2. au moins 10 mots, sinon l'intrus qui doit deviner à la fin a une bien
//      trop belle chance au hasard.
const CATEGORIES = [
  {
    id: 'cuisine',
    cat: 'Dans une cuisine',
    words: ['frigo', 'four', 'passoire', 'couteau', 'poêle', 'micro-ondes',
      'éponge', 'bouilloire', 'planche à découper', 'cocotte', 'tire-bouchon',
      'essuie-tout', 'balance', 'saladier'],
  },
  {
    id: 'sport',
    cat: 'Un sport',
    words: ['volley', 'judo', 'escrime', 'natation', 'handball', 'aviron',
      'tir à l\'arc', 'badminton', 'escalade', 'water-polo', 'rugby', 'ski de fond',
      'boxe', 'triathlon'],
  },
  {
    id: 'ecole',
    cat: 'À l\'école',
    words: ['cantine', 'récré', 'tableau', 'cartable', 'contrôle', 'surveillant',
      'carnet de notes', 'gymnase', 'CDI', 'sonnerie', 'conseil de classe',
      'sortie scolaire'],
  },
  {
    id: 'voyage',
    cat: 'En voyage',
    words: ['valise', 'passeport', 'escale', 'auberge', 'décalage horaire',
      'guide papier', 'douane', 'carte SIM', 'terminal', 'consigne',
      'plan de métro', 'assurance'],
  },
  {
    id: 'internet',
    cat: 'Sur Internet',
    words: ['mot de passe', 'newsletter', 'cookies', 'captcha', 'onglet',
      'mise à jour', 'favori', 'pièce jointe', 'notification', 'historique',
      'panier', 'flou de webcam'],
  },
  {
    id: 'boulot',
    cat: 'Au bureau',
    words: ['réunion', 'imprimante', 'machine à café', 'badge', 'open space',
      'tableur', 'entretien annuel', 'astreinte', 'tickets resto',
      'salle de pause', 'note de frais', 'visio'],
  },
  {
    id: 'concert',
    cat: 'En concert',
    words: ['fosse', 'rappel', 'bracelet', 'balance', 'première partie',
      'bouchons d\'oreilles', 'vestiaire', 'régie', 'gobelet consigné',
      'barrière', 'setlist', 'merch'],
  },
  {
    id: 'hiver',
    cat: 'En hiver',
    words: ['écharpe', 'chocolat chaud', 'pare-brise givré', 'raclette',
      'plaid', 'bonnet', 'chauffage', 'nuit qui tombe à 17 h', 'gants',
      'verglas', 'engelures', 'pelle à neige'],
  },
  {
    id: 'jeuvideo',
    cat: 'Dans un jeu vidéo',
    words: ['point de sauvegarde', 'boss', 'tutoriel', 'inventaire', 'succès',
      'écran de chargement', 'mode facile', 'skin', 'respawn', 'carte',
      'quête secondaire', 'cinématique'],
  },
  {
    id: 'restaurant',
    cat: 'Au restaurant',
    words: ['addition', 'carafe d\'eau', 'menu du jour', 'serveur', 'pourboire',
      'réservation', 'entrée', 'terrasse', 'cuisine ouverte', 'ardoise',
      'pain', 'dessert du chef'],
  },
  {
    id: 'ville',
    cat: 'Dans une ville',
    words: ['feu rouge', 'kiosque', 'passage piéton', 'tram', 'horodateur',
      'place du marché', 'travaux', 'pigeon', 'abribus', 'pont',
      'parking souterrain', 'panneau publicitaire'],
  },
  {
    id: 'enfance',
    cat: 'Un souvenir d\'enfance',
    words: ['cabane', 'genou écorché', 'roue arrière', 'goûter', 'colonie',
      'dessin animé du mercredi', 'billes', 'boum', 'dent de lait',
      'piscine municipale', 'trousse', 'cassette'],
  },
];

if (typeof module !== 'undefined' && module.exports) module.exports = { CATEGORIES };
