/**
 * Une réponse de la bibliothèque publique Meta -> des lignes Pub Track.
 *
 * Fonction PURE, sans réseau : `verify-pub-track.ts` l'exécute sur un
 * échantillon. Le format de Meta n'est pas documenté et change : au lieu de
 * suivre un chemin fixe (data.ad_library_main.search_results_connection...),
 * on PARCOURT tout le JSON et on garde chaque objet qui porte `ad_archive_id`
 * et `snapshot`. Un déplacement de la liste dans l'arbre ne casse rien ; un
 * renommage des champs, lui, change l'empreinte de schéma, et le collecteur
 * s'arrête au lieu d'écrire des lignes vides.
 */
import { boutiqueCle, destinationDe, domaineDe } from '../../lib/pub-track/destination';
import { devinerLangue, type Langue } from '../../lib/pub-track/langue';
import { devinerNiche, type Niche } from '../../lib/pub-track/niches';
import type { Destination } from '../../lib/pub-track/destination';
import type { FormatPub, Reseau } from '../../lib/pub-track/types';
import { categoriePub, type CategoriePub } from '../../lib/pub-track/categorie';
import { offresDe, prixFcfa, type Offre } from '../../lib/pub-track/offre';

type Brut = Record<string, unknown>;

export interface LignePub {
  source: 'meta' | 'tiktok';
  id_source: string;
  annonceur_id: string;
  annonceur_nom: string;
  annonceur_avatar: string | null;
  texte: string;
  titre: string;
  appel_action: string;
  lien: string | null;
  domaine: string | null;
  destination: Destination;
  boutique_cle: string | null;
  format: FormatPub;
  duree_video_s: number | null;
  video_url: string | null;
  reseaux: Reseau[];
  pays: string[];
  langue: Langue | null;
  niche: Niche;
  type_produit: 'physique' | 'digital';
  categorie: CategoriePub;
  prix_fcfa: number | null;
  offres: Offre[];
  /** La recherche qui a ramené la pub (pays et mots), posée par le collecteur : il apprend ce qui rapporte. */
  requete?: string;
  /** TikTok seulement : la vidéo porte la marque publicitaire de TikTok (`is_ad`). */
  sponsorisee?: boolean;
  /** 'occident' pour une pub lue en Occident (« Tendance occidentale », 093) ; absent = Afrique. */
  marche?: 'afrique' | 'occident';
  /** Meta seulement : les abonnés de la page de l'annonceur au moment de la lecture (091). */
  annonceur_abonnes?: number | null;
  /** TikTok seulement : les chiffres de la vidéo au moment de la lecture (migration 087). */
  vues?: number | null;
  likes?: number | null;
  partages?: number | null;
  commentaires?: number | null;
  active: boolean;
  date_debut: string | null;
  date_fin: string | null;
  groupe_cle: string | null;
  /**
   * Meta seulement : le regroupement de la bibliothèque (« N publicités utilisent ce contenu », 116). Meta
   * n'en affiche qu'une pub : la passe de vérification ne déclare pas arrêtée une pub cachée derrière une sœur.
   */
  collation_id?: string | null;
  variantes_source: number;
  /** Pas une colonne : l'adresse fbcdn de l'aperçu, que le collecteur recopie. */
  apercu_source: string | null;
}

/** Les champs dont l'absence signale un changement de format chez Meta. */
export const CHAMPS_ATTENDUS = ['ad_archive_id', 'page_id', 'page_name', 'snapshot', 'start_date', 'is_active'] as const;

/**
 * Un texte que Postgres accepte : sans octet nul ni moitié d'émoji. Meta en
 * envoie, et couper un texte au milieu d'un émoji en fabrique ; la base refuse
 * alors TOUT le lot (« invalid input syntax for type json », 07/10/2026).
 */
export function textePropre(v: string): string {
  return v.replace(/\u0000/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}
const texte = (v: unknown): string => textePropre(typeof v === 'string' ? v : '').trim();
const couper = (v: string, max: number) => textePropre(v.slice(0, max));
const objet = (v: unknown): Brut | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Brut) : null);
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Meta préfixe parfois ses réponses par `for (;;);` et en envoie plusieurs par ligne. */
export function lireJsons(corps: string): unknown[] {
  const propre = corps.replace(/^for \(;;\);/, '');
  const sortie: unknown[] = [];
  for (const ligne of propre.split('\n')) {
    const l = ligne.trim();
    if (!l.startsWith('{') && !l.startsWith('[')) continue;
    try {
      sortie.push(JSON.parse(l));
    } catch {
      /* une ligne illisible n'arrête pas les autres */
    }
  }
  return sortie;
}

