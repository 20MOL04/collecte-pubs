/**
 * LE COLLECTEUR DE NUIT DE PUB TRACK (cahier, section 3).
 *
 * Tourne sur GitHub Actions (`.github/workflows/pub-track-collecte.yml`),
 * JAMAIS sur Vercel. Ouvre la bibliothèque publique Meta dans Chromium, SANS
 * se connecter à aucun compte, lit les pubs que la page reçoit, et les range
 * dans Supabase. Les écrans ne lisent que la base : une recherche de vendeur
 * ne coûte rien.
 *
 * Usage local (Playwright installé à part : `npm install --no-save playwright`
 * puis `npx playwright install chromium`) :
 *
 *   npx tsx scripts/pub-track/collecter.ts --pays CI --mots savon --defilements 1 --sec
 *
 *   --pays CI,SN       pays à lire (défaut : ceux du jour, lib/pub-track/pays.ts)
 *   --mots a,b         mots-clés (défaut : la rotation de lib/pub-track/niches.ts)
 *   --mots-par-pays N  mots par pays (défaut : budget / nombre de pays)
 *   --defilements N    défilements par requête (défaut : budget)
 *   --sec              lit et affiche, n'écrit RIEN en base
 *
 * Variables : NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import { BUDGET_COLLECTE } from '../../lib/pub-track/budget';
import {
  CRENEAUX,
  cleNuit,
  cleOccident,
  debutNuit,
  doitSauter,
  faitesDepuis,
  gagneLeVerrou,
  jourDeNuit,
  ligneAnnotation,
  mesures,
  rangCreneau,
  resteAfrique,
  type LigneJournal,
  type StatutCreneau,
} from '../../lib/pub-track/creneaux';
import { choisirRequetes, type StatRequete } from '../../lib/pub-track/requetes';
import { VERIFICATION, annonceursAVerifier, pageComplete, verdictPage, type PubCandidate, type PubReperee } from '../../lib/pub-track/verification';
import { estPaysPubTrack, paysDuJour, PAYS_PUB_TRACK } from '../../lib/pub-track/pays';
import { schemaTikTokConnu, versLigneTikTok } from './analyser-tiktok';
import { schemaVideoTikTokConnu, versLigneVideoTikTok } from './analyser-tiktok-videos';
import { nommerProduits } from './nommer-produits';
import { requetesOccidentOrientees, type ProduitAOrienter } from '../../lib/pub-track/occident';
import { scoresDeNuit, type PubAScorer } from '../../lib/pub-track/score-nuit';
import { analyserPage, technologieDepuisDomaine, technologieDepuisUrl, technologieSansSite } from '../../lib/pub-track/technologie';
import { CATEGORIES_VISIBLES, categorieAvecClasseur, categorieOccident, categoriePub, vendeursAncres, type CategoriePub, type EntreeCategorie } from '../../lib/pub-track/categorie';
import { clesProduit } from '../../lib/pub-track/produit-cle';
import { offresDe, prixFcfa } from '../../lib/pub-track/offre';
import { estDestination } from '../../lib/pub-track/destination';
import { nicheDePub } from '../../lib/pub-track/niches';
import {
  empreinteSchema,
  fusionner,
  lireJsons,
  schemaConnu,
  trouverPubsBrutes,
  versLigne,
  type LignePub,
} from './analyser-reponse';

const BUCKET = 'pub-track';
const debut = Date.now();

function arg(nom: string): string | null {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}
const sec = process.argv.includes('--sec');
/** `--creneau` : un créneau de la nuit (cron de `collecte.yml`), qui reprend la file là où le précédent s'est arrêté. */
const MODE_CRENEAU = process.argv.includes('--creneau');
const pause = ([min, max]: readonly [number, number]) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
/**
 * TikTok passe tous les N jours (ses « Top Ads » couvrent 30 jours et bougent lentement), ou sur
 * demande. Cette nuit-là, Meta lui cède ses minutes : la nuit entière tient dans le quota gratuit.
 */
const NUIT_TIKTOK =
  !process.argv.includes('--videos-seul') &&
  (process.argv.includes('--tiktok') ||
  process.argv.includes('--tiktok-seul') ||
  (!process.argv.includes('--sans-tiktok') && Math.floor(Date.now() / 86_400_000) % BUDGET_COLLECTE.tiktokTousLesNJours === 0));
/** Les vidéos TikTok des vendeurs (ScrapeCreators) passent chaque nuit dès qu'une clé est posée. */
const VIDEOS_TIKTOK = !!process.env.SCRAPECREATORS_API_KEY?.trim() && !process.argv.includes('--sans-tiktok');
/** Le nommage des produits passe chaque nuit dès que la clé Gemini est posée. */
const NOMMAGE = !!process.env.GEMINI_API_KEY?.trim();
const tempsEcoule = () =>
  (Date.now() - debut) / 60_000 >
  BUDGET_COLLECTE.dureeMaxMinutes - (NUIT_TIKTOK ? BUDGET_COLLECTE.tiktokMinutes : 0) - (VIDEOS_TIKTOK ? BUDGET_COLLECTE.tiktokVideosMinutes : 0) - (NOMMAGE ? BUDGET_COLLECTE.nommageMinutes : 0) - BUDGET_COLLECTE.rafraichirMinutes - BUDGET_COLLECTE.occidentMinutes;

/** `depuis` (AAAA-MM-JJ) : seulement les pubs lancées depuis ce jour, filtre de la bibliothèque elle-même. */
function urlBibliotheque(pays: string, mot: string, depuis: string | null = null): string {
  const p = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country: pays,
    q: mot,
    search_type: 'keyword_unordered',
    media_type: 'all',
  });
  if (depuis) p.set('start_date[min]', depuis);
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

/**
 * Toutes les pubs actives d'un annonceur, en UNE page (rafraîchissement des vidéos, 09/10/2026) :
 * l'adresse vidéo d'une pub Meta expire ~4 jours après sa lecture ; relire l'annonceur renouvelle
 * d'un coup celle de toutes ses pubs.
 */
function urlAnnonceur(pageId: string, pays: string): string {
  const p = new URLSearchParams({ active_status: 'active', ad_type: 'all', country: pays, view_all_page_id: pageId, search_type: 'page', media_type: 'all' });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

const ilYAJours = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Les JSON embarqués dans le HTML : la première page de résultats arrive souvent par là. */
function jsonsDuHtml(html: string): unknown[] {
  const sortie: unknown[] = [];
  for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].includes('ad_archive_id')) continue;
    sortie.push(...lireJsons(m[1]));
  }
  return sortie;
}

class Bloque extends Error {}
class SchemaChange extends Error {}

