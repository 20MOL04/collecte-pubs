/**
 * Le score Pub Track, 0 à 100, et la phrase qui l'explique (cahier, 4.6).
 *
 * Fonction PURE : le collecteur la calcule chaque nuit, le verrou l'exécute.
 * Les pondérations vivent ici et seulement ici. Un chiffre sans sa raison
 * n'est pas une expertise : `phrase` accompagne toujours `score`.
 *
 * Meta ne publie ni portée ni dépenses hors d'Europe : on ne mesure que ce
 * qui se voit, et on ne l'invente jamais.
 */
export interface SignauxScore {
  joursActifs: number;
  variantes: number;
  pubsActivesBoutique: number;
  /** Variation sur 7 jours, en fraction (0.42 = +42 %). null = pas d'historique. */
  croissance7j: number | null;
  reseaux: number;
}

export const POIDS_SCORE = {
  jours: 40,
  variantes: 20,
  pression: 20,
  croissance: 15,
  reseaux: 5,
} as const;

const borne = (x: number) => Math.max(0, Math.min(1, x));
/** 0 à `plein` sur une courbe logarithmique : les premiers jours comptent plus. */
const log = (x: number, plein: number) => borne(Math.log1p(Math.max(0, x)) / Math.log1p(plein));

export function scorePub(s: SignauxScore): number {
  const total =
    POIDS_SCORE.jours * log(s.joursActifs, 60) +
    POIDS_SCORE.variantes * log(Math.max(0, s.variantes - 1), 7) +
    POIDS_SCORE.pression * log(Math.max(0, s.pubsActivesBoutique - 1), 49) +
    POIDS_SCORE.croissance * borne(s.croissance7j ?? 0) +
    POIDS_SCORE.reseaux * borne((s.reseaux - 1) / 3);
  return Math.round(Math.max(0, Math.min(100, total)));
}

export function enHausse(variation7j: number | null): boolean {
  return (variation7j ?? 0) >= 0.15;
}

/** « Accélère » : les deux variations montent, et la semaine va plus vite que le mois. */
export function accelere(variation7j: number | null, variation30j: number | null): boolean {
  if (variation7j === null || variation30j === null) return false;
  return variation7j > 0 && variation30j > 0 && variation7j > variation30j / 4;
}

export function phraseScore(s: SignauxScore, langue: 'fr' | 'en' = 'fr'): string {
  const fr = langue === 'fr';
  const morceaux: string[] = [];
  const j = Math.max(0, Math.round(s.joursActifs));
  morceaux.push(fr ? `${j} jour${j > 1 ? 's' : ''}` : `${j} day${j > 1 ? 's' : ''}`);
  if (s.variantes > 1) morceaux.push(fr ? `${s.variantes} variantes` : `${s.variantes} variants`);
  if (s.pubsActivesBoutique > 1) {
    morceaux.push(fr ? `${s.pubsActivesBoutique} pubs actives en boutique` : `${s.pubsActivesBoutique} active ads in store`);
  }
  if (enHausse(s.croissance7j)) morceaux.push(fr ? 'boutique en hausse' : 'store growing');
  return morceaux.join(' · ');
}
