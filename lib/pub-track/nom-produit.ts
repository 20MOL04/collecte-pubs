/**
 * Le nom du produit d'une pub, et la recherche qui retrouve son fournisseur (demande du
 * équipe, 09/10/2026 : « il met le nom de la campagne au lieu du nom du produit, donc sur
 * Alibaba on ne trouve rien »).
 *
 * Le collecteur de nuit montre au modèle de vision l'IMAGE et la légende de chaque pub, par
 * lots, et range trois choses : un nom court en français pour l'écran, une requête anglaise
 * pour Alibaba (le catalogue est en anglais), et un verdict « vend un produit ou non ». Ce
 * fichier est PUR : la consigne, la lecture de la réponse, et le repli sans modèle.
 */

export const LOT_NOMMAGE = 10;
export const NOM_MAX = 80;
export const RECHERCHE_MAX = 90;

export interface PubANommer {
  texte: string;
  titre: string;
  niche: string | null;
  typeProduit: string | null;
}

export interface NomProduit {
  vend: boolean;
  nom: string | null;
  /** Vide pour un produit digital : il n'a pas de fournisseur à trouver. */
  recherche: string | null;
  /** Le type de produit en anglais, court et générique : la clé de l'onglet Produits (088). */
  famille: string | null;
  /** Le produit sur l'image : net, flou (petit, caché par du texte) ou absent (097). */
  image: QualiteImage | null;
  /** Où est le produit : [ymin, xmin, ymax, xmax] de 0 à 1000, seulement s'il est net. */
  cadre: Cadre | null;
}

export const QUALITES_IMAGE = ['net', 'flou', 'absent'] as const;
export type QualiteImage = (typeof QUALITES_IMAGE)[number];
export type Cadre = [number, number, number, number];

export const CONSIGNE_IMAGE =
  '- "image": "net" when the product itself is clearly visible and sharp on the image; "flou" when it is blurry, tiny, partly hidden or covered by text; "absent" when it is not visible (only a person, a scene, a text card). - "cadre": the box around the product as [ymin, xmin, ymax, xmax] from 0 to 1000, tight but including the whole product, ONLY when "image" is "net"; otherwise null.';

/**
 * Un cadre utilisable : quatre nombres de 0 à 1000, dans l'ordre, et assez grand pour qu'une image
 * recadrée reste lisible (au moins 4 % de l'image). Sinon null : on garde la vignette entière.
 */
export function cadreValide(v: unknown): Cadre | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [y0, x0, y1, x1] = (v as number[]).map((n) => Math.max(0, Math.min(1000, n)));
  if (y1 <= y0 || x1 <= x0) return null;
  if ((y1 - y0) * (x1 - x0) < 40_000) return null;
  return [y0, x0, y1, x1];
}

export function consigneNommage(pubs: readonly PubANommer[], connues: readonly string[] = []): string {
  const lignes = pubs.map((p, i) => {
    const legende = `${p.titre ? `${p.titre}\n` : ''}${p.texte}`.replace(/\s+/g, ' ').slice(0, 700);
    return `#${i + 1} (image ${i + 1}) [${p.typeProduit ?? 'physique'}${p.niche ? `, ${p.niche}` : ''}] ${legende}`;
  });
  return [
    'You see ads and videos posted by African online sellers. Each item has one image (in the same order) and its caption.',
    'For EACH item, identify the exact product being sold, mainly from the IMAGE, using the caption for brand, size, capacity or material.',
    'Return ONLY a JSON array, one object per item, in order:',
    '[{"i":1,"vend":true,"nom":"...","recherche":"...","famille":"...","image":"net","cadre":[120,200,880,760]}]',
    '- "vend": false ONLY when the post clearly sells nothing: news, police or government notice, joke or comedy, music, personal life, religious content, job offer, school or training centre enrolment, real estate, restaurant meal or food delivery app. A seller showing a product with a price, an order or delivery offer is true.',
    '- "nom": the product name in French, 2 to 6 words, like a shop listing title ("Crème éclaircissante au curcuma 50 ml", "Mixeur électrique 6 L"). Never the campaign slogan, never the shop name, no emoji, no price, no dash between words.',
    '- "recherche": an English supplier search query for Alibaba, 3 to 8 words: the generic product type plus its visible attributes (material, size, capacity, style), the way a wholesaler lists it ("turmeric skin whitening cream 50ml", "electric food blender 6l stainless"). No shop name, no price, no seller brand. Empty string for a digital product (ebook, course, training, software).',
    CONSIGNE_FAMILLE,
    CONSIGNE_IMAGE,
    connues.length ? `Existing product types to reuse whenever they fit: ${connues.join(' | ')}` : '',
    '',
    ...lignes,
  ].join('\n');
}

export const CONSIGNE_FAMILLE =
  '- "famille": the generic product TYPE in English, 1 to 3 words, lowercase, singular, without size, colour, material or brand ("food blender", "blood pressure monitor", "perfume", "wig", "ebook", "online course"). Two ads for the same kind of product MUST get exactly the same famille.';

/** Une famille propre : minuscules, lettres et espaces, 1 à 4 mots, 40 caractères. */
export function familleNette(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const f = v.toLowerCase().normalize('NFKC').replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const mots = f.split(' ').filter(Boolean);
  return mots.length && mots.length <= 4 ? mots.join(' ').slice(0, 40) : null;
}

/**
 * La famille des pubs DÉJÀ nommées, en texte seul (aucune image : quelques jetons par pub). Les
 * familles connues sont données d'abord, pour qu'un même produit retombe sur la même clé.
 */
