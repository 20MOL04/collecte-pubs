/**
 * LA SOURCE AUTORISÉE DES PUBS (07/11/2026) : le branchement prêt pour la source que Martin choisira.
 *
 * Deux possibilités, à décider par Martin :
 * - un FOURNISSEUR DE DONNÉES SOUS CONTRAT, dont le contrat couvre les pubs Meta des pays de Pub Track et, s'il livre
 *   des vidéos, leur recopie chez nous ;
 * - l'ACCÈS OFFICIEL DE META (API de la bibliothèque publicitaire, compte vérifié). Attention : cette API ne rend les pubs
 *   commerciales que pour les pays de l'Union européenne ; hors UE, seulement les pubs politiques ou sociales. Elle ne
 *   suffit donc pas, seule, pour l'Afrique.
 *
 * Quelle que soit la source, elle livre des `PubFournie` (le format ci-dessous, documenté dans
 * docs/SOURCE-AUTORISEE.md). Elles deviennent des lignes Pub Track par le MÊME traducteur que la bibliothèque
 * (`versLigne`, analyser-reponse.ts) : même catégorie, même niche, même clé de groupe, mêmes règles. Fonctions PURES,
 * testées dans `tests/source-autorisee.test.ts`.
 */
import { fusionner, versLigne, type LignePub } from '../../scripts/pub-track/analyser-reponse';
import { estPaysPubTrack } from './pays';

/** Une pub telle qu'une source autorisée doit la livrer. Seuls `id`, `page_id` et `pays` sont obligatoires. */
export interface PubFournie {
  /** L'identifiant de la pub dans la bibliothèque Meta (ad archive id) : c'est lui qui évite les doublons. */
  id: string;
  page_id: string;
  page_nom?: string;
  page_avatar?: string | null;
  page_abonnes?: number | null;
  texte?: string;
  titre?: string;
  appel_action?: string;
  lien?: string | null;
  /** Codes pays ISO à deux lettres où la pub est diffusée. */
  pays: string[];
  /** facebook, instagram, messenger, audience_network, whatsapp, threads. */
  plateformes?: string[];
  /** AAAA-MM-JJ. */
  date_debut?: string | null;
  date_fin?: string | null;
  active?: boolean;
  format?: 'video' | 'image' | 'carrousel';
  /** Un lien https encore valide vers le fichier vidéo : il part aussitôt dans R2, il n'est jamais gardé en base. */
  video_url?: string | null;
  video_duree_s?: number | null;
  /** L'image (ou l'aperçu de la vidéo), recopiée comme miniature. */
  image_url?: string | null;
  /** Combien de pubs partagent cette créative (« N publicités utilisent ce contenu »). */
  variantes?: number | null;
  collation_id?: string | null;
}

const unix = (jour: string | null | undefined): number | null => {
  if (!jour || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  const t = Date.parse(`${jour}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};

const https = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    return new URL(u).protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
};

/** Pourquoi une pub fournie est écartée, ou `null` si elle est utilisable. */
export function defautPubFournie(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'pas un objet';
  const o = p as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^\d{5,25}$/.test(o.id)) return 'id absent ou invalide';
  if (typeof o.page_id !== 'string' || !o.page_id.trim()) return 'page_id absent';
  if (!Array.isArray(o.pays) || !o.pays.some((x) => typeof x === 'string' && /^[A-Za-z]{2}$/.test(x))) return 'pays absents';
  return null;
}

/** La pub fournie, mise dans la forme que la bibliothèque Meta renvoie, pour passer par le même traducteur. */
export function versBrutMeta(p: PubFournie): Record<string, unknown> {
  const video = https(p.video_url);
  const image = https(p.image_url);
  return {
    ad_archive_id: p.id,
    page_id: p.page_id,
    page_name: p.page_nom ?? '',
    is_active: p.active !== false,
    start_date: unix(p.date_debut),
    end_date: unix(p.date_fin),
    publisher_platform: (p.plateformes ?? []).map((x) => x.toUpperCase()),
    collation_id: p.collation_id ?? null,
    collation_count: p.variantes ?? 1,
    snapshot: {
      page_name: p.page_nom ?? '',
      page_profile_picture_url: https(p.page_avatar) ?? '',
      page_like_count: p.page_abonnes ?? null,
      body: { text: p.texte ?? '' },
      title: p.titre ?? '',
      link_url: p.lien ?? '',
      cta_text: p.appel_action ?? '',
      display_format: p.format ? p.format.toUpperCase().replace('CARROUSEL', 'CAROUSEL') : video ? 'VIDEO' : 'IMAGE',
      videos: video ? [{ video_hd_url: video, video_preview_image_url: image ?? '', video_duration: p.video_duree_s ?? null }] : [],
      images: !video && image ? [{ original_image_url: image }] : [],
      cards: [],
    },
  };
}

/**
 * Une ligne Pub Track par pub fournie, tous ses pays réunis. Le marché : Afrique si au moins un pays de Pub Track,
 * Occident sinon (la « Tendance occidentale »).
 */
export function versLigneFournie(p: PubFournie): LignePub | null {
  if (defautPubFournie(p)) return null;
  const pays = [...new Set(p.pays.filter((x) => /^[A-Za-z]{2}$/.test(x)).map((x) => x.toUpperCase()))].sort();
  const brut = versBrutMeta(p);
  let ligne: LignePub | null = null;
  for (const code of pays) {
    const l = versLigne(brut, code);
    if (!l) continue;
    ligne = ligne ? fusionner(ligne, l) : l;
  }
  if (!ligne) return null;
  return pays.some(estPaysPubTrack) ? ligne : { ...ligne, marche: 'occident' };
}

/* ── La lecture du fournisseur (contrat JSON de docs/SOURCE-AUTORISEE.md) ─────────────────────────────── */

export class RefusSource extends Error {}

/** Une page du fournisseur. Un refus (401, 403, 429) lève `RefusSource` : la collecte s'arrête là. */
export async function lirePageSource(adresse: string, cle: string | null): Promise<{ pubs: unknown[]; suivant: string | null }> {
  const r = await fetch(adresse, {
    headers: { accept: 'application/json', ...(cle ? { authorization: `Bearer ${cle}` } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 401 || r.status === 403 || r.status === 429) throw new RefusSource(`la source a refuse (HTTP ${r.status})`);
  if (!r.ok) throw new Error(`source : HTTP ${r.status}`);
  const corps = (await r.json()) as { pubs?: unknown; suivant?: unknown };
  const suivant = typeof corps.suivant === 'string' && corps.suivant.startsWith('https://') ? corps.suivant : null;
  return { pubs: Array.isArray(corps.pubs) ? corps.pubs : [], suivant };
}

export function premiereAdresse(base: string, pays: string[], depuis: string | null): string {
  const u = new URL(base);
  if (pays.length) u.searchParams.set('pays', pays.join(','));
  if (depuis) u.searchParams.set('depuis', depuis);
  return u.toString();
}

/** Les lignes Pub Track des pubs fournies, et le compte des pubs écartées par motif. */
export function traduire(brutes: unknown[]): { lignes: LignePub[]; ecartees: Record<string, number> } {
  const lignes = new Map<string, LignePub>();
  const ecartees: Record<string, number> = {};
  for (const b of brutes) {
    const defaut = defautPubFournie(b);
    const l = defaut ? null : versLigneFournie(b as PubFournie);
    if (!l) {
      const motif = defaut ?? 'illisible';
      ecartees[motif] = (ecartees[motif] ?? 0) + 1;
      continue;
    }
    lignes.set(l.id_source, l);
  }
  return { lignes: [...lignes.values()], ecartees };
}
