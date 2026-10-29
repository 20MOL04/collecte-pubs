/**
 * La catégorie d'une pub : ce qui décide si elle entre dans Pub Track.
 *
 * Décision de l'équipe, 07/10/2026 : Pub Track montre des pubs de PRODUITS
 * vendus PAR des vendeurs ANCRÉS en Afrique, physiques et digitaux SÉPARÉS.
 * La bibliothèque Meta d'un pays rend tout ce qui y a été diffusé : le
 * 07/10/2026, sur 1 847 pubs, 177 menaient au Play Store, des dizaines à des
 * séries courtes (ReelShort, DramaWave), à des applications chinoises, à
 * Nespresso ou à une eSIM vendue depuis l'Europe. Mêlées aux vraies, elles
 * rendaient la grille inutilisable.
 *
 * Fonction pure, rejouée sur toute la base par le collecteur (`--reclasser`)
 * chaque fois que la règle change. Testée par `verify-pub-track.ts`.
 */
import type { Destination } from './destination';
import type { Niche } from './niches';
import { estPlateformeDigitale } from './technologie';

const CATEGORIES_PUB = ['physique', 'digital', 'saas', 'service', 'application', 'divertissement', 'hors_cible'] as const;
export type CategoriePub = (typeof CATEGORIES_PUB)[number];

/**
 * Les seules catégories que la grille montre, chacune dans son onglet, JAMAIS mêlées : les trois types
 * de produit (plan v2, section 2.3). `saas` (logiciel ou application vendu en abonnement, lot 3) n'est
 * posé que par le classeur IA : les règles de ce fichier ne le devinent pas, elles le CONTRÔLENT
 * (`categorieAvecClasseur`). C'est la seule liste : filtres, écran, Molia et MCP la lisent ici.
 */
export const CATEGORIES_VISIBLES = ['physique', 'digital', 'saas'] as const satisfies readonly CategoriePub[];
export type CategorieVisible = (typeof CATEGORIES_VISIBLES)[number];

export function estCategorieVisible(v: unknown): v is CategorieVisible {
  return typeof v === 'string' && (CATEGORIES_VISIBLES as readonly string[]).includes(v);
}

/**
 * Le type posé par le classeur IA (lot 3), contrôlé par les règles. Les règles ont le dernier mot sur ce
 * qui n'est PAS un produit vendu en Afrique (application grand public, divertissement, hors cible) : le
 * modèle voit l'image, pas le vendeur. Il a le dernier mot sur le TYPE d'un produit : physique, digital,
 * et SaaS, qu'aucune règle ne sait reconnaître (un logiciel en abonnement passait pour « digital »,
 * « service » ou « application »).
 */
export function categorieAvecClasseur(regles: CategoriePub, typeIa: string | null | undefined, vend: boolean | null | undefined): CategoriePub {
  if (vend === false || !estCategorieVisible(typeIa)) return regles;
  if (typeIa === 'saas') return regles === 'digital' || regles === 'service' || regles === 'application' || regles === 'saas' ? 'saas' : regles;
  return estCategorieVisible(regles) ? typeIa : regles;
}

export interface EntreeCategorie {
  texte: string;
  titre: string;
  appelAction: string;
  domaine: string | null;
  lien: string | null;
  destination: Destination;
  boutiqueCle: string | null;
  langue: string | null;
  niche: Niche;
  /** La plateforme de la boutique, lue par le robot sur la page de vente (Chariow, Maketou…). */
  technologie?: string | null;
  /**
   * Le VENDEUR est reconnu installé en Afrique par la MAJORITÉ de ses pubs
   * (audit du 08/10/2026 : UniversCosmetix, à Dakar, avait une pub acceptée et
   * la suivante rejetée, faute d'avoir écrit « Dakar » deux fois). Voir `vendeursAncres`.
   */
  vendeurAncre?: boolean;
  /** Le nom de la page Facebook : Jumia écrit « Commande maintenant » sans jamais se nommer. */
  annonceur?: string | null;
  /**
   * TikTok publie les pays CIBLÉS par chaque pub. Une pub ciblée sur un à trois pays
   * africains seulement vient d'un vendeur local ; une campagne sur 30 pays est une
   * marque mondiale (`cibleTikTok`, 09/10/2026).
   */
  cibleAfricaine?: boolean;
  /**
   * Le texte est trop court pour juger (un titre TikTok : « hi », « Golden Braid ») : sans boutique,
   * sans WhatsApp et sans signe de vente, la pub n'est pas rangée parmi les produits.
   */
  exigeVente?: boolean;
}

