/**
 * LE SCORE v2 DE TOUTE LA BASE, CHAQUE NUIT (Pub Track v2, lot 4).
 *
 * Pur : le collecteur lui passe les pubs actives et les compteurs des boutiques, annonceurs et groupes ; il
 * rend, pour chaque pub, le score, la phrase et le statut à ranger. Le nombre de VENDEURS DISTINCTS et de
 * PAYS d'un produit se compte ici, par famille (posée par le classeur IA), à marché et type égaux : un
 * produit vendu par cinq pages dans quatre pays est un marché confirmé, une page seule ne l'est pas encore.
 * Verrou : verify-score-v2.
 */
import { estOffre, type Offre } from './offre';
import { phraseScore, scorePub, statutPub, type SignauxScore, type StatutPub } from './score';

export interface PubAScorer {
  id: string;
  jours_actifs: number | null;
  groupe_cle: string | null;
  variantes_source: number | null;
  boutique_cle: string | null;
  annonceur_id: string | null;
  source: string | null;
  categorie: string | null;
  marche: string | null;
  produit_famille: string | null;
  pays: string[] | null;
  prix_fcfa: number | null;
  offres: string[] | null;
  date_debut: string | null;
  verifiee_le?: string | null;
}

export interface ScoreDeNuit {
  id: string;
  score: number;
  phrase: string;
  statut: StatutPub | null;
}

const JOUR = 86_400_000;
const cleProduit = (p: PubAScorer) => (p.produit_famille ? `${p.marche ?? 'afrique'}|${p.categorie ?? ''}|${p.produit_famille}` : null);

export function scoresDeNuit(
  pubs: readonly PubAScorer[],
  compteurs: {
    variantesGroupe: ReadonlyMap<string, number>;
    croissanceBoutique: ReadonlyMap<string, number | null>;
    croissanceAnnonceur: ReadonlyMap<string, number | null>;
  },
  maintenant: Date,
): ScoreDeNuit[] {
  const vendeurs = new Map<string, Set<string>>();
  const pays = new Map<string, Set<string>>();
  for (const p of pubs) {
    const c = cleProduit(p);
    if (!c) continue;
    if (p.annonceur_id) vendeurs.set(c, (vendeurs.get(c) ?? new Set()).add(p.annonceur_id));
    const ensemble = pays.get(c) ?? new Set<string>();
    for (const x of p.pays ?? []) ensemble.add(x);
    pays.set(c, ensemble);
  }
  const aujourdhui = Date.parse(`${maintenant.toISOString().slice(0, 10)}T00:00:00Z`);
  return pubs.map((p) => {
    const c = cleProduit(p);
    const croissance =
      (p.boutique_cle ? compteurs.croissanceBoutique.get(p.boutique_cle) : undefined) ??
      (p.annonceur_id ? compteurs.croissanceAnnonceur.get(`${p.source ?? 'meta'}:${p.annonceur_id}`) : undefined) ??
      null;
    const signaux: SignauxScore = {
      joursVerifies: Math.max(0, p.jours_actifs ?? 0),
      variantes: Math.max(1, (p.groupe_cle ? compteurs.variantesGroupe.get(p.groupe_cle) : undefined) ?? 0, p.variantes_source ?? 1),
      croissance7j: croissance,
      vendeursProduit: c ? Math.max(1, vendeurs.get(c)?.size ?? 1) : 1,
      paysProduit: Math.max(1, c ? pays.get(c)?.size ?? 1 : (p.pays ?? []).length),
      prixConnu: p.prix_fcfa != null,
      offres: (p.offres ?? []).filter(estOffre) as Offre[],
      preuveJours: p.verifiee_le ? Math.max(0, Math.floor((maintenant.getTime() - Date.parse(p.verifiee_le)) / JOUR)) : null,
    };
    const score = scorePub(signaux);
    const joursDepuisLancement = p.date_debut ? Math.max(0, Math.round((aujourdhui - Date.parse(`${p.date_debut}T00:00:00Z`)) / JOUR)) : null;
    return {
      id: p.id,
      score,
      phrase: phraseScore(signaux),
      statut: statutPub({ active: true, categorie: p.categorie, marche: p.marche, joursDepuisLancement, score, signaux }),
    };
  });
}
