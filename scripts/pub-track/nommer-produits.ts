/**
 * Nomme les produits de la vitrine Pub Track (09/10/2026, `lib/pub-track/nom-produit.ts`).
 *
 * Appelé en fin de nuit par `collecter.ts`, ou seul :
 *   npx tsx --env-file=.env.local scripts/pub-track/nommer-produits.ts [--max 400] [--source tiktok]
 *
 * Un appel au modèle de vision par lot de 10 pubs (image + légende), jamais deux : une
 * réponse illisible laisse le lot sans nom, et `nomme_le` reste vide pour la nuit suivante.
 * Sans `GEMINI_API_KEY`, rien n'est fait : le panneau garde le repli sans modèle.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { coutTexteUsd } from '../../services/ai/providers/cout-texte';
import { modeleVisionPubTrack } from '../../lib/pub-track/modele';
import { consigneFamilles, consigneImages, consigneNommage, lireFamilles, lireImages, lireNomsProduits, LOT_NOMMAGE, type Cadre, type PubANommer } from '../../lib/pub-track/nom-produit';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Ligne {
  id: string;
  texte: string | null;
  titre: string | null;
  niche: string | null;
  categorie: string;
  miniature_chemin: string;
}

async function image(base: string, chemin: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/storage/v1/object/public/pub-track/${chemin}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    // 384 px suffisent pour reconnaître un objet, et coûtent quatre fois moins de jetons qu'une miniature pleine.
    const petite = await sharp(Buffer.from(await res.arrayBuffer())).resize(384, 384, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
    return petite.toString('base64');
  } catch {
    return null;
  }
}

/** En dessous, une découpe n'est pas une image produit utilisable dans une boutique. */
const COTE_MIN_DECOUPE = 180;

/**
 * Découpe la miniature sur le produit (cadre du modèle, 0 à 1000, marge de 6 %) et la range à part,
 * `produits/<id>.webp`. Rend null quand la découpe serait trop petite : le kit n'enverra pas une
 * vignette illisible, il préférera ne rien envoyer.
 */
async function recadrerProduit(sb: SupabaseClient, base: string, chemin: string, cadre: Cadre, id: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/storage/v1/object/public/pub-track/${chemin}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const source = Buffer.from(await res.arrayBuffer());
    const { width: w = 0, height: h = 0 } = await sharp(source).metadata();
    if (!w || !h) return null;
    const [y0, x0, y1, x1] = cadre;
    const marge = 0.06;
    const gauche = Math.max(0, Math.floor(((x0 - (x1 - x0) * marge) / 1000) * w));
    const haut = Math.max(0, Math.floor(((y0 - (y1 - y0) * marge) / 1000) * h));
    const droite = Math.min(w, Math.ceil(((x1 + (x1 - x0) * marge) / 1000) * w));
    const bas = Math.min(h, Math.ceil(((y1 + (y1 - y0) * marge) / 1000) * h));
    if (droite - gauche < COTE_MIN_DECOUPE || bas - haut < COTE_MIN_DECOUPE) return null;
    const decoupe = await sharp(source).extract({ left: gauche, top: haut, width: droite - gauche, height: bas - haut }).webp({ quality: 85 }).toBuffer();
    const cible = `produits/${id}.webp`;
    const { error } = await sb.storage.from('pub-track').upload(cible, decoupe, { contentType: 'image/webp', upsert: true });
    return error ? null : cible;
  } catch {
    return null;
  }
}

interface Compteur {
  coutUsd: number;
  jetonsEntree: number;
  jetonsSortie: number;
}

/**
 * UN appel au modèle, compté. 'arret' : clé refusée ou quota (inutile d'insister cette nuit) ;
 * 'echec' : pas de réponse exploitable ; sinon le JSON lu, ou null s'il est illisible (payé quand même).
 */
async function appelerGemini(cle: string, modele: string, parts: Record<string, unknown>[], compteur: Compteur): Promise<'arret' | 'echec' | { json: unknown }> {
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(modele)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cle },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 16384 },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const corps = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    } | null;
    const u = corps?.usageMetadata;
    const entree = u?.promptTokenCount ?? 0;
    const sortieJetons = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
    compteur.jetonsEntree += entree;
    compteur.jetonsSortie += sortieJetons;
    compteur.coutUsd += coutTexteUsd(modele, { jetonsEntree: entree, jetonsSortie: sortieJetons });
    if (!res.ok) {
      console.error(`Gemini : HTTP ${res.status}`);
      return res.status === 401 || res.status === 403 || res.status === 429 ? 'arret' : 'echec';
    }
    try {
      return { json: JSON.parse(corps?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '') };
    } catch {
      return { json: null };
    }
  } catch (err) {
    console.error('Gemini : pas de reponse', err instanceof Error ? err.message : err);
    return 'echec';
  }
}

