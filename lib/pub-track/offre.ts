/**
 * Le prix et le type d'offre d'une pub, lus dans son texte (filtres premium
 * de Pub Track, décision de l'équipe du 07/10/2026 : « des filtres qui donnent
 * de la valeur », pensés pour le vendeur africain, ce que Minea ne sait pas faire).
 *
 * Fonction pure, rejouée sur toute la base par le collecteur. Testée par
 * `verify-pub-track.ts`. Un prix qu'on ne lit pas avec certitude n'est PAS
 * deviné : `null`. Un mauvais prix ferait filtrer de travers, un prix absent
 * fait seulement manquer une pub.
 */

/** Tranches de prix, en FCFA (le franc CFA d'Afrique de l'Ouest et du Centre). */
export const TRANCHES_PRIX = ['moins_5k', '5k_15k', '15k_30k', '30k_60k', 'plus_60k'] as const;
export type TranchePrix = (typeof TRANCHES_PRIX)[number];
export const BORNES_PRIX: Record<TranchePrix, [number, number | null]> = {
  moins_5k: [0, 4_999],
  '5k_15k': [5_000, 14_999],
  '15k_30k': [15_000, 29_999],
  '30k_60k': [30_000, 59_999],
  plus_60k: [60_000, null],
};

export const OFFRES = ['paiement_livraison', 'livraison_gratuite', 'promo', 'lot'] as const;
export type Offre = (typeof OFFRES)[number];

export function estOffre(v: unknown): v is Offre {
  return typeof v === 'string' && (OFFRES as readonly string[]).includes(v);
}

/**
 * Le franc guinéen ramené en FCFA, ordre de grandeur relevé le 07/10/2026
 * (1 FCFA ≈ 15 GNF). Il ne sert qu'à RANGER un prix dans une tranche large :
 * une erreur de 10 % ne change presque jamais la tranche.
 */
const GNF_PAR_FCFA = 15;

// « 12 500 », « 12.500 », « 12 500 » (espace fine), « 15000 » : jamais plus de 7 chiffres d'affilée (un numéro de téléphone en a 8 ou plus).
const NOMBRE = String.raw`(\d{1,3}(?:[ .,  ]\d{3})+|\d{3,7})`;
const FCFA = new RegExp(`${NOMBRE}\\s*(?:f\\s?cfa|fcfa|cfa|xof|xaf|frs?\\b|francs?\\b|f\\b)`, 'gi');
const GNF = new RegExp(`${NOMBRE}\\s*(?:gnf|fg\\b|francs? guin[ée]ens?)`, 'gi');

const enNombre = (brut: string) => Number(brut.replace(/[ .,  ]/g, ''));

/**
 * Le prix le plus BAS qu'on lit avec sa monnaie, en FCFA. Une pub montre
 * souvent l'ancien prix barré puis le prix promo : le plus bas est celui que
 * l'acheteur paie. Hors de 500 FCFA à 5 millions : on ne garde pas (frais de
 * livraison, numéro de commande, montant de cagnotte).
 */
export function prixFcfa(texte: string): number | null {
  const t = texte.normalize('NFKC');
  const prix: number[] = [];
  for (const m of t.matchAll(FCFA)) prix.push(enNombre(m[1] ?? ''));
  for (const m of t.matchAll(GNF)) prix.push(Math.round(enNombre(m[1] ?? '') / GNF_PAR_FCFA));
  const plausibles = prix.filter((p) => Number.isFinite(p) && p >= 500 && p <= 5_000_000);
  return plausibles.length ? Math.min(...plausibles) : null;
}

const SIGNES: Record<Offre, RegExp> = {
  paiement_livraison: /paiement\s+(?:à|a)\s+la\s+livraison|payez?\s+(?:à|a)\s+la\s+livraison|cash\s+on\s+delivery|pay\s+on\s+delivery|vous\s+payez\s+(?:à|a)\s+la\s+r[ée]ception/i,
  livraison_gratuite: /livraison\s+(?:gratuite|offerte|free)|free\s+delivery|free\s+shipping/i,
  promo: /-\s?\d{1,2}\s?%|\d{1,2}\s?%\s+(?:de\s+)?(?:r[ée]duction|remise|off)|promo(?:tion)?\b|soldes?\b|r[ée]duction\b/i,
  lot: /\d\s?(?:achet[ée]s?|pris)\s?=\s?\d\s?offert|\b1\s?\+\s?1\b|\b2\s?\+\s?1\b|achetez\s+\d.{0,20}offert|\d\s+pour\s+le\s+prix\s+de\s+\d|buy\s+\d\s+get\s+\d/i,
};

/** Les leviers d'offre que la pub met en avant. */
export function offresDe(texte: string): Offre[] {
  const t = texte.normalize('NFKC');
  return OFFRES.filter((o) => SIGNES[o].test(t));
}