async function lireRequete(
  contexte: { newPage(): Promise<any> },
  pays: string,
  mot: string,
  defilements: number,
  depuis: string | null = null,
  adresse: string | null = null,
): Promise<LignePub[]> {
  const page = await contexte.newPage();
  const corps: Promise<string>[] = [];
  page.on('response', (r: any) => {
    if (r.url().includes('/api/graphql') && r.request().method() === 'POST') {
      corps.push(r.text().catch(() => ''));
    }
  });
  try {
    const reponse = await page.goto(adresse ?? urlBibliotheque(pays, mot, depuis), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (/login|checkpoint/.test(page.url())) throw new Bloque(`redirige vers ${page.url()}`);
    await pause(BUDGET_COLLECTE.pauseDefilementMs);
    const html = await page.content();
    // Mesuré le 07/10/2026 après ~60 recherches dans l'après-midi : Meta répond 403 avec une
    // page SANS aucune pub. Continuer, c'est enchaîner des recherches vides et creuser le blocage.
    if (reponse?.status() === 403 && !html.includes('ad_archive_id')) throw new Bloque('403 sans aucune pub : Meta freine cette adresse');
    if (reponse?.status() === 429) throw new Bloque('429 : trop de demandes pour cette adresse');
    for (let i = 0; i < defilements; i++) {
      await page.mouse.wheel(0, 6000);
      await pause(BUDGET_COLLECTE.pauseDefilementMs);
    }
    const lire = async () => {
      const textes = await Promise.all(corps);
      const brutes = [...jsonsDuHtml(html), ...textes.flatMap(lireJsons)].flatMap((j) => trouverPubsBrutes(j));
      if (!schemaConnu(brutes)) throw new SchemaChange(empreinteSchema(brutes));
      return brutes.map((b) => versLigne(b, pays)).filter((l): l is LignePub => !!l);
    };
    // UNE RECHERCHE RICHE SE LIT PLUS LOIN (audit du 08/10/2026 : 104 recherches sur 188 butaient sur la
    // limite). On continue tant que chaque défilement apporte encore des pubs ET que la moitié sont des produits.
    let lignes = await lire();
    for (let i = 0; i < BUDGET_COLLECTE.defilementsBonus; i++) {
      const utiles = lignes.filter((l) => (CATEGORIES_VISIBLES as readonly string[]).includes(l.categorie)).length;
      if (lignes.length < BUDGET_COLLECTE.pubsParDefilement * (defilements + i) || utiles * 2 < lignes.length) break;
      const avant = new Set(lignes.map((l) => l.id_source)).size;
      await page.mouse.wheel(0, 6000);
      await pause(BUDGET_COLLECTE.pauseDefilementMs);
      lignes = await lire();
      if (new Set(lignes.map((l) => l.id_source)).size <= avant) break;
    }
    return lignes;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function recopierMiniature(sb: SupabaseClient, l: LignePub): Promise<string | null> {
  if (!l.apercu_source) return null;
  try {
    const r = await fetch(l.apercu_source, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const image = await sharp(Buffer.from(await r.arrayBuffer()))
      // 720 px et une meilleure qualité (10/10/2026) : la découpe du produit (097) se fait dans cette
      // image ; à 480 px, un produit recadré tombait sous 200 px et n'était pas utilisable.
      .resize({ width: 720, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const chemin = `${l.source}/${l.id_source}.webp`;
    const { error } = await sb.storage.from(BUCKET).upload(chemin, image, { contentType: 'image/webp', upsert: true });
    return error ? null : chemin;
  } catch {
    return null;
  }
}

/**
 * `null` quand le site n'a pas répondu, ou a répondu par une erreur (page de
 * vérification, 5xx) : ne rien savoir n'est pas savoir qu'il est « sur mesure ».
 */
async function lirePage(url: string): Promise<{ html: string; adresse: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'follow' });
    if (!r.ok) return null;
    return { html: (await r.text()).slice(0, 393_216), adresse: r.url || url };
  } catch {
    return null;
  }
}

/**
 * Sur quoi vend cette boutique. Décision du équipe du 07/10/2026 : on lit
 * LA PAGE DE VENTE de la pub (son lien), pas seulement l'accueil du domaine,
 * parce qu'un vendeur digital monte souvent sa page sur son propre domaine et
 * branche un bouton de paiement Chariow, Maketou ou Selar. Dans l'ordre :
 * l'adresse elle-même, l'adresse où la page REDIRIGE, les liens et formulaires
 * de la page et son pied de page, puis le bouton d'achat suivi UN cran plus
 * loin. `null` quand aucun site n'a répondu : ne rien savoir n'est pas savoir.
 */
async function lireTechnologie(domaine: string, lienPub: string | null): Promise<string | null> {
  const connue = technologieDepuisDomaine(domaine) ?? technologieDepuisUrl(lienPub);
  if (connue) return connue;
  const page = (lienPub ? await lirePage(lienPub) : null) ?? (await lirePage(`https://${domaine}`));
  if (!page) return null;
  const parRedirection = technologieDepuisUrl(page.adresse);
  if (parRedirection) return parRedirection;
  const lecture = analyserPage(page.html, page.adresse);
  if (lecture.technologie) return lecture.technologie;
  if (lecture.lienAchat) {
    const parBouton = technologieDepuisUrl(lecture.lienAchat);
    if (parBouton) return parBouton;
    const suite = await lirePage(lecture.lienAchat);
    if (suite) {
      const loin = technologieDepuisUrl(suite.adresse) ?? analyserPage(suite.html, suite.adresse).technologie;
      if (loin) return loin;
    }
  }
  return 'sur_mesure';
}

function colonnes(l: LignePub): Omit<LignePub, 'apercu_source'> & { vu_le: string; maj_le: string } {
  const { apercu_source: _ignore, ...reste } = l;
  const maintenant = new Date().toISOString();
  return { ...reste, vu_le: maintenant, maj_le: maintenant };
}

/** Colonnes d'une migration peut-être pas encore appliquée (116) : sans elles, on écrit quand même le reste. */
const COLONNES_RECENTES = ['collation_id'] as const;

async function ecrireParLots(sb: SupabaseClient, lignes: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < lignes.length; i += 400) {
    const lot = lignes.slice(i, i + 400);
    const ecrire = (l: Record<string, unknown>[]) => sb.from('pub_track_pubs').upsert(l, { onConflict: 'source,id_source', defaultToNull: false });
    let { error } = await ecrire(lot);
    if (error && colonneAbsente(error.message)) {
      ({ error } = await ecrire(lot.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !(COLONNES_RECENTES as readonly string[]).includes(k))))));
    }
    if (error) throw new Error(`ecriture pub_track_pubs : ${error.message}`);
  }
}

async function toutLire<T>(lire: (de: number, a: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const sortie: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await lire(de, de + 999);
    if (error) throw new Error(error.message);
    sortie.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return sortie;
  }
}

/**
 * Le score de TOUTES les pubs actives, pas seulement de celles vues cette nuit :
 * les jours actifs et la pression des boutiques bougent aussi pour les autres.
 */
/**
 * Pose sur TOUTES les pubs, chaque nuit et à chaque `--reclasser` : la catégorie
 * (lib/pub-track/categorie.ts), la niche (niches.ts, avec la famille nommée par le collecteur),
 * la clé produit (produit-cle.ts), le prix en FCFA et les leviers d'offre (offre.ts).
 *
 * Tout repasser chaque nuit, c'est ce qui rend le nettoyage IDEMPOTENT et rétroactif : une règle
 * qui change s'applique aussi aux lignes lues avant elle (« TikTok For Business » restait dans la
 * Tendance occidentale, lu avant l'exclusion du 10/10). La base n'écrit que ce qui change
 * (`pub_track_poser_enrichissement`, migration 107).
 *
 * - Afrique (Meta) : les règles africaines, le vendeur jugé sur toutes ses pubs.
 * - Occident : `categorieOccident` (enseignes, banques, crédit, immobilier, services).
 * - TikTok : la catégorie posée à la lecture est gardée (le ciblage par pays qui la décide n'est
 *   pas en base) ; seules la niche et la clé produit sont recalculées.
 */
async function classerBase(sb: SupabaseClient): Promise<number> {
  const colonnes =
    'id, source, marche, categorie, annonceur_id, annonceur_nom, texte, titre, appel_action, lien, domaine, destination, boutique_cle, langue, produit_famille, verdict_ia';
  const lire = (c: string) => toutLire<Record<string, string | null>>((de, a) => sb.from('pub_track_pubs').select(c).order('id').range(de, a));
  // Le type vu par le classeur IA (117) : sans la migration, les règles seules décident, comme avant.
  const lignes = await lire(`${colonnes}, type_ia`).catch((err: Error) => {
    if (!colonneAbsente(err.message)) throw err;
    return lire(colonnes);
  });
  const technos = new Map(
    (await toutLire<{ cle: string; technologie: string }>((de, a) => sb.from('pub_track_boutiques').select('cle, technologie').range(de, a))).map((b) => [
      b.cle,
      b.technologie,
    ]),
  );
  const niches = new Map(lignes.map((l) => [l.id as string, nicheDePub({ texte: l.texte, titre: l.titre, domaine: l.domaine, famille: l.produit_famille })]));
  const entree = (l: Record<string, string | null>): EntreeCategorie => ({
    technologie: l.boutique_cle ? technos.get(l.boutique_cle) ?? null : null,
    texte: l.texte ?? '',
    titre: l.titre ?? '',
    appelAction: l.appel_action ?? '',
    domaine: l.domaine,
    lien: l.lien,
    destination: estDestination(l.destination) ? l.destination : 'inconnue',
    boutiqueCle: l.boutique_cle,
    langue: l.langue,
    niche: niches.get(l.id as string) ?? 'autre',
    annonceur: l.annonceur_nom,
  });
  const afrique = lignes.filter((l) => l.source === 'meta' && l.marche !== 'occident');
  // Le vendeur se juge sur TOUTES ses pubs (audit du 08/10/2026).
  const ancres = vendeursAncres(afrique.map((l) => ({ annonceurId: l.annonceur_id, entree: entree(l) })));
  const vend = (l: Record<string, string | null>) => (l.verdict_ia === 'produit' ? true : l.verdict_ia === 'pas_produit' ? false : null);
  const categorie = (l: Record<string, string | null>): string | null => {
    const regles = categorieRegles(l);
    return regles ? categorieAvecClasseur(regles as CategoriePub, l.type_ia, vend(l)) : regles;
  };
  const categorieRegles = (l: Record<string, string | null>): string | null => {
    if (l.marche === 'occident') {
      return categorieOccident({
        texte: l.texte ?? '',
        titre: l.titre ?? '',
        domaine: l.domaine,
        lien: l.lien,
        annonceur: l.annonceur_nom,
        famille: l.produit_famille,
        categorieLue: l.categorie as CategoriePub | null,
      });
    }
    if (l.source !== 'meta') return l.categorie;
    return categoriePub({ ...entree(l), vendeurAncre: l.annonceur_id != null && ancres.has(l.annonceur_id) });
  };
  const cles = clesProduit(lignes.map((l) => ({ id: l.id as string, source: l.source ?? 'meta', annonceurId: l.annonceur_id, texte: l.texte ?? '', titre: l.titre })));
  const enrichies = lignes.map((l) => ({
    id: l.id,
    prix_fcfa: prixFcfa(`${l.texte ?? ''} ${l.titre ?? ''}`),
    offres: offresDe(`${l.texte ?? ''} ${l.titre ?? ''}`),
    categorie: categorie(l),
    niche: niches.get(l.id as string) ?? 'autre',
    produit_cle: cles.get(l.id as string) ?? null,
  }));
  let poses = 0;
  for (let i = 0; i < enrichies.length; i += 500) {
    const { data, error } = await sb.rpc('pub_track_poser_enrichissement', { p_lignes: enrichies.slice(i, i + 500) });
    if (error) throw new Error(`categories : ${error.message}`);
    poses += Number(data) || 0;
  }
  return poses;
}