/** Tous les objets « pub » de l'arbre, où qu'ils soient. */
export function trouverPubsBrutes(racine: unknown, sortie: Brut[] = [], profondeur = 0): Brut[] {
  if (profondeur > 40 || !racine || typeof racine !== 'object') return sortie;
  if (Array.isArray(racine)) {
    for (const x of racine) trouverPubsBrutes(x, sortie, profondeur + 1);
    return sortie;
  }
  const o = racine as Brut;
  if (typeof o.ad_archive_id === 'string' || typeof o.ad_archive_id === 'number') {
    if (objet(o.snapshot)) {
      sortie.push(o);
      return sortie;
    }
  }
  for (const v of Object.values(o)) trouverPubsBrutes(v, sortie, profondeur + 1);
  return sortie;
}

export function empreinteSchema(pubs: Brut[]): string {
  const cles = new Set<string>();
  for (const p of pubs.slice(0, 20)) for (const c of Object.keys(p)) cles.add(c);
  return [...cles].sort().join(',');
}

export function schemaConnu(pubs: Brut[]): boolean {
  if (pubs.length === 0) return true;
  return pubs.slice(0, 20).every((p) => CHAMPS_ATTENDUS.every((c) => c in p));
}

const RESEAUX_META: Record<string, Reseau> = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  MESSENGER: 'messenger',
  AUDIENCE_NETWORK: 'audience_network',
  WHATSAPP: 'whatsapp',
  THREADS: 'threads',
};

function dateDepuisUnix(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function formatDe(snap: Brut, cartes: Brut[]): FormatPub {
  const d = texte(snap.display_format).toUpperCase();
  // DCO = pub dynamique : plusieurs cartes, mais le vendeur en voit une seule à la fois.
  if (d === 'CAROUSEL' || (d !== 'DCO' && cartes.length > 1)) return 'carrousel';
  if (d === 'VIDEO' || liste(snap.videos).length > 0 || cartes.some((c) => c.video_hd_url || c.video_sd_url)) return 'video';
  return 'image';
}

function premierMedia(snap: Brut, cartes: Brut[]): { video: string | null; apercu: string | null } {
  const videos = liste(snap.videos).map(objet).filter((x): x is Brut => !!x);
  const images = liste(snap.images).map(objet).filter((x): x is Brut => !!x);
  const v = videos[0] ?? cartes.find((c) => c.video_hd_url || c.video_sd_url) ?? null;
  const video = v ? texte(v.video_hd_url) || texte(v.video_sd_url) || null : null;
  const apercu =
    (v && texte(v.video_preview_image_url)) ||
    texte(images[0]?.resized_image_url) ||
    texte(images[0]?.original_image_url) ||
    texte(cartes[0]?.resized_image_url) ||
    texte(cartes[0]?.original_image_url) ||
    texte(cartes[0]?.video_preview_image_url) ||
    null;
  return { video, apercu };
}

const GABARIT = /\{\{[^}]+\}\}/;

/**
 * Le nom du fichier média (sans les paramètres signés, qui changent à chaque
 * lecture). Deux pubs d'une même page qui montrent le même fichier sont la
 * même créative republiée : c'est la « réutilisation », un signal fort.
 */
export function fichierMedia(u: string | null): string | null {
  if (!u) return null;
  try {
    const nom = new URL(u).pathname.split('/').pop() ?? '';
    return nom.length >= 8 ? nom : null;
  } catch {
    return null;
  }
}

const TERMES_DIGITAL = ['formation', 'ebook', 'cours en ligne', 'masterclass', 'webinaire', 'coaching', 'application', 'logiciel', 'abonnement', 'online course', 'training'];

