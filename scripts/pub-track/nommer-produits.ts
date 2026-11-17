/**
 * Nomme les produits de la vitrine Pub Track (09/10/2026, `lib/pub-track/nom-produit.ts`).
 *
 * Appelé en fin de nuit par `collecter.ts`, ou seul :
 *   npx tsx --env-file=.env.local scripts/pub-track/nommer-produits.ts [--max 400] [--source tiktok]
 *
 * Un appel au modèle de vision par lot de 10 pubs (image + légende), jamais deux : une
 * réponse illisible laisse le lot sans nom, et `nomme_le` reste vide pour la nuit suivante.
 * Modèle : Claude Haiku, effort `low` (17/11/2026, Pub Track quitte Gemini), réglable par
 * `CLAUDE_PUB_TRACK_COLLECTE_MODEL`. Sans `ANTHROPIC_API_KEY`, rien n'est fait : le panneau
 * garde le repli sans modèle.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { configR2, deposerR2, urlPubliquePubTrack, variablesR2Absentes } from '../../services/stockage/r2';
import { referenceR2, urlPubliqueDeReference } from '../../lib/stockage/reference';

/** Une miniature `r2:` vit dans le bucket R2 public, un ancien chemin dans le bucket Supabase `pub-track`. */
const adresseImage = (base: string, chemin: string) => urlPubliqueDeReference(chemin, 'pub-track', { r2: urlPubliquePubTrack(), supabase: base });
import { appelerClaude, ErreurClaude } from '../../services/pub-track/claude';
import { modeleCollectePubTrack } from '../../lib/pub-track/modele';
import { rafraichirVitrinePubTrack } from '../../lib/pub-track/rafraichir-vitrine';
import { consigneFamilles, consigneImages, consigneNommage, lireFamilles, lireImages, lireNomsProduits, LOT_NOMMAGE, type Cadre, type PubANommer } from '../../lib/pub-track/nom-produit';

/** Plafond de sortie d'un lot de dix (réflexion comprise) : un plafond, pas un achat. */
const JETONS_MAX_LOT = 16_000;

interface Ligne {
  id: string;
  texte: string | null;
  titre: string | null;
  niche: string | null;
  categorie: string;
  miniature_chemin: string;
}

