/**
 * L'APPEL À CLAUDE DE PUB TRACK (17/11/2026, Pub Track quitte Gemini).
 *
 * Un seul module pour la route « Pourquoi elle marche » (Vercel) et la collecte de nuit (GitHub Actions) : il
 * n'importe ni `server-only` ni d'alias `@/`, pour que les scripts le chargent tels quels. HTTP brut comme le
 * reste du dépôt (aucun SDK installé), sans flux : une réponse tient en quelques milliers de jetons.
 *
 * Trois règles :
 * - la dépense se lit dans `usage` (cache compris), jamais dans la longueur du texte, et elle remonte AVEC
 *   l'échec (`ErreurFournisseurFacturee`) : un appel payé qui n'a rien donné reste une dépense ;
 * - un refus (`stop_reason: "refusal"`) ou une réponse coupée (`max_tokens`) est un échec, jamais un JSON vide ;
 * - `arret` dit quand insister ne sert à rien cette nuit (clé refusée, débit ou solde épuisé).
 */
import { coutTexteUsd } from '../ai/providers/cout-texte';
import { ErreurFournisseurFacturee } from '../ai/providers/depense-engagee';

export const ENDPOINT_CLAUDE = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
/**
 * Les modèles qui acceptent le secours serveur sur refus (`fallbacks: "default"`) : Anthropic rejoue la même
 * demande sur le modèle de secours qu'il choisit selon la cause du refus, dans le même appel. Haiku 5.5 n'en a pas
 * (une liste `fallbacks` y rend 400).
 */
export const AVEC_SECOURS_SERVEUR = /^claude-(opus-5-5|opus-5|fable-5-[12]|sonnet-5-5)$/;
export const BETA_SECOURS = 'server-side-fallback-2026-07-01';

export type MimeImage = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface ImageClaude {
  mime: MimeImage;
  /** Base64 sans saut de ligne. */
  data: string;
}

export interface DemandeClaude {
  cle: string;
  modele: string;
  /** La consigne, envoyée après les images. */
  texte: string;
  images?: readonly ImageClaude[];
  /** Sortie structurée : le JSON rendu respecte ce schéma (objet à la racine). Sans schéma, lecture tolérante. */
  schema?: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

export interface ReponseClaude {
  json: unknown;
  /** Le modèle qui a RÉELLEMENT répondu : celui du secours quand le premier a refusé. */
  modeleServi: string;
  coutUsd: number;
  jetonsEntree: number;
  jetonsSortie: number;
}

/** Un échec facturé, avec ce qu'il dit de la suite : `arret` = inutile de rappeler avant demain. */
export class ErreurClaude extends ErreurFournisseurFacturee {
  readonly arret: boolean;
  readonly jetonsEntree: number;
  readonly jetonsSortie: number;
  /**
   * Le modèle a peut-être travaillé sans que sa facture nous parvienne (délai dépassé, coupure réseau) : le
   * montant porté (zéro) est un plancher, jamais une preuve de gratuité. L'appelant le journalise.
   */
  readonly coutIncertain: boolean;

