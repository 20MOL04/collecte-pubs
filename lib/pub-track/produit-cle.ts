/**
 * Un produit, une carte (15/10/2026).
 *
 * La vitrine regroupait déjà les copies d'une pub par annonceur et par les 100 premiers
 * caractères du texte (093). Une variante qui ajoute trois mots en tête (« Comme Gaëlle,
 * reprenez le contrôle… » contre « Reprenez le contrôle… ») ou change un emoji passait pour
 * un autre produit, et le haut du classement se remplissait du même article. `groupe_cle`
 * n'y peut rien : Meta le pose par FICHIER (une vidéo, une image), pas par produit.
 *
 * Ici : chez un même annonceur, deux pubs dont les mots porteurs se recouvrent assez
 * (indice de Jaccard ≥ `SEUIL_MEME_PRODUIT`) vendent le même produit. Les mots de la vente
 * (livraison, commande, WhatsApp, prix) et les nombres ne comptent pas : ils sont les mêmes
 * pour tous les produits d'une boutique. Le résultat, `produit_cle`, est posé chaque nuit par
 * le collecteur ; la vitrine garde la meilleure variante et compte les autres.
 */
import { mots } from './texte';

export const SEUIL_MEME_PRODUIT = 0.5;
const MOTS_MAX = 60;
const MOTS_MIN = 3;

const VIDES = new Set(
  (
    'avec pour dans vous votre vos nous notre nos plus tout tous toute toutes sans sont etre avoir cette ceci cela elle elles ils leur leurs ' +
    'mais comme donc aussi tres bien fait faire peut deja encore jamais rien chaque entre apres avant depuis chez sous sur vers ' +
    'livraison livre livrer gratuite gratuit partout domicile paiement commande commander commandez commandes contact contactez appel appelez ' +
    'whatsapp messenger message inbox prix promo promotion offre offert stock disponible disponibles maintenant aujourd hui vite rapide ' +
    'seulement only with your from this that have will just more what when where which free delivery shipping order now shop today ' +
    'available price call send click link here limited best quality high garantie qualite original originale authentique client clients ' +
    'fcfa franc francs cfa naira cedis'
  ).split(' '),
);

/** Les mots porteurs d'une pub : au moins 4 lettres, ni nombre ni mot de la vente. */
export function motsPorteurs(texte: string): Set<string> {
  const sortie = new Set<string>();
  for (const m of mots(texte)) {
    if (m.length < 4 || /\d/.test(m) || VIDES.has(m)) continue;
    sortie.add(m);
    if (sortie.size >= MOTS_MAX) break;
  }
  return sortie;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let commun = 0;
  for (const m of a) if (b.has(m)) commun += 1;
  return commun / (a.size + b.size - commun);
}

/**
 * Retire la formule de la boutique : les mots présents dans plus de la moitié de ses textes
 * DIFFÉRENTS (« on te livre avant que tu payes, Douala et Yaoundé »). Sans ça, une armoire et
 * une salle à manger du même vendeur se ressemblaient par leur pied de pub, pas par leur produit.
 * Une boutique d'un seul produit perd aussi ses mots produit : ses variantes ne fusionnent pas
 * plus qu'avant, elles ne fusionnent jamais à tort.
 */
function sansFormuleDeBoutique(liste: { id: string; mots: Set<string> }[]): { id: string; mots: Set<string> }[] {
  const textes = new Map<string, Set<string>>();
  for (const p of liste) textes.set([...p.mots].sort().join(' '), p.mots);
  if (textes.size < FORMULE_TEXTES_MIN) return liste;
  const df = new Map<string, number>();
  for (const m of textes.values()) for (const w of m) df.set(w, (df.get(w) ?? 0) + 1);
  // Une grande boutique (beaucoup de textes) a forcément plusieurs produits : le seuil y est plus bas.
  const part = textes.size >= FORMULE_TEXTES_GRANDE ? FORMULE_PART_GRANDE : FORMULE_PART;
  const formule = new Set([...df].filter(([, n]) => n / textes.size > part).map(([w]) => w));
  return liste.map((p) => ({ id: p.id, mots: new Set([...p.mots].filter((w) => !formule.has(w))) }));
}
const FORMULE_TEXTES_MIN = 4;
const FORMULE_PART = 0.75;
const FORMULE_TEXTES_GRANDE = 8;
const FORMULE_PART_GRANDE = 0.3;

/**
 * Même produit : les mots porteurs se recouvrent (Jaccard ≥ `SEUIL_MEME_PRODUIT`), ou la plus
 * courte des deux pubs est contenue aux trois cinquièmes dans l'autre, sur six mots au moins
 * (une accroche longue devant la même description : « Les enfants partent à l'école… Avec ce
 * cuiseur à œufs… » contre « C'est la rentrée ! Avec ce cuiseur à œufs… »).
 */
export function memeProduit(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (jaccard(a, b) >= SEUIL_MEME_PRODUIT) return true;
  let commun = 0;
  for (const m of a) if (b.has(m)) commun += 1;
  return commun >= COMMUNS_MIN && commun / Math.min(a.size, b.size) >= INCLUSION_MIN;
}
const COMMUNS_MIN = 6;
const INCLUSION_MIN = 0.6;

export interface PubACleProduit {
  id: string;
  source: string;
  annonceurId: string | null;
  texte: string;
  titre?: string | null;
}

/**
 * La clé produit de chaque pub : `source:annonceur:id` de la pub qui mène son groupe (la plus riche en mots).
 * Une pub sans annonceur, ou sans assez de mots porteurs, n'en reçoit pas (`null`) : la vitrine
 * retombe alors sur l'empreinte du texte.
 */
export function clesProduit(pubs: readonly PubACleProduit[]): Map<string, string | null> {
  const sortie = new Map<string, string | null>();
  const parAnnonceur = new Map<string, { id: string; mots: Set<string> }[]>();
  for (const p of pubs) {
    const m = motsPorteurs(`${p.texte} ${p.titre ?? ''}`);
    if (!p.annonceurId || m.size < MOTS_MIN) {
      sortie.set(p.id, null);
      continue;
    }
    const cle = `${p.source}:${p.annonceurId}`;
    const liste = parAnnonceur.get(cle) ?? [];
    liste.push({ id: p.id, mots: m });
    parAnnonceur.set(cle, liste);
  }
  for (const [annonceur, brute] of parAnnonceur) {
    const liste = sansFormuleDeBoutique(brute).filter((p) => {
      if (p.mots.size >= MOTS_MIN) return true;
      sortie.set(p.id, null);
      return false;
    });
    // Regroupement par MENEUR, pas en chaîne : une pub rejoint un groupe si elle ressemble à sa
    // première pub. En chaîne, une pub presque vide (la formule seule) reliait tous les produits.
    const meneurs: { id: string; mots: Set<string> }[] = [];
    // Les pubs les plus riches mènent : une pub réduite à la formule ne doit pas devenir le centre d un groupe.
    for (const p of [...liste].sort((a, b) => b.mots.size - a.mots.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const meneur = meneurs.find((m) => memeProduit(m.mots, p.mots));
      if (!meneur) meneurs.push(p);
      sortie.set(p.id, `${annonceur}:${(meneur ?? p).id}`);
    }
  }
  return sortie;
}