// ── Applications et jeux ──────────────────────────────────────────────
const DOMAINES_APPLICATION = [
  'play.google.com', 'apps.apple.com', 'itunes.apple.com', 'onelink.me', 'app.adjust.com', 'app.appsflyer.com',
  'appsflyer.com', 'adapty.io', 'app.link', 'apps.microsoft.com', 'appgallery.huawei.com',
];
const APPELS_APPLICATION = ['installer', 'installer l’application', 'installer l\'application', 'jouer à ce jeu', 'utiliser l’application', 'install now', 'play game', 'use app'];

// ── Séries, musique, contenus ─────────────────────────────────────────
const DOMAINES_DIVERTISSEMENT = ['reelshort', 'dramawave', 'netshort', 'shortmax', 'dramabox', 'goodshort', 'flextv', 'listen.to', 'spotify', 'deezer', 'ffm.to', 'music.', 'audiomack', 'boomplay', 'soundcloud', 'qweasdzxcshop'];
const APPELS_DIVERTISSEMENT = ['autres vidéos', 'écouter maintenant', 'watch more', 'listen now'];

// ── Plateformes, médias, chaînes : pas des vendeurs (audit du 08/10/2026) ──
// Jumia, Alibaba ou une chaîne WhatsApp « Pinduoduo Afrique » ne sont pas des
// boutiques qu'un vendeur peut copier : ce sont des places de marché.
const DOMAINES_PLATEFORMES = [
  'jumia.', 'alibaba.com', 'aliexpress.', 'temu.com', 'shein.com', 'amazon.', 'ebay.', 'pinduoduo', 'glovo', 'yango',
  'kilimall', 'konga.com', 'jiji.', 'coinafrique', 'expat-dakar', 'tonaton', 'avito.ma',
];
const NOMS_PLATEFORMES = /\b(jumia|alibaba|aliexpress|temu|shein|pinduoduo|glovo|kilimall|konga|jiji|coinafrique)\b/i;
// Lus sur le NOM de la page seulement : opérateurs, réseaux sociaux, multinationales. Une pub d'Orange
// ou de Meta n'est pas une boutique qu'un vendeur peut copier (audit du 08/10/2026 : Yas, Meta for Business).
// La marque SEULE, ou suivie d'un pays ou de « Money », « Business », « Africa » : « Orange Pharma Bamako »
// est une pharmacie, « Orange Sénégal » est l'opérateur.
const NOMS_GRANDES_MARQUES =
  /^(orange|mtn|moov|airtel|yas|free|wave|safaricom|vodacom|glo|canal\+|startimes|meta|facebook|instagram|whatsapp|google|tiktok|coca-cola|nestl[ée]|unilever|samsung|apple|huawei|tecno|infinix|itel|xiaomi|total(energies)?|shell|ecobank|uba)(\s+(for\s+business|money|business|africa|afrique|mobile|s[ée]n[ée]gal|c[ôo]te\s+d.ivoire|ci|cameroun|cameroon|mali|burkina(\s+faso)?|guin[ée]e|b[ée]nin|togo|niger|congo|rdc|gabon|ghana|nigeria|kenya|uganda|rwanda|maroc|morocco|tunisie|alg[ée]rie|madagascar|tchad|mauritanie))*$/i;
// Vendre des abonnés ou des likes n'est pas un produit.
const VENTE_ABONNES = /\d[\d\s.]*\s*(abonn[ée]s|followers|likes|vues)\s+(d[èe]s|pour|[àa])\b|acheter\s+des\s+(abonn[ée]s|followers|likes)/i;
const SIGNES_NON_VENDEUR =
  /whatsapp\.com\/channel|\biptv\b|abonnement\s+(tv|t[ée]l[ée]|iptv)|cha[iî]nes?\s+(tv|t[ée]l[ée])\b|regarder\s+(tous\s+)?(vos\s+|les\s+)?matchs|profit(er|ez)\s+de\s+(vos|tous\s+les)\s+matchs|tous\s+les\s+matchs\s+en\s+direct|marabouts?|voyan(ce|te?s?)|retour\s+(de\s+l.)?affection|envo[ûu]tements?|ma[iî]tre\s+spirituel|univers\s+spirituel|f[ée]ticheur|\bmagazine\b|newsletter|(^|[^\p{L}])(church|[ée]glise|bible|gospel|[ée]vangile|pri[èe]res?|prayers?|ministry|ap[ôo]tre|pasteur|culte|rfi|[ée]dito|conf[ée]rence|fondation|expo|foire|soir[ée]e)($|[^\p{L}])|^\s*video_[0-9a-f]{8,}/iu;

