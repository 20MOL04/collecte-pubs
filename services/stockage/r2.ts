/**
 * CLOUDFLARE R2, PAR SON API COMPATIBLE S3 (07/11/2026). Décision du fondateur : les vidéos de Pub Track vont
 * directement dans R2, jamais dans Supabase, pour ne pas les déménager deux fois.
 *
 * Aucune dépendance : une signature AWS SigV4 minimale (`signerS3`, pure, vérifiée sur l'exemple publié par AWS dans
 * `verify-pub-track-affichable.ts`) et `fetch`. Deux gestes seulement : déposer un objet, et additionner la taille
 * des objets d'un préfixe (le plafond se MESURE, il ne se suppose pas).
 *
 * Sans les cinq variables `R2_*`, `configR2()` rend `null` et rien ne part.
 */
import { createHash, createHmac } from 'node:crypto';

export interface ConfigR2 {
  compte: string;
  cleId: string;
  secret: string;
  bucket: string;
  /** Le domaine public du bucket (« https://videos.exemple.com »), sans barre finale. */
  urlPublique: string;
}

export function configR2(): ConfigR2 | null {
  const compte = process.env.R2_ACCOUNT_ID?.trim();
  const cleId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secret = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_PUB_TRACK?.trim();
  const urlPublique = urlPubliquePubTrack();
  if (!compte || !cleId || !secret || !bucket || !urlPublique) return null;
  return { compte, cleId, secret, bucket, urlPublique };
}