  constructor(message: string, coutUsd: number, opts: { arret?: boolean; jetonsEntree?: number; jetonsSortie?: number; coutIncertain?: boolean; cause?: unknown } = {}) {
    super(message, coutUsd, opts.cause);
    this.name = 'ErreurClaude';
    this.arret = opts.arret ?? false;
    this.jetonsEntree = opts.jetonsEntree ?? 0;
    this.jetonsSortie = opts.jetonsSortie ?? 0;
    this.coutIncertain = opts.coutIncertain ?? false;
  }
}

/** Le vrai type d'une image, lu dans ses premiers octets : l'en-tête HTTP d'un stockage ment parfois. */
export function typeImage(octets: Uint8Array): MimeImage | null {
  const a = (i: number) => octets[i] ?? -1;
  if (a(0) === 0xff && a(1) === 0xd8 && a(2) === 0xff) return 'image/jpeg';
  if (a(0) === 0x89 && a(1) === 0x50 && a(2) === 0x4e && a(3) === 0x47) return 'image/png';
  if (a(0) === 0x47 && a(1) === 0x49 && a(2) === 0x46) return 'image/gif';
  if (a(0) === 0x52 && a(1) === 0x49 && a(2) === 0x46 && a(3) === 0x46 && a(8) === 0x57 && a(9) === 0x45 && a(10) === 0x42 && a(11) === 0x50) return 'image/webp';
  return null;
}

/** Le JSON d'une réponse sans schéma : blocs ```json, phrase autour, tableau ou objet. `null` si illisible. */
export function extraireJson(texte: string): unknown {
  const nu = texte.trim();
  const candidats: string[] = [nu];
  const cloture = nu.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cloture?.[1]) candidats.push(cloture[1].trim());
  for (const [ouvre, ferme] of [['[', ']'], ['{', '}']] as const) {
    const debut = nu.indexOf(ouvre);
    const fin = nu.lastIndexOf(ferme);
    if (debut >= 0 && fin > debut) candidats.push(nu.slice(debut, fin + 1));
  }
  for (const c of candidats) {
    try {
      return JSON.parse(c);
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}

interface UsageClaude {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface CorpsClaude {
  model?: string;
  content?: { type?: string; text?: string }[];
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
  usage?: UsageClaude & { iterations?: (UsageClaude & { type?: string; model?: string })[] };
  error?: { type?: string; message?: string };
}

/** Jetons et dollars d'un usage, cache compris (Anthropic exclut le cache de `input_tokens` : il s'ajoute). */
function depense(modele: string, u: UsageClaude): { coutUsd: number; jetonsEntree: number; jetonsSortie: number } {
  return {
    coutUsd: coutTexteUsd(modele, {
      jetonsEntree: u.input_tokens ?? 0,
      jetonsSortie: u.output_tokens ?? 0,
      jetonsCache: u.cache_read_input_tokens ?? 0,
      jetonsCreationCache: u.cache_creation_input_tokens ?? 0,
    }),
    jetonsEntree: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    jetonsSortie: u.output_tokens ?? 0,
  };
}

/**
 * Lit la réponse d'Anthropic, PURE (verrou : verify-pub-track-claude). Rend le JSON et la dépense, ou LÈVE une
 * `ErreurClaude` qui porte ce qui a déjà été facturé.
 */
export function lireReponseClaude(statut: number, corps: unknown, modele: string, avecSchema: boolean): ReponseClaude {
  const c = (corps && typeof corps === 'object' ? corps : {}) as CorpsClaude;
  const iterations = Array.isArray(c.usage?.iterations) ? c.usage.iterations : [];
  const secoursServi = iterations.some((it) => it.type === 'fallback_message');
  const modeleServi = secoursServi && typeof c.model === 'string' && c.model ? c.model : modele;
  /*
   * Avec le secours serveur, `usage` ne couvre que la tentative rendue ; `usage.iterations` porte CHAQUE
   * tentative, au tarif du modèle qui l'a faite. On les additionne : un refus suivi d'un secours se paie deux
   * fois au plus, et ne compter que la dernière flatterait la marge.
   */
  const parTentative = iterations.map((it) => depense(it.model || (it.type === 'fallback_message' ? modeleServi : modele), it));
  const total = parTentative.length
    ? parTentative.reduce((x, y) => ({ coutUsd: x.coutUsd + y.coutUsd, jetonsEntree: x.jetonsEntree + y.jetonsEntree, jetonsSortie: x.jetonsSortie + y.jetonsSortie }))
    : depense(modele, c.usage ?? {});
  const { coutUsd, jetonsEntree, jetonsSortie } = total;
  const jetons = { jetonsEntree, jetonsSortie };

  if (statut < 200 || statut >= 300) {
    const message = c.error?.message ?? '';
    // Clé refusée, débit dépassé, ou solde vide (Anthropic répond 400 « credit balance is too low ») : demain.
    const arret = statut === 401 || statut === 403 || statut === 429 || (statut === 400 && /credit balance|billing/i.test(message));
    throw new ErreurClaude(`claude : HTTP ${statut}${message ? ` (${message.slice(0, 160)})` : ''}`, coutUsd, { arret, ...jetons });
  }
  if (c.stop_reason === 'refusal') {
    throw new ErreurClaude(`claude : refus du modele${c.stop_details?.category ? ` (${c.stop_details.category})` : ''}`, coutUsd, jetons);
  }
  if (c.stop_reason === 'max_tokens') {
    throw new ErreurClaude('claude : reponse coupee par le plafond de jetons', coutUsd, jetons);
  }
  // Après un secours, seul le texte qui suit le dernier bloc `fallback` appartient à la réponse rendue.
  const blocs = c.content ?? [];
  const depuis = blocs.map((b) => b.type).lastIndexOf('fallback') + 1;
  const texte = blocs.slice(depuis).flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('');
  let json: unknown = null;
  if (avecSchema) {
    try {
      json = JSON.parse(texte);
    } catch {
      json = null;
    }
  } else {
    json = extraireJson(texte);
  }
  if (json === null || json === undefined) throw new ErreurClaude('claude : reponse hors format', coutUsd, jetons);
  return { json, modeleServi, coutUsd, ...jetons };
}

/** UN appel, jamais deux : aucune reprise ici, l'appelant décide. */
export async function appelerClaude(d: DemandeClaude): Promise<ReponseClaude> {
  const images = d.images ?? [];
  const contenu: Record<string, unknown>[] = [];
  images.forEach((img, i) => {
    // Plusieurs images : chacune porte son numéro, celui que la consigne cite (« image 3 »).
    if (images.length > 1) contenu.push({ type: 'text', text: `Image ${i + 1}:` });
    contenu.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
  });
  contenu.push({ type: 'text', text: d.texte });

  const secours = AVEC_SECOURS_SERVEUR.test(d.modele);
  let reponse: Response;
  let corps: unknown;
  try {
    reponse = await fetch(ENDPOINT_CLAUDE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': d.cle, 'anthropic-version': VERSION, ...(secours ? { 'anthropic-beta': BETA_SECOURS } : {}) },
      // AUCUN `tools` : le modèle lit des pubs publiques, du texte non fiable, il n'a rien pour agir.
      body: JSON.stringify({
        model: d.modele,
        max_tokens: d.maxTokens,
        output_config: { effort: 'low', ...(d.schema ? { format: { type: 'json_schema', schema: d.schema } } : {}) },
        // Un refus se rejoue sur le secours choisi par Anthropic selon sa cause, dans le même appel.
        ...(secours ? { fallbacks: 'default' } : {}),
        messages: [{ role: 'user', content: contenu }],
      }),
      signal: AbortSignal.timeout(d.timeoutMs),
    });
    // Un corps coupé par le délai lève ici aussi : sa facture est tout aussi incertaine.
    corps = (await reponse.json()) as unknown;
  } catch (err) {
    // Délai dépassé ou coupure : le modèle a peut-être déjà travaillé, mais sa facture ne nous est pas parvenue.
    // On n'invente pas un montant : zéro porté, signalé incertain, journalisé par l'appelant.
    throw new ErreurClaude('claude : pas de reponse du modele (cout incertain)', 0, { coutIncertain: true, cause: err });
  }
  return lireReponseClaude(reponse.status, corps, d.modele, !!d.schema);
}
