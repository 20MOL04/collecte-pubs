/**
 * Les niches de Pub Track : liste FERMÉE.
 *
 * `termes` sert à deviner la niche d'une pub, par mot entier (texte.ts). Les mots
 * que le collecteur TAPE vivent ailleurs, par langue (`mots-cles.ts`, `requetes.ts`).
 *
 * Pas de devinette sûre = `autre`. Jamais une niche au hasard.
 *
 * Mesure du 15/10/2026 sur la vraie base : 46 % des pubs visibles tombaient en `autre`. Trois
 * causes : des listes d'une vingtaine de mots, en français surtout, sans pluriel (« pagnes »
 * ne trouvait pas « pagne ») ; les lettres stylisées (« 𝐊𝐈𝐓 𝐌𝐈𝐍𝐂𝐄𝐔𝐑 ») jamais ramenées à des
 * lettres simples ; et toute égalité rendue `autre`. Les listes couvrent maintenant le français,
 * l'anglais, le portugais et un peu de swahili, le pluriel se ramène au singulier, la famille du
 * produit nommée par le collecteur (« headphones ») compte double, et une égalité se tranche par
 * la famille, puis par le terme lu le PREMIER dans la pub : une règle fixe, pas un tirage.
 * Verrou : `verify-pub-track-qualite.ts`.
 *
 * `services` et `immobilier` restent courtes exprès : elles font sortir une pub des produits
 * (`categoriePub`), un mot de trop y écarterait de vrais vendeurs.
 */
import { mots } from './texte';

export const NICHES = [
  'beaute',
  'mode',
  'chaussures',
  'maison',
  'electronique',
  'sante',
  'alimentation',
  'bebe',
  'auto_moto',
  'digital',
  'services',
  'immobilier',
  'autre',
] as const;
export type Niche = (typeof NICHES)[number];

interface DefNiche {
  nom: string;
  nomEn: string;
  termes: readonly string[];
}