/** Les familles déjà rangées, les plus fréquentes d'abord : le modèle les réutilise plutôt qu'en inventer. */
async function famillesConnues(sb: SupabaseClient, max = 150): Promise<string[]> {
  const { data } = await sb.from('pub_track_pubs').select('produit_famille').not('produit_famille', 'is', null).limit(10_000);
  const n = new Map<string, number>();
  for (const r of (data ?? []) as { produit_famille: string }[]) n.set(r.produit_famille, (n.get(r.produit_famille) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([f]) => f);
}

/**
 * Le rattrapage des familles pour les pubs nommées AVANT la migration 088 : texte seul, lots de
 * 80, aucune image. Quelques jetons par pub.
 */
export async function classerFamilles(sb: SupabaseClient, max: number): Promise<{ lots: number; rangees: number } & Compteur> {
  const cle = process.env.GEMINI_API_KEY?.trim();
  const sortie = { lots: 0, rangees: 0, coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
  if (!cle) return sortie;
  const modele = modeleVisionPubTrack();
  const { data, error } = await sb
    .from('pub_track_pubs')
    .select('id, produit_nom, produit_recherche')
    .eq('verdict_ia', 'produit')
    .is('produit_famille', null)
    .not('produit_nom', 'is', null)
    .limit(max);
  if (error) throw new Error(`familles : ${error.message}`);
  const lignes = (data ?? []) as { id: string; produit_nom: string; produit_recherche: string | null }[];
  for (let k = 0; k < lignes.length; k += 80) {
    const lot = lignes.slice(k, k + 80);
    const connues = await famillesConnues(sb);
    const appel = await appelerGemini(cle, modele, [{ text: consigneFamilles(lot.map((l) => ({ nom: l.produit_nom, recherche: l.produit_recherche ?? l.produit_nom })), connues) }], sortie);
    if (appel === 'arret') break;
    if (appel === 'echec') continue;
    sortie.lots += 1;
    const familles = lireFamilles(appel.json, lot.length);
    await Promise.all(
      lot.map(async (l, i) => {
        if (!familles[i]) return;
        sortie.rangees += 1;
        await sb.from('pub_track_pubs').update({ produit_famille: familles[i] }).eq('id', l.id);
      }),
    );
  }
  return sortie;
}

/**
 * Le rattrapage des images (097) pour les pubs physiques DÉJÀ nommées : net / flou / absent, et la
 * découpe sur le produit. Lots de 10 images, sans renommer.
 */
export async function jugerImages(sb: SupabaseClient, options: { max: number; minutes: number }): Promise<{ lots: number; nettes: number; decoupes: number } & Compteur> {
  const cle = process.env.GEMINI_API_KEY?.trim();
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const sortie = { lots: 0, nettes: 0, decoupes: 0, coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
  if (!cle || !base) return sortie;
  const modele = modeleVisionPubTrack();
  const fin = Date.now() + options.minutes * 60_000;
  const { data, error } = await sb
    .from('pub_track_pubs')
    .select('id, miniature_chemin')
    .eq('verdict_ia', 'produit')
    .eq('categorie', 'physique')
    .is('produit_image_qualite', null)
    .not('miniature_chemin', 'is', null)
    .order('score', { ascending: false })
    .limit(options.max);
  if (error) throw new Error(`images : ${error.message}`);
  const lignes = (data ?? []) as { id: string; miniature_chemin: string }[];
  for (let k = 0; k < lignes.length && Date.now() < fin; k += LOT_NOMMAGE) {
    const lot = lignes.slice(k, k + LOT_NOMMAGE);
    const images = await Promise.all(lot.map((l) => image(base, l.miniature_chemin)));
    const garde = lot.filter((_, i) => images[i]);
    if (!garde.length) continue;
    const parts: Record<string, unknown>[] = [{ text: consigneImages(garde.length) }, ...images.filter((x): x is string => !!x).map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))];
    const appel = await appelerGemini(cle, modele, parts, sortie);
    if (appel === 'arret') break;
    if (appel === 'echec' || appel.json === null) continue;
    sortie.lots += 1;
    const verdicts = lireImages(appel.json, garde.length);
    await Promise.all(
      garde.map(async (l, i) => {
        const v = verdicts[i];
        if (!v) return;
        if (v.image === 'net') sortie.nettes += 1;
        const decoupe = v.cadre ? await recadrerProduit(sb, base, l.miniature_chemin, v.cadre, l.id) : null;
        if (decoupe) sortie.decoupes += 1;
        await sb.from('pub_track_pubs').update({ produit_image_qualite: v.image, produit_image_chemin: decoupe }).eq('id', l.id);
      }),
    );
  }
  return sortie;
}

export async function nommerProduits(
  sb: SupabaseClient,
  options: { max: number; minutes: number; source?: string },
): Promise<{ lots: number; nommees: number; rejetees: number; illisibles: number; coutUsd: number; jetonsEntree: number; jetonsSortie: number }> {
  const cle = process.env.GEMINI_API_KEY?.trim();
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const sortie = { lots: 0, nommees: 0, rejetees: 0, illisibles: 0, coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
  if (!cle || !base) {
    console.log('Nommage : GEMINI_API_KEY absente, saute.');
    return sortie;
  }
  const modele = modeleVisionPubTrack();
  const fin = Date.now() + options.minutes * 60_000;

  let r = sb
    .from('pub_track_pubs')
    .select('id, texte, titre, niche, categorie, miniature_chemin')
    .is('nomme_le', null)
    .in('categorie', ['physique', 'digital'])
    .not('miniature_chemin', 'is', null)
    .order('vu_le', { ascending: false })
    .limit(options.max);
  if (options.source) r = r.eq('source', options.source);
  const { data, error } = await r;
  if (error) throw new Error(`nommage : ${error.message}`);
  const lignes = (data ?? []) as Ligne[];
  const connues = await famillesConnues(sb);

  for (let k = 0; k < lignes.length && Date.now() < fin; k += LOT_NOMMAGE) {
    const lot = lignes.slice(k, k + LOT_NOMMAGE);
    const images = await Promise.all(lot.map((l) => image(base, l.miniature_chemin)));
    const garde = lot.filter((_, i) => images[i]);
    // Une miniature illisible (404) ne se relira pas mieux demain : marquée, jamais retéléchargée.
    const sansImage = lot.filter((_, i) => !images[i]).map((l) => l.id);
    if (sansImage.length) await sb.from('pub_track_pubs').update({ nomme_le: new Date().toISOString() }).in('id', sansImage);
    const imgs = images.filter((x): x is string => !!x);
    if (!garde.length) continue;
    const pubs: PubANommer[] = garde.map((l) => ({ texte: l.texte ?? '', titre: l.titre ?? '', niche: l.niche, typeProduit: l.categorie === 'digital' ? 'digital' : 'physique' }));
    const parts: Record<string, unknown>[] = [{ text: consigneNommage(pubs, connues) }, ...imgs.map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))];

    const appel = await appelerGemini(cle, modele, parts, sortie);
    if (appel === 'arret') break;
    if (appel === 'echec') continue;
    sortie.lots += 1;
    const json = appel.json;
    if (json === null) {
      // Réponse payée mais illisible (souvent coupée par le plafond) : comptée, le lot sera repris une fois.
      sortie.illisibles += 1;
      continue;
    }
    const noms = lireNomsProduits(json, garde.length);
    const maintenant = new Date().toISOString();
    await Promise.all(
      garde.map(async (l, i) => {
        const n = noms[i];
        if (!n) {
          // Oubliée par le modèle : marquée sans nom, pour ne pas la repayer chaque nuit.
          await sb.from('pub_track_pubs').update({ nomme_le: maintenant }).eq('id', l.id);
          return;
        }
        if (n.vend) sortie.nommees += 1;
        else sortie.rejetees += 1;
        const decoupe = n.vend && n.cadre && l.categorie !== 'digital' ? await recadrerProduit(sb, base, l.miniature_chemin, n.cadre, l.id) : null;
        await sb
          .from('pub_track_pubs')
          .update({
            produit_nom: n.nom,
            produit_recherche: l.categorie === 'digital' ? null : n.recherche,
            verdict_ia: n.vend ? 'produit' : 'pas_produit',
            produit_famille: n.vend ? n.famille : null,
            produit_image_qualite: n.image,
            produit_image_chemin: decoupe,
            nomme_le: maintenant,
          })
          .eq('id', l.id);
      }),
    );
  }
  return sortie;
}

