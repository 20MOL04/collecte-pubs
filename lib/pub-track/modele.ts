/**
 * Le modèle de vision de Pub Track, lu à UN endroit : l'analyse « Pourquoi elle marche » (route)
 * et le nommage des produits (collecteur de nuit) ne doivent jamais diverger.
 */
export function modeleVisionPubTrack(): string {
  return process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-3.6-flash';
}