/** Une étape du recalcul, relancée deux fois si la base dépasse son temps limite. */
async function etapeRecalcul<T>(nom: string, appel: () => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  for (let essai = 1; ; essai++) {
    const { data, error } = await appel();
    if (!error) return data;
    if (essai >= 3 || !/timeout/i.test(error.message)) throw new Error(`recalcul ${nom} : ${error.message}`);
    console.warn(`recalcul ${nom} : ${error.message}, nouvel essai dans 20 s`);
    await pause([20_000, 20_000]);
  }
}

/**
 * Le recalcul de fin de nuit, EN ÉTAPES COURTES (migrations 095 et 096). D'un bloc, il prenait
 * 17 s et la base coupe à 8 s : la nuit du 10/10/2026 s'est arrêtée là sans fermer son journal.
 * Les jours d'activité partent par paquets de 2 000 lignes (~1,3 s chacun).
 */
async function recalculer(sb: SupabaseClient): Promise<void> {
  const jour = new Date().toISOString().slice(0, 10);
  await etapeRecalcul('pubs', () => sb.rpc('pub_track_recalculer_pubs', { p_jour: jour }));
  for (let i = 0; i < 50; i++) {
    const n = await etapeRecalcul<number>('jours', () => sb.rpc('pub_track_recalculer_jours', { p_jour: jour, p_limite: 2000 }));
    if (!n) break;
  }
  await etapeRecalcul('boutiques', () => sb.rpc('pub_track_recalculer_boutiques'));
  await etapeRecalcul('annonceurs', () => sb.rpc('pub_track_recalculer_annonceurs'));
  await etapeRecalcul('historique', () => sb.rpc('pub_track_recalculer_historique', { p_jour: jour }));
}

/**
 * Le score v2 de TOUTES les pubs actives, sa phrase et son statut prouvé (lot 4, lib/pub-track/score-nuit.ts).
 * Sans la migration 116 (pas de `verifiee_le`), aucune preuve : aucune pub ne passe gagnante. Sans la 118,
 * le score et la phrase passent par l'ancienne porte, sans statut.
 */
