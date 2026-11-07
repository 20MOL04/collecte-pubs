/**
 * LA FILE DES VIDÉOS À RANGER DANS R2 (07/11/2026).
 *
 * Pendant une collecte, chaque pub dont la vidéo arrive avec un lien encore valide laisse ce lien EN MÉMOIRE
 * (`FileVideos`, jamais en base : voir lib/pub-track/video-chez-nous.ts). À la fin, après le calcul des scores, la
 * file part dans R2, les meilleures pubs d'abord (gagnantes, montantes, puis score), dans la limite de temps et du
 * plafond de 8 Go. Le premier `plafond_atteint` ou `r2_absent` arrête la file : inutile d'insister.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { estVideoChezNous, ordreDepot, type CandidateVideo } from '../../lib/pub-track/video-chez-nous';
import { deposerVideoPubTrack, outilsReels, type OutilsDepot, type ResultatDepotVideo } from '../../services/pub-track/videos';
import type { ConfigR2 } from '../../services/stockage/r2';

/** Les liens vidéo de la collecte en cours, par pub (`source` + `id_source`). Le dernier lien lu gagne. */
export class FileVideos {
  private readonly liens = new Map<string, { source: string; id_source: string; url: string; autoriserMeta: boolean }>();
  ajouter(source: string, id_source: string, url: string, autoriserMeta = false): void {
    this.liens.set(`${source}:${id_source}`, { source, id_source, url, autoriserMeta });
  }
  get taille(): number {
    return this.liens.size;
  }
  entrees() {
    return [...this.liens.values()];
  }
}

export interface BilanDepot {
  candidates: number;
  deposees: number;
  octets: number;
  refus: Record<string, number>;
  arret: string | null;
}

/**
 * Le cœur de la file, PUR (testé) : dépose dans l'ordre jusqu'à `fin`, s'arrête au premier refus qui vaut pour
 * toutes les suivantes (plafond, R2 absent).
 */
export async function deposerDansLOrdre(
  candidates: readonly (CandidateVideo & { autoriserMeta?: boolean })[],
  deposer: (c: CandidateVideo & { autoriserMeta?: boolean }) => Promise<ResultatDepotVideo>,
  fin: number,
  maintenant: () => number = Date.now,
): Promise<BilanDepot> {
  const bilan: BilanDepot = { candidates: candidates.length, deposees: 0, octets: 0, refus: {}, arret: null };
  for (const c of ordreDepot(candidates)) {
    if (maintenant() > fin) {
      bilan.arret = 'temps';
      break;
    }
    const r = await deposer(c);
    if (r.ok) {
      bilan.deposees += 1;
      bilan.octets += r.octets;
      continue;
    }
    bilan.refus[r.raison] = (bilan.refus[r.raison] ?? 0) + 1;
    if (r.raison === 'plafond_atteint' || r.raison === 'r2_absent') {
      bilan.arret = r.raison;
      break;
    }
  }
  return bilan;
}

const colonneAbsente = (m: string) => /column|colonne|schema cache|PGRST204|42703/i.test(m);

/** Lit `id`, score, statut et vidéo en base des pubs de la file, puis dépose. */
export async function deposerFile(
  sb: SupabaseClient,
  file: FileVideos,
  options: { minutes: number; plafondOctets?: number; outils?: OutilsDepot; r2?: ConfigR2 | null } = { minutes: 10 },
): Promise<BilanDepot> {
  const fin = Date.now() + options.minutes * 60_000;
  const parSource = new Map<string, Map<string, { url: string; autoriserMeta: boolean }>>();
  for (const e of file.entrees()) {
    const m = parSource.get(e.source) ?? new Map();
    m.set(e.id_source, { url: e.url, autoriserMeta: e.autoriserMeta });
    parSource.set(e.source, m);
  }
  const candidates: (CandidateVideo & { autoriserMeta: boolean })[] = [];
  for (const [source, liens] of parSource) {
    const ids = [...liens.keys()];
    for (let i = 0; i < ids.length; i += 300) {
      const lot = ids.slice(i, i + 300);
      const lire = (colonnes: string) => sb.from('pub_track_pubs').select(colonnes).eq('source', source).in('id_source', lot);
      let res = await lire('id, id_source, score, statut_pt, video_url');
      // Migration 118 pas encore appliquée : sans statut, l'ordre se fait au score seul.
      if (res.error && colonneAbsente(res.error.message)) res = await lire('id, id_source, score, video_url');
      if (res.error) throw new Error(`file des videos : ${res.error.message}`);
      for (const r of (res.data ?? []) as unknown as { id: string | number; id_source: string; score: number | null; statut_pt?: string | null; video_url: string | null }[]) {
        if (estVideoChezNous(r.video_url)) continue;
        const lien = liens.get(r.id_source);
        if (!lien) continue;
        candidates.push({ id: String(r.id), urlSource: lien.url, score: r.score, statut: r.statut_pt ?? null, autoriserMeta: lien.autoriserMeta });
      }
    }
  }
  const outils = options.outils ?? outilsReels(sb);
  return deposerDansLOrdre(candidates, (c) => deposerVideoPubTrack(c.id, c.urlSource, { outils, r2: options.r2, plafondOctets: options.plafondOctets, autoriserMeta: c.autoriserMeta }), fin);
}

export const ligneBilan = (b: BilanDepot) =>
  `Videos R2 : ${b.deposees}/${b.candidates} deposees (${(b.octets / 1024 ** 2).toFixed(1)} Mo)` +
  `${Object.keys(b.refus).length ? `, refus ${JSON.stringify(b.refus)}` : ''}${b.arret ? `, arret : ${b.arret}` : ''}.`;