// ── Écoles et services : ce qui se suit sur place ou se réserve, pas un produit ──
// Testés AVANT le digital : « formation » rangeait HEC Rabat, Dakar Institute et
// ISFORT parmi les produits digitaux (audit du 08/10/2026, 25 pubs sur 70).
// Les signes FORTS suffisent seuls ; les FAIBLES (« université », « diplôme ») ne comptent que sans
// vente : un kenté « pour la remise des diplômes à l'université » à 150 000 F reste un produit.
const SIGNES_ECOLE =
  /(^|[^\p{L}])(master|executive|licence|bachelor|mba|admissions?|inscriptions?|(nouvelle|prochaine)\s+rentr[ée]e|rentr[ée]e\s*(:|le|du)\s*\d+|certification\s+\p{L}+\s+manager|auto-?[ée]cole|permis\s+de\s+conduire|[ée]cole\s+(professionnelle|sup[ée]rieure|d.ing[ée]nieurs?|de\s+commerce|de\s+management)|portes\s+ouvertes|centre\s+de\s+formation|session\s+de\s+formation|en\s+pr[ée]sentiel|cycle\s+d.ing[ée]nieur)($|[^\p{L}])/iu;
const SIGNES_ECOLE_FAIBLES =
  /(^|[^\p{L}])(dipl[ôo]mes?|dipl[ôo]mant(e|es)?|certifiant(e|es)?|cr[èe]che|institut|universit[ée]|[ée]cole|apprentissage\s+des\s+langues)($|[^\p{L}])/iu;
const SIGNES_SERVICE =
  /(^|[^\p{L}])(agence|site\s+(web|internet)|cr[ée]ation\s+de\s+sites?|votre\s+site|website|transitaire|shipping|fret|d[ée]douanement|photographe|s[ée]ance\s+photo|h[ôo]tel|resort|restaurant|r[ée]servez|clinique|billets?\s+d.avion|agence\s+de\s+voyages?|visas?|immigration|imprimerie|impressions?|spa|location\s+de\s+(voiture|v[ée]hicule|salle)|transfert\s+d.argent|logiciel|saas|application\s+de\s+gestion|outil\s+de\s+gestion|recrutement|cargo|conteneurs?|groupage|colis|barriques?|grands?\s+cartons?|insurance|assurances?|loans?|pr[êe]ts?\s+(rapides?|personnels?)|cr[ée]dit\s+(rapide|personnel)|fines?\s+(sa|payment)|vpn|ip\s+r[ée]sidentielle|abonn[ée]s|followers|attorneys?|lawyers?|claims?|offre\s+d.emploi|nous\s+recrutons|d[ée]m[ée]nagement)($|[^\p{L}])/iu;
// Un signe de téléchargement l'emporte sur l'école : « formation, pack à télécharger » est un produit digital.
const SIGNES_TELECHARGEMENT =
  /(^|[^\p{L}])(t[ée]l[ée]charg(er|ement|eable)|ebook|e-book|pdf|acc[èe]s\s+[àa]\s+vie|livre\s+num[ée]rique|pack\s+digital)($|[^\p{L}])/iu;


// Toujours un service, même avec un prix : une villa à vendre, une offre d'emploi.
const SIGNES_IMMOBILIER_EMPLOI =
  /(^|[^\p{L}])(villa|duplex|appartements?|apartments?|bedrooms?|real\s+estate|parcelles?|terrains?\s+(à|a)\s+vendre|titre\s+foncier|immobili[eè]re?|avis\s+de\s+recrutement|offre\s+d.emploi|nous\s+recrutons|recrutement|postulez)($|[^\p{L}])/iu;
// Une livraison qui se fait à la porte : un objet. « Livraison immédiate par e-mail » est du digital.
const LIVRAISON_PHYSIQUE = /(^|[^\p{L}])(livraison|delivery)(?!\s+(imm[ée]diate|instantan[ée]e|automatique|par\s+(e-?mail|mail|whatsapp)))/iu;
const BOUTIQUES_PHYSIQUES = ['shopify', 'youcan', 'woocommerce'];

// Le signe FORT d'une vente : un prix avec sa monnaie, une commande, une livraison, un stock.
// « Promo » ou « prix » seuls ne suffisent pas : les agences de visa et les imprimeries en mettent aussi.
const VENTE_FORTE =
  /(^|[^\p{L}])(commander|commandez|commande|order|achetez|livraison|delivery|en\s+stock|stock\s+limit[ée]|arrivage|restockage|tailles?|pointures?|flacon|kit)($|[^\p{L}])|\d[\d\s.,]*\s?(f|fr|frs|fcfa|cfa|gnf|fg|ar|dt|dh|da|ugx|tzs|ksh|kes|rwf|etb|zmw|mwk|kz|mzn|cdf|fc|mru|ngn|ghs|xof|xaf|د\.ت|درهم|دج)(?![\p{L}])|₦|gh₵|\$\s?\d|\d\s?\$/iu;