export const DEF_NICHES: Record<Niche, DefNiche> = {
  beaute: {
    nom: 'Beauté et soins',
    nomEn: 'Beauty and care',
    termes: [
      'creme', 'serum', 'peau', 'visage', 'teint', 'savon', 'lotion', 'gommage', 'eclaircissant', 'eclaircissante', 'tache', 'bouton', 'acne',
      'cheveu', 'perruque', 'meche', 'parfum', 'maquillage', 'skincare', 'skin', 'hair', 'wig', 'perfume', 'beauty', 'beaute', 'cosmetique', 'gel', 'huile',
      'lait corporel', 'beurre corporel', 'beurre de karite', 'karite', 'rouge a levre', 'lipstick', 'gloss', 'vernis', 'ongle', 'nail', 'cil', 'eyelash',
      'lash', 'sourcil', 'deodorant', 'shampoing', 'shampooing', 'shampoo', 'conditioner', 'mascara', 'fond de teint', 'foundation', 'body lotion',
      'facial', 'moisturizer', 'toner', 'sunscreen', 'ecran solaire', 'ride', 'wrinkle', 'anti age', 'tresse', 'braid', 'lace', 'frontal', 'defrisant',
      'coiffure', 'barbe', 'beard', 'rasoir', 'epilation', 'epilateur', 'dentifrice', 'teeth whitening', 'blanchiment', 'cosmetic', 'makeup',
      'vergeture', 'hydratant', 'hydratante', 'soap', 'body oil', 'face oil', 'cleanser', 'hair care', 'pele', 'cabelo', 'maquiagem', 'nywele', 'ngozi',
      'exfoliant', 'masque visage', 'savon noir', 'lissage', 'keratine', 'pommade', 'body butter',
    ],
  },
  mode: {
    nom: 'Mode',
    nomEn: 'Fashion',
    termes: [
      'robe', 'pagne', 'wax', 'boubou', 'ensemble', 'tenue', 'chemise', 'pantalon', 'jean', 'sac', 'montre', 'bijou', 'collier', 'lunette', 'dress', 'fashion',
      'mode', 'vetement', 'clothes', 'bag', 'watch', 'jupe', 'short', 't shirt', 'tshirt', 'polo', 'veste', 'manteau', 'blouson', 'pull', 'sweat', 'hoodie',
      'jacket', 'coat', 'legging', 'lingerie', 'soutien gorge', 'bra', 'culotte', 'boxer', 'chaussette', 'sock', 'gaine', 'shapewear', 'abaya', 'hijab',
      'kaftan', 'caftan', 'djellaba', 'bazin', 'kente', 'ankara', 'kitenge', 'bracelet', 'bague', 'earring', 'boucle d oreille', 'necklace', 'pendentif',
      'pendant', 'casquette', 'chapeau', 'hat', 'foulard', 'echarpe', 'ceinture', 'belt', 'portefeuille', 'wallet', 'sac a main', 'handbag', 'backpack',
      'sac a dos', 'valise', 'suitcase', 'sunglasses', 'glasses', 'bonnet', 'tissu', 'fabric', 'clothing', 'outfit', 'apparel', 'jewelry', 'jewellery',
      'vestido', 'roupa', 'bolsa', 'calca', 'camisa', 'oculos', 'relogio', 'colar', 'brinco', 'joia', 'semijoia', 'nguo', 'gauni', 'mkoba', 'cap',
      'pyjama', 'nuisette', 'combinaison', 'kimono', 'costume', 'cravate', 'bijouterie', 'ring', 'jogging', 'survetement', 'mochila', 'trousse',
      'pochette',
    ],
  },
  chaussures: {
    nom: 'Chaussures',
    nomEn: 'Shoes',
    termes: [
      'chaussure', 'basket', 'sneaker', 'sandale', 'escarpin', 'mocassin', 'shoe', 'boot', 'botte', 'talon', 'heels', 'mule', 'claquette', 'slipper',
      'pantoufle', 'tong', 'derby', 'pointure', 'clog', 'sapato', 'tenis', 'sandalia', 'chinelo', 'viatu', 'babouche', 'espadrille',
    ],
  },
  maison: {
    nom: 'Maison et cuisine',
    nomEn: 'Home and kitchen',
    termes: [
      'cuisine', 'mixeur', 'blender', 'marmite', 'casserole', 'poele', 'vaisselle', 'rideau', 'matelas', 'drap', 'canape', 'meuble', 'lampe', 'ventilateur',
      'nettoyage', 'kitchen', 'home', 'maison', 'deco', 'broyeur', 'moulin', 'batteur', 'batteuse', 'friteuse', 'air fryer', 'airfryer', 'four', 'micro onde',
      'refrigerateur', 'frigo', 'congelateur', 'cuisiniere', 'gaziniere', 'bouilloire', 'assiette', 'gobelet', 'tasse', 'mug', 'couteau', 'knife', 'cookware',
      'ustensile', 'table', 'chaise', 'chair', 'lit', 'bed', 'oreiller', 'pillow', 'couverture', 'blanket', 'couette', 'coussin', 'cushion', 'tapis', 'rug',
      'carpet', 'armoire', 'etagere', 'shelf', 'rangement', 'organizer', 'organisateur', 'decoration', 'decor', 'miroir', 'mirror', 'horloge', 'vase',
      'fleur artificielle', 'lamp', 'ampoule', 'bulb', 'lustre', 'climatiseur', 'clim', 'aspirateur', 'vacuum', 'balai', 'serpillere', 'mop', 'lessive',
      'detergent', 'laundry', 'machine a laver', 'washing machine', 'fer a repasser', 'moustiquaire', 'mattress', 'towel', 'serviette', 'salle de bain',
      'bathroom', 'douche', 'shower', 'robinet', 'jardin', 'garden', 'outil', 'tool', 'perceuse', 'drill', 'bricolage', 'cozinha', 'casa', 'cama', 'colchao',
      'sofa', 'panela', 'toalha', 'jiko', 'kitanda', 'sufuria', 'godoro', 'lampe solaire', 'pet', 'dog', 'chien', 'cat', 'cleaning', 'cleaner', 'furniture',
      'thermos', 'glaciere', 'presse agrume', 'extracteur de jus', 'centrifugeuse', 'cuiseur', 'autocuiseur', 'rice cooker', 'robot de cuisine',
      'nappe', 'lunch box', 'bocal', 'seau', 'filtre a eau', 'water filter', 'purificateur', 'humidificateur', 'diffuseur', 'diffuser', 'bougie',
      'candle', 'cadre', 'tableau', 'papier peint', 'wallpaper', 'carrelage', 'peinture', 'paint', 'wrench', 'scie', 'saw', 'construction', 'btp',
      'fan', 'nettoyeur', 'karcher', 'stove', 'rechaud', 'plaque a gaz', 'detendeur', 'grill', 'barbecue',
    ],
  },
  electronique: {
    nom: 'Électronique et accessoires',
    nomEn: 'Electronics and accessories',
    termes: [
      'telephone', 'smartphone', 'iphone', 'samsung', 'ecouteur', 'airpod', 'chargeur', 'powerbank', 'power bank', 'tablette', 'ordinateur', 'laptop', 'tv',
      'television', 'camera', 'enceinte', 'speaker', 'phone', 'smartwatch', 'smart watch', 'montre connectee', 'earbud', 'earphone', 'headphone', 'bluetooth',
      'wifi', 'wi fi', 'routeur', 'router', 'modem', 'usb', 'cable', 'adaptateur', 'projecteur', 'projector', 'videoprojecteur', 'drone', 'console',
      'playstation', 'ps5', 'manette', 'gamepad', 'clavier', 'keyboard', 'souris', 'mouse', 'ecran', 'monitor', 'imprimante', 'printer', 'disque dur',
      'cle usb', 'carte memoire', 'radio', 'micro', 'microphone', 'ring light', 'tripod', 'trepied', 'gimbal', 'panneau solaire', 'solar panel', 'inverter',
      'onduleur', 'batterie', 'battery', 'groupe electrogene', 'generator', 'stabilisateur', 'decodeur', 'antenne', 'redmi', 'xiaomi', 'tecno', 'infinix',
      'itel', 'huawei', 'oppo', 'vivo', 'pixel', 'macbook', 'pc', 'electronique', 'electronic', 'gadget', 'appareil photo', 'surveillance', 'cctv', 'alarme',
      'tracker', 'gps', 'lampe torche', 'flashlight', 'walkie talkie', 'telecommande', 'kit solaire', 'solar', 'solaire', 'convertisseur', 'casque audio',
      'casque bluetooth', 'sans fil', 'wireless', 'led', 'telemovel', 'celular', 'simu', 'lithium', 'kva',
    ],
  },
  sante: {
    nom: 'Santé et bien-être',
    nomEn: 'Health and wellness',
    termes: [
      'sante', 'douleur', 'articulation', 'tension', 'diabete', 'minceur', 'maigrir', 'ventre', 'detox', 'tisane', 'complement', 'vitamine', 'sexuel',
      'virilite', 'fertilite', 'health', 'weight', 'naturel', 'plante', 'hemorroide', 'prostate', 'infection', 'ulcere', 'gastrite', 'digestion',
      'constipation', 'cholesterol', 'hypertension', 'glycemie', 'menstruation', 'kyste', 'fibrome', 'libido', 'erection', 'ejaculation', 'aphrodisiaque',
      'impuissance', 'endurance', 'poids', 'perte de poids', 'weight loss', 'slim', 'slimming', 'graisse', 'ventre plat', 'bien etre', 'wellness',
      'supplement', 'capsule', 'gelule', 'comprime', 'sirop', 'remede', 'traitement', 'massage', 'massager', 'masseur', 'orthopedique', 'genou', 'knee',
      'back pain', 'posture', 'correcteur', 'tensiometre', 'glucometre', 'thermometre', 'oxymetre', 'medical', 'medicament', 'pharmacie', 'moringa',
      'gingembre', 'ginseng', 'spiruline', 'collagene', 'collagen', 'probiotic', 'immunite', 'immunity', 'insomnie', 'stress', 'fitness', 'musculation',
      'gym', 'yoga', 'exercise', 'treadmill', 'saude', 'dor', 'emagrecer', 'barriga', 'afya', 'maumivu', 'kisukari', 'dietary', 'blood pressure',
      'blood sugar', 'kidney', 'rein', 'foie', 'liver', 'mal de dos', 'sciatique', 'rhumatisme', 'arthrose', 'migraine', 'yeux', 'hormone',
      'menopause', 'grossesse', 'pregnancy', 'snoring', 'ronflement', 'brule graisse', 'fat burner', 'traditionnel', 'naturelle',
      'haleine', 'cicatrice', 'fertility', 'pain relief',
    ],
  },
  alimentation: {
    nom: 'Alimentation et boissons',
    nomEn: 'Food and drinks',
    // Pas de « thé » : sans accent il devient « the », l'article anglais.
    termes: [
      'cafe', 'jus', 'miel', 'chocolat', 'epice', 'riz', 'huile', 'farine', 'boisson', 'restaurant', 'livraison repas', 'patisserie', 'gateau', 'food',
      'coffee', 'tea', 'drink', 'lait', 'poisson', 'viande', 'poulet', 'oeuf', 'fruit', 'legume', 'sauce', 'condiment', 'bouillon', 'pate', 'spaghetti',
      'couscous', 'attieke', 'gari', 'manioc', 'igname', 'plantain', 'arachide', 'cacahuete', 'noix', 'cajou', 'cashew', 'amande', 'datte', 'sucre', 'sel',
      'vin', 'wine', 'biere', 'beer', 'whisky', 'liqueur', 'eau minerale', 'soda', 'yaourt', 'fromage', 'snack', 'biscuit', 'bonbon', 'candy', 'cereale',
      'cereal', 'oats', 'avoine', 'pizza', 'burger', 'traiteur', 'repas', 'meal', 'cake', 'cookie', 'glace', 'ice cream', 'green tea', 'comida', 'mel',
      'molho', 'sumo', 'suco', 'bolo', 'chakula', 'kahawa', 'chai', 'asali', 'mchele', 'bissap', 'confiture', 'jam', 'ketchup',
      'mayonnaise', 'conserve', 'sardine', 'crevette', 'shrimp', 'mangue', 'ananas', 'banane', 'tomate', 'oignon', 'piment', 'poivre', 'surgele',
    ],
  },
  bebe: {
    nom: 'Bébé et enfant',
    nomEn: 'Baby and kids',
    termes: [
      'bebe', 'enfant', 'couche', 'poussette', 'jouet', 'biberon', 'baby', 'kid', 'toy', 'nourrisson', 'layette', 'puzzle', 'peluche', 'lego', 'cartable',
      'fourniture scolaire', 'child', 'children', 'toddler', 'diaper', 'stroller', 'nursery', 'crianca', 'brinquedo', 'mtoto', 'watoto', 'educatif',
      'porte bebe', 'chaise haute', 'lit bebe', 'tetine', 'lingette', 'wipes', 'maternite', 'ecolier', 'scolaire',
    ],
  },
  auto_moto: {
    nom: 'Auto et moto',
    nomEn: 'Car and motorbike',
    termes: [
      'voiture', 'auto', 'moto', 'pneu', 'casque', 'retroviseur', 'car', 'motorbike', 'vehicule', 'piece auto', 'piece detachee', 'spare part', 'tire', 'tyre',
      'jante', 'rim', 'huile moteur', 'engine', 'moteur', 'phare', 'headlight', 'essuie glace', 'wiper', 'siege auto', 'car seat', 'volant', 'toyota',
      'mercedes', 'bmw', 'nissan', 'hyundai', 'kia', 'peugeot', 'scooter', 'velo', 'bike', 'bicycle', 'trottinette', 'tricycle', 'camion', 'truck',
      'carrosserie', 'dashcam', 'compresseur', 'antigel', 'lubrifiant', 'vidange', 'carro', 'llanta', 'pikipiki', 'corolla', 'automobile',
    ],
  },
  digital: {
    nom: 'Formation et produits digitaux',
    nomEn: 'Courses and digital products',
    termes: [
      'formation', 'ebook', 'cours', 'coaching', 'masterclass', 'webinaire', 'application', 'logiciel', 'abonnement', 'course', 'training', 'template',
      'trading', 'crypto', 'pdf', 'e book', 'livre numerique', 'pack digital', 'tutoriel', 'tutorial', 'online course', 'forex', 'dropshipping',
      'marketing digital', 'affiliation', 'guide pratique', 'guide complet', 'telechargement', 'telecharger', 'curso', 'digital product',
      // La famille « digital service » du collecteur : un tableur, un pack de plans, pas une agence.
      'digital service',
    ],
  },
  services: {
    nom: 'Services',
    nomEn: 'Services',
    termes: ['service', 'services', 'agence', 'reparation', 'transfert', 'voyage', 'billet', 'visa', 'assurance', 'credit', 'pret', 'banque', 'agency'],
  },
  immobilier: {
    nom: 'Immobilier',
    nomEn: 'Real estate',
    termes: ['terrain', 'terrains', 'parcelle', 'villa', 'appartement', 'maison a vendre', 'location', 'immobilier', 'lotissement', 'real estate'],
  },
  autre: { nom: 'Autre', nomEn: 'Other', termes: [] },
};

