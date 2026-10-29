/**
 * La « Tendance occidentale » de Pub Track (décision du équipe, 10/10/2026) : Pub Track reste
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

/** Un produit africain qui gagne ou qui monte cette semaine : la matière des recherches orientées (lot 6). */
export interface ProduitAOrienter {
  /** Le nom en français (classeur IA). */
  nom: string | null;
  /** La recherche fournisseur en anglais (classeur IA). */
  recherche: string | null;
}

const motsCourts = (v: string | null, max: number) =>
  (v ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((m) => m.length > 1)
    .slice(0, max)
    .join(' ')
    .toLowerCase();

/**
 * Les recherches occidentales de la nuit, ORIENTÉES (plan v2, lot 6) : la moitié cherche en Occident les produits
 * africains qui gagnent ou montent cette semaine (le nom français dans les pays francophones, la recherche anglaise
 * ailleurs), pour dire au vendeur « déjà en test en Afrique » ; l'autre moitié garde la rotation des mots de vente,
 * pour trouver ce qui n'est pas encore arrivé (« pas encore en Afrique »). Sans produit à orienter : la rotation seule.
 * Déterministe pour un jour et une liste donnés.
 */
export function requetesOccidentOrientees(produits: readonly ProduitAOrienter[], jour: Date, n: number): { pays: string; mot: string }[] {
  if (n <= 0) return [];
  const orientees: { pays: string; mot: string }[] = [];
  const vues = new Set<string>();
  const jourN = Math.floor(jour.getTime() / 86_400_000);
  const ordrePays = PAYS_OCCIDENT.filter((p) => p.langue !== 'pt');
  produits.forEach((p, i) => {
    const pays = ordrePays[(jourN + i) % ordrePays.length]!;
    const mot = pays.langue === 'fr' ? motsCourts(p.nom, 4) || motsCourts(p.recherche, 4) : motsCourts(p.recherche, 4) || motsCourts(p.nom, 4);
    const cle = `${pays.code}|${mot}`;
    if (mot.split(' ').length < 2 || vues.has(cle)) return;
    vues.add(cle);
    orientees.push({ pays: pays.code, mot });
  });
  const partOrientee = Math.min(orientees.length, Math.ceil(n / 2));
  const rotation = requetesOccident(jour, n).filter((r) => !vues.has(`${r.pays}|${r.mot}`));
  return [...orientees.slice(0, partOrientee), ...rotation].slice(0, n);
}
