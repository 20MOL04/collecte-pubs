/**
 * Découpe un texte en mots ENTIERS, sans accents, en minuscules.
 *
 * Toute devinette de Pub Track (niche, langue, type de produit) passe par ici :
 * on compare des mots entiers, jamais des sous-chaînes. « sac » ne doit pas
 * trouver « sachet », « thé » ne doit pas trouver « esthétique » (même règle
 * que `trouverCategoriePlaybook`, verrou `verify-categorie-mot-entier.ts`).
 */
// NFKC d'abord : \u00ab \ud835\udc0a\ud835\udc08\ud835\udc13 \ud835\udc0c\ud835\udc08\ud835\udc0d\ud835\udc02\ud835\udc04\ud835\udc14\ud835\udc11 \u00bb (lettres math\u00e9matiques, fr\u00e9quentes dans les pubs) redevient \u00ab KIT MINCEUR \u00bb.
function sansAccents(s: string): string {
  return s.normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function mots(texte: string): string[] {
  return sansAccents(texte.normalize('NFKC').toLowerCase())
    .split(/[^a-z0-9\u0600-\u06ff]+/)
    .filter((m) => m.length > 0);
}

/**
 * Vrai si l'un des termes apparaît en mots entiers. Un terme peut faire
 * plusieurs mots (« creme visage ») : il doit alors apparaître dans l'ordre,
 * collé.
 */
export function contientTerme(motsTexte: readonly string[], termes: readonly string[]): boolean {
  const ensemble = new Set(motsTexte);
  for (const terme of termes) {
    const t = mots(terme);
    if (t.length === 0) continue;
    if (t.length === 1) {
      if (ensemble.has(t[0])) return true;
      continue;
    }
    for (let i = 0; i + t.length <= motsTexte.length; i++) {
      if (t.every((m, j) => motsTexte[i + j] === m)) return true;
    }
  }
  return false;
}