export function estNiche(v: unknown): v is Niche {
  return typeof v === 'string' && (NICHES as readonly string[]).includes(v);
}

/** Le pluriel ramené au singulier, des deux côtés : « pagnes » trouve « pagne », « bijoux » trouve « bijou ». */
const racine = (m: string) => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m);

const TERMES: readonly { niche: Niche; mots: string[] }[] = NICHES.flatMap((niche) =>
  DEF_NICHES[niche].termes.map((t) => ({ niche, mots: mots(t).map(racine) })).filter((t) => t.mots.length > 0),
);

/** Pour chaque niche : son poids (un terme de plusieurs mots compte double) et la position du premier terme lu. */
function compter(texte: string): Map<Niche, { poids: number; premier: number }> {
  const m = mots(texte).map(racine);
  const positions = new Map<string, number>();
  m.forEach((w, i) => {
    if (!positions.has(w)) positions.set(w, i);
  });
  const sortie = new Map<Niche, { poids: number; premier: number }>();
  const vus = new Set<string>();
  for (const t of TERMES) {
    const cle = `${t.niche}:${t.mots.join(' ')}`;
    if (vus.has(cle)) continue;
    let pos = -1;
    if (t.mots.length === 1) pos = positions.get(t.mots[0]) ?? -1;
    else {
      for (let i = 0; i + t.mots.length <= m.length; i++) {
        if (t.mots.every((w, j) => m[i + j] === w)) {
          pos = i;
          break;
        }
      }
    }
    if (pos < 0) continue;
    vus.add(cle);
    const c = sortie.get(t.niche) ?? { poids: 0, premier: Number.POSITIVE_INFINITY };
    c.poids += t.mots.length > 1 ? 2 : 1;
    c.premier = Math.min(c.premier, pos);
    sortie.set(t.niche, c);
  }
  return sortie;
}