export function consigneFamilles(produits: readonly { nom: string; recherche: string }[], connues: readonly string[]): string {
  return [
    'For EACH product below, give its generic product TYPE in English. Return ONLY a JSON array of strings, one per product, in order.',
    CONSIGNE_FAMILLE.replace('- "famille": ', 'Rule: '),
    connues.length ? `Reuse one of these existing types whenever it fits: ${connues.join(' | ')}` : '',
    '',
    ...produits.map((p, i) => `#${i + 1} ${p.recherche} (${p.nom})`),
  ].join('\n');
}

export function lireFamilles(brut: unknown, n: number): (string | null)[] {
  const sortie: (string | null)[] = Array.from({ length: n }, () => null);
  if (!Array.isArray(brut)) return sortie;
  brut.slice(0, n).forEach((x, i) => {
    sortie[i] = familleNette(x);
  });
  return sortie;
}

const sansTiret = (s: string) => s.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();

/**
 * Le rattrapage des images pour les pubs DÉJÀ nommées (097) : seulement « net / flou / absent » et
 * le cadre, sans renommer. Même lot d'images que le nommage, réponse beaucoup plus courte.
 */
export function consigneImages(n: number): string {
  return [
    `You see ${n} images from African online sellers' ads, in order. For EACH image, judge the product being sold.`,
    'Return ONLY a JSON array, one object per image, in order: [{"i":1,"image":"net","cadre":[120,200,880,760]}]',
    CONSIGNE_IMAGE,
  ].join('\n');
}

export function lireImages(brut: unknown, n: number): ({ image: QualiteImage; cadre: Cadre | null } | null)[] {
  const sortie: ({ image: QualiteImage; cadre: Cadre | null } | null)[] = Array.from({ length: n }, () => null);
  if (!Array.isArray(brut)) return sortie;
  brut.forEach((x, k) => {
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    const i = typeof o.i === 'number' && Number.isInteger(o.i) ? o.i - 1 : k;
    if (i < 0 || i >= n || !(QUALITES_IMAGE as readonly string[]).includes(String(o.image))) return;
    const image = o.image as QualiteImage;
    sortie[i] = { image, cadre: image === 'net' ? cadreValide(o.cadre) : null };
  });
  return sortie;
}

/** La réponse du modèle, contrôlée : un tableau mal formé ne nomme rien. */
export function lireNomsProduits(brut: unknown, n: number): (NomProduit | null)[] {
  const sortie: (NomProduit | null)[] = Array.from({ length: n }, () => null);
  if (!Array.isArray(brut)) return sortie;
  brut.forEach((x, k) => {
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    const i = typeof o.i === 'number' && Number.isInteger(o.i) ? o.i - 1 : k;
    if (i < 0 || i >= n || typeof o.vend !== 'boolean') return;
    const nom = typeof o.nom === 'string' ? sansTiret(o.nom).slice(0, NOM_MAX) : '';
    const recherche = typeof o.recherche === 'string' ? sansTiret(o.recherche).toLowerCase().slice(0, RECHERCHE_MAX) : '';
    const image = (QUALITES_IMAGE as readonly string[]).includes(String(o.image)) ? (o.image as QualiteImage) : null;
    sortie[i] = { vend: o.vend, nom: nom || null, recherche: recherche || null, famille: familleNette(o.famille), image, cadre: image === 'net' ? cadreValide(o.cadre) : null };
  });
  return sortie;
}

/** Les mots de la vente, jamais ceux du produit : ils noient une recherche fournisseur. */
const MOTS_VENTE =
  /(^|[^\p{L}])(livraison|gratuite?|partout|commande[rz]?|commandez|disponibles?|promo(tion)?|offre|prix|fcfa|cfa|whatsapp|appelez|contactez|stock|qualit[ée]|original|nouveau|nouvelle|arrivage|delivery|free|order|now|available|price|call|dm|shop|boutique|abidjan|dakar|lagos|douala|lom[ée]|cotonou|bamako|accra|nairobi|kinshasa|ouagadougou)(?=$|[^\p{L}])/giu;

/**
 * Le repli sans nom de modèle : la légende débarrassée des liens, hashtags, prix, numéros et
 * mots de vente. Moins juste qu'un nom vu sur l'image, toujours mieux que le slogan.
 */
export function rechercheDeRepli(titre: string, texte: string): string {
  const source = `${titre} ${texte}`.normalize('NFKC');
  return source
    .replace(/https?:\/\/\S+|[#@]\S+/g, ' ')
    .replace(MOTS_VENTE, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    // « 6L », « 50ml » gardés ; un prix ou un numéro seul (que des chiffres) écarté.
    .filter((m) => m.length > 1 && /\p{L}/u.test(m))
    .slice(0, 6)
    .join(' ');
}

/**
 * Le lien Alibaba d'une pub : la requête anglaise du modèle, sinon le nom vu sur l'image, sinon le
 * repli tiré de la légende. Rien de tout ça : null, et le bouton disparaît. JAMAIS le nom de
 * l'annonceur : c'est la boutique, pas le produit (audit du 09/10/2026).
 */
export function lienAlibaba(recherche: string | null, nom: string | null, titre: string, texte: string): string | null {
  const q = recherche?.trim() || nom?.trim() || rechercheDeRepli(titre, texte);
  return q ? `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(q)}` : null;
}

/**
 * La recherche PAR IMAGE : Google Lens lit la miniature (publique, dans notre stockage) et
 * retrouve le même objet chez les grossistes (Alibaba, AliExpress, 1688). Alibaba n'accepte
 * pas d'image par adresse dans un lien.
 */
export function lienRechercheImage(miniature: string | null): string | null {
  return miniature ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(miniature)}` : null;
}
