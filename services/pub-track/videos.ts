/**
 * LES VIDÉOS DE PUB TRACK, RANGÉES CHEZ NOUS : le dépôt dans Cloudflare R2, côté robot (07/11/2026).
 *
 * Même dépôt que l'application (`20MOL04/creafrik`, services/pub-track/videos.ts) : même clé `videos/<id>.mp4`, même
 * réencodage 480p H.264 « faststart », même plafond MESURÉ sur le bucket (8 Go par défaut). Deux différences :
 * - ffmpeg vient du système (`FFMPEG_PATH`, sinon `ffmpeg` du PATH ; le workflow l'installe), pas d'`ffmpeg-static` ;
 * - le client Supabase est passé par l'appelant (pas d'alias `@/`, pas de `server-only`).
 *
 * Sans les variables `R2_*`, rien ne part (`r2_absent`) avant tout téléchargement. Un CDN de Meta est refusé
 * (`url_meta`) sauf si l'appelant l'autorise pour une source sous contrat (voir lib/pub-track/video-chez-nous.ts).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { estAdresseMeta } from '../../lib/pub-track/video-chez-nous';
import { configR2, deposerR2, occupationR2, type ConfigR2 } from '../stockage/r2';

const DOSSIER = 'videos/';
const GO = 1024 ** 3;

export const PLAFOND_VIDEOS_OCTETS_DEFAUT = 8 * GO;
/** Une pub de plus de 300 Mo à la source n'est pas une pub sociale. */
export const SOURCE_MAX_OCTETS = 300 * 1024 * 1024;
const DUREE_MAX_S = 300;
const DELAI_TELECHARGEMENT_MS = 60_000;
const DELAI_ENCODAGE_MS = 180_000;

export type RaisonRefusVideo =
  | 'id_invalide'
  | 'url_invalide'
  | 'url_meta'
  | 'r2_absent'
  | 'plafond_atteint'
  | 'telechargement'
  | 'trop_lourde'
  | 'encodage'
  | 'depot'
  | 'mise_a_jour';

export type ResultatDepotVideo =
  | { ok: true; cle: string; url: string; octets: number; occupeOctets: number }
  | { ok: false; raison: RaisonRefusVideo; detail?: string };

/** Ce dont le dépôt a besoin hors de lui-même : remplaçable dans les tests, sans réseau ni ffmpeg. */
export interface OutilsDepot {
  occupation(c: ConfigR2, prefixe: string, cleSuivie?: string): Promise<{ total: number; objet: number }>;
  deposer(c: ConfigR2, cle: string, corps: Uint8Array, type: string, cache: string): Promise<string>;
  telecharger(url: string): Promise<Uint8Array | 'trop_lourde'>;
  reencoder(octets: Uint8Array): Promise<{ ok: true; fichier: Uint8Array } | { ok: false; detail: string }>;
  /** Pose la nouvelle adresse sur la pub. `null` = réussi ; sinon le message d'erreur. */
  majBase(id: string, url: string): Promise<string | null>;
}

export const cleVideo = (id: string) => `${DOSSIER}${id}.mp4`;

/** La commande ffmpeg, PURE : identique à celle de l'application. */
export function argsReencodage(entree: string, sortie: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-y',
    '-i', entree,
    '-t', String(DUREE_MAX_S),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale=w='if(gt(iw,ih),-2,min(480,iw))':h='if(gt(iw,ih),min(480,ih),-2)'",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-movflags', '+faststart',
    sortie,
  ];
}

export function lancerFfmpeg(binaire: string, args: string[], dossier: string, delaiMs: number): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(binaire, args, { cwd: dossier });
    let stderr = '';
    p.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const minuterie = setTimeout(() => p.kill('SIGKILL'), delaiMs);
    p.on('error', (e) => {
      clearTimeout(minuterie);
      resolve({ ok: false, stderr: String(e) });
    });
    p.on('close', (code) => {
      clearTimeout(minuterie);
      resolve({ ok: code === 0, stderr });
    });
  });
}

