/**
 * L'ÉCRITURE DES PUBS DANS `pub_track_pubs` : le seul chemin par lequel le collecteur (collecter.ts) et la source
 * autorisée (collecter-source.ts) écrivent une pub. Sorti de collecter.ts le 07/11/2026 pour être partagé.
 *
 * Le verrou des vidéos (lib/pub-track/video-chez-nous.ts) s'applique ici, à chaque ligne :
 * - une `video_url` déjà rangée chez nous (`https://media.creafrik.com/...`) est réécrite TELLE QUELLE ;
 * - un lien externe (fbcdn, TikTok, fournisseur) n'est jamais écrit : il part dans la file des dépôts R2
 *   (`FileVideos`, scripts/pub-track/deposer-videos.ts), en mémoire.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { CATEGORIES_VISIBLES } from '../../lib/pub-track/categorie';
import { sourceADeposer, videoAEcrire } from '../../lib/pub-track/video-chez-nous';
import type { LignePub } from './analyser-reponse';
import { FileVideos } from './deposer-videos';

export const BUCKET_MINIATURES = 'pub-track';

/** Tant qu'une migration n'est pas appliquée, ses colonnes n'existent pas. */
export const colonneAbsente = (m: string) => /column|colonne|schema cache|PGRST204/i.test(m);

/** La file des vidéos de la collecte en cours : remplie par `ecrireRecherche`, vidée dans R2 en fin de collecte. */
export const fileVideosCollecte = new FileVideos();

export async function recopierMiniature(sb: SupabaseClient, l: LignePub): Promise<string | null> {
  if (!l.apercu_source) return null;
  try {
    const r = await fetch(l.apercu_source, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    // Chargé à la demande : le reste du module (le verrou des vidéos) se teste sans sharp installé.
    const { default: sharp } = await import('sharp');
    const image = await sharp(Buffer.from(await r.arrayBuffer()))
      // 720 px et une meilleure qualité (10/10/2026) : la découpe du produit (097) se fait dans cette
      // image ; à 480 px, un produit recadré tombait sous 200 px et n'était pas utilisable.
      .resize({ width: 720, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const chemin = `${l.source}/${l.id_source}.webp`;
    const { error } = await sb.storage.from(BUCKET_MINIATURES).upload(chemin, image, { contentType: 'image/webp', upsert: true });
    return error ? null : chemin;
  } catch {
    return null;
  }
}

export function colonnes(l: LignePub): Omit<LignePub, 'apercu_source'> & { vu_le: string; maj_le: string } {
  const { apercu_source: _ignore, ...reste } = l;
  const maintenant = new Date().toISOString();
  return { ...reste, vu_le: maintenant, maj_le: maintenant };
}

/** Colonnes d'une migration peut-être pas encore appliquée (116) : sans elles, on écrit quand même le reste. */
const COLONNES_RECENTES = ['collation_id'] as const;

export async function ecrireParLots(sb: SupabaseClient, lignes: Record<string, unknown>[]): Promise<void> {
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

/**
 * Écrit les pubs d'UNE recherche, miniatures comprises. Les miniatures se
 * recopiaient en fin de nuit seulement : une collecte coupée en route (celle du
 * 07/10/2026 à 03 h 47) laissait ses pubs sans image, et le lien fbcdn expire en
 * quelques jours. Renvoie le nombre de pubs nouvelles et de miniatures posées.
 */
export async function ecrireRecherche(
  sb: SupabaseClient,
  touchees: LignePub[],
  avecMiniature: Set<string>,
  budget: { miniatures: number },
  options: { file?: FileVideos; autoriserMeta?: boolean } = {},
): Promise<{ nouvelles: number; miniatures: number }> {
  const file = options.file ?? fileVideosCollecte;
  const enBase = new Map<string, string | null>();
  /** La `video_url` en base de chaque pub déjà connue : le verrou des vidéos se décide sur elle. */
  const videoEnBase = new Map<string, string | null>();
  for (let i = 0; i < touchees.length; i += 500) {
    const { data, error } = await sb
      .from('pub_track_pubs')
      .select('id_source, miniature_chemin, video_url')
      .eq('source', touchees[0]?.source ?? 'meta')
      .in('id_source', touchees.slice(i, i + 500).map((l) => l.id_source));
    // Sans cette lecture, l'écriture remettrait à NULL les miniatures existantes : on n'écrit pas du tout.
    if (error) throw new Error(`lecture des miniatures et videos : ${error.message}`);
    // Sans cette lecture, l'écriture pourrait aussi écraser une vidéo rangée chez nous : même règle, on n'écrit pas.
    for (const r of (data ?? []) as { id_source: string; miniature_chemin: string | null; video_url: string | null }[]) {
      enBase.set(r.id_source, r.miniature_chemin);
      videoEnBase.set(r.id_source, r.video_url);
    }
  }
  let miniatures = 0;
  const aEcrire: Record<string, unknown>[] = [];
  for (const l of touchees) {
    const ligne: Record<string, unknown> = colonnes(l);
    // LE VERROU DES VIDÉOS (07/11/2026) : la vidéo rangée chez nous reste, un lien externe n'est jamais écrit.
    // Toujours posée, même à NULL : supabase-js écrit l'union des clés d'un lot (même piège que les miniatures).
    ligne.video_url = videoAEcrire(videoEnBase.get(l.id_source), l.video_url);
    const aDeposer = sourceADeposer(videoEnBase.get(l.id_source), l.video_url, { autoriserMeta: options.autoriserMeta });
    if (aDeposer) file.ajouter(l.source, l.id_source, aDeposer, options.autoriserMeta ?? false);
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