async function recalculerScores(sb: SupabaseClient): Promise<number> {
  const variantesGroupe = new Map(
    (await toutLire<{ groupe_cle: string; variantes: number }>((de, a) => sb.from('pub_track_groupes').select('groupe_cle, variantes').range(de, a))).map((g) => [g.groupe_cle, g.variantes]),
  );
  const croissanceBoutique = new Map(
    (await toutLire<{ cle: string; variation_7j: number | null }>((de, a) => sb.from('pub_track_boutiques').select('cle, variation_7j').range(de, a))).map((b) => [b.cle, b.variation_7j]),
  );
  const croissanceAnnonceur = new Map(
    (await toutLire<{ source: string; page_id: string; variation_7j: number | null }>((de, a) => sb.from('pub_track_annonceurs').select('source, page_id, variation_7j').range(de, a))).map((x) => [
      `${x.source}:${x.page_id}`,
      x.variation_7j,
    ]),
  );
  const colonnesScore = 'id, source, jours_actifs, groupe_cle, variantes_source, boutique_cle, annonceur_id, categorie, marche, produit_famille, pays, prix_fcfa, offres, date_debut';
  const lirePubs = (c: string) => toutLire<PubAScorer>((de, a) => sb.from('pub_track_pubs').select(c).eq('active', true).order('id').range(de, a));
  const pubs = await lirePubs(`${colonnesScore}, verifiee_le`).catch((err: Error) => {
    if (!colonneAbsente(err.message)) throw err;
    return lirePubs(colonnesScore);
  });
  const scores = scoresDeNuit(pubs, { variantesGroupe, croissanceBoutique, croissanceAnnonceur }, new Date());
  let poses = 0;
  let v2 = true;
  for (let i = 0; i < scores.length; i += 1000) {
    const lot = scores.slice(i, i + 1000);
    if (v2) {
      const { data, error } = await sb.rpc('pub_track_poser_scores_v2', { p_scores: lot });
      if (!error) {
        poses += Number(data) || 0;
        continue;
      }
      console.error(`scores v2 : ${error.message} ; repli sur l ancienne porte, sans statut`);
      v2 = false;
    }
    const { data, error } = await sb.rpc('pub_track_poser_scores', { p_scores: lot.map(({ id, score, phrase }) => ({ id, score, phrase })) });
    if (error) throw new Error(`scores : ${error.message}`);
    poses += Number(data) || 0;
  }
  const statuts = scores.reduce((n, x) => ({ ...n, [x.statut ?? 'aucun']: (n[x.statut ?? 'aucun'] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`Scores v2 : ${scores.length} pubs actives, ${statuts.gagnante ?? 0} gagnantes, ${statuts.montante ?? 0} montantes, ${statuts.nouvelle ?? 0} nouvelles.`);
  return poses;
}

/**
 * La technologie de chaque boutique, sur TOUTE la base et APRÈS le recalcul
 * (qui crée les boutiques). Elle se posait en fin de collecte, sur les seules
 * pubs de la nuit : le 07/10/2026, aucune collecte n'était allée au bout, et
 * les 195 boutiques étaient « sur mesure », un sous-domaine myshopify compris.
 */
async function poserTechnologies(sb: SupabaseClient, relireTout = false, max: number = BUDGET_COLLECTE.technosParNuit): Promise<number> {
  const limite = new Date(Date.now() - BUDGET_COLLECTE.technoValableJours * 86_400_000).toISOString();
  const boutiques = await toutLire<{ cle: string; destination: string; technologie: string; techno_lue_le: string | null }>((de, a) =>
    sb.from('pub_track_boutiques').select('cle, destination, technologie, techno_lue_le').order('cle').range(de, a),
  );
  const maintenant = () => new Date().toISOString();
  let poses = 0;
  // La page de vente d'une pub de chaque boutique : c'est elle qui porte le bouton de paiement.
  const liens = new Map<string, string>();
  for (const p of await toutLire<{ boutique_cle: string | null; lien: string | null }>((de, a) =>
    sb.from('pub_track_pubs').select('boutique_cle, lien').eq('destination', 'boutique').not('lien', 'is', null).order('vu_le', { ascending: false }).range(de, a),
  )) {
    if (p.boutique_cle && p.lien && !liens.has(p.boutique_cle)) liens.set(p.boutique_cle, p.lien);
  }

  for (const b of boutiques) {
    if (b.destination === 'boutique' || !estDestination(b.destination)) continue;
    const technologie = technologieSansSite(b.destination);
    if (!technologie || technologie === b.technologie) continue;
    const { error } = await sb.from('pub_track_boutiques').update({ technologie, techno_lue_le: maintenant() }).eq('cle', b.cle);
    if (error) console.error(`technologie ${b.cle} : ${error.message}`);
    else poses += 1;
  }

  // Six sites à la fois : 800 lectures à 8 s chacune dureraient sinon près de deux heures.
  const aLire = boutiques
    .filter((b) => b.destination === 'boutique' && !b.cle.startsWith('wa:') && (relireTout || !b.techno_lue_le || b.techno_lue_le < limite))
    .slice(0, max);
  for (let i = 0; i < aLire.length; i += 6) {
    await Promise.all(
      aLire.slice(i, i + 6).map(async (b) => {
        // Site muet : on garde ce qu'on savait, et on ne le relit que dans 30 jours.
        const technologie = (await lireTechnologie(b.cle, liens.get(b.cle) ?? null)) ?? b.technologie;
        const { error } = await sb.from('pub_track_boutiques').update({ technologie, techno_lue_le: maintenant() }).eq('cle', b.cle);
        if (error) console.error(`technologie ${b.cle} : ${error.message}`);
        else if (technologie !== b.technologie) poses += 1;
      }),
    );
  }
  return poses;
}

/**
 * Écrit les pubs d'UNE recherche, miniatures comprises. Les miniatures se
 * recopiaient en fin de nuit seulement : une collecte coupée en route (celle du
 * 07/10/2026 à 03 h 47) laissait ses pubs sans image, et le lien fbcdn expire en
 * quelques jours. Renvoie le nombre de pubs nouvelles et de miniatures posées.
 */
async function ecrireRecherche(
  sb: SupabaseClient,
  touchees: LignePub[],
  avecMiniature: Set<string>,
  budget: { miniatures: number },
): Promise<{ nouvelles: number; miniatures: number }> {
  const enBase = new Map<string, string | null>();
  for (let i = 0; i < touchees.length; i += 500) {
    const { data, error } = await sb
      .from('pub_track_pubs')
      .select('id_source, miniature_chemin')
      .eq('source', touchees[0]?.source ?? 'meta')
      .in('id_source', touchees.slice(i, i + 500).map((l) => l.id_source));
    // Sans cette lecture, l'écriture remettrait à NULL les miniatures existantes : on n'écrit pas du tout.
    if (error) throw new Error(`lecture des miniatures : ${error.message}`);
    for (const r of (data ?? []) as { id_source: string; miniature_chemin: string | null }[]) enBase.set(r.id_source, r.miniature_chemin);
  }
  let miniatures = 0;
  const aEcrire: Record<string, unknown>[] = [];
  for (const l of touchees) {
    const ligne: Record<string, unknown> = colonnes(l);
    // TOUJOURS la miniature déjà en base (audit du 09/10/2026) : supabase-js écrit l'union des clés
    // d'un lot, et une seule miniature neuve dans le lot remettait à NULL celle des autres pubs.
    ligne.miniature_chemin = enBase.get(l.id_source) ?? null;
    if (enBase.get(l.id_source)) avecMiniature.add(l.id_source);
    // Une pub qu'aucun écran ne montrera (application, série, marque hors d'Afrique) ne coûte pas une image.
    const visible = (CATEGORIES_VISIBLES as readonly string[]).includes(l.categorie);
    if (visible && !avecMiniature.has(l.id_source) && budget.miniatures > 0) {
      const chemin = await recopierMiniature(sb, l);
      if (chemin) {
        ligne.miniature_chemin = chemin;
        avecMiniature.add(l.id_source);
        budget.miniatures -= 1;
        miniatures += 1;
      }
    }
    aEcrire.push(ligne);
  }
  await ecrireParLots(sb, aEcrire);
  return { nouvelles: touchees.filter((l) => !enBase.has(l.id_source)).length, miniatures };
}

/* ── TikTok : les « Top Ads » du Creative Center (lot 7, 09/10/2026) ─────────────────────── */

const TOPADS = 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=';
const API_TIKTOK = 'https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2';
const ORDRES_TIKTOK = ['for_you', 'like', 'reach', 'ctr'] as const;
// Le Creative Center refuse un navigateur qui se présente comme automatisé : il reste blanc.
const NAVIGATEUR_ORDINAIRE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * La page publique signe ses appels (en-têtes `timestamp`, `user-sign`, `anonymous-user-id`) ;
 * on charge UNE page comme un visiteur, on relit ces en-têtes, puis on lit les listes et les
 * fiches avec eux : 0,6 s par fiche au lieu de 10 s par page (mesuré le 09/10/2026).
 */
async function collecterTikTok(
  navigateur: { newContext(o: Record<string, unknown>): Promise<any> },
  sb: SupabaseClient | null,
  pays: readonly string[],
  avecMiniature: Set<string>,
  budget: { miniatures: number },
): Promise<{ listes: number; lues: number; ecrites: number; utiles: number; nouvelles: number; miniatures: number }> {
  const fin = Date.now() + BUDGET_COLLECTE.tiktokMinutes * 60_000;
  const contexte = await navigateur.newContext({ locale: 'en-US', userAgent: NAVIGATEUR_ORDINAIRE, viewport: { width: 1300, height: 900 } });
  const page = await contexte.newPage();
  let entetes: Record<string, string> | null = null;
  page.on('request', (r: any) => {
    if (!entetes && String(r.url()).includes('top_ads/v2/list')) {
      entetes = Object.fromEntries(Object.entries(r.headers() as Record<string, string>).filter(([k]) => !/^(sec-|user-agent|referer|accept-encoding|cookie)/.test(k)));
    }
  });
  const sortie = { listes: 0, lues: 0, ecrites: 0, utiles: 0, nouvelles: 0, miniatures: 0 };
  try {
    await page.goto(`${TOPADS}NG`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    for (let i = 0; i < 40 && !entetes; i++) await pause([400, 600]);
    if (!entetes) throw new Error('en-tetes signes introuvables : la page Top Ads a change');
    const lire = async (url: string): Promise<Record<string, any> | null> => {
      const t: string = await page.evaluate(
        async ([u, h]: [string, Record<string, string>]) => (await fetch(u, { headers: h, credentials: 'include' })).text(),
        [url, entetes],
      );
      try {
        const j = JSON.parse(t);
        return j?.code === 0 ? j.data : null;
      } catch {
        return null;
      }
    };

    // Chaque passage trie autrement (pour vous, likes, portée, taux de clic) : la même liste de 20
    // n'est pas relue, et TikTok freine au-delà d'une centaine d'appels (mesuré le 09/10/2026).
    const tri = ORDRES_TIKTOK[Math.floor(Date.now() / 86_400_000 / BUDGET_COLLECTE.tiktokTousLesNJours) % ORDRES_TIKTOK.length];
    const periode = Number(arg('tiktok-periode')) === 180 ? 180 : 30;
    const elements = new Map<string, Record<string, unknown>>();
    for (const p of pays) {
      if (Date.now() > fin) break;
      for (let n = 1; n <= BUDGET_COLLECTE.tiktokPagesParPays; n++) {
        const data = await lire(`${API_TIKTOK}/list?period=${periode}&page=${n}&limit=20&order_by=${tri}&country_code=${p}`);
        sortie.listes += 1;
        const mats = Array.isArray(data?.materials) ? (data.materials as Record<string, unknown>[]) : [];
        if (!schemaTikTokConnu(mats)) throw new SchemaChange(`tiktok:${Object.keys(mats[0] ?? {}).sort().join(',')}`);
        for (const m of mats) elements.set(String(m.id), m);
        await pause([400, 900]);
        if (mats.length < 20) break;
      }
    }
    sortie.lues = elements.size;

    // Une pub déjà lue cette semaine ne coûte pas une fiche de plus.
    const recentes = new Set<string>();
    // `--tiktok-relire` : relire aussi les pubs vues cette semaine, pour les reclasser après un changement de règle.
    if (sb && elements.size && !process.argv.includes('--tiktok-relire')) {
      const ids = [...elements.keys()];
      const depuis = new Date(Date.now() - 7 * 86_400_000).toISOString();
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await sb.from('pub_track_pubs').select('id_source').eq('source', 'tiktok').gte('vu_le', depuis).in('id_source', ids.slice(i, i + 300));
        for (const r of (data ?? []) as { id_source: string }[]) recentes.add(r.id_source);
      }
    }
    const lignes: LignePub[] = [];
    for (const [id, element] of elements) {
      if (Date.now() > fin) break;
      if (recentes.has(id)) continue;
      const fiche = await lire(`${API_TIKTOK}/detail?material_id=${id}`);
      const l = versLigneTikTok(element, fiche);
      if (l) lignes.push({ ...l, requete: `tiktok · ${l.pays.join(',')}` });
      await pause([250, 600]);
    }
    sortie.ecrites = lignes.length;
    sortie.utiles = lignes.filter((l) => (CATEGORIES_VISIBLES as readonly string[]).includes(l.categorie)).length;
    if (sb && lignes.length) {
      const ecrit = await ecrireRecherche(sb, lignes, avecMiniature, budget);
      sortie.nouvelles = ecrit.nouvelles;
      sortie.miniatures = ecrit.miniatures;
    } else if (!sb) {
      for (const l of lignes) console.log(`  ${l.categorie.padEnd(12)} ${l.pays.join(',').padEnd(6)} ${l.appel_action.padEnd(14)} ${(l.domaine ?? l.destination).slice(0, 26).padEnd(26)} | ${l.texte.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  } finally {
    await contexte.close().catch(() => undefined);
  }
  return sortie;
}

/* ── TikTok : les vidéos des vendeurs, boostées ou non (ScrapeCreators, 09/10/2026) ─────────── */

const API_SCRAPECREATORS = 'https://api.scrapecreators.com/v1/tiktok/search/keyword';

/**
 * Pays par pays, 2 recherches dans sa langue (`choisirRequetes`, mémoire séparée de Meta sous
 * « tiktok:<pays> »), faites comme depuis ce pays (`region`), sur le mois, les plus aimées.
 * 1 crédit par recherche, plafonné par nuit (`tiktokVideosParNuit`).
 */
async function collecterVideosTikTok(
  sb: SupabaseClient | null,
  pays: readonly string[],
  memoire: Map<string, Map<string, StatRequete>>,
  avecMiniature: Set<string>,
  budget: { miniatures: number },
): Promise<{ recherches: number; lues: number; retenues: number; utiles: number; nouvelles: number; miniatures: number; credits: number | null }> {
  const cle = process.env.SCRAPECREATORS_API_KEY?.trim() ?? '';
  // `--videos-par-pays`, `--videos-max`, `--videos-minutes` : une passe d enrichissement lancée à la main.
  const parPays = Number(arg('videos-par-pays') ?? BUDGET_COLLECTE.tiktokVideosParPays);
  const maxRecherches = Number(arg('videos-max') ?? BUDGET_COLLECTE.tiktokVideosParNuit);
  const fin = Date.now() + Number(arg('videos-minutes') ?? BUDGET_COLLECTE.tiktokVideosMinutes) * 60_000;
  const sortie = { recherches: 0, lues: 0, retenues: 0, utiles: 0, nouvelles: 0, miniatures: 0, credits: null as number | null };
  const jour = new Date();
  tour: for (const p of pays) {
    const mots = choisirRequetes(p, memoire.get(`tiktok:${p}`) ?? new Map(), jour, parPays);
    for (const mot of mots) {
      if (Date.now() > fin || sortie.recherches >= maxRecherches) break tour;
      const q = new URLSearchParams({ query: mot, region: p, date_posted: 'this-month', sort_by: 'relevance', trim: 'true' });
      let corps: Record<string, unknown> | null = null;
      try {
        const res = await fetch(`${API_SCRAPECREATORS}?${q.toString()}`, { headers: { 'x-api-key': cle }, signal: AbortSignal.timeout(60_000) });
        corps = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (res.status === 401 || res.status === 402) throw new Error(`ScrapeCreators ${res.status} : cle refusee ou credits epuises`);
      } catch (err) {
        console.error(`TikTok videos ${p} « ${mot} » : echec`, err instanceof Error ? err.message : err);
        if (String(err).includes('credits epuises') || String(err).includes('cle refusee')) break tour;
        continue;
      }
      sortie.recherches += 1;
      if (typeof corps?.credits_remaining === 'number') sortie.credits = corps.credits_remaining;
      const items = (Array.isArray(corps?.search_item_list) ? corps.search_item_list : []) as Record<string, unknown>[];
      const bruts = items.map((i) => ((i.aweme_info && typeof i.aweme_info === 'object' ? i.aweme_info : i) as Record<string, unknown>));
      if (!schemaVideoTikTokConnu(bruts)) throw new SchemaChange(`tiktok-videos:${Object.keys(bruts[0] ?? {}).sort().join(',')}`);
      sortie.lues += items.length;
      const lignes = items.map((i) => versLigneVideoTikTok(i)).filter((l): l is LignePub => !!l).map((l) => ({ ...l, requete: `tiktok:${p} · ${mot}` }));
      const utiles = lignes.filter((l) => (CATEGORIES_VISIBLES as readonly string[]).includes(l.categorie)).length;
      sortie.retenues += lignes.length;
      sortie.utiles += utiles;
      if (sb) {
        await sb.rpc('pub_track_compter_requete', { p_pays: `tiktok:${p}`, p_requete: mot, p_pubs: items.length, p_utiles: utiles });
        if (lignes.length) {
          const ecrit = await ecrireRecherche(sb, lignes, avecMiniature, budget);
          sortie.nouvelles += ecrit.nouvelles;
          sortie.miniatures += ecrit.miniatures;
        }
      } else {
        for (const l of lignes) console.log(`  ${l.categorie.padEnd(12)} ${l.pays.join(',')} ${l.annonceur_nom.slice(0, 20).padEnd(20)} | ${l.texte.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
      console.log(`TikTok videos ${p} « ${mot} » : ${items.length} videos, ${lignes.length} de vendeurs africains, ${utiles} produits`);
      await pause([800, 1600]);
    }
  }
  return sortie;
}

/* ── La passe de vérification (lot 2 de Pub Track v2) ───────────────────────────────────── */

/**
 * Une page annonceur lue JUSQU'AU BOUT : on défile tant qu'un défilement apporte de nouvelles pubs, sous un
 * plafond. Tous pays (`ALL`) : une pub active ailleurs que dans le pays d'une recherche reste active.
 * `complete` faux = la page n'a pas fini de charger, elle ne prouve aucun arrêt.
 */
async function lirePageAnnonceur(contexte: { newPage(): Promise<any> }, pageId: string): Promise<{ lignes: LignePub[]; complete: boolean }> {
  const page = await contexte.newPage();
  const corps: Promise<string>[] = [];
  page.on('response', (r: any) => {
    if (r.url().includes('/api/graphql') && r.request().method() === 'POST') corps.push(r.text().catch(() => ''));
  });
  try {
    const reponse = await page.goto(urlAnnonceur(pageId, 'ALL'), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (/login|checkpoint/.test(page.url())) throw new Bloque(`redirige vers ${page.url()}`);
    await pause(BUDGET_COLLECTE.pauseDefilementMs);
    const html = await page.content();
    if (reponse?.status() === 403 && !html.includes('ad_archive_id')) throw new Bloque('403 sans aucune pub : Meta freine cette adresse');
    if (reponse?.status() === 429) throw new Bloque('429 : trop de demandes pour cette adresse');
    const lire = async () => {
      const textes = await Promise.all(corps);
      const brutes = [...jsonsDuHtml(html), ...textes.flatMap(lireJsons)].flatMap((j) => trouverPubsBrutes(j));
      if (!schemaConnu(brutes)) throw new SchemaChange(empreinteSchema(brutes));
      const uniques = new Map<string, LignePub>();
      for (const b of brutes) {
        const l = versLigne(b, 'ALL');
        if (l && l.annonceur_id === pageId) uniques.set(l.id_source, l);
      }
      return [...uniques.values()];
    };
    let lignes = await lire();
    for (let n = 1; n <= VERIFICATION.defilementsMax; n++) {
      const avant = lignes.length;
      await page.mouse.wheel(0, 6000);
      await pause(BUDGET_COLLECTE.pauseDefilementMs);
      lignes = await lire();
      if (lignes.length === avant) return { lignes, complete: pageComplete(0, n) };
    }
    return { lignes, complete: false };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Relit les annonceurs qui comptent, score décroissant, jusqu'à `fin`. Chaque page relue : ses pubs sont
 * écrites (vidéo renouvelée au passage), confirmées, et les absentes d'une page complète arrêtées.
 * Une pub vue sur la page garde ses pays et son marché connus : la page « tous pays » ne les dit pas.
 */
async function verifierAnnonceurs(
  contexte: { newPage(): Promise<any> },
  sb: SupabaseClient,
  fin: number,
  depuisNuit: Date,
  avecMiniature: Set<string>,
  budget: { miniatures: number },
): Promise<{ annonceurs: number; completes: number; lues: number; confirmees: number; arretees: number; preuves: boolean }> {
  const sortie = { annonceurs: 0, completes: 0, lues: 0, confirmees: 0, arretees: 0, preuves: true };
  const lireCandidates = (colonnes: string) =>
    toutLire<PubCandidate>((de, a) =>
      sb
        .from('pub_track_pubs')
        .select(colonnes)
        .eq('source', 'meta')
        .eq('active', true)
        .in('categorie', CATEGORIES_VISIBLES as unknown as string[])
        .order('score', { ascending: false })
        .range(de, a),
    );
  const candidates = await lireCandidates('annonceur_id, score, verifiee_le').catch(async (err: Error) => {
    if (!colonneAbsente(err.message)) throw err;
    sortie.preuves = false;
    return lireCandidates('annonceur_id, score');
  });
  const ordre = annonceursAVerifier(candidates, depuisNuit, new Date(), VERIFICATION.annonceursParNuit);
  for (const pageId of ordre) {
    if (Date.now() > fin) break;
    const lireActives = (colonnes: string) => sb.from('pub_track_pubs').select(colonnes).eq('source', 'meta').eq('annonceur_id', pageId).eq('active', true).limit(2000);
    let res = await lireActives('id_source, groupe_cle, collation_id, pays, marche');
    if (res.error && colonneAbsente(res.error.message)) res = await lireActives('id_source, groupe_cle, pays, marche');
    if (res.error) throw new Error(`verification ${pageId} : ${res.error.message}`);
    const actives = (res.data ?? []) as unknown as (PubReperee & { pays: string[] | null; marche: string | null })[];
    const connues = new Map(actives.map((a) => [a.id_source, a]));
    const compte = new Map<string, number>();
    for (const a of actives) for (const p of a.pays ?? []) compte.set(p, (compte.get(p) ?? 0) + 1);
    const paysAnnonceur = [...compte.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const marcheAnnonceur = actives.some((a) => a.marche === 'occident') ? ('occident' as const) : undefined;

    const { lignes, complete } = await lirePageAnnonceur(contexte, pageId);
    sortie.annonceurs += 1;
    if (complete) sortie.completes += 1;
    sortie.lues += lignes.length;
    const ecrites = lignes.map((l) => {
      const c = connues.get(l.id_source);
      return {
        ...l,
        pays: c?.pays?.length ? c.pays : paysAnnonceur ? [paysAnnonceur] : [],
        ...(c?.marche === 'occident' || (!c && marcheAnnonceur) ? { marche: 'occident' as const } : {}),
        requete: `verification · ${pageId}`,
      };
    });
    if (ecrites.length) await ecrireRecherche(sb, ecrites, avecMiniature, budget);
    const verdict = verdictPage({
      actives: actives.map((a) => ({ id_source: a.id_source, groupe_cle: a.groupe_cle, collation_id: a.collation_id ?? null })),
      vues: lignes.map((l) => ({ id_source: l.id_source, groupe_cle: l.groupe_cle, collation_id: l.collation_id ?? null })),
      complete,
    });
    if (sortie.preuves) {
      const { error } = await sb.rpc('pub_track_poser_verification', {
        p_annonceur: pageId,
        p_confirmees: verdict.confirmees,
        p_arretees: verdict.arretees,
        p_quand: new Date().toISOString(),
      });
      if (error) {
        // Migration 116 pas encore appliquée : la page est écrite (vidéos renouvelées), aucune preuve posée.
        console.error(`verification : preuves non posees (${error.message})`);
        sortie.preuves = false;
      } else {
        sortie.confirmees += verdict.confirmees.length;
        sortie.arretees += verdict.arretees.length;
      }
    }
    console.log(`Verification ${pageId} : ${lignes.length} pubs listees${complete ? '' : ' (page coupee)'}, ${verdict.confirmees.length} confirmees, ${verdict.arretees.length} arretees`);
    await pause(BUDGET_COLLECTE.pauseRequeteMs);
  }
  return sortie;
}

/**
 * Le rafraîchissement des vidéos Meta (09/10/2026) : les pubs de la vitrine lues il y a plus de
 * deux jours ont une adresse vidéo qui meurt bientôt. On relit en priorité les annonceurs qui en
 * ont le plus, une page chacun, dans le budget de temps de la nuit.
 */
async function rafraichirVideosMeta(
  contexte: { newPage(): Promise<any> },
  sb: SupabaseClient,
  avecMiniature: Set<string>,
  budget: { miniatures: number },
  finImposee: number | null = null,
): Promise<{ annonceurs: number; pubs: number }> {
  const fin = finImposee ?? Date.now() + BUDGET_COLLECTE.rafraichirMinutes * 60_000;
  const { data, error } = await sb
    .from('pub_track_vitrine')
    .select('annonceur_id, pays')
    .eq('source', 'meta')
    .eq('active', true)
    .not('video_url', 'is', null)
    .lt('vu_le', new Date(Date.now() - Number(arg('rafraichir-jours') ?? 2) * 86_400_000).toISOString())
    .limit(3000);
  if (error) throw new Error(error.message);
  const parAnnonceur = new Map<string, { n: number; pays: string }>();
  for (const l of (data ?? []) as { annonceur_id: string; pays: string[] | null }[]) {
    const e = parAnnonceur.get(l.annonceur_id) ?? { n: 0, pays: l.pays?.[0] ?? 'ALL' };
    e.n += 1;
    parAnnonceur.set(l.annonceur_id, e);
  }
  const ordre = [...parAnnonceur.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, BUDGET_COLLECTE.rafraichirAnnonceurs);
  const sortie = { annonceurs: 0, pubs: 0 };
  for (const [pageId, { pays }] of ordre) {
    if (Date.now() > fin) break;
    const lignes = (await lireRequete(contexte, pays, '', 1, null, urlAnnonceur(pageId, pays))).filter((l) => l.annonceur_id === pageId);
    sortie.annonceurs += 1;
    if (lignes.length) {
      await ecrireRecherche(sb, lignes, avecMiniature, budget);
      sortie.pubs += lignes.length;
    }
    await pause(BUDGET_COLLECTE.pauseRequeteMs);
  }
  return sortie;
}

/* ── Le journal de la nuit : verrou, saut, mesures (lot 1 de Pub Track v2) ─────────────────── */

/** Tant que la migration 115 n'est pas appliquée, ses colonnes n'existent pas : on range les mesures dans le message. */
const colonneAbsente = (m: string) => /column|colonne|schema cache|PGRST204/i.test(m);

async function ouvrirJournal(sb: SupabaseClient, message: string, nuit: string): Promise<string> {
  const plein = await sb.from('pub_track_collectes').insert({ message, nuit, statut: 'en_cours' }).select('id').single();
  if (!plein.error) return (plein.data as { id: string }).id;
  if (!colonneAbsente(plein.error.message)) throw new Error(`journal : ${plein.error.message}`);
  const repli = await sb.from('pub_track_collectes').insert({ message }).select('id').single();
  if (repli.error) throw new Error(`journal : ${repli.error.message}`);
  return (repli.data as { id: string }).id;
}

async function lireJournal(sb: SupabaseClient): Promise<LigneJournal[]> {
  const plein = await sb.from('pub_track_collectes').select('id, debut, fin, message, statut, nuit').order('debut', { ascending: false }).limit(40);
  if (!plein.error) return (plein.data ?? []) as LigneJournal[];
  if (!colonneAbsente(plein.error.message)) throw new Error(`journal : ${plein.error.message}`);
  const repli = await sb.from('pub_track_collectes').select('id, debut, fin, message').order('debut', { ascending: false }).limit(40);
  if (repli.error) throw new Error(`journal : ${repli.error.message}`);
  return (repli.data ?? []) as LigneJournal[];
}

async function fermerJournal(sb: SupabaseClient, id: string, champs: Record<string, unknown>, m: ReturnType<typeof mesures>): Promise<void> {
  const fin = new Date().toISOString();
  const { nuit, creneau, statut, minutes_meta, pubs_par_minute, bloque_a, annonceurs_verifies, pubs_confirmees, pubs_arretees } = m;
  const plein = await sb
    .from('pub_track_collectes')
    .update({ ...champs, nuit, creneau, statut, minutes_meta, pubs_par_minute, bloque_a, annonceurs_verifies, pubs_confirmees, pubs_arretees, fin })
    .eq('id', id);
  if (!plein.error) return;
  if (!colonneAbsente(plein.error.message)) {
    console.error(`journal : ${plein.error.message}`);
    return;
  }
  const message = `${String(champs.message ?? '').slice(0, 300)} | ${JSON.stringify(m)}`;
  const repli = await sb.from('pub_track_collectes').update({ ...champs, message, fin }).eq('id', id);
  if (repli.error) console.error(`journal : ${repli.error.message}`);
}

/**
 * Les produits africains qui gagnent ou qui montent cette semaine (lot 6) : la matière des recherches occidentales
 * orientées. Sans la migration 118 (pas de statut), une liste vide : la rotation seule, comme avant.
 */
async function produitsAOrienter(sb: SupabaseClient): Promise<ProduitAOrienter[]> {
  const { data, error } = await sb
    .from('pub_track_pubs')
    .select('produit_nom, produit_recherche')
    .in('statut_pt', ['gagnante', 'montante'])
    .eq('marche', 'afrique')
    .eq('categorie', 'physique')
    .eq('active', true)
    .not('produit_recherche', 'is', null)
    .order('score', { ascending: false })
    .limit(40);
  if (error) return [];
  return ((data ?? []) as { produit_nom: string | null; produit_recherche: string | null }[]).map((l) => ({ nom: l.produit_nom, recherche: l.produit_recherche }));
}

/** Le créneau en cours, pour fermer sa ligne même quand la nuit s'arrête sur une panne. */
let journalOuvert: { sb: SupabaseClient; id: string; nuit: string; creneau: number } | null = null;

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sec && (!url || !cle)) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (ou --sec)');
  const sb = !sec ? createClient(url!, cle!, { auth: { persistSession: false } }) : null;

  // `--recalculer` : recalcul et scores seulement, sans ouvrir Meta.
  if (sb && (process.argv.includes('--recalculer') || process.argv.includes('--reclasser'))) {
    const premier = await classerBase(sb);
    await recalculer(sb);
    const technos = await poserTechnologies(sb, process.argv.includes('--relire-technos'));
    const second = await classerBase(sb);
    await recalculer(sb);
    console.log(`${premier + second} categories posees.`);
    console.log(`OK: ${technos} technologies, ${await recalculerScores(sb)} scores poses.`);
    return;
  }

  const nuit = cleNuit(new Date());
  // Tous les créneaux d'une nuit lisent les mêmes pays et les mêmes recherches occidentales.
  const aujourdhui = MODE_CRENEAU ? jourDeNuit(nuit) : new Date();
  const pays = (arg('pays')?.split(',').map((p) => p.trim().toUpperCase()).filter(estPaysPubTrack)) ?? paysDuJour(aujourdhui).map((p) => p.code);
  const motsImposes = arg('mots')?.split(',').map((m) => m.trim()).filter(Boolean) ?? null;
  const motsParPays = Number(arg('mots-par-pays')) || Math.max(1, Math.floor(BUDGET_COLLECTE.requetesParNuit / Math.max(1, pays.length)));
  const defilements = Number(arg('defilements')) || BUDGET_COLLECTE.defilementsParRequete;
  const joursDepuis = Number(arg('depuis'));
  const depuisImpose = Number.isInteger(joursDepuis) && joursDepuis > 0 && joursDepuis <= 90 ? ilYAJours(joursDepuis) : null;

  // LE VERROU ET LE SAUT, AVANT TOUT NAVIGATEUR. Une seule collecte Meta à la fois, quel que soit le
  // dépôt qui la lance ; un refus de Meta arrête la nuit, deux nuits refusées de suite en sautent une.
  let creneau = 1;
  if (sb) {
    const id = await ouvrirJournal(sb, MODE_CRENEAU ? `creneau nuit ${nuit}` : `pays ${pays.join(',')}`, nuit);
    const lignes = await lireJournal(sb);
    creneau = rangCreneau(lignes, nuit, id, new Date());
    const fermerSans = async (statut: StatutCreneau, texte: string) => {
      const m = mesures({ nuit, creneau, statut, recherches: 0, pubsLues: 0, msMeta: 0, bloqueA: null });
      await fermerJournal(sb, id, { message: texte }, m);
      console.log(texte);
      console.log(ligneAnnotation(m));
    };
    if (!gagneLeVerrou(lignes, id, new Date())) {
      await fermerSans('occupe', 'une autre collecte Meta tourne deja : ce creneau ne s ouvre pas');
      return;
    }
    if (doitSauter(lignes, nuit, new Date()) && !process.argv.includes('--forcer')) {
      await fermerSans('saute', `deux blocages Meta de suite : nuit ${nuit} sautee`);
      return;
    }
    journalOuvert = { sb, id, nuit, creneau };
  }

  const stats = {
    requetes: 0,
    pubs_lues: 0,
    pubs_nouvelles: 0,
    erreurs: 0,
    empreinte_schema: null as string | null,
    message: '',
    // La dépense Gemini du nommage, dans le journal de la nuit (migration 094).
    nommage_pubs: 0,
    nommage_jetons_entree: 0,
    nommage_jetons_sortie: 0,
    nommage_cout_usd: 0,
  };
  // Écrits par `arreter`, une fermeture : sans l'annotation large, TypeScript croirait le statut toujours « ok ».
  let statut = 'ok' as StatutCreneau;
  let verif = { annonceurs: 0, completes: 0, lues: 0, confirmees: 0, arretees: 0, preuves: false };
  let bloqueA = null as number | null;

  const nomPaquet = 'playwright';
  const { chromium } = await import(nomPaquet);
  // Le robot se présente tel qu'il est : aucun déguisement en personne (décision du 29/10/2026).
  const navigateur = await chromium.launch({ headless: true });
  const contexte = await navigateur.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 900 } });
  const vues = new Map<string, LignePub>();
  const avecMiniature = new Set<string>();
  const budgetMiniatures = { miniatures: Math.floor(BUDGET_COLLECTE.miniaturesParNuit / (MODE_CRENEAU ? CRENEAUX.parNuit : 1)) };
  let miniatures = 0;

  // La mémoire des recherches (migration 083) : ce que chaque (pays, recherche) a déjà rapporté.
  const memoire = new Map<string, Map<string, StatRequete>>();
  if (sb) {
    const lues = await toutLire<{ pays: string; requete: string; recherches: number; utiles: number; derniere: string | null }>((de, a) =>
      sb.from('pub_track_requetes').select('pays, requete, recherches, utiles, derniere').range(de, a),
    );
    for (const r of lues) {
      const m = memoire.get(r.pays) ?? new Map<string, StatRequete>();
      m.set(r.requete, { recherches: r.recherches, utiles: r.utiles, derniere: r.derniere });
      memoire.set(r.pays, m);
    }
  }

  /** Un arrêt Meta : le format a changé, ou l'adresse est freinée. Le reste du créneau ne touche plus Meta. */
  const arreter = (err: unknown): boolean => {
    if (err instanceof SchemaChange) {
      statut = 'schema';
      stats.empreinte_schema = err.message;
      stats.message = 'format Meta change : collecte arretee, analyser-reponse.ts a mettre a jour';
      console.error(stats.message, err.message);
      return true;
    }
    if (err instanceof Bloque) {
      statut = 'bloque';
      bloqueA = stats.requetes;
      stats.message = `bloque par Meta : ${err.message}`;
      console.error(stats.message);
      return true;
    }
    return false;
  };

  /** Une recherche africaine, écrite tout de suite. `false` : Meta a dit stop. */
  const chercherAfrique = async (p: string, mot: string, rang: number): Promise<boolean> => {
    stats.requetes += 1;
    try {
      // `--depuis N` : tout lire sur N jours (rattrapage). Sinon, une recherche sur deux ne prend que les lancements récents.
      const depuis = depuisImpose ?? (rang % 2 === 0 ? ilYAJours(BUDGET_COLLECTE.fraicheurJours) : null);
      const lignes = await lireRequete(contexte, p, mot, defilements, depuis);
      stats.pubs_lues += lignes.length;
      const touchees: LignePub[] = [];
      for (const l of lignes) {
        const deja = vues.get(l.id_source);
        const fusion = { ...(deja ? fusionner(deja, l) : l), requete: `${p} · ${mot}` };
        vues.set(l.id_source, fusion);
        touchees.push(fusion);
      }
      const utiles = lignes.filter((l) => (CATEGORIES_VISIBLES as readonly string[]).includes(l.categorie)).length;
      if (sb) {
        const { error } = await sb.rpc('pub_track_compter_requete', { p_pays: p, p_requete: mot, p_pubs: lignes.length, p_utiles: utiles });
        if (error) console.error(`memoire des recherches : ${error.message}`);
      }
      // Sauvé tout de suite, images comprises : une panne en fin de nuit ne perd pas ce qui est déjà lu.
      if (sb && touchees.length) {
        const ecrit = await ecrireRecherche(sb, touchees, avecMiniature, budgetMiniatures);
        stats.pubs_nouvelles += ecrit.nouvelles;
        miniatures += ecrit.miniatures;
      }
      console.log(`${p} « ${mot} »${depuis ? ` depuis le ${depuis}` : ''} : ${lignes.length} pubs, ${utiles} utiles (total ${vues.size})`);
    } catch (err) {
      stats.erreurs += 1;
      if (arreter(err)) return false;
      console.error(`${p} « ${mot} » : echec`, err instanceof Error ? err.message : err);
    }
    await pause(BUDGET_COLLECTE.pauseRequeteMs);
    return true;
  };

  /** Une recherche occidentale (« Tendance occidentale », 10/10/2026). `false` : Meta a dit stop. */
  const chercherOccident = async (po: string, mot: string): Promise<boolean> => {
    try {
      const lues = await lireRequete(contexte, po, mot, defilements, null);
      const lignes = lues.map((l) => ({
        ...l,
        marche: 'occident' as const,
        requete: `occident:${po} · ${mot}`,
        // Enseignes, banques, crédit, immobilier, services : écartés dès la lecture (15/10/2026). Le reste
        // attend le jugement du modèle de vision ; `classerBase` rejoue la règle chaque nuit avec la famille.
        categorie: categorieOccident({ texte: l.texte, titre: l.titre, domaine: l.domaine, lien: l.lien, annonceur: l.annonceur_nom, categorieLue: l.categorie }),
      }));
      stats.pubs_lues += lignes.length;
      if (sb) {
        // La mémoire sait ainsi quelles recherches occidentales la nuit a déjà faites (un créneau reprend la suite).
        await sb.rpc('pub_track_compter_requete', { p_pays: cleOccident(po), p_requete: mot, p_pubs: lignes.length, p_utiles: lignes.length });
        if (lignes.length) {
          const ecrit = await ecrireRecherche(sb, lignes, avecMiniature, budgetMiniatures);
          stats.pubs_nouvelles += ecrit.nouvelles;
          miniatures += ecrit.miniatures;
        }
      }
      console.log(`Occident ${po} « ${mot} » : ${lignes.length} pubs`);
    } catch (err) {
      if (arreter(err)) return false;
      console.error(`Occident ${po} « ${mot} » : echec`, err instanceof Error ? err.message : err);
    }
    await pause(BUDGET_COLLECTE.pauseRequeteMs);
    return true;
  };

  const debutMeta = Date.now();
  let finReelleMeta = debutMeta;
  const seulementTikTok = process.argv.includes('--tiktok-seul') || process.argv.includes('--videos-seul') || process.argv.includes('--rafraichir-seul');
  try {
    if (MODE_CRENEAU) {
      // LA FILE DE LA NUIT : l'Afrique, puis l'Occident, puis le rafraîchissement des vidéos, dans le
      // temps du créneau. Ce qui a déjà été cherché depuis le début de la nuit (mémoire des recherches)
      // est sauté : le créneau suivant reprend là où celui-ci s'est arrêté (jamais après un 403 : voir `doitSauter`).
      const fin = debutMeta + CRENEAUX.minutesMeta * 60_000;
      const depuisNuit = debutNuit(nuit);
      // D'ABORD LA PREUVE (lot 2) : relire les annonceurs qui comptent avant de chercher du neuf.
      let actif = true;
      if (sb) {
        try {
          const v = await verifierAnnonceurs(contexte, sb, Math.min(fin, Date.now() + VERIFICATION.minutesParCreneau * 60_000), depuisNuit, avecMiniature, budgetMiniatures);
          verif = v;
          stats.pubs_lues += v.lues;
          console.log(`Verification : ${v.annonceurs} annonceurs relus (${v.completes} pages completes), ${v.lues} pubs, ${v.confirmees} confirmees, ${v.arretees} arretees${v.preuves ? '' : ', preuves non posees (migration 116 absente)'}.`);
        } catch (err) {
          if (arreter(err)) actif = false;
          else {
            stats.erreurs += 1;
            console.error('Verification : echec', err instanceof Error ? err.message : err);
          }
        }
      }
      const dernieres = (cle: string) => new Map([...(memoire.get(cle) ?? new Map<string, StatRequete>()).entries()].map(([r, s]) => [r, s.derniere]));
      const faites = new Map(pays.map((p) => [p, faitesDepuis(dernieres(p), depuisNuit)]));
      tour: for (const { pays: p, reste } of actif ? resteAfrique(pays, faites, motsParPays) : []) {
        const mots = motsImposes ?? choisirRequetes(p, memoire.get(p) ?? new Map(), new Date(), reste);
        for (const [i, mot] of mots.entries()) {
          if (Date.now() > fin) break tour;
          if (!(await chercherAfrique(p, mot, (faites.get(p) ?? 0) + i))) {
            actif = false;
            break tour;
          }
        }
      }
      if (sb && actif && Date.now() < fin) {
        const faitesOccident = (po: string, mot: string) => {
          const d = memoire.get(cleOccident(po))?.get(mot)?.derniere;
          return !!d && Date.parse(d) >= depuisNuit.getTime();
        };
        const orientees = requetesOccidentOrientees(await produitsAOrienter(sb), jourDeNuit(nuit), BUDGET_COLLECTE.occidentRequetes);
        for (const { pays: po, mot } of orientees) {
          if (Date.now() > fin) break;
          if (faitesOccident(po, mot)) continue;
          if (!(await chercherOccident(po, mot))) {
            actif = false;
            break;
          }
        }
      }
      // Le rafraîchissement des vidéos n'a plus de place à part : relire un annonceur renouvelle ses vidéos.
    } else if (!seulementTikTok) {
      // Le lancement à la main (rattrapage d'un pays, d'un mot) : l'ancienne nuit d'un bloc, sous le même verrou.
      tour: for (const p of pays) {
        const mots = motsImposes ?? choisirRequetes(p, memoire.get(p) ?? new Map(), aujourdhui, motsParPays);
        for (const [rang, mot] of mots.entries()) {
          if (tempsEcoule() || stats.requetes >= BUDGET_COLLECTE.requetesParNuit) break tour;
          if (!(await chercherAfrique(p, mot, rang))) break tour;
        }
      }
      if (sb && statut === 'ok') {
        const finOccident = Date.now() + BUDGET_COLLECTE.occidentMinutes * 60_000;
        for (const { pays: po, mot } of requetesOccidentOrientees(await produitsAOrienter(sb), new Date(), BUDGET_COLLECTE.occidentRequetes)) {
          if (Date.now() > finOccident) break;
          if (!(await chercherOccident(po, mot))) break;
        }
      }
      if (sb && statut === 'ok') {
        try {
          const r = await rafraichirVideosMeta(contexte, sb, avecMiniature, budgetMiniatures);
          console.log(`Videos Meta : ${r.annonceurs} annonceurs relus, ${r.pubs} pubs rafraichies.`);
        } catch (err) {
          // Un refus ici n'arrête pas la nuit : TikTok et le nommage passent quand même.
          if (!arreter(err)) {
            stats.erreurs += 1;
            console.error('Videos Meta : echec', err instanceof Error ? err.message : err);
          }
        }
      }
    }
    finReelleMeta = Date.now();
    if (VIDEOS_TIKTOK && statut === 'ok') {
      try {
        // Les pays du jour (ou `--pays`) : les vidéos des vendeurs bougent vite, on les relit chaque nuit.
        const tv = await collecterVideosTikTok(sb, pays, memoire, avecMiniature, budgetMiniatures);
        stats.pubs_lues += tv.lues;
        stats.pubs_nouvelles += tv.nouvelles;
        miniatures += tv.miniatures;
        console.log(`TikTok videos : ${tv.recherches} recherches, ${tv.lues} videos lues, ${tv.retenues} de vendeurs africains, ${tv.utiles} produits, ${tv.nouvelles} nouvelles, credits restants ${tv.credits ?? '?'}.`);
      } catch (err) {
        stats.erreurs += 1;
        console.error('TikTok videos : echec', err instanceof Error ? err.message : err);
      }
    }
    if (NUIT_TIKTOK && statut === 'ok') {
      try {
        // `--pays` restreint aussi TikTok ; sinon les 54 pays, une page de liste coûte moins d'une seconde.
        const tt = await collecterTikTok(navigateur, sb, arg('pays') ? pays : PAYS_PUB_TRACK.map((x) => x.code), avecMiniature, budgetMiniatures);
        stats.pubs_lues += tt.lues;
        stats.pubs_nouvelles += tt.nouvelles;
        miniatures += tt.miniatures;
        console.log(`TikTok : ${tt.listes} listes, ${tt.lues} pubs lues, ${tt.ecrites} retenues (pays africains), ${tt.utiles} produits, ${tt.nouvelles} nouvelles.`);
      } catch (err) {
        stats.erreurs += 1;
        console.error('TikTok : echec', err instanceof Error ? err.message : err);
      }
    }
  } finally {
    await navigateur.close().catch(() => undefined);
  }
  const pubsMeta = stats.pubs_lues;
  const m = mesures({
    nuit,
    creneau,
    statut,
    recherches: stats.requetes,
    pubsLues: pubsMeta,
    msMeta: finReelleMeta - debutMeta,
    bloqueA,
    annonceursVerifies: verif.annonceurs,
    pubsConfirmees: verif.confirmees,
    pubsArretees: verif.arretees,
  });

  const lignes = [...vues.values()];
  if (!sb) {
    for (const l of lignes.slice(0, 5)) console.log(JSON.stringify(l, null, 2));
    console.log(`\n--sec : ${lignes.length} pubs lues, rien n'est ecrit.`);
    console.log(JSON.stringify(m));
    return;
  }

  // Un créneau qui n'a rien lu (403 dès la première recherche) n'a rien à reclasser : il ne coûte pas un recalcul.
  let technos = 0;
  let scores = 0;
  if (lignes.length || !MODE_CRENEAU) {
    await classerBase(sb);
    await recalculer(sb);
    technos = await poserTechnologies(sb, false, Math.floor(BUDGET_COLLECTE.technosParNuit / (MODE_CRENEAU ? CRENEAUX.parNuit : 1)));
    // Une boutique reconnue Chariow cette nuit rend ses pubs digitales dès ce matin.
    await classerBase(sb);
    await recalculer(sb);

    // LE RATTRAPAGE DES IMAGES (audit du 08/10/2026 : 292 pubs de produits sans image, donc absentes
    // de la vitrine). La miniature ne se copie qu'à la lecture, et seulement pour une pub déjà classée
    // produit ; celles que le classement de fin de nuit reconnaît (vendeur jugé à la majorité,
    // boutique Chariow) n'en avaient pas. Leur adresse d'aperçu n'existe qu'en mémoire, cette nuit.
    const sansImage: { id_source: string }[] = [];
    const idsNuit = lignes.filter((l) => l.apercu_source && !avecMiniature.has(l.id_source)).map((l) => l.id_source);
    for (let i = 0; i < idsNuit.length; i += 300) {
      const { data } = await sb
        .from('pub_track_pubs')
        .select('id_source')
        .eq('source', 'meta')
        .in('categorie', CATEGORIES_VISIBLES as unknown as string[])
        .is('miniature_chemin', null)
        .in('id_source', idsNuit.slice(i, i + 300));
      sansImage.push(...((data ?? []) as { id_source: string }[]));
    }
    let rattrapees = 0;
    for (const { id_source } of sansImage) {
      if (budgetMiniatures.miniatures <= 0) break;
      const l = vues.get(id_source);
      const chemin = l ? await recopierMiniature(sb, l) : null;
      if (!chemin) continue;
      budgetMiniatures.miniatures -= 1;
      const { error } = await sb.from('pub_track_pubs').update({ miniature_chemin: chemin }).eq('source', 'meta').eq('id_source', id_source);
      if (!error) rattrapees += 1;
    }
    miniatures += rattrapees;
    if (rattrapees) console.log(`${rattrapees} images rattrapees pour des pubs reconnues en fin de nuit.`);

    scores = await recalculerScores(sb);
  }

  if (NOMMAGE) {
    try {
      const nm = await nommerProduits(sb, { max: BUDGET_COLLECTE.nommageParNuit, minutes: BUDGET_COLLECTE.nommageMinutes });
      stats.nommage_pubs = nm.nommees + nm.rejetees;
      stats.nommage_jetons_entree = nm.jetonsEntree;
      stats.nommage_jetons_sortie = nm.jetonsSortie;
      stats.nommage_cout_usd = Math.round(nm.coutUsd * 10_000) / 10_000;
      console.log(`Nommage : ${nm.nommees} produits nommes, ${nm.rejetees} rejetes, ${nm.illisibles} lots illisibles, ${nm.jetonsEntree} jetons lus, ${nm.jetonsSortie} ecrits, ~${nm.coutUsd.toFixed(3)} $ (estimation haute, tarif Flash absent de cout-texte).`);
    } catch (err) {
      stats.erreurs += 1;
      console.error('Nommage : echec', err instanceof Error ? err.message : err);
    }
  }

  if (journalOuvert) {
    await fermerJournal(sb, journalOuvert.id, stats, m);
    journalOuvert = null;
  }
  console.log(`\nOK: ${stats.requetes} requetes, ${lignes.length} pubs, ${stats.pubs_nouvelles} nouvelles, ${miniatures} miniatures, ${technos} technologies, ${scores} scores, ${stats.erreurs} erreurs.`);
  console.log(ligneAnnotation(m));
  // Un 403 est un refus prévu et respecté : le créneau s'arrête proprement et la nuit s'arrête avec lui.
  // Seul un changement de format chez Meta demande une main sur le code, et fait échouer la tâche.
  if (statut === 'bloque') console.log(`::warning title=Meta a bloque ce creneau::${stats.message.replace(/%/g, '%25')}`);
  if (statut === 'schema') process.exitCode = 2;
}

main().catch(async (err) => {
  console.error('collecte Pub Track : echec', err);
  if (journalOuvert) {
    const { sb, id, nuit, creneau } = journalOuvert;
    const m = mesures({ nuit, creneau, statut: 'erreur', recherches: 0, pubsLues: 0, msMeta: 0, bloqueA: null });
    await fermerJournal(sb, id, { message: `echec : ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) }, m).catch(() => undefined);
    console.log(ligneAnnotation(m));
  }
  process.exit(1);
});