export function versLigne(brut: Brut, pays: string): LignePub | null {
  const snap = objet(brut.snapshot);
  const id = texte(String(brut.ad_archive_id ?? ''));
  if (!snap || !id) return null;
  const cartes = liste(snap.cards).map(objet).filter((x): x is Brut => !!x);
  const corps = objet(snap.body);
  // Meta remplace le texte d'une pub dynamique par un gabarit « {{product.brand}} » :
  // on prend alors celui de la première carte, et on n'affiche jamais un gabarit.
  const sansGabarit = (...v: unknown[]) => v.map(texte).find((t) => t && !GABARIT.test(t)) ?? '';
  const texteFinal = sansGabarit(corps?.text, cartes[0]?.body);
  const titre = sansGabarit(snap.title, cartes[0]?.title);
  const lien = texte(snap.link_url) || texte(cartes[0]?.link_url) || null;
  const appel = texte(snap.cta_text);
  const destination = destinationDe(lien, appel);
  const { video, apercu } = premierMedia(snap, cartes);
  const format = formatDe(snap, cartes);
  const niche = devinerNiche(texteFinal, titre, domaineDe(lien));
  const motsTexte = `${texteFinal} ${titre}`.toLowerCase();
  const digital = niche === 'digital' || TERMES_DIGITAL.some((t) => new RegExp(`\\b${t}\\b`).test(motsTexte));
  const duree = Number(objet(liste(snap.videos)[0])?.video_duration ?? NaN);
  const domaine = destination === 'boutique' ? domaineDe(lien) : null;
  const cleBoutique = boutiqueCle(destination, lien, texteFinal);
  const langue = devinerLangue(texteFinal);
  const collation = Number(brut.collation_count);

  return {
    source: 'meta',
    id_source: id,
    annonceur_id: texte(String(brut.page_id ?? '')),
    annonceur_nom: texte(brut.page_name) || texte(snap.page_name),
    annonceur_avatar: texte(snap.page_profile_picture_url) || null,
    texte: couper(texteFinal, 4000),
    titre: couper(titre, 300),
    appel_action: couper(appel, 60),
    lien,
    domaine,
    destination,
    boutique_cle: cleBoutique,
    format,
    duree_video_s: Number.isFinite(duree) && duree > 0 ? Math.round(duree) : null,
    video_url: video,
    reseaux: [...new Set(liste(brut.publisher_platform).map((r) => RESEAUX_META[texte(r).toUpperCase()]).filter(Boolean))],
    pays: [pays.toUpperCase()],
    langue,
    niche,
    type_produit: digital ? 'digital' : 'physique',
    categorie: categoriePub({ texte: texteFinal, titre, appelAction: appel, domaine, lien, destination, boutiqueCle: cleBoutique, langue, niche, annonceur: texte(brut.page_name) || texte(snap.page_name) }),
    prix_fcfa: prixFcfa(`${texteFinal} ${titre}`),
    offres: offresDe(`${texteFinal} ${titre}`),
    active: brut.is_active !== false,
    date_debut: dateDepuisUnix(brut.start_date),
    date_fin: brut.is_active === false ? dateDepuisUnix(brut.end_date) : null,
    groupe_cle: groupeCle(texte(String(brut.page_id ?? '')), fichierMedia(video) ?? fichierMedia(apercu), brut.collation_id, id),
    collation_id: brut.collation_id != null && texte(String(brut.collation_id)) ? texte(String(brut.collation_id)) : null,
    variantes_source: Number.isFinite(collation) && collation > 0 ? Math.round(collation) : 1,
    apercu_source: apercu,
    // Les abonnés de la page (10/10/2026) : la bibliothèque les donne avec chaque pub, on les jetait.
    annonceur_abonnes: abonnesPage(snap.page_like_count),
  };
}

/** Un nombre d'abonnés plausible, ou null : jamais un zéro inventé quand la donnée manque. */
export function abonnesPage(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function groupeCle(pageId: string, fichier: string | null, collation: unknown, id: string): string {
  if (pageId && fichier) return `meta:${pageId}:${fichier}`;
  return collation ? `meta:c:${texte(String(collation))}` : `meta:${id}`;
}

/** Fusionne une pub vue dans plusieurs pays : on garde l'union des pays. */
export function fusionner(a: LignePub, b: LignePub): LignePub {
  return { ...a, pays: [...new Set([...a.pays, ...b.pays])].sort(), variantes_source: Math.max(a.variantes_source, b.variantes_source) };
}
