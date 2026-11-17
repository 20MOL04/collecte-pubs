/**
 * CLOUDFLARE R2, PAR SON API COMPATIBLE S3 (07/11/2026). Décision du fondateur : les vidéos de Pub Track vont
 * directement dans R2, jamais dans Supabase, pour ne pas les déménager deux fois.
 *
 * 15/11/2026 : le projet Supabase a été bloqué (2,72 Go pour 1 Go offert, toute l'API en 402). Depuis, TOUS les
 * fichiers de Creafrik vont dans R2 : le bucket PUBLIC (`R2_BUCKET_PUB_TRACK`, domaine `R2_URL_PUBLIQUE_PUB_TRACK`)
 * pour ce qui était déjà public, le bucket PRIVÉ (`R2_BUCKET_PRIVE`) pour tout le reste, lu par adresse présignée.
 * La seule porte des fichiers privés est `services/stockage/fichiers.ts`.
 *
 * Aucune dépendance : une signature AWS SigV4 minimale (`signerS3` et `presignerS3`, pures, vérifiées sur les
 * exemples publiés par AWS dans `verify-pub-track-affichable.ts` et `verify-stockage-r2.ts`) et `fetch`.
 *
 * Sans les variables `R2_*`, `configR2()` / `configR2Prive()` rendent `null` et rien ne part.
 */
import { createHash, createHmac } from 'node:crypto';

export interface IdentifiantsR2 {
  compte: string;
  cleId: string;
  secret: string;
}

export interface ConfigR2 extends IdentifiantsR2 {
  bucket: string;
  /** Le domaine public du bucket (« https://videos.exemple.com »), sans barre finale. Vide pour le bucket privé. */
  urlPublique: string;
}

export function identifiantsR2(): IdentifiantsR2 | null {
  const compte = process.env.R2_ACCOUNT_ID?.trim();
  const cleId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secret = process.env.R2_SECRET_ACCESS_KEY?.trim();
  return compte && cleId && secret ? { compte, cleId, secret } : null;
}

/**
 * Le bucket PUBLIC : ce qui était déjà public dans Supabase, et seulement ça (vidéos et images de Pub Track, copies
 * partagées d'une affiche, bucket Supabase `partages`).
 */
export function configR2(): ConfigR2 | null {
  const ids = identifiantsR2();
  const bucket = process.env.R2_BUCKET_PUB_TRACK?.trim();
  const urlPublique = urlPubliquePubTrack();
  if (!ids || !bucket || !urlPublique) return null;
  return { ...ids, bucket, urlPublique };
}

/**
 * Le bucket PRIVÉ (15/11/2026) : tous les fichiers d'un vendeur (`original-assets`, `generated-assets`). Aucun
 * domaine public : il ne se lit que par adresse présignée, fabriquée sur le serveur.
 */
export function configR2Prive(): ConfigR2 | null {
  const ids = identifiantsR2();
  const bucket = process.env.R2_BUCKET_PRIVE?.trim();
  return ids && bucket ? { ...ids, bucket, urlPublique: '' } : null;
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

const sha256 = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const hmac = (cle: string | Buffer, v: string) => createHmac('sha256', cle).update(v, 'utf8').digest();
/** RFC 3986, comme S3 l'attend : tout sauf A-Z a-z 0-9 - _ . ~ est encodé. */
const encoder = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const trier = ([a, x]: readonly [string, string], [b, y]: readonly [string, string]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0);
const cleDeSignature = (secret: string, jour: string, region: string, service = 's3') =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, jour), region), service), 'aws4_request');

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
  /** Le service AWS signé (« s3 » par défaut ; « ses » pour l'envoi des courriels, `lib/emails/providers/ses-client.ts`). */
  service?: string;
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
    .sort(trier)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonique = [r.methode, cheminCanonique, requeteCanonique, noms.map((n) => `${n}:${parNom[n]}\n`).join(''), signes, r.empreinteCorps].join('\n');
  const service = r.service ?? 's3';
  const portee = `${jour}/${r.region}/${service}/aws4_request`;
  const aSigner = ['AWS4-HMAC-SHA256', amzDate, portee, sha256(canonique)].join('\n');
  const signature = createHmac('sha256', cleDeSignature(r.secret, jour, r.region, service)).update(aSigner, 'utf8').digest('hex');
  const sortie: Record<string, string> = { ...entetes };
  delete sortie.host;
  sortie.authorization = `AWS4-HMAC-SHA256 Credential=${r.cleId}/${portee}, SignedHeaders=${signes}, Signature=${signature}`;
  return sortie;
}

/** S3 refuse une présignature au-delà de sept jours. */
export const DUREE_PRESIGNEE_MAX_S = 7 * 24 * 60 * 60;