export async function image(base: string, chemin: string): Promise<string | null> {
  try {
    const adresse = adresseImage(base, chemin);
    if (!adresse) return null;
    const res = await fetch(adresse, { signal: AbortSignal.timeout(20_000) });
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
export async function recadrerProduit(base: string, chemin: string, cadre: Cadre, id: string): Promise<string | null> {
  // Sans R2, la découpe ne doit pas disparaître en silence : le nommage s'arrête et dit quoi poser.
  const r2 = configR2();
  if (!r2) throw new Error(`R2 non configuré (images produit de Pub Track) : variables absentes ${variablesR2Absentes().join(', ')}`);
  try {
    const adresse = adresseImage(base, chemin);
    if (!adresse) return null;
    const res = await fetch(adresse, { signal: AbortSignal.timeout(20_000) });
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
    // Le bucket R2 public (15/11/2026) : `produit_image_chemin` recoit la reference `r2:produits/<id>.webp`.
    await deposerR2(r2, cible, new Uint8Array(decoupe), 'image/webp', 'public, max-age=604800');
    return referenceR2(cible);
  } catch {
    return null;
  }
}

export interface Compteur {
  coutUsd: number;
  jetonsEntree: number;
  jetonsSortie: number;
  /** Échecs du modèle de suite dans la nuit (remis à zéro au premier succès). */
  echecsDeSuite?: number;
}

/** Échecs de suite (pas de réponse, 404 modèle, 5xx, 529, réponse inutilisable) avant d'arrêter la nuit. */
export const ECHECS_DE_SUITE_MAX = 5;
/** Pause après un échec : un modèle en panne ou surchargé n'est pas martelé. */
export const PAUSE_APRES_ECHEC_MS = 7000;
/** Échecs FACTURÉS par pub avant qu'elle sorte de la file : une seule reprise, jamais une rente (migration 148). */
export const ECHECS_FACTURES_MAX = 2;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

let compteurEchecs: boolean | null = null;
/** La colonne `ia_echecs_factures` (migration 148) existe-t-elle ? Lu une fois par nuit. */
export async function compteurEchecsDisponible(sb: SupabaseClient): Promise<boolean> {
  if (compteurEchecs === null) {
    const { error } = await sb.from('pub_track_pubs').select('ia_echecs_factures').limit(1);
    compteurEchecs = !error;
    if (error) console.error('Migration 148 absente : une pub sortira de la file des son premier echec facture.');
  }
  return compteurEchecs;
}

/**
 * Un lot payé mais inutilisable (refus, coupé par le plafond, hors format) : chaque pub compte un échec facturé.
 * Au deuxième, `marqueur` (`nomme_le`, `classe_le`) est posé et la pub sort de la file, sans nom. Sans la
 * migration 148, elle sort dès le premier : mieux vaut une pub sans nom qu'un lot repayé chaque nuit.
 * `marqueur` nul (rattrapage des images) : seul le compteur bouge, la requête des images saute les pubs au plafond.
 */
export async function noterEchecsFactures(sb: SupabaseClient, ids: readonly string[], marqueur: 'nomme_le' | 'classe_le' | null): Promise<void> {
  if (!ids.length) return;
  const maintenant = new Date().toISOString();
  if (!(await compteurEchecsDisponible(sb))) {
    if (marqueur) await sb.from('pub_track_pubs').update({ [marqueur]: maintenant }).in('id', [...ids]);
    return;
  }
  const { data } = await sb.from('pub_track_pubs').select('id, ia_echecs_factures').in('id', [...ids]);
  await Promise.all(
    ((data ?? []) as { id: string; ia_echecs_factures: number | null }[]).map((l) => {
      const n = (l.ia_echecs_factures ?? 0) + 1;
      return sb
        .from('pub_track_pubs')
        .update({ ia_echecs_factures: n, ...(marqueur && n >= ECHECS_FACTURES_MAX ? { [marqueur]: maintenant } : {}) })
        .eq('id', l.id);
    }),
  );
}

/**
 * UN appel au modèle, compté, jamais deux. 'arret' : clé refusée, débit ou solde épuisé, ou
 * `ECHECS_DE_SUITE_MAX` échecs de suite (modèle introuvable, en panne, surchargé) : inutile d'insister cette
 * nuit. 'echec' : pas de réponse ; sinon le JSON lu, ou null quand la réponse est payée mais inutilisable
 * (refus, coupée par le plafond, hors format). Après un échec, une pause. Images : JPEG en base64 (`image()`).
 */
export async function appelerModele(cle: string, modele: string, texte: string, images: readonly string[], compteur: Compteur): Promise<'arret' | 'echec' | { json: unknown }> {
  let issue: 'echec' | { json: null };
  try {
    const r = await appelerClaude({
      cle,
      modele,
      texte,
      images: images.map((data) => ({ mime: 'image/jpeg' as const, data })),
      maxTokens: JETONS_MAX_LOT,
      timeoutMs: 120_000,
    });
    compteur.jetonsEntree += r.jetonsEntree;
    compteur.jetonsSortie += r.jetonsSortie;
    compteur.coutUsd += r.coutUsd;
    compteur.echecsDeSuite = 0;
    return { json: r.json };
  } catch (err) {
    if (err instanceof ErreurClaude) {
      // Un échec facturé reste une dépense de la nuit : il entre au compteur avant tout le reste.
      compteur.jetonsEntree += err.jetonsEntree;
      compteur.jetonsSortie += err.jetonsSortie;
      compteur.coutUsd += err.costUsd;
      console.error(err.message);
      if (err.arret) return 'arret';
      // Des jetons lus : le modèle a répondu (refus, coupée, hors format), le lot est payé mais inutilisable.
      issue = err.jetonsEntree > 0 ? { json: null } : 'echec';
    } else {
      console.error('Claude : pas de reponse', err instanceof Error ? err.message : err);
      issue = 'echec';
    }
  }
  compteur.echecsDeSuite = (compteur.echecsDeSuite ?? 0) + 1;
  if (compteur.echecsDeSuite >= ECHECS_DE_SUITE_MAX) {
    console.error(`Claude : ${compteur.echecsDeSuite} echecs de suite, arret de la nuit.`);
    return 'arret';
  }
  await dormir(PAUSE_APRES_ECHEC_MS);
  return issue;
}

/** Les familles déjà rangées, les plus fréquentes d'abord : le modèle les réutilise plutôt qu'en inventer. */
export async function famillesConnues(sb: SupabaseClient, max = 150): Promise<string[]> {
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
  const cle = process.env.ANTHROPIC_API_KEY?.trim();
  const sortie = { lots: 0, rangees: 0, coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
  if (!cle) return sortie;
  const modele = modeleCollectePubTrack();
  const demande = sb
    .from('pub_track_pubs')
    .select('id, produit_nom, produit_recherche')
    .eq('verdict_ia', 'produit')
    .is('produit_famille', null)
    .not('produit_nom', 'is', null);
  // Une pub dont la famille a deja coute deux echecs factures n'est plus montree au modele.
  const filtree = (await compteurEchecsDisponible(sb)) ? demande.lt('ia_echecs_factures', ECHECS_FACTURES_MAX) : demande;
  const { data, error } = await filtree.limit(max);
  if (error) throw new Error(`familles : ${error.message}`);
  const lignes = (data ?? []) as { id: string; produit_nom: string; produit_recherche: string | null }[];
  for (let k = 0; k < lignes.length; k += 80) {
    const lot = lignes.slice(k, k + 80);
    const connues = await famillesConnues(sb);
    const appel = await appelerModele(cle, modele, consigneFamilles(lot.map((l) => ({ nom: l.produit_nom, recherche: l.produit_recherche ?? l.produit_nom })), connues), [], sortie);
    if (appel === 'arret') break;
    if (appel === 'echec') continue;
    if (appel.json === null) {
      await noterEchecsFactures(sb, lot.map((l) => l.id), null);
      continue;
    }
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
  const cle = process.env.ANTHROPIC_API_KEY?.trim();
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const sortie = { lots: 0, nettes: 0, decoupes: 0, coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
  if (!cle || !base) return sortie;
  const modele = modeleCollectePubTrack();
  const fin = Date.now() + options.minutes * 60_000;
  const demande = sb
    .from('pub_track_pubs')
    .select('id, miniature_chemin')
    .eq('verdict_ia', 'produit')
    .eq('categorie', 'physique')
    .is('produit_image_qualite', null)
    .not('miniature_chemin', 'is', null);
  // Une pub dont l'image a deja coute deux echecs factures n'est plus montree au modele.
  const filtree = (await compteurEchecsDisponible(sb)) ? demande.lt('ia_echecs_factures', ECHECS_FACTURES_MAX) : demande;
  const { data, error } = await filtree.order('score', { ascending: false }).limit(options.max);
  if (error) throw new Error(`images : ${error.message}`);
  const lignes = (data ?? []) as { id: string; miniature_chemin: string }[];
  for (let k = 0; k < lignes.length && Date.now() < fin; k += LOT_NOMMAGE) {
    const lot = lignes.slice(k, k + LOT_NOMMAGE);
    const images = await Promise.all(lot.map((l) => image(base, l.miniature_chemin)));
    const garde = lot.filter((_, i) => images[i]);
    if (!garde.length) continue;
    const appel = await appelerModele(cle, modele, consigneImages(garde.length), images.filter((x): x is string => !!x), sortie);
    if (appel === 'arret') break;
    if (appel === 'echec') continue;
    if (appel.json === null) {
      await noterEchecsFactures(sb, garde.map((l) => l.id), null);
      continue;
    }
    sortie.lots += 1;
    const verdicts = lireImages(appel.json, garde.length);
    await Promise.all(
      garde.map(async (l, i) => {
        const v = verdicts[i];
        if (!v) return;
        if (v.image === 'net') sortie.nettes += 1;
        const decoupe = v.cadre ? await recadrerProduit(base, l.miniature_chemin, v.cadre, l.id) : null;
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
  const cle = process.env.ANTHROPIC_API_KEY?.trim();
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const sortie = { lots: 0, nommees: 0, rejetees: 0, illisibles: 0, coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
  if (!cle || !base) {
    console.log('Nommage : ANTHROPIC_API_KEY absente, saute.');
    return sortie;
  }
  const modele = modeleCollectePubTrack();
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
    const appel = await appelerModele(cle, modele, consigneNommage(pubs, connues), imgs, sortie);
    if (appel === 'arret') break;
    if (appel === 'echec') continue;
    sortie.lots += 1;
    const json = appel.json;
    if (json === null) {
      // Réponse payée mais inutilisable (refus, coupée, hors format) : comptée, et chaque pub du lot note un
      // échec facturé. Le lot est repris UNE fois ; au deuxième échec, ses pubs sortent de la file sans nom.
      sortie.illisibles += 1;
      await noterEchecsFactures(sb, garde.map((l) => l.id), 'nomme_le');
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
        const decoupe = n.vend && n.cadre && l.categorie !== 'digital' ? await recadrerProduit(base, l.miniature_chemin, n.cadre, l.id) : null;
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
      .then(async (s) => {
        await rafraichirVitrinePubTrack(sb);
        return s;
      })
      .then((s) => console.log(`Images : ${s.lots} lots, ${s.nettes} produits nets, ${s.decoupes} decoupes, ${s.jetonsEntree} jetons lus, ${s.jetonsSortie} ecrits.`))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else if (process.argv.includes('--familles')) {
    classerFamilles(sb, Number(arg('max') ?? 5000))
      .then(async (s) => {
        await rafraichirVitrinePubTrack(sb);
        return s;
      })
      .then((s) => console.log(`Familles : ${s.lots} lots, ${s.rangees} pubs rangees, ${s.jetonsEntree} jetons lus, ${s.jetonsSortie} ecrits.`))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else
  nommerProduits(sb, { max: Number(arg('max') ?? 400), minutes: Number(arg('minutes') ?? 30), source: arg('source') ?? undefined })
    .then(async (s) => {
      await rafraichirVitrinePubTrack(sb);
      return s;
    })
    .then((s) => console.log(`Nommage : ${s.lots} lots, ${s.nommees} produits nommes, ${s.rejetees} rejetes (pas un produit), ${s.illisibles} lots illisibles, ${s.jetonsEntree} jetons lus, ${s.jetonsSortie} ecrits, ~${s.coutUsd.toFixed(4)} $ (releve Anthropic).`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
