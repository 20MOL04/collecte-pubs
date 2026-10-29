/**
 * Le score Pub Track v2, 0 à 100, la phrase qui l'explique, et le statut d'une pub (plan v2, lot 4).
 *
 * Fonction PURE : le collecteur la calcule chaque nuit, le verrou l'exécute. Les pondérations et les
 * seuils vivent ici et seulement ici : l'écran, Molia et le MCP lisent le statut rangé en base, jamais un
 * chiffre recopié. Un chiffre sans sa raison n'est pas une expertise : `phrase` accompagne toujours `score`.
 *
 * Meta ne publie ni portée ni dépenses hors d'Europe : on ne mesure que ce qui se voit, et on ne l'invente
 * jamais. Le v2 ne compte que des PREUVES (plan, section 2.1) : une longévité vérifiée, des variantes, une
 * montée sur 7 jours, plusieurs vendeurs du même produit, plusieurs pays, une offre lisible. Une pub dont
 * la dernière vérification a plus de 3 jours ne peut pas atteindre le seuil gagnant.
 */
import type { Offre } from './offre';

export interface SignauxScore {
  /** Jours actifs PROUVÉS : de la date de début Meta à la dernière preuve d'activité (migration 116). */
  joursVerifies: number;
  /** Variantes : le groupe de fichiers et le « N publicités utilisent ce contenu » de Meta. */
  variantes: number;
  /** Variation sur 7 jours de la boutique ou de l'annonceur, en fraction (0.42 = +42 %). null = pas d'historique. */
  croissance7j: number | null;
  /** Annonceurs DISTINCTS qui vendent le même produit (famille), 1 quand on ne sait pas. */
  vendeursProduit: number;
  /** Pays distincts où le produit est vendu, au moins ceux de la pub. */
  paysProduit: number;
  prixConnu: boolean;
  offres: readonly Offre[];
  /** Âge en jours de la dernière vérification de la page annonceur, null = jamais vérifiée. */
  preuveJours: number | null;
}

/** Proposition de départ du plan (lot 4), à ajuster sur mesure réelle. Total : 100. */
export const POIDS_SCORE = {
  longevite: 35,
  variantes: 20,
  montee: 15,
  vendeurs: 15,
  pays: 10,
  offre: 5,
} as const;

/** Les seuils d'un statut : une seule source pour l'écran, Molia et le MCP (plan, section 2.2). */
export const SEUILS_PUB = {
  gagnante: { scoreMin: 60, joursVerifiesMin: 14, preuveMaxJours: 3, variantesMin: 2, vendeursMin: 2 },
  montante: { lanceeMinJours: 7, lanceeMaxJours: 21, preuveMaxJours: 3 },
  nouvelle: { lanceeMaxJours: 7 },
  /** Tendance occidentale (plan, section 2.4) : promise aux abonnés, elle doit être irréprochable. */
  occident: { joursVerifiesMin: 14, variantesMin: 3, vendeursMin: 2, preuveMaxJours: 3 },
} as const;

export const STATUTS_PUB = ['gagnante', 'montante', 'nouvelle'] as const;
export type StatutPub = (typeof STATUTS_PUB)[number];

export function estStatutPub(v: unknown): v is StatutPub {
  return typeof v === 'string' && (STATUTS_PUB as readonly string[]).includes(v);
}

const borne = (x: number) => Math.max(0, Math.min(1, x));
/** 0 à `plein` sur une courbe logarithmique : les premiers jours comptent plus. */
const log = (x: number, plein: number) => borne(Math.log1p(Math.max(0, x)) / Math.log1p(plein));

export const preuveRecente = (preuveJours: number | null) => preuveJours !== null && preuveJours <= SEUILS_PUB.gagnante.preuveMaxJours;

export function scorePub(s: SignauxScore): number {
  const offre = (s.prixConnu ? 0.5 : 0) + (s.offres.length ? 0.5 : 0);
  const total =
    POIDS_SCORE.longevite * log(s.joursVerifies, 60) +
    POIDS_SCORE.variantes * log(Math.max(0, s.variantes - 1), 7) +
    POIDS_SCORE.montee * borne(s.croissance7j ?? 0) +
    POIDS_SCORE.vendeurs * log(Math.max(0, s.vendeursProduit - 1), 4) +
    POIDS_SCORE.pays * borne((s.paysProduit - 1) / 3) +
    POIDS_SCORE.offre * offre;
  const brut = Math.round(Math.max(0, Math.min(100, total)));
  // Sans preuve récente, une pub ne franchit pas le seuil gagnant : on ne vend pas ce qu'on n'a pas vérifié.
  return preuveRecente(s.preuveJours) ? brut : Math.min(brut, SEUILS_PUB.gagnante.scoreMin - 1);
}