export interface PresignatureS3 {
  methode: string;
  hote: string;
  /** Le chemin, NON encodé. */
  chemin: string;
  /** Paramètres signés en plus des X-Amz-* (« response-content-disposition », par exemple). */
  requete?: Record<string, string>;
  /** En-têtes signés en plus de `host` (« if-none-match », « content-type », « content-length »). */
  entetes?: Record<string, string>;
  date: Date;
  expireS: number;
  region: string;
  cleId: string;
  secret: string;
}

/**
 * La présignature SigV4 par paramètres d'adresse, PURE : rend l'adresse complète. Seul `host` est signé et le corps
 * ne l'est pas (`UNSIGNED-PAYLOAD`) : le navigateur envoie son propre type de contenu. Vérifiée sur l'exemple publié
 * par AWS (« Authenticating Requests: Using Query Parameters ») dans `verify-stockage-r2.ts`.
 */
export function presignerS3(r: PresignatureS3): string {
  const amzDate = r.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const jour = amzDate.slice(0, 8);
  const portee = `${jour}/${r.region}/s3/aws4_request`;
  const expire = Math.max(1, Math.min(DUREE_PRESIGNEE_MAX_S, Math.floor(r.expireS)));
  const parametres: Record<string, string> = {
    ...r.requete,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${r.cleId}/${portee}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expire),
  };
  // Les en-têtes signés en plus de `host` : le client DOIT les envoyer à l'identique, sinon R2 refuse (403).
  const entetes: Record<string, string> = { host: r.hote };
  for (const [k, v] of Object.entries(r.entetes ?? {})) entetes[k.toLowerCase()] = String(v).trim();
  const noms = Object.keys(entetes).sort();
  parametres['X-Amz-SignedHeaders'] = noms.join(';');
  const requeteCanonique = Object.entries(parametres)
    .map(([k, v]) => [encoder(k), encoder(v)] as const)
    .sort(trier)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const cheminCanonique = r.chemin.split('/').map(encoder).join('/');
  const canonique = [r.methode, cheminCanonique, requeteCanonique, noms.map((n) => `${n}:${entetes[n]}\n`).join(''), noms.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const aSigner = ['AWS4-HMAC-SHA256', amzDate, portee, sha256(canonique)].join('\n');
  const signature = createHmac('sha256', cleDeSignature(r.secret, jour, r.region)).update(aSigner, 'utf8').digest('hex');
  return `https://${r.hote}${cheminCanonique}?${requeteCanonique}&X-Amz-Signature=${signature}`;
}

export const hoteR2 = (c: IdentifiantsR2) => `${c.compte}.r2.cloudflarestorage.com`;

/** Une adresse présignée sur un objet du bucket, calculée sans aucun appel réseau. */
export function urlPresigneeR2(c: ConfigR2, methode: 'GET' | 'PUT', cle: string, expireS: number, requete?: Record<string, string>, entetes?: Record<string, string>): string {
  return presignerS3({ methode, hote: hoteR2(c), chemin: `/${c.bucket}/${cle}`, requete, entetes, date: new Date(), expireS, region: 'auto', cleId: c.cleId, secret: c.secret });
}

/**
 * Une adresse d'envoi SIMPLE, liée à son contenu : `if-none-match: *` signé (elle ne peut pas écraser un fichier,
 * donc pas remplacer après validation un fichier déjà envoyé), et le type de contenu signé s'il est donné, la taille
 * aussi pour le bucket public. Le navigateur renvoie ces en-têtes tels quels (sauf `content-length`, qu'il pose seul).
 */
export function envoiPresigneR2(c: ConfigR2, cle: string, expireS: number, contraintes: { type?: string; octets?: number } = {}): { url: string; entetes: Record<string, string> } {
  const entetes: Record<string, string> = { 'if-none-match': '*' };
  if (contraintes.type) entetes['content-type'] = contraintes.type;
  if (contraintes.octets !== undefined) entetes['content-length'] = String(contraintes.octets);
  return { url: urlPresigneeR2(c, 'PUT', cle, expireS, undefined, entetes), entetes };
}

/** Relit une adresse présignée de CE compte : le bucket et la clé, décodés. `null` pour toute autre adresse. */
export function lireUrlPresigneeR2(url: string, c: IdentifiantsR2): { bucket: string; cle: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.host !== hoteR2(c) || !u.searchParams.has('X-Amz-Signature')) return null;
  // Le chemin BRUT de l'adresse, jamais `u.pathname` : l'analyseur d'URL résout `%2e%2e` en `..` et remonterait de
  // dossier en silence. Un segment `.` ou `..`, même encodé, rend l'adresse illisible.
  const brut = /^https:\/\/[^/?#]+(\/[^?#]*)/i.exec(url)?.[1];
  if (!brut) return null;
  try {
    const segments = brut.split('/').slice(1).map((s) => decodeURIComponent(s));
    if (segments.some((s) => s === '.' || s === '..' || s === '' || s.includes('/'))) return null;
    const [bucket, ...reste] = segments;
    return bucket && reste.length ? { bucket, cle: reste.join('/') } : null;
  } catch {
    return null;
  }
}

