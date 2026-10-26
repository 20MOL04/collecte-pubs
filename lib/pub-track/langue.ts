/**
 * La langue d'une pub, par mots outils (cahier, section 4.4). Pas de
 * dépendance : six langues suffisent au marché, et une heuristique honnête
 * vaut mieux qu'un modèle qu'on paierait à chaque pub.
 */
import { mots } from './texte';

export const LANGUES = ['fr', 'en', 'ar', 'pt', 'sw', 'wo'] as const;
export type Langue = (typeof LANGUES)[number];

export const NOMS_LANGUE: Record<Langue, string> = {
  fr: 'Français',
  en: 'Anglais',
  ar: 'Arabe',
  pt: 'Portugais',
  sw: 'Swahili',
  wo: 'Wolof',
};

const MOTS_OUTILS: Record<Exclude<Langue, 'ar'>, readonly string[]> = {
  fr: ['le', 'la', 'les', 'des', 'et', 'est', 'pour', 'avec', 'votre', 'vous', 'une', 'dans', 'sur', 'pas', 'qui', 'commande', 'livraison'],
  en: ['the', 'and', 'for', 'with', 'your', 'you', 'this', 'that', 'now', 'order', 'delivery', 'free', 'get', 'our'],
  pt: ['o', 'os', 'para', 'com', 'voce', 'seu', 'sua', 'nao', 'uma', 'entrega', 'agora', 'muito'],
  sw: ['na', 'kwa', 'ya', 'wa', 'za', 'ni', 'bei', 'sasa', 'yako', 'hii', 'leo'],
  wo: ['ak', 'ci', 'dafa', 'nga', 'yi', 'bi', 'gi', 'dina', 'jend', 'waaw'],
};

export function estLangue(v: unknown): v is Langue {
  return typeof v === 'string' && (LANGUES as readonly string[]).includes(v);
}

export function devinerLangue(texte: string): Langue | null {
  if (/[\u0600-\u06ff]{3,}/.test(texte)) return 'ar';
  const m = mots(texte);
  if (m.length < 3) return null;
  let meilleure: Langue | null = null;
  let meilleurScore = 1;
  for (const [langue, outils] of Object.entries(MOTS_OUTILS) as [Langue, readonly string[]][]) {
    const ensemble = new Set(outils);
    const score = m.filter((x) => ensemble.has(x)).length;
    if (score > meilleurScore) {
      meilleure = langue;
      meilleurScore = score;
    }
  }
  return meilleure;
}
