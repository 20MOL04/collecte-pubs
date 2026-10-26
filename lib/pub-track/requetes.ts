/**
 * Ce que le collecteur tape dans la bibliothèque Meta, pays par pays, et
 * comment il apprend de ce que chaque recherche rapporte (audit du 08/10/2026).
 *
 * Trois règles, toutes mesurées sur la base réelle :
 *
 * 1. Chaque pays reçoit les mots de SA langue (`PROFILS`). La banque unique en
 *    français faisait chercher « cedis » en Namibie et « gnf » en Eswatini.
 * 2. Un produit n'est jamais cherché seul : il est accolé à une ANCRE du pays
 *    (sa monnaie, « livraison », sa capitale). Meta exige alors les deux mots,
 *    et la recherche ne ramène plus que des vendeurs locaux.
 * 3. Le robot RETIENT ce que rapporte chaque recherche (`StatRequete`, table
 *    `pub_track_requetes`) : il relance ce qui marche, abandonne ce qui ne
 *    rapporte rien, et garde toujours une part d'essais neufs.
 *
 * Fonctions pures, testées par `verify-pub-track.ts`.
 */
import { BANQUES, type LangueRecherche } from './mots-cles';

interface ProfilPays {
  langues: readonly LangueRecherche[];
  /** Les mots qui ancrent une recherche dans le pays : monnaie, livraison, ville. */
  ancres: readonly string[];
}

const XOF_XAF = (capitale: string): ProfilPays => ({ langues: ['fr'], ancres: ['fcfa', 'livraison', capitale] });
const ANGLAIS = (...ancres: string[]): ProfilPays => ({ langues: ['en'], ancres: ['delivery', ...ancres] });
const PORTUGAIS = (...ancres: string[]): ProfilPays => ({ langues: ['pt'], ancres: ['entrega', ...ancres] });
const MAGHREB = (monnaie: string, ville: string): ProfilPays => ({ langues: ['fr', 'ar'], ancres: [monnaie, 'livraison', ville, 'التوصيل'] });

export const PROFILS: Record<string, ProfilPays> = {
  CI: XOF_XAF('abidjan'), SN: XOF_XAF('dakar'), BJ: XOF_XAF('cotonou'), TG: XOF_XAF('lomé'), BF: XOF_XAF('ouagadougou'),
  ML: XOF_XAF('bamako'), NE: XOF_XAF('niamey'), CM: XOF_XAF('douala'), CG: XOF_XAF('brazzaville'), GA: XOF_XAF('libreville'),
  TD: XOF_XAF("n'djamena"), CF: XOF_XAF('bangui'), GQ: XOF_XAF('malabo'),
  GN: { langues: ['fr'], ancres: ['gnf', 'livraison', 'conakry'] },
  CD: { langues: ['fr'], ancres: ['livraison', 'kinshasa', 'lubumbashi'] },
  MG: { langues: ['fr'], ancres: ['livraison', 'antananarivo', 'ariary'] },
  BI: { langues: ['fr'], ancres: ['livraison', 'bujumbura'] },
  DJ: { langues: ['fr', 'ar'], ancres: ['livraison', 'djibouti'] },
  KM: { langues: ['fr', 'ar'], ancres: ['livraison', 'moroni'] },
  RW: { langues: ['en', 'fr'], ancres: ['delivery', 'kigali', 'rwf'] },
  MU: { langues: ['en', 'fr'], ancres: ['delivery', 'livraison', 'rs'] },
  SC: { langues: ['en', 'fr'], ancres: ['delivery', 'livraison'] },
  MA: MAGHREB('dh', 'casablanca'), DZ: MAGHREB('da', 'alger'), TN: MAGHREB('dt', 'tunis'),
  MR: { langues: ['ar', 'fr'], ancres: ['التوصيل', 'livraison', 'nouakchott'] },
  EG: { langues: ['ar'], ancres: ['التوصيل', 'جنيه', 'القاهرة'] },
  LY: { langues: ['ar'], ancres: ['التوصيل', 'دينار', 'طرابلس'] },
  SD: { langues: ['ar'], ancres: ['التوصيل', 'الخرطوم'] },
  SO: { langues: ['en', 'ar'], ancres: ['delivery', 'mogadishu'] },
  NG: ANGLAIS('naira', 'lagos', 'abuja'), GH: ANGLAIS('cedis', 'accra', 'kumasi'), KE: ANGLAIS('ksh', 'nairobi', 'mombasa'),
  UG: ANGLAIS('ugx', 'kampala'), TZ: ANGLAIS('tsh', 'dar es salaam'), ZA: ANGLAIS('johannesburg', 'durban'),
  ET: ANGLAIS('birr', 'addis ababa'), SL: ANGLAIS('freetown'), LR: ANGLAIS('monrovia'), GM: ANGLAIS('banjul', 'dalasi'),
  ZM: ANGLAIS('lusaka', 'kwacha'), ZW: ANGLAIS('harare'), MW: ANGLAIS('lilongwe', 'blantyre'), BW: ANGLAIS('gaborone'),
  NA: ANGLAIS('windhoek'), LS: ANGLAIS('maseru'), SZ: ANGLAIS('mbabane'), SS: ANGLAIS('juba'), ER: ANGLAIS('asmara'),
  AO: PORTUGAIS('kz', 'luanda'), MZ: PORTUGAIS('maputo', 'meticais'), CV: PORTUGAIS('praia'), ST: PORTUGAIS('são tomé'),
  GW: PORTUGAIS('bissau', 'fcfa'),
};

