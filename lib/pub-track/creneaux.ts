/**
 * LA NUIT EN CRÉNEAUX COURTS (Pub Track v2, lot 1, 29/10/2026 : docs/PLAN-PUB-TRACK-V2.md).
 *
 * Le 29/10/2026, Meta a répondu 403 dès la première recherche et la nuit a lu 0 pub. La nuit se
 * coupe en créneaux de quelques minutes, une seule collecte à la fois, qui reprennent la file de la
 * nuit là où le précédent s'est arrêté. Un refus de Meta (403, 429) est RESPECTÉ : il arrête la nuit
 * entière, on ne relance jamais depuis une autre machine pour passer outre, et le robot ne se
 * déguise pas en personne (décision du 29/10/2026 : contourner un refus d'accès est exclu).
 *
 * Tout est PUR ici, sans réseau ni base : `scripts/verify-collecte-creneaux.ts` l'exécute.
 */

export const CRENEAUX = {
  /**
   * Créneaux planifiés par nuit (crons de `collecte.yml`). Six depuis le lot 2 : la vérification relit
   * au moins 150 annonceurs par nuit (environ une heure), en plus des recherches. Une seule collecte à la
   * fois reste la règle : six créneaux courts, jamais deux en même temps.
   */
  parNuit: 6,
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
 * Un refus se respecte. Les créneaux qui ont touché Meta, du plus récent au plus ancien :
 * - le dernier a été bloqué CETTE nuit : les créneaux suivants de la nuit ne rouvrent pas Meta ;
 * - les deux derniers ont été bloqués et le dernier date de la veille : la nuit entière est sautée.
 * Un mur durable donne donc un seul essai toutes les deux nuits, jamais une relance immédiate.
 */
export function doitSauter(lignes: readonly LigneJournal[], nuit: string, maintenant: Date): boolean {
  const tentatives = [...lignes]
    .sort((a, b) => Date.parse(b.debut) - Date.parse(a.debut))
    .filter((l) => A_TOUCHE_META.includes(statutDe(l, maintenant)));
  const derniereTentative = tentatives[0];
  if (derniereTentative && statutDe(derniereTentative, maintenant) === 'bloque' && nuitDe(derniereTentative) === nuit) return true;
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
  /** Lot 2 : annonceurs relus, pubs confirmées actives, pubs prouvées arrêtées. */
  annonceurs_verifies: number;
  pubs_confirmees: number;
  pubs_arretees: number;
}

export function mesures(entree: {
  nuit: string;
  creneau: number;
  statut: StatutCreneau;
  recherches: number;
  pubsLues: number;
  msMeta: number;
  bloqueA: number | null;
  annonceursVerifies?: number;
  pubsConfirmees?: number;
  pubsArretees?: number;
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
    annonceurs_verifies: entree.annonceursVerifies ?? 0,
    pubs_confirmees: entree.pubsConfirmees ?? 0,
    pubs_arretees: entree.pubsArretees ?? 0,
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
  annonceurs_verifies: number;
  pubs_arretees: number;
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
        annonceurs_verifies: ms.reduce((s, m) => s + (m.annonceurs_verifies ?? 0), 0),
        pubs_arretees: ms.reduce((s, m) => s + (m.pubs_arretees ?? 0), 0),
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
