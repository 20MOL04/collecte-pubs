/**
 * LE CLASSEUR IA (Pub Track v2, lot 3, 29/10/2026 : docs/PLAN-PUB-TRACK-V2.md).
 *
 * Le champ « produit » rendu au MCP était le titre ou le texte de la pub (« Discuter sur Messenger »,
 * « Livraison gratuite »). Le classeur montre au modèle de vision l'IMAGE et la légende de chaque pub, par
 * lots, et range : le vrai nom du produit, la recherche fournisseur, la famille, le verdict « vend un
 * produit ou non », le TYPE (physique, digital, saas), la qualité créative de 1 à 5, et le cadre du produit.
 *
 * GRATUIT, décision de l'équipe du 29/10/2026 (« je n'ai pas d'argent pour ça ») : il tourne avec une clé
 * Gemini de la version gratuite (projet SANS facturation), au rythme qu'elle autorise, et s'arrête au
 * premier refus de quota. Il reprend la nuit suivante là où il s'est arrêté (`classe_le`).
 *
 * Pur : la consigne, la lecture contrôlée de la réponse, l'ordre de passage. Verrou : verify-classeur.
 */
import { CATEGORIES_VISIBLES, type CategorieVisible } from './categorie';
import { CONSIGNE_FAMILLE, CONSIGNE_IMAGE, lireNomsProduits, type NomProduit, type PubANommer } from './nom-produit';

export const CLASSEUR = {
  /** Pubs par appel : une image et une légende chacune. */
  lot: 10,
  /** Pubs classées par nuit au plus. */
  maxParNuit: 600,
  /** Minutes de la tâche au plus. */
  minutes: 40,
  /**
   * Pause entre deux appels. La version gratuite limite le nombre d'appels par minute : 7 s tiennent sous
   * 10 par minute, avec de la marge. Un refus de quota (429) arrête la nuit, jamais une relance.
   */
  pauseEntreAppelsMs: 7000,
} as const;

export const QUALITES_CREATIVES = [1, 2, 3, 4, 5] as const;

export interface Classement extends NomProduit {
  type: CategorieVisible | null;
  qualite: number | null;
}

export const CONSIGNE_TYPE =
  '- "type": "physique" for a physical product shipped to the buyer (cosmetics, clothes, phone accessory, kitchen tool, food supplement); "digital" for a digital product sold once (ebook, PDF, online course, training, template); "saas" for software or an app sold as a SUBSCRIPTION or monthly plan (CRM, online shop builder, accounting or school management software, website builder, AI tool). When "vend" is false, give your best guess anyway.';

export const CONSIGNE_QUALITE =
  '- "qualite": the creative quality of the ad from 1 to 5, judged as an e-commerce media buyer: 5 = the product is clearly shown, a strong hook, a visible demonstration or result, a clear offer; 3 = the product is visible but the ad is plain; 1 = the product is hard to see or the ad is confusing. Integer only.';

export function consigneClasseur(pubs: readonly PubANommer[], connues: readonly string[] = []): string {
  const lignes = pubs.map((p, i) => {
    const legende = `${p.titre ? `${p.titre}\n` : ''}${p.texte}`.replace(/\s+/g, ' ').slice(0, 700);
    return `#${i + 1} (image ${i + 1})${p.niche ? ` [${p.niche}]` : ''} ${legende}`;
  });
  return [
    'You see ads posted by online sellers, mostly African. Each item has one image (in the same order) and its caption.',
    'For EACH item, identify the exact product being sold, mainly from the IMAGE, using the caption for brand, size, capacity or material.',
    'Return ONLY a JSON array, one object per item, in order:',
    '[{"i":1,"vend":true,"nom":"...","recherche":"...","famille":"...","type":"physique","qualite":4,"image":"net","cadre":[120,200,880,760]}]',
    '- "vend": false ONLY when the post clearly sells nothing: news, notice, joke, music, personal life, religious content, job offer, school enrolment, real estate, restaurant meal. A seller showing a product with a price, an order or delivery offer is true.',
    '- "nom": the product name in French, 2 to 6 words, like a shop listing title ("Crème éclaircissante au curcuma 50 ml", "Ventilateur solaire rechargeable 16 pouces", "Logiciel de gestion de boutique"). Never the campaign slogan, never the shop name, never a call to action ("Livraison gratuite", "Discuter sur Messenger", "Commandez maintenant"), no emoji, no price, no dash between words.',
    '- "recherche": an English supplier search query for Alibaba, 3 to 8 words, for a physical product only. Empty string for digital and saas.',
    CONSIGNE_FAMILLE,
    CONSIGNE_TYPE,
    CONSIGNE_QUALITE,
    CONSIGNE_IMAGE,
    connues.length ? `Existing product types to reuse whenever they fit: ${connues.join(' | ')}` : '',
    '',
    ...lignes,
  ].join('\n');
}

const typeValide = (v: unknown): CategorieVisible | null => (typeof v === 'string' && (CATEGORIES_VISIBLES as readonly string[]).includes(v) ? (v as CategorieVisible) : null);
const qualiteValide = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

/** Les appels à l'action que le modèle recopie parfois comme « nom » : ce n'est jamais un produit. */
const FAUX_NOMS = /^(livraison|discuter|commande[rz]?|commandez|envoyer|contactez|appelez|achetez|acheter|en savoir|shop now|order|send message|learn more|promo|offre|disponible)\b/i;

/** La réponse du modèle, contrôlée : un objet mal formé ne range rien, un faux nom n'est pas gardé. */
export function lireClassement(brut: unknown, n: number): (Classement | null)[] {
  const noms = lireNomsProduits(brut, n);
  const extra: { type: CategorieVisible | null; qualite: number | null }[] = Array.from({ length: n }, () => ({ type: null, qualite: null }));
  if (Array.isArray(brut)) {
    brut.forEach((x, k) => {
      if (!x || typeof x !== 'object') return;
      const o = x as Record<string, unknown>;
      const i = typeof o.i === 'number' && Number.isInteger(o.i) ? o.i - 1 : k;
      if (i < 0 || i >= n) return;
      extra[i] = { type: typeValide(o.type), qualite: qualiteValide(o.qualite) };
    });
  }
  return noms.map((nom, i) => {
    if (!nom) return null;
    const propre = nom.nom && !FAUX_NOMS.test(nom.nom.trim()) && nom.nom.trim().split(/\s+/).length >= 2 ? nom.nom : null;
    const type = extra[i]!.type;
    return { ...nom, nom: propre, recherche: type === 'physique' ? nom.recherche : null, type, qualite: extra[i]!.qualite };
  });
}

/** Le coût d'une nuit en version gratuite : zéro facturé, l'équivalent payant seulement indiqué. */
export function coutFacture(estimationUsd: number, gratuit: boolean): number {
  return gratuit ? 0 : Math.round(estimationUsd * 10_000) / 10_000;
}