export interface EntreeNiche {
  texte?: string | null;
  titre?: string | null;
  domaine?: string | null;
  /** La famille du produit nommée par le collecteur, en anglais (« headphones », « dietary supplement »). */
  famille?: string | null;
}

/**
 * La niche d'une pub. Le poids le plus fort gagne ; la famille du produit compte double. Une
 * égalité se tranche par la famille, puis par le terme lu le plus tôt. Zéro = `autre`.
 */
export function nicheDePub(e: EntreeNiche): Niche {
  const texte = compter([e.texte, e.titre, e.domaine].filter(Boolean).join(' '));
  const famille = compter(e.famille ?? '');
  const parFamille = [...famille.entries()].sort((a, b) => b[1].poids - a[1].poids || a[1].premier - b[1].premier)[0]?.[0] ?? null;
  let meilleure: Niche = 'autre';
  let meilleur = { poids: 0, premier: Number.POSITIVE_INFINITY };
  for (const niche of NICHES) {
    if (niche === 'autre') continue;
    const t = texte.get(niche);
    const f = famille.get(niche);
    const poids = (t?.poids ?? 0) + 2 * (f?.poids ?? 0);
    if (poids === 0) continue;
    const premier = t?.premier ?? -1;
    const mieux =
      poids > meilleur.poids ||
      (poids === meilleur.poids && niche === parFamille && meilleure !== parFamille) ||
      (poids === meilleur.poids && meilleure !== parFamille && premier < meilleur.premier);
    if (mieux) {
      meilleure = niche;
      meilleur = { poids, premier };
    }
  }
  return meilleure;
}

/** La niche d'après les seuls textes de la pub (lecture d'une pub, avant que sa famille soit connue). */
export function devinerNiche(...textes: (string | null | undefined)[]): Niche {
  return nicheDePub({ texte: textes.filter(Boolean).join(' ') });
}
