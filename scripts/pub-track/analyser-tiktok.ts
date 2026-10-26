/**
 * Une pub du TikTok Creative Center (« Top Ads ») -> une ligne Pub Track
 * (lot 7 du cahier, lancé le 09/10/2026).
 *
 * Fonction PURE, sans réseau : `verify-pub-track.ts` l'exécute sur un
 * échantillon. Deux sources par pub : l'élément de la LISTE (titre, vidéo,
 * likes, taux de clic) et sa FICHE (pays ciblés, page d'arrivée, partages).
 * Sans fiche, on ne sait ni où va la pub ni à qui elle s'adresse : elle n'est
 * pas écrite.
 *
 * Ce que TikTok ne donne pas, on ne l'invente pas : aucune date de lancement
 * (le Creative Center montre les meilleures pubs des 30 derniers jours), aucun
 * nom de page quand la marque est vide.
 *
 * Les vidéos « boostées » (Promouvoir) n'y figurent pas : TikTok ne les publie
 * dans aucune bibliothèque publique.
 */
import { boutiqueCle, destinationDe, domaineDe } from '../../lib/pub-track/destination';
import { devinerLangue } from '../../lib/pub-track/langue';
import { devinerNiche } from '../../lib/pub-track/niches';
import { categoriePub, cibleTikTok } from '../../lib/pub-track/categorie';
import { offresDe, prixFcfa } from '../../lib/pub-track/offre';
import { PAYS_PUB_TRACK } from '../../lib/pub-track/pays';
import { textePropre, type LignePub } from './analyser-reponse';

type Brut = Record<string, unknown>;

const AFRICAINS = new Set(PAYS_PUB_TRACK.map((p) => p.code));
const texte = (v: unknown): string => textePropre(typeof v === 'string' ? v : '').trim();
const objet = (v: unknown): Brut | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Brut) : null);
const couper = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Les champs dont l'absence signale un changement de format chez TikTok. */
export const CHAMPS_TIKTOK = ['id', 'ad_title', 'video_info', 'like', 'ctr'] as const;

export function schemaTikTokConnu(elements: readonly Brut[]): boolean {
  return elements.length === 0 || elements.every((e) => CHAMPS_TIKTOK.every((c) => c in e));
}

/** L'objectif de campagne, lu comme un bouton d'action. */
const APPELS: Record<string, string> = {
  campaign_objective_conversion: 'Acheter',
  campaign_objective_product_sales: 'Acheter',
  campaign_objective_traffic: 'En savoir plus',
  campaign_objective_lead_generation: 'S’inscrire',
  campaign_objective_app_install: 'Installer',
  campaign_objective_reach: '',
  campaign_objective_video_view: '',
  campaign_objective_engagement: '',
};

/** La meilleure qualité de vidéo qui reste légère : la grille la lit au survol. */
function videoDe(info: Brut | null): string | null {
  const urls = objet(info?.video_url);
  if (!urls) return null;
  return texte(urls['720p']) || texte(urls['480p']) || texte(urls['540p']) || texte(urls['1080p']) || texte(urls['360p']) || null;
}

export function versLigneTikTok(element: Brut, fiche: Brut | null): LignePub | null {
  const id = texte(String(element.id ?? ''));
  if (!id || !fiche) return null;
  const info = objet(element.video_info) ?? objet(fiche.video_info);
  const titre = texte(fiche.ad_title) || texte(element.ad_title);
  const lien = texte(fiche.landing_page) || null;
  const objectif = texte(fiche.objective_key) || texte(element.objective_key);
  const appel = APPELS[objectif] ?? '';
  const cible = cibleTikTok(Array.isArray(fiche.country_code) ? fiche.country_code.map(String) : [], AFRICAINS);
  // Une pub qui ne vise aucun pays d'Afrique ne regarde pas nos vendeurs.
  if (!cible.pays.length) return null;
  const destination = destinationDe(lien, appel);
  const domaine = destination === 'boutique' ? domaineDe(lien) : null;
  const cle = boutiqueCle(destination, lien, titre);
  const marque = texte(element.brand_name) || texte(fiche.brand_name);
  const niche = devinerNiche(titre, '', domaine);
  const langue = devinerLangue(titre);
  const duree = Number(info?.duration);
  const annonceur = marque || domaine || '';
  return {
    source: 'tiktok',
    id_source: id,
    // Sans marque ni domaine, chaque pub est son propre annonceur : on ne regroupe pas au hasard.
    annonceur_id: annonceur ? `tt:${annonceur.toLowerCase()}` : `tt:pub:${id}`,
    annonceur_nom: annonceur,
    annonceur_avatar: null,
    texte: couper(titre, 4000),
    titre: '',
    appel_action: appel,
    lien,
    domaine,
    destination,
    boutique_cle: cle,
    format: 'video',
    duree_video_s: Number.isFinite(duree) && duree > 0 ? Math.round(duree) : null,
    video_url: videoDe(info),
    reseaux: ['tiktok'],
    pays: cible.pays,
    langue,
    niche,
    type_produit: niche === 'digital' ? 'digital' : 'physique',
    categorie: categoriePub({
      texte: titre, titre: '', appelAction: appel, domaine, lien, destination, boutiqueCle: cle, langue, niche,
      annonceur: marque, cibleAfricaine: cible.locale, exigeVente: true,
    }),
    prix_fcfa: prixFcfa(titre),
    offres: offresDe(titre),
    active: true,
    date_debut: null,
    date_fin: null,
    groupe_cle: `tiktok:${texte(info?.vid) || id}`,
    variantes_source: 1,
    apercu_source: texte(info?.cover) || null,
  };
}