const PROFIL_DEFAUT: ProfilPays = ANGLAIS();

function profilDe(pays: string): ProfilPays {
  return PROFILS[pays] ?? PROFIL_DEFAUT;
}

/**
 * Toutes les recherches possibles pour un pays : les phrases de vente de ses
 * langues telles quelles, puis chaque produit accolé à une ancre (les ancres
 * tournent d'un produit à l'autre), sans doublon.
 */
export function requetesDuPays(pays: string): string[] {
  const { langues, ancres } = profilDe(pays);
  const sortie: string[] = [];
  for (const langue of langues) {
    const banque = BANQUES[langue];
    // Une ancre écrite dans l'alphabet de la langue : « التوصيل » ne s'accole pas à « mixeur ».
    const siennes = ancres.filter((a) => /[؀-ۿ]/.test(a) === (langue === 'ar'));
    const ancresLangue = siennes.length ? siennes : ancres;
    // En français, la phrase de vente est déjà locale (« livraison gratuite » : 98 % de pubs utiles).
    // En anglais, elle ramène le monde entier (« available » : 31 %) : elle prend la monnaie ou la ville.
    const precises = ancresLangue.filter((a) => !['delivery', 'entrega', 'التوصيل', 'livraison'].includes(a));
    if (langue === 'fr' || !precises.length) sortie.push(...banque.vente);
    else banque.vente.forEach((phrase, i) => sortie.push(`${phrase} ${precises[i % precises.length]}`));
    [...banque.produits, ...banque.digital].forEach((mot, i) => sortie.push(`${mot} ${ancresLangue[i % ancresLangue.length]}`));
  }
  return [...new Set(sortie)];
}

export interface StatRequete {
  recherches: number;
  /** Pubs de produits (physiques ou digitaux) qu'elle a ramenées, toutes recherches confondues. */
  utiles: number;
  /** Date de la dernière recherche (ISO). */
  derniere: string | null;
}

/** Une recherche essayée deux fois sans rien d'utile est mise de côté. */
export const ESSAIS_AVANT_ABANDON = 2;
/** Une recherche qui rapporte ne revient pas avant ce délai : Meta n'a pas encore de pubs neuves. */
const REPOS_JOURS = 3;
/** Part des recherches d'une nuit données à ce qui a déjà rapporté ; le reste explore. */
const PART_EXPLOITATION = 0.6;

/**
 * Les recherches d'un pays pour cette nuit.
 *
 * Moitié et plus : les meilleures déjà essayées (pubs utiles par recherche),
 * reposées depuis `REPOS_JOURS`. Le reste : des recherches jamais faites, dans
 * un ordre qui tourne avec le jour et le pays. Ce qui a échoué deux fois sort.
 */
export function choisirRequetes(
  pays: string,
  stats: ReadonlyMap<string, StatRequete>,
  jour: Date,
  combien: number,
): string[] {
  const toutes = requetesDuPays(pays);
  const reposee = (s: StatRequete) => !s.derniere || jour.getTime() - new Date(s.derniere).getTime() >= REPOS_JOURS * 86_400_000;
  const essayees = toutes
    .map((r) => ({ r, s: stats.get(r) }))
    .filter((x): x is { r: string; s: StatRequete } => !!x.s && x.s.recherches > 0);
  const gagnantes = essayees
    .filter(({ s }) => s.utiles > 0 && reposee(s))
    .sort((a, b) => b.s.utiles / b.s.recherches - a.s.utiles / a.s.recherches);
  const neuves = toutes.filter((r) => !stats.get(r)?.recherches);
  const n = Math.floor(jour.getTime() / 86_400_000);
  const decalage = neuves.length ? (n * combien + [...pays].reduce((s, c) => s + c.charCodeAt(0), 0)) % neuves.length : 0;
  const tournees = neuves.map((_, i) => neuves[(decalage + i) % neuves.length]!);

  const choix: string[] = [];
  const prendre = (liste: readonly string[], max: number) => {
    for (const r of liste) {
      if (choix.length >= max) break;
      if (!choix.includes(r)) choix.push(r);
    }
  };
  prendre(gagnantes.map((g) => g.r), Math.ceil(combien * PART_EXPLOITATION));
  prendre(tournees, combien);
  // Plus rien de neuf : on repasse sur les essais qui n'ont pas encore été abandonnés.
  const relances = essayees.filter(({ s }) => !(s.recherches >= ESSAIS_AVANT_ABANDON && s.utiles === 0) && reposee(s)).map((x) => x.r);
  prendre(relances, combien);
  return choix;
}