/**
 * Le statut d'une pub. Gagnante : produit PHYSIQUE AFRICAIN, active vérifiée il y a moins de 3 jours,
 * longévité vérifiée d'au moins 14 jours, au moins 2 variantes OU 2 vendeurs du même produit, score v2 ≥ 60.
 * Montante : lancée il y a 7 à 21 jours, active vérifiée, boutique ou annonceur en hausse sur 7 jours.
 * Nouvelle : lancée il y a moins de 7 jours, jamais présentée comme gagnante.
 */
export function statutPub(e: {
  active: boolean;
  categorie: string | null;
  marche: string | null;
  joursDepuisLancement: number | null;
  score: number;
  signaux: SignauxScore;
}): StatutPub | null {
  if (!e.active) return null;
  const s = e.signaux;
  const g = SEUILS_PUB.gagnante;
  if (
    e.categorie === 'physique' &&
    (e.marche ?? 'afrique') === 'afrique' &&
    preuveRecente(s.preuveJours) &&
    s.joursVerifies >= g.joursVerifiesMin &&
    (s.variantes >= g.variantesMin || s.vendeursProduit >= g.vendeursMin) &&
    e.score >= g.scoreMin
  ) {
    return 'gagnante';
  }
  const lancee = e.joursDepuisLancement;
  if (lancee === null) return null;
  if (lancee < SEUILS_PUB.nouvelle.lanceeMaxJours) return 'nouvelle';
  const m = SEUILS_PUB.montante;
  if (lancee >= m.lanceeMinJours && lancee <= m.lanceeMaxJours && s.preuveJours !== null && s.preuveJours <= m.preuveMaxJours && (s.croissance7j ?? 0) > 0) {
    return 'montante';
  }
  return null;
}

/**
 * Une pub occidentale montrée aux abonnés (lot 6) : produit PHYSIQUE, active vérifiée il y a moins de 3 jours, et
 * soit 14 jours prouvés avec au moins 3 variantes, soit plusieurs annonceurs sur le même produit. Le reste est lu et
 * gardé, jamais présenté comme une tendance.
 */
export function occidentProuve(e: { categorie: string | null; signaux: SignauxScore }): boolean {
  const o = SEUILS_PUB.occident;
  const s = e.signaux;
  if (e.categorie !== 'physique' || s.preuveJours === null || s.preuveJours > o.preuveMaxJours) return false;
  return (s.joursVerifies >= o.joursVerifiesMin && s.variantes >= o.variantesMin) || s.vendeursProduit >= o.vendeursMin;
}

export function enHausse(variation7j: number | null): boolean {
  return (variation7j ?? 0) >= 0.15;
}

/** « Accélère » : les deux variations montent, et la semaine va plus vite que le mois. */
export function accelere(variation7j: number | null, variation30j: number | null): boolean {
  if (variation7j === null || variation30j === null) return false;
  return variation7j > 0 && variation30j > 0 && variation7j > variation30j / 4;
}

const LIBELLES_OFFRE: Record<Offre, { fr: string; en: string }> = {
  paiement_livraison: { fr: 'paiement à la livraison', en: 'cash on delivery' },
  livraison_gratuite: { fr: 'livraison gratuite', en: 'free delivery' },
  promo: { fr: 'promo', en: 'discount' },
  lot: { fr: 'lot', en: 'bundle' },
};

export function phraseScore(s: SignauxScore, langue: 'fr' | 'en' = 'fr'): string {
  const fr = langue === 'fr';
  const morceaux: string[] = [];
  const j = Math.max(0, Math.round(s.joursVerifies));
  if (s.preuveJours === null) morceaux.push(fr ? `${j} jour${j > 1 ? 's' : ''}, non vérifiée` : `${j} day${j > 1 ? 's' : ''}, not verified`);
  else if (!preuveRecente(s.preuveJours)) morceaux.push(fr ? `${j} jour${j > 1 ? 's' : ''}, vérifiée il y a ${s.preuveJours} jours` : `${j} day${j > 1 ? 's' : ''}, verified ${s.preuveJours} days ago`);
  else morceaux.push(fr ? `${j} jour${j > 1 ? 's' : ''} vérifiés` : `${j} verified day${j > 1 ? 's' : ''}`);
  if (s.variantes > 1) morceaux.push(fr ? `${s.variantes} variantes` : `${s.variantes} variants`);
  if (s.vendeursProduit > 1) morceaux.push(fr ? `${s.vendeursProduit} vendeurs` : `${s.vendeursProduit} sellers`);
  if (s.paysProduit > 1) morceaux.push(fr ? `${s.paysProduit} pays` : `${s.paysProduit} countries`);
  if (enHausse(s.croissance7j)) morceaux.push(fr ? 'en hausse' : 'growing');
  const offre = s.offres[0];
  if (offre) morceaux.push(LIBELLES_OFFRE[offre][fr ? 'fr' : 'en']);
  return morceaux.join(' · ');
}
