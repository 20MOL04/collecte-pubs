/**
 * LE VERROU DES VIDÉOS RANGÉES CHEZ NOUS (07/11/2026). Fonctions PURES, testées dans `tests/video-chez-nous.test.ts`.
 *
 * Les liens vidéo des CDN de Meta (fbcdn) et de TikTok expirent en quelques jours : le 07/11/2026, les 10 868 vidéos
 * Meta de la base avaient toutes un lien périmé. Les vidéos se rangent donc dans Cloudflare R2, sous
 * `https://media.creafrik.com/videos/<id>.mp4` (services/pub-track/videos.ts), et l'application ne lit QUE celles-là.
 *
 * Deux règles, appliquées à CHAQUE écriture de `pub_track_pubs` par le collecteur (scripts/pub-track/ecriture.ts) :
 * 1. une `video_url` déjà chez nous n'est JAMAIS réécrite, ni par un lien neuf ni par NULL ;
 * 2. un lien externe (fbcdn, TikTok, fournisseur) n'est JAMAIS écrit en `video_url` : il sert seulement de source
 *    au dépôt dans R2, en mémoire, le temps de la collecte.
 */

/** L'adresse publique du bucket R2 de Pub Track. La variable d'environnement prime ; la valeur par défaut est celle posée le 07/11/2026. */
export const URL_PUBLIQUE_R2_DEFAUT = 'https://media.creafrik.com';

/** Les vidéos rangées par compatibilité dans le bucket Supabase `pub-track` (ancien chemin, avant R2). */
export const MARQUE_VIDEO_SUPABASE = '/storage/v1/object/public/pub-track/videos/';

/** Le domaine public R2, https seulement, sans barre finale. Une valeur mal formée retombe sur la valeur par défaut. */
export function urlPubliqueR2(env: Record<string, string | undefined> = process.env): string {
  const brut = env.R2_URL_PUBLIQUE_PUB_TRACK?.trim().replace(/\/+$/, '');
  return brut && /^https:\/\/[^\s"*,()/]+$/.test(brut) ? brut : URL_PUBLIQUE_R2_DEFAUT;
}

/**
 * Une adresse de vidéo rangée chez nous. `media.creafrik.com` compte TOUJOURS, même si la variable désigne un autre
 * domaine : le verrou ne doit jamais céder à cause d'une variable mal posée.
 */
export function estVideoChezNous(url: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!url) return false;
  return url.startsWith(`${URL_PUBLIQUE_R2_DEFAUT}/`) || url.startsWith(`${urlPubliqueR2(env)}/`) || url.includes(MARQUE_VIDEO_SUPABASE);
}

/** Les hôtes des CDN de Meta. Le dépôt dans R2 ne télécharge jamais depuis eux (règle de services/pub-track/videos.ts). */
const HOTES_META = [/(^|\.)fbcdn\.net$/i, /(^|\.)facebook\.com$/i, /(^|\.)fbsbx\.com$/i, /(^|\.)cdninstagram\.com$/i, /(^|\.)instagram\.com$/i, /(^|\.)fb\.com$/i];

export function estAdresseMeta(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const hote = new URL(url).hostname;
    return HOTES_META.some((h) => h.test(hote));
  } catch {
    return false;
  }
}

/**
 * La `video_url` à écrire pour une pub, à partir de celle déjà en base et de celle que la collecte vient de lire.
 * Ne rend JAMAIS un lien externe : la vidéo de chez nous en base, sinon une vidéo de chez nous neuve, sinon NULL.
 */
export function videoAEcrire(enBase: string | null | undefined, lue: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (enBase && estVideoChezNous(enBase, env)) return enBase;
  if (lue && estVideoChezNous(lue, env)) return lue;
  return null;
}

/**
 * La source à déposer dans R2 : le lien lu, s'il est https, externe et encore inconnu chez nous. `null` sinon. Une pub
 * déjà rangée chez nous ne repart jamais au dépôt.
 *
 * Un CDN de Meta est refusé par défaut : le collecteur de la bibliothèque publique n'y télécharge rien (règle de
 * services/pub-track/videos.ts). Seule une source SOUS CONTRAT peut l'autoriser (`autoriserMeta`, décision de Martin,
 * `SOURCE_PUBS_VIDEOS_META=oui`), quand son contrat couvre la recopie des vidéos qu'elle livre.
 */
export function sourceADeposer(
  enBase: string | null | undefined,
  lue: string | null | undefined,
  options: { autoriserMeta?: boolean; env?: Record<string, string | undefined> } = {},
): string | null {
  const env = options.env ?? process.env;
  if (estVideoChezNous(enBase, env) || !lue || estVideoChezNous(lue, env)) return null;
  if (estAdresseMeta(lue) && !options.autoriserMeta) return null;
  try {
    return new URL(lue).protocol === 'https:' ? lue : null;
  } catch {
    return null;
  }
}

export interface CandidateVideo {
  /** `pub_track_pubs.id` : la clé du fichier, `videos/<id>.mp4`. */
  id: string;
  urlSource: string;
  score: number | null;
  statut: string | null;
}

const RANG_STATUT: Record<string, number> = { gagnante: 0, montante: 1, nouvelle: 2 };

/** L'ordre du dépôt : les gagnantes d'abord, puis les montantes, puis le score décroissant. Rend une copie. */
export function ordreDepot<T extends Pick<CandidateVideo, 'score' | 'statut'>>(candidates: readonly T[]): T[] {
  const rang = (s: string | null) => (s && s in RANG_STATUT ? RANG_STATUT[s] : 3);
  return [...candidates].sort((a, b) => rang(a.statut) - rang(b.statut) || (b.score ?? -1) - (a.score ?? -1));
}