// ── Produits digitaux ─────────────────────────────────────────────────
// Plateformes nées en Afrique : leur présence suffit à ancrer le vendeur.
const PLATEFORMES_DIGITAL_AFRIQUE = ['chariow', 'maketou', 'selar'];
const DOMAINES_DIGITAL = [...PLATEFORMES_DIGITAL_AFRIQUE, 'systeme.io', 'gumroad', 'payhip', 'learnybox', 'podia', 'kajabi', 'teachable', 'thinkific', 'stan.store', 'beacons.ai', 'tiiny'];
// Signes d'un produit QU'ON TÉLÉCHARGE ou qu'on suit en ligne. « formation » seul n'en est pas un :
// le 07/10/2026, il rangeait des écoles d'hôtellerie et HEC Rabat parmi les produits digitaux.
const TERMES_DIGITAL = [
  'ebook', 'e-book', 'livre numérique', 'pdf', 'cours en ligne', 'formation en ligne', 'masterclass', 'webinaire',
  'accès à vie', 'acces a vie', 'template', 'templates', 'online course', 'guide complet', 'téléchargement immédiat', 'vidéos de formation',
];

// ── Ce qui ancre un vendeur en Afrique ────────────────────────────────
const INDICATIFS_AFRIQUE = [
  '225', '221', '237', '224', '229', '228', '226', '223', '243', '242', '241', '227', '235', '236', '240', '212', '213', '216', '218',
  '234', '233', '254', '255', '256', '250', '257', '251', '252', '253', '27', '260', '263', '265', '258', '261', '230', '222', '220',
  '231', '232', '238', '239', '244', '245', '248', '249', '211', '262', '269', '266', '267', '268', '264', '291', '290',
];
const MONNAIES =
  /\b(f\s?cfa|fcfa|cfa|xof|xaf|gnf|francs?\s+guin[ée]ens?|naira|ngn|cedis?|ghs|ksh|kes|dirhams?|mad|dzd|tnd|ariary|ugx|tzs|rwf|etb|birr|zmw|kwacha|mwk|kwanza|aoa|meticais|mzn|cdf|francs?\s+congolais|ouguiya|mru|dalasi|gmd|leones?)\b|₦|gh₵/i;
// Un nombre suivi d'une monnaie courte : « 5000f », « 15 000 frs », « 39 DT », « 55 000Ar », « 85 dh »
// (audit du 08/10/2026 : « Lait thaïlandais 5000f » était rejeté, faute d'avoir écrit « FCFA »).
const PRIX_LOCAL = /\d[\d\s.,]*\s?(f|fr|frs|fg|ar|dt|dh|dhs|da|fc|ksh)(?![\p{L}])/iu;
const LIEUX = new RegExp(
  `\\b(${[
    'abidjan', 'yopougon', 'cocody', 'bouaké', 'bouake', 'dakar', 'thiès', 'thies', 'touba', 'douala', 'yaoundé', 'yaounde', 'conakry',
    'kankan', 'cotonou', 'porto-novo', 'calavi', 'lomé', 'lome', 'ouagadougou', 'ouaga', 'bobo-dioulasso', 'bamako', 'kinshasa',
    'lubumbashi', 'brazzaville', 'pointe-noire', 'libreville', 'niamey', "n'djamena", 'ndjamena', 'casablanca', 'rabat', 'marrakech',
    'alger', 'oran', 'tunis', 'sfax', 'lagos', 'abuja', 'accra', 'kumasi', 'nairobi', 'mombasa', 'kigali', 'kampala', 'dar es salaam',
    'côte d’ivoire', "côte d'ivoire", 'cote d’ivoire', "cote d'ivoire", 'sénégal', 'senegal', 'cameroun', 'cameroon', 'guinée',
    'guinee', 'bénin', 'benin', 'togo', 'burkina', 'mali', 'congo', 'gabon', 'niger', 'tchad', 'maroc', 'algérie', 'tunisie',
    'nigeria', 'ghana', 'kenya', 'rwanda', 'afrique',
    // Les 54 pays et leurs grandes villes (audit du 08/10/2026 : « Uganda » ou « Madagascar » n'ancraient rien).
    'uganda', 'ouganda', 'tanzania', 'tanzanie', 'madagascar', 'antananarivo', 'mauritanie', 'mauritania', 'nouakchott',
    'ethiopia', 'éthiopie', 'ethiopie', 'zambia', 'zambie', 'lusaka', 'zimbabwe', 'harare', 'malawi', 'lilongwe',
    'mozambique', 'maputo', 'angola', 'luanda', 'namibia', 'namibie', 'botswana', 'gaborone', 'lesotho', 'eswatini',
    'south africa', 'afrique du sud', 'johannesburg', 'durban', 'egypt', 'égypte', 'egypte', 'cairo', 'le caire',
    'libya', 'libye', 'sudan', 'soudan', 'khartoum', 'somalia', 'somalie', 'mogadishu', 'djibouti', 'eritrea',
    'burundi', 'bujumbura', 'gambia', 'gambie', 'banjul', 'sierra leone', 'freetown', 'liberia', 'monrovia',
    'bissau', 'cabo verde', 'cap-vert', 'comores', 'comoros', 'moroni', 'mauritius', 'seychelles', 'centrafrique',
    'bangui', 'malabo', 'rdc', 'goma', 'algeria', 'morocco', 'tunisia', 'tanger', 'agadir', 'sousse', 'ivory coast',
    'parakou', 'sokodé', 'korhogo', 'ziguinchor', 'kaolack', 'bafoussam', 'garoua', 'labé', 'kindia', 'ségou', 'sikasso',
    'zinder', 'maradi', 'port-gentil', 'franceville',
  ].join('|')})\\b`,
  'i',
);
const LIVRAISON_LOCALE = /paiement\s+(à|a)\s+la\s+livraison|livraison\s+(gratuite|partout|rapide|disponible|à domicile|a domicile)|cash on delivery|pay on delivery/i;
// France, Belgique, Suisse, Amérique du Nord, Royaume-Uni, Allemagne, Espagne, Italie, Chine, Turquie, Émirats, Inde.
// Le « + » seul : « 00 1 » se lit aussi dans un prix comme « 10 000 15 000 ».
const NUMERO_ETRANGER = /\+\s?(33|32|41|1|44|49|34|39|86|90|971|91)[\s.-]?\d/;
// Domaines nationaux d'Afrique, en fin de nom.
const TLD_AFRIQUE = /\.(ci|sn|cm|gn|bj|tg|bf|ml|cd|cg|ga|ne|td|cf|gq|ma|dz|tn|ly|ng|gh|ke|tz|ug|rw|bi|et|so|dj|za|zm|zw|mw|mz|mg|mu|mr|gm|lr|sl|cv|st|ao|gw|sc|sd|ss|km|ls|bw|na|er)$/i;