export async function reencoder480p(octets: Uint8Array): Promise<{ ok: true; fichier: Uint8Array } | { ok: false; detail: string }> {
  const binaire = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const dossier = await mkdtemp(join(tmpdir(), 'pub-track-video-'));
  try {
    await writeFile(join(dossier, 'source'), octets);
    const r = await lancerFfmpeg(binaire, argsReencodage('source', 'sortie.mp4'), dossier, DELAI_ENCODAGE_MS);
    if (!r.ok) return { ok: false, detail: r.stderr.slice(-400) };
    return { ok: true, fichier: await readFile(join(dossier, 'sortie.mp4')) };
  } finally {
    await rm(dossier, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function telechargerVideo(url: string): Promise<Uint8Array | 'trop_lourde'> {
  const r = await fetch(url, { signal: AbortSignal.timeout(DELAI_TELECHARGEMENT_MS), redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  if (Number(r.headers.get('content-length')) > SOURCE_MAX_OCTETS) return 'trop_lourde';
  const morceaux: Uint8Array[] = [];
  let lus = 0;
  const lecteur = r.body.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    lus += value.byteLength;
    if (lus > SOURCE_MAX_OCTETS) {
      await lecteur.cancel();
      return 'trop_lourde';
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux);
}

/** Les outils réels : R2, fetch, ffmpeg, et la mise à jour de `pub_track_pubs.video_url` par son `id`. */
export function outilsReels(sb: { from(t: string): any }): OutilsDepot {
  return {
    occupation: occupationR2,
    deposer: deposerR2,
    telecharger: telechargerVideo,
    reencoder: reencoder480p,
    async majBase(id, url) {
      const { error } = await sb.from('pub_track_pubs').update({ video_url: url }).eq('id', id);
      return error ? error.message : null;
    },
  };
}

/**
 * Télécharge une vidéo depuis une adresse FOURNIE, la réencode en 480p, la dépose sous `videos/<id>.mp4` et pose
 * `video_url`. Le plafond est mesuré avant le téléchargement et juste avant le dépôt.
 */
export async function deposerVideoPubTrack(
  id: string,
  urlSource: string,
  options: { outils: OutilsDepot; r2?: ConfigR2 | null; plafondOctets?: number; autoriserMeta?: boolean },
): Promise<ResultatDepotVideo> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { ok: false, raison: 'id_invalide' };
  let source: URL;
  try {
    source = new URL(urlSource);
  } catch {
    return { ok: false, raison: 'url_invalide' };
  }
  if (source.protocol !== 'https:') return { ok: false, raison: 'url_invalide' };
  if (estAdresseMeta(source.toString()) && !options.autoriserMeta) return { ok: false, raison: 'url_meta' };
  const r2 = options.r2 === undefined ? configR2() : options.r2;
  if (!r2) return { ok: false, raison: 'r2_absent' };
  const plafond = options.plafondOctets ?? PLAFOND_VIDEOS_OCTETS_DEFAUT;
  const o = options.outils;
  const cle = cleVideo(id);

  try {
    const { total } = await o.occupation(r2, DOSSIER);
    if (total >= plafond) return { ok: false, raison: 'plafond_atteint', detail: `${total} octets sur ${plafond}` };
  } catch (e) {
    return { ok: false, raison: 'depot', detail: e instanceof Error ? e.message : String(e) };
  }

  let octets: Uint8Array | 'trop_lourde';
  try {
    octets = await o.telecharger(source.toString());
  } catch (e) {
    return { ok: false, raison: 'telechargement', detail: e instanceof Error ? e.message : String(e) };
  }
  if (octets === 'trop_lourde') return { ok: false, raison: 'trop_lourde' };

  const encode = await o.reencoder(octets);
  if (!encode.ok) return { ok: false, raison: 'encodage', detail: encode.detail };

  let occupe: number;
  try {
    const m = await o.occupation(r2, DOSSIER, cle);
    occupe = m.total - m.objet;
  } catch (e) {
    return { ok: false, raison: 'depot', detail: e instanceof Error ? e.message : String(e) };
  }
  if (occupe + encode.fichier.byteLength > plafond) return { ok: false, raison: 'plafond_atteint', detail: `${occupe + encode.fichier.byteLength} octets sur ${plafond}` };

  let url: string;
  try {
    url = `${await o.deposer(r2, cle, encode.fichier, 'video/mp4', 'public, max-age=31536000, immutable')}?v=${Date.now()}`;
  } catch (e) {
    return { ok: false, raison: 'depot', detail: e instanceof Error ? e.message : String(e) };
  }
  const erreur = await o.majBase(id, url);
  if (erreur) return { ok: false, raison: 'mise_a_jour', detail: erreur };
  return { ok: true, cle, url, octets: encode.fichier.byteLength, occupeOctets: occupe + encode.fichier.byteLength };
}