/** Le domaine public du bucket des vidéos de Pub Track, https seulement, ou `null`. */
export function urlPubliquePubTrack(): string | null {
  const brut = process.env.R2_URL_PUBLIQUE_PUB_TRACK?.trim().replace(/\/+$/, '');
  return brut && /^https:\/\/[^\s"*,()]+$/.test(brut) ? brut : null;
}

/** Les variables R2 absentes, par leur nom (jamais leur valeur) : le banc dit laquelle manque. */
export function variablesR2Absentes(): string[] {
  const noms = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PUB_TRACK'].filter((n) => !process.env[n]?.trim());
  return urlPubliquePubTrack() ? noms : [...noms, 'R2_URL_PUBLIQUE_PUB_TRACK'];
}

/**
 * L'état du bucket, LU sans rien créer (une liste d'un objet) : prêt, bucket absent, accès refusé (R2 non activé ou
 * clé sans droit sur ce bucket), ou autre erreur, avec le code d'erreur rendu par R2.
 */
export async function sonderBucketR2(c: Omit<ConfigR2, 'urlPublique'>): Promise<{ etat: 'pret' | 'bucket_absent' | 'acces_refuse' | 'r2_inactif' | 'erreur'; code: string; statut: number }> {
  try {
    const r = await appelR2({ ...c, urlPublique: '' }, 'GET', '', { requete: { 'list-type': '2', 'max-keys': '1' } });
    const xml = await r.text();
    const code = /<Code>([^<]*)<\/Code>/.exec(xml)?.[1] ?? (r.ok ? 'OK' : `HTTP ${r.status}`);
    if (r.ok) return { etat: 'pret', code, statut: r.status };
    if (code === 'NoSuchBucket' || r.status === 404) return { etat: 'bucket_absent', code, statut: r.status };
    if (r.status === 401 || r.status === 403) return { etat: 'acces_refuse', code, statut: r.status };
    return { etat: 'erreur', code, statut: r.status };
  } catch (e) {
    // Mesuré le 07/11/2026 : tant que R2 n'est pas activé, l'hôte du compte refuse la poignée de main TLS.
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
    return { etat: /HANDSHAKE|ENOTFOUND/i.test(code) ? 'r2_inactif' : 'erreur', code, statut: 0 };
  }
}

const sha256 =(v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const hmac = (cle: string | Buffer, v: string) => createHmac('sha256', cle).update(v, 'utf8').digest();
/** RFC 3986, comme S3 l'attend : tout sauf A-Z a-z 0-9 - _ . ~ est encodé. */
const encoder = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface RequeteS3 {
  methode: string;
  hote: string;
  /** Le chemin, NON encodé (« /bucket/videos/x.mp4 ») : chaque segment est encodé ici. */
  chemin: string;
  requete?: Record<string, string>;
  /** En-têtes signés en plus de host, x-amz-date et x-amz-content-sha256 (noms en minuscules). */
  entetes?: Record<string, string>;
  empreinteCorps: string;
  date: Date;
  region: string;
  cleId: string;
  secret: string;
}

/** La signature SigV4, PURE : rend les en-têtes à poser sur la requête, `authorization` compris. */
export function signerS3(r: RequeteS3): Record<string, string> {
  const amzDate = r.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const jour = amzDate.slice(0, 8);
  const entetes: Record<string, string> = { ...r.entetes, host: r.hote, 'x-amz-content-sha256': r.empreinteCorps, 'x-amz-date': amzDate };
  const noms = Object.keys(entetes).map((n) => n.toLowerCase()).sort();
  const parNom = Object.fromEntries(Object.entries(entetes).map(([n, v]) => [n.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const signes = noms.join(';');
  const cheminCanonique = r.chemin.split('/').map(encoder).join('/');
  const requeteCanonique = Object.entries(r.requete ?? {})
    .map(([k, v]) => [encoder(k), encoder(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonique = [r.methode, cheminCanonique, requeteCanonique, noms.map((n) => `${n}:${parNom[n]}\n`).join(''), signes, r.empreinteCorps].join('\n');
  const portee = `${jour}/${r.region}/s3/aws4_request`;
  const aSigner = ['AWS4-HMAC-SHA256', amzDate, portee, sha256(canonique)].join('\n');
  const cle = hmac(hmac(hmac(hmac(`AWS4${r.secret}`, jour), r.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', cle).update(aSigner, 'utf8').digest('hex');
  const sortie: Record<string, string> = { ...entetes };
  delete sortie.host;
  sortie.authorization = `AWS4-HMAC-SHA256 Credential=${r.cleId}/${portee}, SignedHeaders=${signes}, Signature=${signature}`;
  return sortie;
}

const hoteR2 = (c: ConfigR2) => `${c.compte}.r2.cloudflarestorage.com`;

async function appelR2(c: ConfigR2, methode: 'PUT' | 'GET' | 'DELETE', cle: string, opts: { corps?: Uint8Array; requete?: Record<string, string>; entetes?: Record<string, string> } = {}): Promise<Response> {
  const chemin = `/${c.bucket}${cle ? `/${cle}` : ''}`;
  const entetes = signerS3({
    methode,
    hote: hoteR2(c),
    chemin,
    requete: opts.requete,
    entetes: opts.entetes,
    empreinteCorps: sha256(opts.corps ?? ''),
    date: new Date(),
    region: 'auto',
    cleId: c.cleId,
    secret: c.secret,
  });
  // Encodée comme la requête canonique, sinon la signature ne correspond plus (un « + » de jeton, par exemple).
  const qs = Object.entries(opts.requete ?? {}).map(([k, v]) => `${encoder(k)}=${encoder(v)}`).join('&');
  const url = `https://${hoteR2(c)}${chemin.split('/').map(encoder).join('/')}${qs ? `?${qs}` : ''}`;
  return fetch(url, { method: methode, headers: entetes, body: opts.corps ? Buffer.from(opts.corps) : undefined, signal: AbortSignal.timeout(60_000) });
}

/** Dépose un objet. Rend son adresse publique. */
export async function deposerR2(c: ConfigR2, cle: string, corps: Uint8Array, typeContenu: string, cacheControl: string): Promise<string> {
  const r = await appelR2(c, 'PUT', cle, { corps, entetes: { 'content-type': typeContenu, 'cache-control': cacheControl } });
  if (!r.ok) throw new Error(`R2 PUT ${r.status} ${(await r.text()).slice(0, 200)}`);
  return `${c.urlPublique}/${cle.split('/').map(encoder).join('/')}`;
}

/** La place occupée par un préfixe, en octets, et la taille d'un objet précis s'il existe (ListObjectsV2). */
export async function occupationR2(c: ConfigR2, prefixe: string, cleSuivie?: string): Promise<{ total: number; objet: number }> {
  let total = 0;
  let objet = 0;
  let jeton: string | null = null;
  do {
    const requete: Record<string, string> = { 'list-type': '2', prefix: prefixe, 'max-keys': '1000' };
    if (jeton) requete['continuation-token'] = jeton;
    const r = await appelR2(c, 'GET', '', { requete });
    const xml = await r.text();
    if (!r.ok) throw new Error(`R2 LIST ${r.status} ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const taille = Number(/<Size>(\d+)<\/Size>/.exec(m[1] ?? '')?.[1]) || 0;
      total += taille;
      if (cleSuivie && /<Key>([^<]*)<\/Key>/.exec(m[1] ?? '')?.[1] === cleSuivie) objet = taille;
    }
    jeton = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
  } while (jeton);
  return { total, objet };
}

/** Retire un objet (le banc nettoie derrière lui). Un objet déjà absent n'est pas une erreur pour S3. */
export async function supprimerR2(c: ConfigR2, cle: string): Promise<number> {
  const r = await appelR2(c, 'DELETE', cle);
  if (!r.ok && r.status !== 404) throw new Error(`R2 DELETE ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status;
}