const contient = (s: string, motifs: readonly string[]) => motifs.some((m) => s.includes(m));
const motEntier = (s: string, termes: readonly string[]) => termes.some((t) => new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(s));

/** Vrai si la pub porte au moins UN signe d'un vendeur installé en Afrique. */
function ancreeEnAfrique(entree: EntreeCategorie): boolean {
  const e = normaliser(entree);
  const numero = e.boutiqueCle?.startsWith('wa:+') ? e.boutiqueCle.slice(4) : null;
  if (numero && INDICATIFS_AFRIQUE.some((i) => numero.startsWith(i))) return true;
  // « Paris-Dakar » nomme un rallye, pas une boutique à Dakar.
  const texte = `${e.texte} ${e.titre}`.replace(/paris[\s-]+dakar/gi, ' ');
  if (/(\+|00)\s?(2[0-9]{2})[\s.-]?\d/.test(texte) && INDICATIFS_AFRIQUE.some((i) => new RegExp(`(\\+|00)\\s?${i}[\\s.-]?\\d`).test(texte))) return true;
  if (MONNAIES.test(texte) || PRIX_LOCAL.test(texte) || LIEUX.test(texte)) return true;
  if (e.domaine && TLD_AFRIQUE.test(e.domaine)) return true;
  // Un numéro européen, américain ou chinois, sans aucun signe africain : « livraison rapide » ou une
  // conversation en français ne suffisent plus (audit du 08/10/2026 : un boîtier VPN vendu depuis la France).
  if (NUMERO_ETRANGER.test(texte) || (numero && !INDICATIFS_AFRIQUE.some((i) => numero.startsWith(i)))) return false;
  if (LIVRAISON_LOCALE.test(texte)) return true;
  // Un vendeur qui répond en français par message (WhatsApp, Messenger, appel) vend sur place :
  // les marques mondiales envoient vers leur site, presque jamais vers une conversation.
  const parMessage = e.destination === 'message_whatsapp' || e.destination === 'message_messenger' || e.destination === 'appel' || e.destination === 'inconnue';
  // L'arabe (Maghreb), le swahili et le portugais (Angola, Mozambique) comptent aussi : le 08/10/2026,
  // un parfumeur de Nouakchott ou un vendeur de tôles en Ouganda étaient rejetés.
  // Une destination inconnue ne suffit qu'en français : en portugais, elle ramenait le Brésil.
  if (numero || !parMessage) return false;
  if (e.langue === 'fr') return true;
  return e.destination !== 'inconnue' && ['ar', 'sw', 'pt', 'wo'].includes(e.langue ?? '');
}

// Les pubs écrites en « 𝐆𝐑𝐀𝐒 𝐔𝐍𝐈𝐂𝐎𝐃𝐄 » échappent à toute règle tant qu'on ne les ramène pas à des lettres simples.
function normaliser(e: EntreeCategorie): EntreeCategorie {
  return { ...e, texte: e.texte.normalize('NFKC'), titre: e.titre.normalize('NFKC'), appelAction: e.appelAction.normalize('NFKC') };
}

