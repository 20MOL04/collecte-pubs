/**
 * LE CLASSEUR IA DE PUB TRACK (lot 3 de la v2, logique pure : lib/pub-track/classeur.ts).
 *
 * Tâche À PART de la collecte (workflow `classeur.yml`, après le dernier créneau) : il ne parle jamais à
 * Meta. Il prend d'abord les candidates gagnantes (actives, visibles, jamais classées, meilleur score),
 * montre leur image et leur légende au modèle de vision par lots de 10, et range nom, recherche, famille,
 * verdict, type, qualité créative et découpe du produit. Le type devient la catégorie, contrôlée par les
 * règles (`categorieAvecClasseur`).
 *
 * Gratuit : clé Gemini de la version gratuite (projet SANS facturation). `CLASSEUR_GRATUIT=oui` (posé par
 * le workflow) range un coût facturé de zéro et indique seulement l'équivalent payant. Un refus de quota
 * arrête la nuit. Sans clé, rien n'est fait.
 *
 *   npx tsx scripts/pub-track/classer-produits.ts [--max 600] [--minutes 40]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { CATEGORIES_VISIBLES, categorieAvecClasseur, type CategoriePub } from '../../lib/pub-track/categorie';
import { CLASSEUR, consigneClasseur, coutFacture, lireClassement } from '../../lib/pub-track/classeur';
import { mesures, cleNuit } from '../../lib/pub-track/creneaux';
import { modeleVisionPubTrack } from '../../lib/pub-track/modele';
import type { PubANommer } from '../../lib/pub-track/nom-produit';
import { appelerGemini, famillesConnues, image, recadrerProduit, type Compteur } from './nommer-produits';

interface Candidate {
  id: string;
  texte: string | null;
  titre: string | null;
  niche: string | null;
  categorie: CategoriePub;
  miniature_chemin: string;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const colonneAbsente = (m: string) => /column|colonne|schema cache|PGRST204/i.test(m);

export async function classerProduits(
  sb: SupabaseClient,
  options: { max: number; minutes: number },
): Promise<{ lots: number; classees: number; rejetees: number; illisibles: number; saas: number; arret: string | null } & Compteur> {
  const cle = process.env.GEMINI_API_KEY?.trim();
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const sortie = { lots: 0, classees: 0, rejetees: 0, illisibles: 0, saas: 0, arret: null as string | null, coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
  if (!cle || !base) {
    sortie.arret = 'GEMINI_API_KEY absente : rien n a ete fait';
    return sortie;
  }
  const modele = modeleVisionPubTrack();
  const fin = Date.now() + options.minutes * 60_000;
  const { data, error } = await sb
    .from('pub_track_pubs')
    .select('id, texte, titre, niche, categorie, miniature_chemin')
    .is('classe_le', null)
    .eq('active', true)
    .in('categorie', [...CATEGORIES_VISIBLES])
    .not('miniature_chemin', 'is', null)
    .order('score', { ascending: false })
    .limit(options.max);
  if (error) {
    if (colonneAbsente(error.message)) sortie.arret = 'migration 117 absente : rien n a ete fait';
    else throw new Error(`classeur : ${error.message}`);
    return sortie;
  }
  const lignes = (data ?? []) as Candidate[];
  const connues = await famillesConnues(sb);

  for (let k = 0; k < lignes.length; k += CLASSEUR.lot) {
    if (Date.now() > fin) {
      sortie.arret = 'temps de la nuit ecoule';
      break;
    }
    const lot = lignes.slice(k, k + CLASSEUR.lot);
    const images = await Promise.all(lot.map((l) => image(base, l.miniature_chemin)));
    const garde = lot.filter((_, i) => images[i]);
    const sansImage = lot.filter((_, i) => !images[i]).map((l) => l.id);
    // Une miniature illisible ne se lira pas mieux demain : marquée, jamais retéléchargée.
    if (sansImage.length) await sb.from('pub_track_pubs').update({ classe_le: new Date().toISOString() }).in('id', sansImage);
    if (!garde.length) continue;
    const pubs: PubANommer[] = garde.map((l) => ({ texte: l.texte ?? '', titre: l.titre ?? '', niche: l.niche, typeProduit: null }));
    const parts: Record<string, unknown>[] = [{ text: consigneClasseur(pubs, connues) }, ...images.filter((x): x is string => !!x).map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))];

    const appel = await appelerGemini(cle, modele, parts, sortie);
    if (appel === 'arret') {
      // Quota gratuit atteint, ou clé refusée : on s'arrête, la suite passe la nuit prochaine.
      sortie.arret = 'quota atteint ou cle refusee';
      break;
    }
    if (appel === 'echec') {
      await dormir(CLASSEUR.pauseEntreAppelsMs);
      continue;
    }
    sortie.lots += 1;
    if (appel.json === null) {
      sortie.illisibles += 1;
      await dormir(CLASSEUR.pauseEntreAppelsMs);
      continue;
    }
    const classes = lireClassement(appel.json, garde.length);
    const maintenant = new Date().toISOString();
    await Promise.all(
      garde.map(async (l, i) => {
        const c = classes[i];
        if (!c) {
          await sb.from('pub_track_pubs').update({ classe_le: maintenant }).eq('id', l.id);
          return;
        }
        if (c.vend) sortie.classees += 1;
        else sortie.rejetees += 1;
        const categorie = categorieAvecClasseur(l.categorie, c.type, c.vend);
        if (categorie === 'saas') sortie.saas += 1;
        const decoupe = c.vend && c.cadre && categorie === 'physique' ? await recadrerProduit(sb, base, l.miniature_chemin, c.cadre, l.id) : null;
        await sb
          .from('pub_track_pubs')
          .update({
            ...(c.nom ? { produit_nom: c.nom } : {}),
            produit_recherche: categorie === 'physique' ? c.recherche : null,
            verdict_ia: c.vend ? 'produit' : 'pas_produit',
            produit_famille: c.vend ? c.famille : null,
            produit_image_qualite: c.image,
            ...(decoupe ? { produit_image_chemin: decoupe } : {}),
            type_ia: c.type,
            qualite_creative: c.qualite,
            categorie,
            classe_le: maintenant,
            nomme_le: maintenant,
          })
          .eq('id', l.id);
      }),
    );
    await dormir(CLASSEUR.pauseEntreAppelsMs);
  }
  return sortie;
}

const direct = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/pub-track/classer-produits.ts');
if (direct) {
  const arg = (nom: string) => {
    const i = process.argv.indexOf(`--${nom}`);
    return i > 0 ? process.argv[i + 1] ?? null : null;
  };
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleSb = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cleSb) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis');
  const sb = createClient(url, cleSb, { auth: { persistSession: false } });
  const gratuit = process.env.CLASSEUR_GRATUIT === 'oui';
  const debut = Date.now();
  classerProduits(sb, { max: Number(arg('max') ?? CLASSEUR.maxParNuit), minutes: Number(arg('minutes') ?? CLASSEUR.minutes) })
    .then(async (s) => {
      const facture = coutFacture(s.coutUsd, gratuit);
      console.log(
        `Classeur : ${s.lots} lots, ${s.classees} produits classes (dont ${s.saas} SaaS), ${s.rejetees} rejetes, ${s.illisibles} lots illisibles, ${s.jetonsEntree} jetons lus, ${s.jetonsSortie} ecrits, cout facture ${facture} $ (equivalent payant estime ~${s.coutUsd.toFixed(3)} $)${s.arret ? `, arret : ${s.arret}` : ''}.`,
      );
      // Le journal de la nuit porte la dépense (094), ligne fermée d'emblée : elle ne tient jamais le verrou Meta.
      const m = mesures({ nuit: cleNuit(new Date()), creneau: 0, statut: 'hors_meta', recherches: 0, pubsLues: 0, msMeta: 0, bloqueA: null });
      const ligne = {
        message: `classeur IA : ${s.classees + s.rejetees} pubs, ${s.saas} SaaS${s.arret ? `, ${s.arret}` : ''}`,
        debut: new Date(debut).toISOString(),
        fin: new Date().toISOString(),
        nommage_pubs: s.classees + s.rejetees,
        nommage_jetons_entree: s.jetonsEntree,
        nommage_jetons_sortie: s.jetonsSortie,
        nommage_cout_usd: facture,
      };
      const plein = await sb.from('pub_track_collectes').insert({ ...ligne, nuit: m.nuit, statut: 'hors_meta' });
      if (plein.error) {
        const repli = await sb.from('pub_track_collectes').insert({ ...ligne, message: `${ligne.message} | ${JSON.stringify(m)}` });
        if (repli.error) console.error(`journal : ${repli.error.message}`);
      }
      console.log(`::notice title=Classeur Pub Track::${JSON.stringify({ pubs: s.classees + s.rejetees, saas: s.saas, lots: s.lots, cout_facture_usd: facture, equivalent_payant_usd: Math.round(s.coutUsd * 1000) / 1000, arret: s.arret })}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
