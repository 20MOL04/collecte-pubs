/**
 * LA COLLECTE PAR UNE SOURCE AUTORISÉE (07/11/2026). Aucun navigateur, aucune lecture de la bibliothèque Meta.
 *
 * Lit les pubs d'un fournisseur sous contrat (format `PubFournie`, lib/pub-track/source-autorisee.ts et
 * docs/SOURCE-AUTORISEE.md), les écrit par le même chemin que le collecteur (verrou des vidéos compris), reclasse,
 * recalcule les scores, puis range AUSSITÔT chaque vidéo reçue dans R2, les meilleures pubs d'abord.
 *
 * Un refus de la source (401, 403, 429) arrête tout et se signale : on ne réessaie pas, on ne contourne pas.
 * Sans source configurée, rien n'est fait.
 *
 *   npx tsx scripts/pub-track/collecter-source.ts [--pays CI,SN] [--depuis 2026-11-01] [--pages 20] [--sec]
 *   npx tsx scripts/pub-track/collecter-source.ts --fichier echantillon.json --sec   (un échantillon du fournisseur)
 *
 * Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_* (dépôt des vidéos), et pour la source :
 *   SOURCE_PUBS_URL   adresse https du fournisseur (rend { "pubs": PubFournie[], "suivant": "<adresse>" | null })
 *   SOURCE_PUBS_CLE   sa clé, envoyée en `Authorization: Bearer` (jamais affichée)
 *   SOURCE_PUBS_VIDEOS_META=oui   seulement si le contrat couvre la recopie de vidéos hébergées chez Meta
 */
import { readFile } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { BUDGET_COLLECTE } from '../../lib/pub-track/budget';
import { PAYS_PUB_TRACK } from '../../lib/pub-track/pays';
import { lirePageSource, premiereAdresse, RefusSource, traduire } from '../../lib/pub-track/source-autorisee';
import { configR2 } from '../../services/stockage/r2';
import { classerBase, recalculer, recalculerScores } from './collecter';
import { deposerFile, FileVideos, ligneBilan } from './deposer-videos';
import { ecrireRecherche } from './ecriture';

function arg(nom: string): string | null {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}

async function main(): Promise<void> {
  const debut = new Date().toISOString();
  const sec = process.argv.includes('--sec');
  const fichier = arg('fichier');
  const base = process.env.SOURCE_PUBS_URL?.trim() || null;
  const cle = process.env.SOURCE_PUBS_CLE?.trim() || null;
  const autoriserMeta = process.env.SOURCE_PUBS_VIDEOS_META === 'oui';
  if (!fichier && !base) {
    console.log('Source autorisee : aucune source configuree (SOURCE_PUBS_URL absente). Rien n est fait.');
    return;
  }
  if (base && !base.startsWith('https://')) throw new Error('SOURCE_PUBS_URL doit etre une adresse https');

  const pays = (arg('pays') ?? PAYS_PUB_TRACK.map((p) => p.code).join(',')).split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
  const pagesMax = Number(arg('pages') ?? 20);

  const brutes: unknown[] = [];
  let refus: string | null = null;
  if (fichier) {
    const contenu = JSON.parse(await readFile(fichier, 'utf8')) as { pubs?: unknown[] } | unknown[];
    brutes.push(...(Array.isArray(contenu) ? contenu : (contenu.pubs ?? [])));
  } else if (base) {
    let adresse: string | null = premiereAdresse(base, pays, arg('depuis'));
    for (let page = 0; adresse && page < pagesMax; page += 1) {
      try {
        const r = await lirePageSource(adresse, cle);
        brutes.push(...r.pubs);
        adresse = r.suivant;
      } catch (err) {
        if (err instanceof RefusSource) {
          refus = err.message;
          break;
        }
        throw err;
      }
    }
  }
  const { lignes, ecartees } = traduire(brutes);
  const avecVideo = lignes.filter((l) => l.video_url).length;
  console.log(`Source autorisee : ${brutes.length} pubs recues, ${lignes.length} retenues (${avecVideo} avec video)${Object.keys(ecartees).length ? `, ecartees ${JSON.stringify(ecartees)}` : ''}${refus ? `, ARRET : ${refus}` : ''}.`);
  if (refus) console.log(`::warning title=La source autorisee a refuse::${refus}. Collecte arretee, sans nouvel essai.`);
  if (sec) {
    for (const l of lignes.slice(0, 3)) console.log(JSON.stringify({ ...l, apercu_source: l.apercu_source ? '(lien)' : null, video_url: l.video_url ? '(lien)' : null }));
    console.log('--sec : rien n est ecrit, aucune video n est deposee.');
    return;
  }
  if (!lignes.length) return;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleSb = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cleSb) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis');
  const sb: SupabaseClient = createClient(url, cleSb, { auth: { persistSession: false } });

  const file = new FileVideos();
  const avecMiniature = new Set<string>();
  const budget = { miniatures: BUDGET_COLLECTE.miniaturesParNuit };
  let nouvelles = 0;
  let miniatures = 0;
  // Par lots de 200 : une erreur de base n'emporte pas toute la collecte d'un coup.
  for (let i = 0; i < lignes.length; i += 200) {
    const r = await ecrireRecherche(sb, lignes.slice(i, i + 200), avecMiniature, budget, { file, autoriserMeta });
    nouvelles += r.nouvelles;
    miniatures += r.miniatures;
  }
  console.log(`Ecrit : ${lignes.length} pubs (${nouvelles} nouvelles), ${miniatures} miniatures, ${file.taille} videos a ranger.`);

  // Le même rangement que la nuit : catégories, groupes, scores (les meilleures pubs d'abord pour le dépôt).
  await classerBase(sb);
  await recalculer(sb);
  await recalculerScores(sb);

  if (file.taille) {
    if (!configR2()) console.log(`Videos R2 : ${file.taille} videos en attente, variables R2_* absentes : rien n est depose.`);
    else console.log(ligneBilan(await deposerFile(sb, file, { minutes: Number(arg('videos-minutes') ?? 30), plafondOctets: BUDGET_COLLECTE.videosR2PlafondOctets })));
  }

  const { error } = await sb.from('pub_track_collectes').insert({
    message: `source autorisee : ${lignes.length} pubs, ${nouvelles} nouvelles, ${file.taille} videos${refus ? `, arret : ${refus}` : ''}`.slice(0, 300),
    debut,
    fin: new Date().toISOString(),
  });
  if (error) console.error(`journal : ${error.message}`);
}

if (/collecter-source\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error('Source autorisee : echec', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
