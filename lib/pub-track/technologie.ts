/**
 * Sur quoi tourne une boutique (cahier, section 4.3).
 *
 * Le collecteur lit LA PAGE DE VENTE de la pub (pas seulement l'accueil du
 * domaine), une fois tous les 30 jours, et passe son HTML ici. Décision du
 * équipe du 07/10/2026 : beaucoup de vendeurs digitaux montent une page de
 * vente sur leur propre domaine et branchent un bouton de paiement Chariow,
 * Maketou ou Selar. On lit donc l'ADRESSE DE CHAQUE LIEN et le pied de page, et
 * si rien ne parle, on suit le bouton d'achat un cran plus loin.
 * Fonction pure : pas de réseau dans ce fichier.
 */
import type { Destination } from './destination';

export const TECHNOLOGIES = [
  'shopify',
  'youcan',
  'chariow',
  'maketou',
  'selar',
  'systeme_io',
  'shoplazza',
  'woocommerce',
  'sur_mesure',
  'whatsapp',
  'reseaux_sociaux',
] as const;
export type Technologie = (typeof TECHNOLOGIES)[number];

export const NOMS_TECHNOLOGIE: Record<Technologie, string> = {
  shopify: 'Shopify',
  youcan: 'YouCan',
  chariow: 'Chariow',
  maketou: 'Maketou',
  selar: 'Selar',
  systeme_io: 'Systeme.io',
  shoplazza: 'Shoplazza',
  woocommerce: 'WooCommerce',
  sur_mesure: 'Site sur mesure',
  whatsapp: 'WhatsApp',
  reseaux_sociaux: 'Réseaux sociaux',
};

export function estTechnologie(v: unknown): v is Technologie {
  return typeof v === 'string' && (TECHNOLOGIES as readonly string[]).includes(v);
}

const SIGNATURES: readonly [Technologie, RegExp][] = [
  ['shopify', /cdn\.shopify\.com|myshopify\.com|Shopify\.theme/i],
  ['youcan', /youcan\.shop|youcanshop|cdn\.youcan/i],
  ['chariow', /chariow/i],
  ['maketou', /maketou/i],
  ['selar', /selar\.(co|com)\b/i],
  ['systeme_io', /systeme\.io/i],
  ['shoplazza', /shoplazza/i],
  ['woocommerce', /woocommerce|wp-content\/plugins\/woo/i],
];

export function technologieDepuisDomaine(domaine: string): Technologie | null {
  if (domaine.endsWith('.myshopify.com')) return 'shopify';
  if (domaine.endsWith('.youcan.shop') || domaine.endsWith('.youcan.store')) return 'youcan';
  if (domaine.endsWith('.mychariow.market') || domaine.endsWith('.chariow.com')) return 'chariow';
  return null;
}

export function technologieDepuisHtml(html: string): Technologie {
  return analyserPage(html).technologie ?? 'sur_mesure';
}

/** Plateformes de produits DIGITAUX : une pub qui y mène vend un produit digital. */
const PLATEFORMES_DIGITALES = ['chariow', 'maketou', 'selar', 'systeme_io'] as const satisfies readonly Technologie[];

export function estPlateformeDigitale(t: string | null | undefined): boolean {
  return !!t && (PLATEFORMES_DIGITALES as readonly string[]).includes(t);
}

/** La plateforme qu'une ADRESSE trahit à elle seule (bouton de paiement, redirection). */
export function technologieDepuisUrl(url: string | null | undefined): Technologie | null {
  if (!url) return null;
  let hote: string;
  try {
    hote = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (/(^|\.)chariow\.|mychariow\./.test(hote)) return 'chariow';
  if (/(^|\.)maketou\.|mymaketou\./.test(hote)) return 'maketou';
  if (/(^|\.)selar\.(co|com)$/.test(hote)) return 'selar';
  if (/(^|\.)systeme\.io$/.test(hote)) return 'systeme_io';
  if (hote.endsWith('.myshopify.com')) return 'shopify';
  if (/youcan\.(shop|store)$/.test(hote)) return 'youcan';
  return technologieDepuisDomaine(hote);
}

const MOTS_ACHAT = /acheter|achat|commander|commande|payer|paiement|obtenir|je veux|télécharger|telecharger|buy|checkout|order|get it|pay/i;

interface LecturePage {
  technologie: Technologie | null;
  /** Le bouton d'achat qui mène AILLEURS, à suivre un cran plus loin si la page ne dit rien. */
  lienAchat: string | null;
}

/**
 * Lit une page de vente : d'abord l'adresse de CHAQUE lien et formulaire (le
 * bouton « Acheter » d'une page sur mesure pointe souvent vers Chariow), puis
 * les signatures du code et du pied de page (« Propulsé par Chariow »).
 */
export function analyserPage(html: string, adresse?: string): LecturePage {
  const liens: { href: string; texte: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    liens.push({ href: m[1] ?? '', texte: (m[2] ?? '').replace(/<[^>]+>/g, ' ') });
  }
  for (const m of html.matchAll(/\b(?:action|data-href|data-url)\s*=\s*["']([^"']+)["']/gi)) liens.push({ href: m[1] ?? '', texte: '' });

  const absolu = (href: string): string | null => {
    try {
      return new URL(href, adresse ?? 'https://exemple.invalid/').toString();
    } catch {
      return null;
    }
  };
  for (const l of liens) {
    const t = technologieDepuisUrl(absolu(l.href));
    if (t) return { technologie: t, lienAchat: null };
  }
  for (const [techno, motif] of SIGNATURES) if (motif.test(html)) return { technologie: techno, lienAchat: null };

  const hotePage = adresse ? new URL(adresse).hostname : null;
  const achat = liens
    .map((l) => ({ url: absolu(l.href), texte: l.texte }))
    .find((l) => l.url && /^https?:/.test(l.url) && MOTS_ACHAT.test(`${l.texte} ${l.url}`) && new URL(l.url).hostname !== hotePage);
  return { technologie: null, lienAchat: achat?.url ?? null };
}

export function technologieSansSite(destination: Destination): Technologie | null {
  if (destination === 'message_whatsapp') return 'whatsapp';
  if (destination === 'message_messenger' || destination === 'appel' || destination === 'inconnue') return 'reseaux_sociaux';
  return null;
}