/**
 * Les exclusions VALABLES PARTOUT, Afrique comme Occident (10/10/2026) : une grande plateforme, une
 * grande marque, une chaîne, une vente d'abonnés. La « Tendance occidentale » écarte les règles
 * africaines du tri, jamais celles-ci : « TikTok For Business » s'y montrait en tête.
 */
export function estPlateformeOuMarque(e: { texte: string; titre: string; domaine: string | null; lien: string | null; annonceur: string | null }): boolean {
  const domaine = (e.domaine ?? '').toLowerCase();
  const lien = (e.lien ?? '').toLowerCase();
  const texte = `${e.texte} ${e.titre}`;
  return (
    contient(domaine, DOMAINES_PLATEFORMES) ||
    contient(lien, DOMAINES_PLATEFORMES) ||
    NOMS_PLATEFORMES.test(texte) ||
    NOMS_PLATEFORMES.test(e.annonceur ?? '') ||
    NOMS_GRANDES_MARQUES.test((e.annonceur ?? '').trim()) ||
    SIGNES_NON_VENDEUR.test(texte) ||
    VENTE_ABONNES.test(texte)
  );
}

// ── La « Tendance occidentale » : ce qui n'est pas un produit à copier (15/10/2026) ──
// Les règles africaines (FCFA, WhatsApp, livraison locale) ne jugent pas une pub de Toronto ou de
// Lisbonne : on n'y garde que des vendeurs de PRODUITS. Mesure du 15/10 : TikTok For Business,
// une banque (TD), de l'immobilier (Zefir), des pneus à crédit (Tire Agent), Nordstrom, Lowe's.
// Les grandes enseignes : lues sur le DÉBUT du nom de la page (« VEVOR Home Improvement Canada »).
const ENSEIGNES_OCCIDENT =
  /^(walmart|amazon|target|costco|nordstrom|lowe.?s|home depot|ikea|wayfair|chewy|crocs|lacoste|puma|nike|adidas|reebok|new balance|anthropologie|revolve|depop|dhgate|auchan|carrefour|lidl|aldi|e\.?\s?leclerc|intermarch[ée]|decathlon|zara|h&m|uniqlo|shein|temu|sephora|ulta|savage x fenty|casper|apple|samsung|google|meta|microsoft|tiktok|netflix|spotify|disney|coca-cola|pepsi|mcdonald.?s|starbucks|ebay|etsy|best buy|macy.?s|old navy|levi.?s|under armour|the north face|vevor|fnac|darty|boulanger|cdiscount|la redoute|kiabi|primark|asos|zalando|vinted|leroy merlin|castorama|brico\s?march[ée]|worten|continente|pingo doce|el corte ingl[ée]s|mizuno|barstool|lego|l.or[ée]al|nivea|garnier|dove|gillette|philips|dyson|bosch|lg|sony|hp|dell|lenovo|canon|nikon|gopro|uber|airbnb|booking|expedia|doordash|instacart|hellofresh|shopify|wix|squarespace|canva|adobe|temu|aliexpress|jumia)(\b|\s|$)/i;
// Une banque, un assureur, un service financier : sur le nom de la page.
const NOMS_FINANCE_OCCIDENT =
  /(^|[^\p{L}])(bank|banque|banco|td|rbc|bmo|cibc|scotiabank|desjardins|chase|wells fargo|citi(bank)?|barclays|hsbc|santander|revolut|monzo|n26|paypal|klarna|american express|amex|capital one|credit union|caixa|millennium|novo banco|bnp|cr[ée]dit agricole|soci[ée]t[ée] g[ée]n[ée]rale|lcl|boursorama|ing|ubs|postfinance|insurance|assurances?|seguros?|mortgage|lending|loans?|finance|financial)($|[^\p{L}])/iu;
// Le crédit, l'épargne, l'investissement : dans le texte. « Buy now, pay later with Klarna » reste un produit.
const SIGNES_FINANCE_OCCIDENT =
  /(^|[^\p{L}])(no money down|pay (weekly|monthly)|lease[- ]to[- ]own|rent[- ]to[- ]own|sin pagar nada|paga semanal|mortgage|hypoth[èe]que|credit cards?|cartes? de cr[ée]dit|savings account|compte [ée]pargne|interest rates?|taux d.int[ée]r[êe]t|personal banker|banker|personal loans?|pr[êe]t personnel|pr[ée]stamos?|empr[ée]stimos?|insurance|assurance (auto|habitation|vie)|retirement plans?|crypto|forex)($|[^\p{L}])/iu;
