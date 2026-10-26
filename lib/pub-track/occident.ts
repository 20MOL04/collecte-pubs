/**
 * La « Tendance occidentale » de Pub Track (décision de l'équipe, 10/10/2026) : Pub Track reste
 * 100 % Afrique, mais le robot lit aussi quelques pays occidentaux. Leurs pubs portent
 * `marche = 'occident'` (migration 093) et ne se voient qu'avec le filtre premium du même nom.
 *
 * Le but n'est pas de copier Minea : c'est le PONT. Un produit qui gagne déjà en France ou aux
 * États-Unis arrive souvent en Afrique quelques mois plus tard ; l'onglet Produits le montre.
 *
 * Les pays sont choisis pour les langues que l'Afrique partage avec eux : français, anglais,
 * portugais. Les recherches tournent d'une nuit à l'autre, dans un petit budget de temps.
 */
export interface PaysOccident {
  code: string;
  nom: string;
  nomEn: string;
  langue: 'fr' | 'en' | 'pt';
}

export const PAYS_OCCIDENT: readonly PaysOccident[] = [
  { code: 'FR', nom: 'France', nomEn: 'France', langue: 'fr' },
  { code: 'BE', nom: 'Belgique', nomEn: 'Belgium', langue: 'fr' },
  { code: 'CH', nom: 'Suisse', nomEn: 'Switzerland', langue: 'fr' },
  { code: 'CA', nom: 'Canada', nomEn: 'Canada', langue: 'en' },
  { code: 'US', nom: 'États-Unis', nomEn: 'United States', langue: 'en' },
  { code: 'GB', nom: 'Royaume-Uni', nomEn: 'United Kingdom', langue: 'en' },
  { code: 'AU', nom: 'Australie', nomEn: 'Australia', langue: 'en' },
  { code: 'PT', nom: 'Portugal', nomEn: 'Portugal', langue: 'pt' },
];

/** Des mots de VENTE de produits, pas de marques : la bibliothèque renvoie ce qui se vend. */
export const MOTS_OCCIDENT: Record<PaysOccident['langue'], readonly string[]> = {
  fr: ['livraison gratuite', 'commandez maintenant', 'offre limitée', 'meilleure vente', 'stock limité', 'paiement en 3 fois'],
  en: ['free shipping', 'shop now', 'limited offer', 'best seller', 'order now', 'viral product'],
  pt: ['frete grátis', 'compre agora', 'oferta limitada', 'mais vendido'],
};

/**
 * Les recherches de la nuit : toutes les paires (pays, mot) dans un ordre fixe, et chaque nuit en
 * prend `n` à partir d'un décalage qui avance d'un jour à l'autre. Tout est relu en quelques nuits.
 */
export function requetesOccident(jour: Date, n: number): { pays: string; mot: string }[] {
  const paires = PAYS_OCCIDENT.flatMap((p) => MOTS_OCCIDENT[p.langue].map((mot) => ({ pays: p.code, mot })));
  if (!paires.length || n <= 0) return [];
  const debut = (Math.floor(jour.getTime() / 86_400_000) * n) % paires.length;
  return Array.from({ length: Math.min(n, paires.length) }, (_, i) => paires[(debut + i) % paires.length]);
}

export function paysOccident(code: string): PaysOccident | null {
  return PAYS_OCCIDENT.find((p) => p.code === code.toUpperCase()) ?? null;
}
