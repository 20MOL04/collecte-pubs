/**
 * LA NUIT EN CRÉNEAUX COURTS (Pub Track v2, lot 1, 29/10/2026 : docs/PLAN-PUB-TRACK-V2.md).
 *
 * Le 29/10/2026, Meta a répondu 403 dès la première recherche et la nuit a lu 0 pub. Une heure
 * d'affilée depuis une seule adresse, c'est le rythme d'un robot. La nuit se coupe donc en
 * créneaux de quelques minutes, chacun sur une machine neuve (donc une adresse neuve), qui
 * reprennent la file de la nuit là où le précédent s'est arrêté.
 *
 * Tout est PUR ici, sans réseau ni base : `scripts/verify-collecte-creneaux.ts` l'exécute.
 */

export const CRENEAUX = {
  /** Créneaux planifiés par nuit (crons de `collecte.yml`). */
  parNuit: 4,
  /**
   * Minutes de lecture Meta d'un créneau, toutes tâches comprises (le plan dit 10 à 15). La nuit du
   * 28/10/2026 a fait 62 recherches en 44 minutes (~42 s chacune) pour 1 106 pubs ; le rythme humain
   * en ajoute. 4 x 15 minutes visent le seuil de 1 000 pubs par nuit : à juger sur les mesures.
   */
  minutesMeta: 15,
  /**
   * Une ligne de journal ouverte depuis plus longtemps est celle d'une collecte morte : elle ne
   * tient plus le verrou. Au-dessus de la plus longue tâche GitHub (un lancement à la main, coupé
   * à 58 minutes), sinon un créneau s'ouvrirait pendant qu'elle lit encore Meta.
   */
  verrouMinutes: 60,
  /** Blocages de suite avant de sauter une nuit (plan, lot 1). */
  blocagesAvantSaut: 2,
  /**
   * La nuit D va de D 14 h à D+1 14 h UTC. GitHub retarde les crons : la collecte de 01 h a
   * démarré entre 06 h 08 et 06 h 55 du 27 au 29/10/2026. Un créneau en retard reste dans sa nuit.
   */
  decalageNuitHeures: 14,
  /** Pause longue entre deux recherches : probabilité, et durée en ms. */
  pauseLongueProba: 0.18,
  pauseLongueMs: [20_000, 60_000] as const,
} as const;

const JOUR_MS = 86_400_000;

export function cleNuit(maintenant: Date): string {
  return new Date(maintenant.getTime() - CRENEAUX.decalageNuitHeures * 3_600_000).toISOString().slice(0, 10);
}

export function debutNuit(nuit: string): Date {
  return new Date(Date.parse(`${nuit}T00:00:00Z`) + CRENEAUX.decalageNuitHeures * 3_600_000);
}

/** Le jour qui choisit les pays et les recherches de la nuit : le même pour tous ses créneaux. */
export function jourDeNuit(nuit: string): Date {
  return new Date(Date.parse(`${nuit}T12:00:00Z`));
}

export function nuitPrecedente(nuit: string): string {
  return new Date(Date.parse(`${nuit}T00:00:00Z`) - JOUR_MS).toISOString().slice(0, 10);
}

/* ── La file de la nuit ─────────────────────────────────────────────────────────────── */

/** Ce que la mémoire des recherches dit de ce qui a déjà été cherché cette nuit. */
export function faitesDepuis(derniere: ReadonlyMap<string, string | null>, depuis: Date): number {
  let n = 0;
  for (const d of derniere.values()) if (d && Date.parse(d) >= depuis.getTime()) n += 1;
  return n;
}

/**
 * Les pays de la nuit qui ont encore des recherches à faire, dans l'ordre de priorité, avec ce
 * qui leur reste. Un créneau bloqué n'efface rien : le suivant retrouve les mêmes pays.
 */
export function resteAfrique(
  pays: readonly string[],
  faitesParPays: ReadonlyMap<string, number>,
  quotaParPays: number,
): { pays: string; reste: number }[] {
  return pays
    .map((p) => ({ pays: p, reste: Math.max(0, quotaParPays - (faitesParPays.get(p) ?? 0)) }))
    .filter((x) => x.reste > 0);
}

/** La clé de mémoire d'une recherche occidentale : à part des pays africains, comme `tiktok:`. */
export const cleOccident = (pays: string) => `occident:${pays}`;

/* ── Le journal : statut, verrou, saut de nuit ──────────────────────────────────────── */

export const STATUTS_CRENEAU = ['en_cours', 'ok', 'bloque', 'schema', 'erreur', 'saute', 'occupe'] as const;
export type StatutCreneau = (typeof STATUTS_CRENEAU)[number];

/** Un créneau qui a vraiment parlé à Meta. Sauté ou refusé par le verrou : non. */
const A_TOUCHE_META: readonly StatutCreneau[] = ['ok', 'bloque', 'schema', 'erreur'];

