/**
 * LA PASSE DE VÉRIFICATION (Pub Track v2, lot 2, 29/10/2026 : docs/PLAN-PUB-TRACK-V2.md).
 *
 * Une pub « active » doit être PROUVÉE. Chaque nuit, la page ANNONCEUR de la bibliothèque Meta (toutes
 * ses pubs actives, tous pays) est relue pour les annonceurs qui comptent, score décroissant. Ce qu'elle
 * liste est confirmé ; ce qu'elle ne liste pas, quand elle a été lue jusqu'au bout, est arrêté.
 *
 * Deux prudences, parce qu'arrêter à tort une bonne pub est pire que la laisser un jour de plus :
 * - une page coupée avant la fin (plafond de défilement) ou vide ne prouve AUCUN arrêt ;
 * - Meta n'affiche qu'une pub par regroupement (« N publicités utilisent ce contenu ») : une pub absente
 *   dont le groupe (même fichier média) ou le regroupement Meta est listé est cachée, pas arrêtée.
 *
 * Pur, sans réseau ni base : `scripts/verify-verification-pubs.ts` l'exécute.
 */

export const VERIFICATION = {
  /** Annonceurs relus par nuit au moins (critère du plan). */
  annonceursParNuit: 150,
  /** Minutes d'un créneau données à la vérification, avant les recherches. */
  minutesParCreneau: 9,
  /** Défilements au plus sur une page annonceur ; au-delà, la page est « coupée ». */
  defilementsMax: 12,
  /** Une vérification plus vieille ne vaut plus preuve (plan, section 2.1). */
  preuveValableJours: 3,
  /** Un annonceur vérifié depuis moins longtemps passe après les autres. */
  repasserApresHeures: 44,
} as const;

/** Une pub active en base, candidate à la vérification. */
export interface PubCandidate {
  annonceur_id: string | null;
  score: number | null;
  verifiee_le: string | null;
}

/**
 * Les annonceurs à relire, dans l'ordre : jamais vérifiés cette nuit ; ceux dont la dernière preuve est
 * ancienne avant ceux vérifiés il y a peu ; puis le meilleur score de leurs pubs. Les créneaux suivants
 * de la nuit reprennent la liste, puisque les annonceurs relus portent une preuve de cette nuit.
 */
export function annonceursAVerifier(pubs: readonly PubCandidate[], debutNuit: Date, maintenant: Date, max: number): string[] {
  const parAnnonceur = new Map<string, { score: number; derniere: number }>();
  for (const p of pubs) {
    if (!p.annonceur_id) continue;
    const e = parAnnonceur.get(p.annonceur_id) ?? { score: 0, derniere: 0 };
    e.score = Math.max(e.score, p.score ?? 0);
    if (p.verifiee_le) e.derniere = Math.max(e.derniere, Date.parse(p.verifiee_le));
    parAnnonceur.set(p.annonceur_id, e);
  }
  const recent = maintenant.getTime() - VERIFICATION.repasserApresHeures * 3_600_000;
  return [...parAnnonceur.entries()]
    .filter(([, e]) => e.derniere < debutNuit.getTime())
    .sort(([, a], [, b]) => Number(a.derniere >= recent) - Number(b.derniere >= recent) || b.score - a.score)
    .slice(0, Math.max(0, max))
    .map(([id]) => id);
}

/** Ce qu'il faut savoir d'une pub pour la reconnaître sur une page annonceur. */
export interface PubReperee {
  id_source: string;
  groupe_cle: string | null;
  collation_id: string | null;
}

/**
 * Le verdict d'une page annonceur relue. `complete` : la page a été lue jusqu'à ce qu'un défilement
 * n'apporte plus rien, sous le plafond. Les confirmées comprennent les pubs cachées derrière une sœur
 * listée (même groupe ou même regroupement Meta) : la page ne liste que des pubs actives.
 */
export function verdictPage(entree: { actives: readonly PubReperee[]; vues: readonly PubReperee[]; complete: boolean }): {
  confirmees: string[];
  arretees: string[];
} {
  const vuesIds = new Set(entree.vues.map((v) => v.id_source));
  const groupes = new Set(entree.vues.map((v) => v.groupe_cle).filter((g): g is string => !!g));
  const collations = new Set(entree.vues.map((v) => v.collation_id).filter((c): c is string => !!c));
  const cachee = (a: PubReperee) => (!!a.groupe_cle && groupes.has(a.groupe_cle)) || (!!a.collation_id && collations.has(a.collation_id));
  const confirmees = [...vuesIds, ...entree.actives.filter((a) => !vuesIds.has(a.id_source) && cachee(a)).map((a) => a.id_source)];
  // Une page vide n'est pas une preuve : Meta rend parfois une page sans résultat (freinage, panne).
  const peutArreter = entree.complete && entree.vues.length > 0;
  const arretees = peutArreter ? entree.actives.filter((a) => !vuesIds.has(a.id_source) && !cachee(a)).map((a) => a.id_source) : [];
  return { confirmees: [...new Set(confirmees)], arretees };
}

/** La page est-elle lue jusqu'au bout ? Le dernier défilement n'a rien apporté, sous le plafond. */
export function pageComplete(nouveauxAuDernierDefilement: number, defilements: number): boolean {
  return nouveauxAuDernierDefilement === 0 && defilements <= VERIFICATION.defilementsMax;
}

/** Une preuve d'activité encore valable (plan : moins de 3 jours). */
export function preuveValable(verifieeLe: string | null, maintenant: Date): boolean {
  return !!verifieeLe && maintenant.getTime() - Date.parse(verifieeLe) < VERIFICATION.preuveValableJours * 86_400_000;
}

/**
 * Les jours actifs PROUVÉS, comme la base les calcule (migration 116) : de la date de début Meta à la
 * dernière preuve d'activité, jamais à « aujourd'hui » sans preuve.
 */
export function joursProuves(p: { date_debut: string | null; date_fin: string | null; verifiee_le: string | null; vu_le: string | null }, jour: string): number | null {
  if (!p.date_debut) return null;
  const preuve = [p.verifiee_le, p.vu_le].filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort().pop() ?? null;
  const fin = p.date_fin ?? (preuve && preuve < jour ? preuve : jour);
  return Math.max(0, Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${p.date_debut}T00:00:00Z`)) / 86_400_000));
}