type MethodeR2 = 'PUT' | 'GET' | 'DELETE' | 'HEAD' | 'POST';

async function appelR2(
  c: ConfigR2,
  methode: MethodeR2,
  cle: string,
  opts: { corps?: Uint8Array; requete?: Record<string, string>; entetes?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> {
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
  return fetch(url, { method: methode, headers: entetes, body: opts.corps ? Buffer.from(opts.corps) : undefined, signal: opts.signal ?? AbortSignal.timeout(120_000) });
}

export class ObjetDejaPresentR2 extends Error {
  constructor(cle: string) {
    super(`R2 : objet déjà présent (${cle})`);
    this.name = 'ObjetDejaPresentR2';
  }
}

/**
 * Dépose un objet. Rend son adresse publique (sans objet pour le bucket privé). `sansEcraser` refuse un objet déjà
 * présent (`If-None-Match: *`, réponse 412) : le pendant de `upsert: false` chez Supabase.
 */
export async function deposerR2(c: ConfigR2, cle: string, corps: Uint8Array, typeContenu: string, cacheControl: string, options: { sansEcraser?: boolean } = {}): Promise<string> {
  const entetes: Record<string, string> = { 'content-type': typeContenu, 'cache-control': cacheControl };
  if (options.sansEcraser) entetes['if-none-match'] = '*';
  const r = await appelR2(c, 'PUT', cle, { corps, entetes });
  if (r.status === 412) throw new ObjetDejaPresentR2(cle);
  if (!r.ok) throw new Error(`R2 PUT ${r.status} ${(await r.text()).slice(0, 200)}`);
  return `${c.urlPublique}/${cle.split('/').map(encoder).join('/')}`;
}

/** Lit un objet. `null` s'il n'existe pas ; toute autre erreur lève. */
export async function lireR2(c: ConfigR2, cle: string, signal?: AbortSignal): Promise<Response | null> {
  const r = await appelR2(c, 'GET', cle, { signal });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`R2 GET ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}

/** La taille et le type d'un objet, sans le lire. `null` s'il n'existe pas. */
export async function teteR2(c: ConfigR2, cle: string): Promise<{ octets: number; type: string | null } | null> {
  const r = await appelR2(c, 'HEAD', cle);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`R2 HEAD ${r.status}`);
  return { octets: Number(r.headers.get('content-length')) || 0, type: r.headers.get('content-type') };
}

const decoderXml = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Les objets DIRECTEMENT sous un préfixe (délimiteur « / »), avec leur taille. */
export async function listerR2(c: ConfigR2, prefixe: string, max = 1000): Promise<{ cle: string; octets: number }[]> {
  const sortie: { cle: string; octets: number }[] = [];
  let jeton: string | null = null;
  do {
    const requete: Record<string, string> = { 'list-type': '2', prefix: prefixe, delimiter: '/', 'max-keys': String(Math.min(1000, max)) };
    if (jeton) requete['continuation-token'] = jeton;
    const r = await appelR2(c, 'GET', '', { requete });
    const xml = await r.text();
    if (!r.ok) throw new Error(`R2 LIST ${r.status} ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const cle = /<Key>([^<]*)<\/Key>/.exec(m[1] ?? '')?.[1];
      if (cle) sortie.push({ cle: decoderXml(cle), octets: Number(/<Size>(\d+)<\/Size>/.exec(m[1] ?? '')?.[1]) || 0 });
    }
    jeton = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
  } while (jeton && sortie.length < max);
  return sortie.slice(0, max);
}

/*
 * L'ENVOI PAR MORCEAUX (multipart S3), pour qu'un téléphone sur un réseau faible ne reparte pas de zéro après une
 * coupure : chaque morceau a sa propre adresse présignée et se renvoie seul. R2 exige des morceaux de même taille,
 * le dernier excepté, et 5 Mo au moins. La fin se fait sur le serveur, sans que le navigateur ait à lire les ETag :
 * la liste des morceaux reçus vient de R2 lui-même (`ListParts`).
 */
export const TAILLE_MORCEAU_R2 = 8 * 1024 * 1024;

export async function ouvrirEnvoiMorceleR2(c: ConfigR2, cle: string, typeContenu: string): Promise<string> {
  const r = await appelR2(c, 'POST', cle, { requete: { uploads: '' }, entetes: { 'content-type': typeContenu } });
  const xml = await r.text();
  const id = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
  if (!r.ok || !id) throw new Error(`R2 multipart ${r.status} ${xml.slice(0, 200)}`);
  return decoderXml(id);
}