const SIGNES_IMMOBILIER_OCCIDENT =
  /(^|[^\p{L}])(real estate|realtor|realty|immobili[eè]re?|vente immobili[eè]re|homes? for sale|condos?|apartments? for (rent|sale)|agent immobilier|estimation (gratuite )?de votre bien|vendre votre (bien|maison|appartement)|imobili[aá]ria|im[oó]veis|property for sale|new homes?|homebuyers?|primo-acc[ée]dants?)($|[^\p{L}])/iu;
const SIGNES_SERVICE_OCCIDENT =
  /(^|[^\p{L}])(lawyers?|attorneys?|avocats?|law firm|clinic|clinique|dentists?|dentiste|plumb(er|ing)|plombier|roofing|toiture|hvac|cleaning services?|d[ée]m[ée]nagement|movers|moving company|we.re hiring|hiring now|job offer|offre d.emploi|recrutement|agency|agence|consultation|psychic|voyance|webinar|webinaire|saas|software|logiciel|free trial|essai gratuit|book (a|your) (call|demo|appointment)|prenez rendez-vous|ads credits?|cr[ée]dits? publicitaires?)($|[^\p{L}])/iu;
const FAMILLES_SERVICE = /(^|\s)(digital service|service|software|app|subscription|insurance|loan)(\s|$)/i;
const FAMILLES_DIGITAL = /(^|\s)(online course|ebook|e-book|course|template|digital product|printable|preset)(\s|$)/i;

export interface EntreeOccident {
  texte: string;
  titre: string;
  domaine: string | null;
  lien: string | null;
  annonceur: string | null;
  /** La famille nommée par le collecteur, quand elle est connue (« car spare part », « digital service »). */
  famille?: string | null;
  /** La catégorie lue sur la pub : une application ou un divertissement restent ce qu'ils sont. */
  categorieLue?: CategoriePub | null;
}

/**
 * La catégorie d'une pub de la « Tendance occidentale ». Rejouée chaque nuit sur TOUTES les lignes
 * occidentales (`classerBase`), donc aussi sur celles lues avant que la règle existe.
 */
export function categorieOccident(e: EntreeOccident): CategoriePub {
  if (e.categorieLue === 'application' || e.categorieLue === 'divertissement') return e.categorieLue;
  const annonceur = (e.annonceur ?? '').normalize('NFKC').trim();
  const texte = `${e.texte} ${e.titre}`.normalize('NFKC');
  const famille = (e.famille ?? '').toLowerCase();
  const domaine = (e.domaine ?? '').toLowerCase();
  if (estPlateformeOuMarque({ texte: e.texte, titre: e.titre, domaine: e.domaine, lien: e.lien, annonceur: e.annonceur })) return 'hors_cible';
  if (ENSEIGNES_OCCIDENT.test(annonceur) || ENSEIGNES_OCCIDENT.test(domaine.replace(/^www\./, ''))) return 'hors_cible';
  if (NOMS_FINANCE_OCCIDENT.test(annonceur) || SIGNES_FINANCE_OCCIDENT.test(texte)) return 'service';
  if (SIGNES_IMMOBILIER_OCCIDENT.test(texte) || SIGNES_IMMOBILIER_OCCIDENT.test(annonceur)) return 'service';
  if (SIGNES_SERVICE_OCCIDENT.test(texte) || FAMILLES_SERVICE.test(famille)) return 'service';
  if (FAMILLES_DIGITAL.test(famille) || SIGNES_TELECHARGEMENT.test(texte) || motEntier(texte, TERMES_DIGITAL)) return 'digital';
  if (texte.replace(/\s+/g, ' ').trim().length < 15 && !famille) return 'hors_cible';
  return 'physique';
}