export interface LigneJournal {
  id: string;
  debut: string;
  fin: string | null;
  message: string | null;
  statut?: string | null;
  nuit?: string | null;
}

const estStatut = (v: unknown): v is StatutCreneau => typeof v === 'string' && (STATUTS_CRENEAU as readonly string[]).includes(v);

/**
 * Les mesures d'un créneau rangées dans `message` quand la migration 115 n'est pas encore
 * appliquée : « texte | {json} ». Rien d'autre n'est lu dans ce texte.
 */
export function mesuresDuMessage(message: string | null): Record<string, unknown> | null {
  const m = message?.match(/\|\s*(\{.*\})\s*$/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]!) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Le statut d'une ligne : la colonne quand elle existe (115), sinon les mesures rangées dans le
 * message, sinon le texte des nuits d'avant le lot 1 (« bloque par Meta », « format Meta change »).
 */
export function statutDe(l: LigneJournal, maintenant: Date): StatutCreneau {
  if (estStatut(l.statut)) return l.statut;
  const range = mesuresDuMessage(l.message)?.statut;
  if (estStatut(range)) return range;
  const m = l.message ?? '';
  if (/^bloque par Meta/.test(m)) return 'bloque';
  if (/^format Meta change/.test(m)) return 'schema';
  if (!l.fin) return Date.parse(l.debut) > maintenant.getTime() - CRENEAUX.verrouMinutes * 60_000 ? 'en_cours' : 'erreur';
  return 'ok';
}

export function nuitDe(l: LigneJournal): string {
  return l.nuit ?? cleNuit(new Date(l.debut));
}

/**
 * Le verrou commun aux deux dépôts. La règle `concurrency` de GitHub ne vaut que dans UN dépôt,
 * et creafrik garde un lancement à la main de la même collecte. Chaque créneau écrit d'abord sa
 * ligne, puis relit les lignes ouvertes : la plus ancienne (puis le plus petit identifiant) garde
 * Meta, les autres se ferment en « occupe » sans ouvrir de navigateur. Deux départs à la même
 * seconde désignent donc le même gagnant.
 */
export function gagneLeVerrou(lignes: readonly LigneJournal[], moi: string, maintenant: Date): boolean {
  const ouvertes = lignes.filter((l) => l.id === moi || statutDe(l, maintenant) === 'en_cours');
  const premier = [...ouvertes].sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  return premier?.id === moi;
}

/**
 * Après deux blocages de suite, on saute une nuit. Les créneaux qui ont touché Meta, du plus
 * récent au plus ancien : si les deux derniers ont été bloqués, et que le dernier blocage date de
 * cette nuit ou de la veille, on ne rouvre pas Meta. La nuit d'après, un créneau réessaie ; s'il
 * est bloqué à son tour, on saute encore une nuit. Un mur durable donne donc un essai toutes les
 * deux nuits, jamais une rafale.
 */
export function doitSauter(lignes: readonly LigneJournal[], nuit: string, maintenant: Date): boolean {
  const tentatives = [...lignes]
    .sort((a, b) => Date.parse(b.debut) - Date.parse(a.debut))
    .filter((l) => A_TOUCHE_META.includes(statutDe(l, maintenant)));
  const dernieres = tentatives.slice(0, CRENEAUX.blocagesAvantSaut);
  if (dernieres.length < CRENEAUX.blocagesAvantSaut || dernieres.some((l) => statutDe(l, maintenant) !== 'bloque')) return false;
  const derniere = nuitDe(dernieres[0]!);
  return derniere === nuit || derniere === nuitPrecedente(nuit);
}

/** Le rang du créneau dans sa nuit, pour le journal : les sautés et les refusés ne comptent pas. */
export function rangCreneau(lignes: readonly LigneJournal[], nuit: string, moi: string, maintenant: Date): number {
  const avant = lignes.filter((l) => l.id !== moi && nuitDe(l) === nuit && A_TOUCHE_META.includes(statutDe(l, maintenant)));
  return avant.length + 1;
}

/* ── Le rythme d'une personne ───────────────────────────────────────────────────────── */

export type Alea = () => number;

/**
 * Une pause dans l'intervalle, plus souvent courte que longue (deux tirages multipliés), au lieu
 * d'une loi uniforme que l'œil d'un filtre reconnaît vite.
 */
export function pauseHumaine([min, max]: readonly [number, number], alea: Alea): number {
  return Math.round(min + (max - min) * alea() * (0.4 + 0.6 * alea()));
}

/** De temps en temps, on lâche l'écran : une pause longue entre deux recherches. */
export function pauseLongue(alea: Alea): number {
  if (alea() >= CRENEAUX.pauseLongueProba) return 0;
  const [min, max] = CRENEAUX.pauseLongueMs;
  return Math.round(min + (max - min) * alea());
}

/**
 * Un défilement découpé en petits coups de molette (300 à 1 100 px), au lieu d'un saut de
 * 6 000 px d'un bloc : la même distance, à la vitesse d'une main.
 */