/** Les adresses d'envoi des morceaux, numérotés à partir de 1. */
export function adressesMorceauxR2(c: ConfigR2, cle: string, envoiId: string, octets: number, expireS: number): string[] {
  const n = Math.max(1, Math.ceil(octets / TAILLE_MORCEAU_R2));
  return Array.from({ length: n }, (_, i) => urlPresigneeR2(c, 'PUT', cle, expireS, { partNumber: String(i + 1), uploadId: envoiId }));
}

/**
 * Termine L'envoi par morceaux `envoiId` (celui du jeton remis au navigateur, rangé au registre), et lui seul.
 * Rend `false` s'il n'existe plus (déjà terminé ou abandonné) ou n'a reçu aucun morceau.
 */
export async function terminerEnvoiMorceleR2(c: ConfigR2, cle: string, envoiId: string): Promise<boolean> {
  const lp = await appelR2(c, 'GET', cle, { requete: { uploadId: envoiId, 'max-parts': '1000' } });
  const parts = await lp.text();
  if (lp.status === 404) return false;
  if (!lp.ok) throw new Error(`R2 parts ${lp.status} ${parts.slice(0, 200)}`);
  const morceaux = [...parts.matchAll(/<Part>([\s\S]*?)<\/Part>/g)]
    .map((p) => ({ n: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(p[1] ?? '')?.[1]), etag: decoderXml(/<ETag>([^<]*)<\/ETag>/.exec(p[1] ?? '')?.[1] ?? '') }))
    .filter((p) => p.n > 0 && p.etag)
    .sort((a, b) => a.n - b.n);
  if (morceaux.length === 0) return false;
  const corps = `<CompleteMultipartUpload>${morceaux.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  const fin = await appelR2(c, 'POST', cle, { requete: { uploadId: envoiId }, corps: new TextEncoder().encode(corps), entetes: { 'content-type': 'application/xml' } });
  const reponse = await fin.text();
  if (!fin.ok || /<Error>/.test(reponse)) throw new Error(`R2 fin multipart ${fin.status} ${reponse.slice(0, 200)}`);
  return true;
}

export interface RegleCorsR2 {
  origines: string[];
  methodes: ('GET' | 'HEAD' | 'PUT' | 'POST' | 'DELETE')[];
  entetes: string[];
  exposes: string[];
  ageMaxS: number;
}

/** Le XML S3 d'une configuration CORS (PutBucketCors), PUR. */
export function xmlCorsR2(regles: RegleCorsR2[]): string {
  const x = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>${regles
    .map(
      (r) =>
        `<CORSRule>${r.origines.map((o) => `<AllowedOrigin>${x(o)}</AllowedOrigin>`).join('')}${r.methodes.map((m) => `<AllowedMethod>${m}</AllowedMethod>`).join('')}${r.entetes
          .map((h) => `<AllowedHeader>${x(h)}</AllowedHeader>`)
          .join('')}${r.exposes.map((h) => `<ExposeHeader>${x(h)}</ExposeHeader>`).join('')}<MaxAgeSeconds>${r.ageMaxS}</MaxAgeSeconds></CORSRule>`,
    )
    .join('')}</CORSConfiguration>`;
}

/** La configuration CORS actuelle du bucket, en XML (`null` s'il n'en a aucune). */
export async function lireCorsR2(c: ConfigR2): Promise<string | null> {
  const r = await appelR2(c, 'GET', '', { requete: { cors: '' } });
  const xml = await r.text();
  if (r.status === 404 || /NoSuchCORSConfiguration/.test(xml)) return null;
  if (!r.ok) throw new Error(`R2 GET cors ${r.status} ${xml.slice(0, 200)}`);
  return xml;
}

/** Applique une configuration CORS au bucket (PutBucketCors, avec Content-MD5 comme S3 l'exige). */
export async function appliquerCorsR2(c: ConfigR2, regles: RegleCorsR2[]): Promise<void> {
  const corps = new TextEncoder().encode(xmlCorsR2(regles));
  const md5 = createHash('md5').update(corps).digest('base64');
  const r = await appelR2(c, 'PUT', '', { requete: { cors: '' }, corps, entetes: { 'content-type': 'application/xml', 'content-md5': md5 } });
  if (!r.ok) throw new Error(`R2 PUT cors ${r.status} ${(await r.text()).slice(0, 300)}`);
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

/** Retire un objet. Un objet déjà absent n'est pas une erreur pour S3. */
export async function supprimerR2(c: ConfigR2, cle: string): Promise<number> {
  const r = await appelR2(c, 'DELETE', cle);
  if (!r.ok && r.status !== 404) throw new Error(`R2 DELETE ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status;
}
