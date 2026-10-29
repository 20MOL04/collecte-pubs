/**
 * Types partagés de Pub Track, client et serveur.
 *
 * Ce que l'écran reçoit des routes `/api/pub-track/*`. Aucune URL signée,
 * aucune donnée de vendeur : ce sont des pubs publiques.
 */
import type { Destination } from './destination';
import type { Langue } from './langue';
import type { Niche } from './niches';
import type { Technologie } from './technologie';
import { SEUILS_PUB, type StatutPub } from './score';

export const SOURCES_PUB = ['meta', 'tiktok'] as const;
export type SourcePub = (typeof SOURCES_PUB)[number];

export const FORMATS_PUB = ['video', 'image', 'carrousel'] as const;
export type FormatPub = (typeof FORMATS_PUB)[number];

export const RESEAUX = ['facebook', 'instagram', 'messenger', 'audience_network', 'whatsapp', 'threads', 'tiktok'] as const;
export type Reseau = (typeof RESEAUX)[number];

export type TypeProduit = import('./categorie').CategorieVisible;

/** Sans abonnement, le vendeur voit ce nombre de pubs ; le reste est verrouillé (décision du 07/10/2026). */
/**
 * Sans abonnement (décision du équipe, 10/10/2026) : 8 pubs, soit deux rangées, puis UNE rangée
 * de cartes verrouillées, puis le bandeau d'abonnement. Avant : 10 pubs et jusqu'à 12 cadenas.
 */
export const PUBS_GRATUITES = 8;
export const PUBS_VERROUILLEES = 4;

/**
 * La page « Gagnantes » (10/10/2026, sur le modèle du « Top Trend » d'AfriSpy), classée par score. Sans
 * abonnement : les 3 premières, puis des lignes floutées FACTICES (aucune donnée réelle n'est envoyée au
 * navigateur). Depuis le lot 4 de la v2 (29/10/2026), une gagnante est une pub PROUVÉE : le statut est
 * calculé chaque nuit (`statutPub`, score.ts) et rangé en base (`statut_pt`, migration 118). Le seuil vient
 * de `SEUILS_PUB`, jamais recopié.
 */
export const SCORE_GAGNANTE = SEUILS_PUB.gagnante.scoreMin;
/**
 * Ce qui entre dans « Gagnantes » (15/10/2026) : des PRODUITS PHYSIQUES africains, la meilleure
 * carte de chaque annonceur, et un même texte publié par plusieurs pages une seule fois. Mesure sur la vraie base : les guides de MELBO STORE et de Digital
 * Commerce Place (score 84 à 88) tenaient le haut, et Gadgets shop y avait six cartes. Le digital
 * a son onglet dans la grille (`type=digital`), les services n'entrent nulle part.
 */
export const FILTRE_GAGNANTES = { statut_pt: 'gagnante', marche: 'afrique', categorie: 'physique', rang_annonceur: 1, rang_texte: 1 } as const;
export const GAGNANTES_GRATUITES = 3;
export const GAGNANTES_FLOUTEES = 8;

/** La carte d'une pub qui entre dans « Gagnantes » se distingue dans la grille : le statut rangé en base, une seule règle. */
export function estGagnante(pub: Pick<PubTrack, 'active' | 'statut'>): boolean {
  return pub.active && pub.statut === 'gagnante';
}

export interface PubTrack {
  id: string;
  source: SourcePub;
  idSource: string;
  annonceur: { id: string; nom: string; avatar: string | null };
  annonceurPubsActives: number;
  annonceurPubsTotal: number;
  /** Meta : les abonnés de la page, lus dans la bibliothèque publicitaire (091), ou null. */
  annonceurAbonnes: number | null;
  boutique: { nom: string; technologie: Technologie | null; pubsActives: number; variation7j: number | null } | null;
  texte: string;
  titre: string;
  appelAction: string;
  lien: string | null;
  domaine: string | null;
  destination: Destination;
  boutiqueCle: string | null;
  format: FormatPub;
  dureeVideoS: number | null;
  miniature: string | null;
  videoUrl: string | null;
  reseaux: Reseau[];
  pays: string[];
  langue: Langue | null;
  niche: Niche;
  typeProduit: TypeProduit;
  active: boolean;
  dateDebut: string | null;
  dateFin: string | null;
  joursActifs: number;
  variantes: number;
  score: number;
  scorePhrase: string;
  /** Lot 4 : gagnante, montante, nouvelle, ou null (statut prouvé, calculé chaque nuit). */
  statut: StatutPub | null;
  /** Lot 2 : la dernière vérification de la page annonceur, ou null si jamais vérifiée. */
  verifieeLe: string | null;
  /** Lot 3 : la qualité créative de 1 à 5 jugée par le classeur, ou null. */
  qualiteCreative: number | null;
  /** Lot 4 : pages qui publient le même texte ou le même visuel (un réseau), 1 si la page est seule. */
  reseauPages: number;
  /** Le type générique du produit posé par le classeur IA (088), la clé « un produit » entre vendeurs. */
  famille: string | null;
  /** Lot 6, pubs occidentales seulement : le même produit est-il déjà vendu en Afrique ? */
  pont: 'deja_en_test' | 'pas_encore' | null;
  /** Les leviers d'offre lus dans le texte : paiement à la livraison, livraison gratuite, promo, lot (081). */
  offres: import('./offre').Offre[];
  /** Le prix lu dans le texte, ramené en FCFA (lib/pub-track/offre.ts), ou null. */
  prixFcfa: number | null;
  /** Le nom du produit vu sur l image par le modèle de vision (086), ou null tant qu il n est pas nommé. */
  produitNom: string | null;
  /** La requête anglaise pour Alibaba ; null pour un produit digital. */
  produitRecherche: string | null;
  /** TikTok : la vidéo porte la marque publicitaire de TikTok. */
  sponsorisee: boolean;
  /** TikTok : les chiffres de la vidéo et la croissance des vues depuis le relevé précédent (087). */
  stats: { vues: number; likes: number | null; partages: number | null; commentaires: number | null; croissance: number | null } | null;
}