export function categoriePub(entree: EntreeCategorie): CategoriePub {
  const e = normaliser(entree);
  const appel = e.appelAction.trim().toLowerCase();
  const domaine = (e.domaine ?? '').toLowerCase();
  const lien = (e.lien ?? '').toLowerCase();

  if (contient(domaine, DOMAINES_APPLICATION) || contient(lien, DOMAINES_APPLICATION) || APPELS_APPLICATION.includes(appel)) return 'application';
  if (contient(domaine, DOMAINES_DIVERTISSEMENT) || contient(lien, DOMAINES_DIVERTISSEMENT) || APPELS_DIVERTISSEMENT.includes(appel)) return 'divertissement';

  // Le bouton de paiement trouvé par le robot vaut l'adresse : une page sur mesure qui encaisse par Chariow vend du digital.
  const parBouton = estPlateformeDigitale(e.technologie);
  const digitalParPlateforme = parBouton || contient(domaine, DOMAINES_DIGITAL) || contient(lien, DOMAINES_DIGITAL);
  const plateformeAfricaine =
    (e.technologie != null && ['chariow', 'maketou', 'selar'].includes(e.technologie)) ||
    contient(domaine, PLATEFORMES_DIGITAL_AFRIQUE) ||
    contient(lien, PLATEFORMES_DIGITAL_AFRIQUE);
  const texte = `${e.texte} ${e.titre}`;
  if (estPlateformeOuMarque({ texte: e.texte, titre: e.titre, domaine: e.domaine, lien: e.lien, annonceur: e.annonceur ?? null })) {
    return 'hors_cible';
  }
  if (!plateformeAfricaine && !e.vendeurAncre && !e.cibleAfricaine && !ancreeEnAfrique(e)) return 'hors_cible';
  // Un signe de VENTE (prix, commande, livraison, stock) : « huile d'avocat », « idéal pour restaurant »
  // ou « commandez sur notre site web » restent des produits (simulation du 08/10/2026).
  const vend = VENTE_FORTE.test(texte);
  // Une pub vide ou presque, sans prix ni commande, ne montre rien à copier, même sur Chariow.
  if (!vend && texte.replace(/\s+/g, ' ').trim().length < 25) return 'hors_cible';
  // Une boutique Chariow, Maketou ou Selar vend du digital, quel que soit le vocabulaire de sa pub.
  if (digitalParPlateforme) return 'digital';
  if (SIGNES_IMMOBILIER_EMPLOI.test(texte)) return 'service';
  // Une fiche produit Shopify, YouCan ou WooCommerce vend un objet, même si la pub offre « les recettes en PDF ».
  const ficheProduit = /\/products?\//.test(lien) && e.technologie != null && BOUTIQUES_PHYSIQUES.includes(e.technologie);
  const telechargeable = !ficheProduit && !LIVRAISON_PHYSIQUE.test(texte) && SIGNES_TELECHARGEMENT.test(texte);
  if (!telechargeable && SIGNES_ECOLE.test(texte)) return 'service';
  if (!telechargeable && !vend && SIGNES_ECOLE_FAIBLES.test(texte)) return 'service';
  if (!telechargeable && !vend && SIGNES_SERVICE.test(texte)) return 'service';
  if (e.niche === 'immobilier' || appel === 'postuler maintenant' || appel === 'réserver') return 'service';
  if (e.niche === 'services' && !vend) return 'service';
  if (ficheProduit) return 'physique';
  // La niche « digital » ne suffit plus : elle s'allume sur « formation », « cours » ou « application ».
  if (telechargeable || (!LIVRAISON_PHYSIQUE.test(texte) && motEntier(texte, TERMES_DIGITAL))) return 'digital';
  // Une formation VENDUE à un prix (« formation savonnerie, 2 000 F ») est un produit digital ;
  // sans prix ni commande, c'est un service.
  if (motEntier(texte, ['formation', 'formations', 'coaching', 'cours', 'masterclass'])) return vend ? 'digital' : 'service';
  if (e.exigeVente && !vend && e.destination !== 'boutique' && e.destination !== 'message_whatsapp') return 'hors_cible';
  return 'physique';
}

/**
 * Les vendeurs reconnus installés en Afrique par PLUS DE LA MOITIÉ de leurs pubs.
 *
 * Une seule pub suffisait d'abord : un vendeur étranger qui citait une fois
 * le Kenya faisait passer toutes ses pubs (simulation du 08/10/2026). La
 * majorité stricte (plus de la moitié, et deux pubs au moins) garde UniversCosmetix (Dakar, presque toutes ses pubs ancrées) et
 * écarte une boutique de gaine américaine qui mentionnait un pays une fois.
 */
export function vendeursAncres(pubs: readonly { annonceurId: string | null; entree: EntreeCategorie }[]): Set<string> {
  const comptes = new Map<string, { ancrees: number; total: number }>();
  for (const { annonceurId, entree } of pubs) {
    if (!annonceurId) continue;
    const c = comptes.get(annonceurId) ?? { ancrees: 0, total: 0 };
    c.total += 1;
    if (ancreeEnAfrique(entree)) c.ancrees += 1;
    comptes.set(annonceurId, c);
  }
  return new Set([...comptes].filter(([, c]) => c.ancrees >= 2 && c.ancrees * 2 > c.total).map(([id]) => id));
}

/** Au-delà, une pub TikTok vise trop de pays pour venir d'un vendeur local. */
const CIBLE_LOCALE_MAX = 3;

/**
 * Lit les pays ciblés d'une pub TikTok : les pays africains qu'elle vise, et si
 * elle ne vise QUE l'Afrique, sur peu de pays (le signe d'un vendeur local).
 */
export function cibleTikTok(paysCibles: readonly string[], africains: ReadonlySet<string>): { pays: string[]; locale: boolean } {
  const codes = [...new Set(paysCibles.map((c) => c.toUpperCase()))];
  const pays = codes.filter((c) => africains.has(c));
  return { pays, locale: pays.length > 0 && pays.length === codes.length && codes.length <= CIBLE_LOCALE_MAX };
}
