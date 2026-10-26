/**
 * Une vidéo TikTok de vendeur (recherche par mot-clé de ScrapeCreators) -> une ligne
 * Pub Track (décision de l'équipe, 09/10/2026 : « les vidéos promues, c'est ce que les
 * concurrents suivent »).
 *
 * En Afrique, le vendeur BOOSTE sa vidéo (« Promouvoir ») au lieu d'acheter une pub
 * classique, et aucune bibliothèque publique ne montre ces vidéos. On cherche donc, pays
 * par pays, les vidéos qui VENDENT : publiées depuis un pays africain (`region`, le pays
 * de celui qui publie), avec un signe de vente dans la légende (prix, commande,
 * livraison, WhatsApp), et assez vues pour compter. Boostée ou pas, c'est celle qui vend.
 *
 * Fonction PURE, sans réseau : `verify-pub-track.ts` l'exécute sur un échantillon.
 */
import { boutiqueCle } from '../../lib/pub-track/destination';
import { devinerLangue } from '../../lib/pub-track/langue';
import { devinerNiche } from '../../lib/pub-track/niches';
import { categoriePub } from '../../lib/pub-track/categorie';
import { offresDe, prixFcfa } from '../../lib/pub-track/offre';
import { PAYS_PUB_TRACK } from '../../lib/pub-track/pays';
import { textePropre, type LignePub } from './analyser-reponse';

type Brut = Record<string, unknown>;

const AFRICAINS = new Set(PAYS_PUB_TRACK.map((p) => p.code));
/** En dessous, une vidéo n'a encore rien prouvé : elle ne montre pas un produit qui marche. */
export const VUES_MINIMUM = 2_000;

const compte = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const texte = (v: unknown): string => textePropre(typeof v === 'string' ? v : '').trim();
const objet = (v: unknown): Brut | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Brut) : null);
const premiere = (v: unknown): string | null => {
  const l = objet(v)?.url_list;
  return Array.isArray(l) && typeof l[0] === 'string' ? l[0] : null;
};

/** Les champs dont l'absence signale un changement de format chez ScrapeCreators. */
export const CHAMPS_VIDEO_TIKTOK = ['aweme_id', 'desc', 'region', 'statistics', 'author'] as const;

export function schemaVideoTikTokConnu(items: readonly Brut[]): boolean {
  return items.length === 0 || items.every((i) => CHAMPS_VIDEO_TIKTOK.every((c) => c in i));
}

/**
 * Une vidéo n'est un produit que si sa légende VEND : un prix, un WhatsApp, ou un mot de
 * commande. « delivery » seul ne suffit pas : le 09/10/2026, « the delivery of our twin
 * babies » (un accouchement) passait pour un produit.
 */
const SIGNE_VENTE =
  /(^|[^\p{L}])(command(e[rz]?|ez)|order(\s+now)?|dm\s+(to|for)\s+order|disponibles?|available|en\s+stock|in\s+stock|livraison\s+(gratuite|partout|disponible)|free\s+delivery|pay\s+on\s+delivery|paiement\s+(à|a)\s+la\s+livraison|prix|price)($|[^\p{L}])/iu;

/** Un numéro ou un lien WhatsApp dans la légende : le vendeur prend ses commandes par message. */
const SIGNE_WHATSAPP = /wa\.me\/|whatsapp|\+\s?2\d{2}[\s.-]?\d{2}/i;

export function versLigneVideoTikTok(item: Brut): LignePub | null {
  // La recherche renvoie parfois l'objet enveloppé (`aweme_info`), parfois à plat.
  const v = objet(item.aweme_info) ?? item;
  const id = texte(String(v.aweme_id ?? ''));
  const region = texte(v.region).toUpperCase();
  if (!id || !AFRICAINS.has(region)) return null;
  const stats = objet(v.statistics);
  const vues = Number(stats?.play_count ?? 0);
  if (!Number.isFinite(vues) || vues < VUES_MINIMUM) return null;
  const legende = texte(v.desc);
  if (!legende) return null;
  const auteur = objet(v.author);
  const pseudo = texte(auteur?.unique_id);
  const nom = texte(auteur?.nickname) || (pseudo ? `@${pseudo}` : '');
  const video = objet(v.video);
  const destination = SIGNE_WHATSAPP.test(legende) ? 'message_whatsapp' : 'inconnue';
  const cle = boutiqueCle(destination, null, legende);
  const langue = devinerLangue(legende);
  const niche = devinerNiche(legende, '', null);
  const creation = Number(v.create_time);
  const duree = Number(video?.duration);
  const lien = texte(v.url) || (pseudo ? `https://www.tiktok.com/@${pseudo}/video/${id}` : null);
  const categorie = categoriePub({
    texte: legende, titre: '', appelAction: '', domaine: null, lien: null, destination, boutiqueCle: cle, langue, niche,
    annonceur: nom, cibleAfricaine: true, exigeVente: true,
  });
  const vend = prixFcfa(legende) !== null || destination === 'message_whatsapp' || SIGNE_VENTE.test(legende) || /[₦₵]|(^|[^\p{L}])(ksh|kes|naira|cedis|fcfa|cfa|gnf|dh|dt)($|[^\p{L}])|\d\s?f($|[^\p{L}])/iu.test(legende);
  return {
    source: 'tiktok',
    id_source: `v${id}`,
    annonceur_id: pseudo ? `tt:@${pseudo.toLowerCase()}` : `tt:video:${id}`,
    annonceur_nom: nom,
    annonceur_avatar: premiere(auteur?.avatar_thumb) ?? premiere(auteur?.avatar_medium),
    texte: legende.slice(0, 4000),
    titre: '',
    appel_action: '',
    lien,
    domaine: null,
    destination,
    boutique_cle: cle,
    format: 'video',
    // TikTok donne la durée en millisecondes dans `video.duration`.
    duree_video_s: Number.isFinite(duree) && duree > 0 ? Math.round(duree > 1000 ? duree / 1000 : duree) : null,
    video_url: premiere(video?.play_addr) ?? premiere(video?.download_addr),
    reseaux: ['tiktok'],
    pays: [region],
    langue,
    niche,
    type_produit: niche === 'digital' ? 'digital' : 'physique',
    categorie: (categorie === 'physique' || categorie === 'digital') && !vend ? 'hors_cible' : categorie,
    prix_fcfa: prixFcfa(legende),
    offres: offresDe(legende),
    active: true,
    date_debut: Number.isFinite(creation) && creation > 0 ? new Date(creation * 1000).toISOString().slice(0, 10) : null,
    date_fin: null,
    groupe_cle: `tiktok:v${id}`,
    variantes_source: 1,
    apercu_source: premiere(video?.cover) ?? premiere(video?.origin_cover),
    // TikTok ne dit JAMAIS publiquement qu'une vidéo a été boostée (« Promouvoir ») ; `is_ad` ne marque
    // que ses formats publicitaires. Vrai seulement quand TikTok l'écrit, jamais deviné.
    sponsorisee: v.is_ad === true,
    vues: Math.round(vues),
    likes: compte(stats?.digg_count),
    partages: compte(stats?.share_count),
    commentaires: compte(stats?.comment_count),
  };
}