export function pasDefilement(total: number, alea: Alea): number[] {
  const pas: number[] = [];
  let reste = total;
  while (reste > 0) {
    const p = Math.min(reste, Math.round(300 + 800 * alea()));
    pas.push(p);
    reste -= p;
  }
  return pas;
}

/** Un navigateur sans tête se présente comme « HeadlessChrome » : aucune personne n'en utilise. */
export function agentOrdinaire(agent: string): string {
  return agent.replace(/HeadlessChrome/g, 'Chrome').replace(/\s*Headless\b/g, '');
}

/** Langue, fuseau et en-tête d'une seule personne : le français que lisent les heuristiques de Pub Track. */
export const PROFIL_NAVIGATEUR = {
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  acceptLanguage: 'fr-FR,fr;q=0.9,en-US;q=0.7,en;q=0.6',
  ecrans: [
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
  ],
} as const;

/* ── Les mesures ────────────────────────────────────────────────────────────────────── */

export interface MesuresCreneau {
  nuit: string;
  creneau: number;
  statut: StatutCreneau;
  recherches: number;
  pubs_lues: number;
  minutes_meta: number;
  pubs_par_minute: number;
  /** Rang de la recherche qui a pris le 403, ou null. */
  bloque_a: number | null;
}

export function mesures(entree: {
  nuit: string;
  creneau: number;
  statut: StatutCreneau;
  recherches: number;
  pubsLues: number;
  msMeta: number;
  bloqueA: number | null;
}): MesuresCreneau {
  const minutes = Math.round((entree.msMeta / 60_000) * 10) / 10;
  return {
    nuit: entree.nuit,
    creneau: entree.creneau,
    statut: entree.statut,
    recherches: entree.recherches,
    pubs_lues: entree.pubsLues,
    minutes_meta: minutes,
    pubs_par_minute: minutes > 0 ? Math.round((entree.pubsLues / minutes) * 10) / 10 : 0,
    bloque_a: entree.bloqueA,
  };
}

/** Le titre de l'annotation GitHub que lit `relever-nuits.ts` (l'API GitHub rend les annotations). */
export const TITRE_ANNOTATION = 'Mesures collecte Pub Track';

/** Une ligne `::notice` : GitHub exige d'échapper %, retour chariot et saut de ligne. */
export function ligneAnnotation(m: MesuresCreneau): string {
  const corps = JSON.stringify(m).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::notice title=${TITRE_ANNOTATION}::${corps}`;
}

export function lireAnnotation(message: string): MesuresCreneau | null {
  try {
    const o = JSON.parse(message) as Partial<MesuresCreneau>;
    if (typeof o.nuit !== 'string' || !estStatut(o.statut) || typeof o.pubs_lues !== 'number') return null;
    return o as MesuresCreneau;
  } catch {
    return null;
  }
}

/** Le seuil d'acceptation du lot 1 : une nuit utile lit au moins ce nombre de pubs. */
export const PUBS_MIN_PAR_NUIT = 1000;

export interface BilanNuit {
  nuit: string;
  creneaux: number;
  bloques: number;
  sautes: number;
  pubs_lues: number;
  minutes_meta: number;
  pubs_par_minute: number;
  taux_blocage: number;
  /** Aucun créneau arrêté sur 403, aucun saut, et assez de pubs. */
  reussie: boolean;
}

export function bilanNuits(toutes: readonly MesuresCreneau[]): BilanNuit[] {
  const parNuit = new Map<string, MesuresCreneau[]>();
  for (const m of toutes) parNuit.set(m.nuit, [...(parNuit.get(m.nuit) ?? []), m]);
  return [...parNuit.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([nuit, ms]) => {
      const tentes = ms.filter((m) => A_TOUCHE_META.includes(m.statut));
      const bloques = tentes.filter((m) => m.statut === 'bloque').length;
      const sautes = ms.filter((m) => m.statut === 'saute').length;
      const pubs = ms.reduce((s, m) => s + m.pubs_lues, 0);
      const minutes = Math.round(ms.reduce((s, m) => s + m.minutes_meta, 0) * 10) / 10;
      return {
        nuit,
        creneaux: tentes.length,
        bloques,
        sautes,
        pubs_lues: pubs,
        minutes_meta: minutes,
        pubs_par_minute: minutes > 0 ? Math.round((pubs / minutes) * 10) / 10 : 0,
        taux_blocage: tentes.length ? Math.round((bloques / tentes.length) * 100) / 100 : 0,
        reussie: bloques === 0 && sautes === 0 && pubs >= PUBS_MIN_PAR_NUIT,
      };
    });
}

/** Les nuits réussies d'affilée en partant de la plus récente : le critère d'acceptation (7). */
export function nuitsReussiesDeSuite(bilans: readonly BilanNuit[]): number {
  let n = 0;
  for (const b of [...bilans].reverse()) {
    if (!b.reussie) break;
    n += 1;
  }
  return n;
}
