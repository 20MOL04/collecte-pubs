/**
 * Les modèles de Pub Track, lus à UN endroit (décision du fondateur, 17/11/2026 : Pub Track quitte Gemini pour
 * Claude, les recharges se concentrent sur Anthropic).
 *
 * - « Pourquoi elle marche » (route `app/api/pub-track/analyse`) : un vendeur la lit, Sonnet.
 * - La collecte de nuit (nommage, classeur, familles, images) : des lots de dix pubs, Haiku.
 *
 * Une valeur posée qui n'est pas un modèle Claude se signale bruyamment et retombe sur le défaut : un reste de
 * réglage Gemini enverrait sinon un nom de modèle inconnu à Anthropic, nuit après nuit.
 */
export const MODELE_ANALYSE_DEFAUT = 'claude-sonnet-5-5';
export const MODELE_COLLECTE_DEFAUT = 'claude-haiku-5-5';

function modeleClaude(variable: string, valeur: string | undefined, defaut: string): string {
  const pose = valeur?.trim();
  if (!pose) return defaut;
  if (!pose.toLowerCase().startsWith('claude-')) {
    console.error(`[pub-track/modele] ${variable}="${pose}" n'est pas un modèle Claude. Repli sur ${defaut}.`);
    return defaut;
  }
  return pose;
}

export function modeleAnalysePubTrack(): string {
  return modeleClaude('CLAUDE_PUB_TRACK_ANALYSE_MODEL', process.env.CLAUDE_PUB_TRACK_ANALYSE_MODEL, MODELE_ANALYSE_DEFAUT);
}

export function modeleCollectePubTrack(): string {
  return modeleClaude('CLAUDE_PUB_TRACK_COLLECTE_MODEL', process.env.CLAUDE_PUB_TRACK_COLLECTE_MODEL, MODELE_COLLECTE_DEFAUT);
}