const direct = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/pub-track/nommer-produits.ts');
if (direct) {
  const arg = (nom: string) => {
    const i = process.argv.indexOf(`--${nom}`);
    return i > 0 ? process.argv[i + 1] ?? null : null;
  };
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleSb = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cleSb) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis');
  const sb = createClient(url, cleSb, { auth: { persistSession: false } });
  if (process.argv.includes('--images')) {
    jugerImages(sb, { max: Number(arg('max') ?? 2000), minutes: Number(arg('minutes') ?? 60) })
      .then((s) => console.log(`Images : ${s.lots} lots, ${s.nettes} produits nets, ${s.decoupes} decoupes, ${s.jetonsEntree} jetons lus, ${s.jetonsSortie} ecrits.`))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else if (process.argv.includes('--familles')) {
    classerFamilles(sb, Number(arg('max') ?? 5000))
      .then((s) => console.log(`Familles : ${s.lots} lots, ${s.rangees} pubs rangees, ${s.jetonsEntree} jetons lus, ${s.jetonsSortie} ecrits.`))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else
  nommerProduits(sb, { max: Number(arg('max') ?? 400), minutes: Number(arg('minutes') ?? 30), source: arg('source') ?? undefined })
    .then((s) => console.log(`Nommage : ${s.lots} lots, ${s.nommees} produits nommes, ${s.rejetees} rejetes (pas un produit), ${s.illisibles} lots illisibles, ${s.jetonsEntree} jetons lus, ${s.jetonsSortie} ecrits, ~${s.coutUsd.toFixed(3)} $ (estimation haute).`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