export interface BoutiquePubTrack {
  cle: string;
  nom: string;
  logo: string | null;
  technologie: Technologie;
  destination: Destination;
  pays: string[];
  niche: Niche;
  pubsActives: number;
  variation7j: number | null;
  variation30j: number | null;
  premierePub: string | null;
  dernierePub: string | null;
  apercus: string[];
  /** Toutes ses pubs connues, actives ou non (Minea : « 235 actives / 613 total »). */
  pubsTotal?: number;
  /** La part de ses pubs par pays, la plus forte d'abord (à la place du « trafic par pays » de Minea). */
  partsPays?: { code: string; part: number }[];
  /** Pubs actives jour par jour sur 30 jours (`null` : jour sans relevé). */
  courbe?: (number | null)[];
}

export interface AnnonceurPubTrack {
  source: SourcePub;
  pageId: string;
  nom: string;
  avatar: string | null;
  lienPage: string | null;
  pays: string[];
  pubsActives: number;
  variation7j: number | null;
  variation30j: number | null;
  boutiques: string[];
  /** Pubs actives jour par jour sur 30 jours (`null` : jour sans relevé). */
  courbe?: (number | null)[];
}

/** Un compteur de filtre : « Shopify 25 090 ». */
export interface Compteur {
  valeur: string;
  nombre: number;
}

export interface PagePubs {
  pubs: PubTrack[];
  total: number;
  suivant: string | null;
  /** Cartes verrouillées à montrer après les pubs gratuites (aucune donnée réelle). */
  verrouillees: number;
  /** Sans abonnement seulement : combien de gagnantes (score ≥ SCORE_GAGNANTE) restent cachées. */
  gagnantes?: number;
  toutVoir: boolean;
  compteurs?: Partial<Record<'pays' | 'niche' | 'destination' | 'format', Compteur[]>>;
}

export interface DetailPub {
  pub: PubTrack;
  apercus: { id: string; miniature: string }[];
  toutVoir: boolean;
}

/** Lien public vers la pub à sa source : la bibliothèque Meta, ou sa fiche du TikTok Creative Center. */
/**
 * L'identifiant de la vidéo TikTok d'un vendeur (`v<id>`, ScrapeCreators), ou null pour une pub
 * Meta ou un « Top Ad » du Creative Center (dont l'identifiant n'est pas celui d'une vidéo).
 */
export function idVideoTikTok(pub: Pick<PubTrack, 'source' | 'idSource'>): string | null {
  return pub.source === 'tiktok' && /^v\d+$/.test(pub.idSource) ? pub.idSource.slice(1) : null;
}

/**
 * Le lecteur OFFICIEL de TikTok (09/10/2026) : l'adresse MP4 d'une vidéo TikTok expire en ~24 h
 * (celles du matin renvoyaient déjà 403 le soir). Le lecteur intégré, lui, n'expire jamais, et
 * c'est TikTok qui sert la vidéo : aucun octet ne passe par nos serveurs.
 */
export function lecteurTikTok(id: string): string {
  const p = new URLSearchParams({
    autoplay: '1', loop: '1', controls: '1', progress_bar: '1', play_button: '1', volume_control: '1',
    fullscreen_button: '0', music_info: '0', description: '0', rel: '0', native_context_menu: '0', closed_caption: '0',
  });
  return `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?${p.toString()}`;
}

export function lienBibliotheque(pub: Pick<PubTrack, 'source' | 'idSource' | 'annonceur'>): string {
  const video = idVideoTikTok(pub);
  if (video) {
    const pseudo = pub.annonceur.id.startsWith('tt:@') ? pub.annonceur.id.slice(4) : '';
    return pseudo ? `https://www.tiktok.com/@${encodeURIComponent(pseudo)}/video/${video}` : `https://www.tiktok.com/embed/v2/${video}`;
  }
  return pub.source === 'tiktok'
    ? `https://ads.tiktok.com/business/creativecenter/topads/${encodeURIComponent(pub.idSource)}/pc/en`
    : `https://www.facebook.com/ads/library/?id=${encodeURIComponent(pub.idSource)}`;
}
