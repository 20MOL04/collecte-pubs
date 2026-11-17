/**
 * LA RÉFÉRENCE D'UN FICHIER PUBLIC (15/11/2026). Un fichier déjà public (copie partagée d'une affiche, image de
 * Pub Track) a son adresse calculée sans lire la base : sa colonne porte donc elle-même son emplacement.
 *
 * - `r2:<clé>` : le fichier vit dans le bucket R2 public, à `<R2_URL_PUBLIQUE_PUB_TRACK>/<clé>`.
 * - toute autre valeur : un chemin dans le bucket Supabase public d'origine, écrit avant le passage à R2.
 *
 * Les fichiers PRIVÉS n'utilisent jamais ce préfixe : leur emplacement est rangé dans la table `fichiers_r2`
 * (migration 145), parce que leur chemin se recalcule dans le code à bien des endroits et doit garder sa forme.
 * Module pur, sans secret : utilisable des deux côtés.
 */
export const PREFIXE_R2 = 'r2:';

export const estReferenceR2 = (reference: string): boolean => reference.startsWith(PREFIXE_R2);

export const referenceR2 = (cle: string): string => `${PREFIXE_R2}${cle}`;

/** La clé R2 d'une référence `r2:`, ou `null` pour un ancien chemin Supabase. */
export function cleDeReference(reference: string): string | null {
  return estReferenceR2(reference) ? reference.slice(PREFIXE_R2.length) : null;
}

const encoderChemin = (cle: string) => cle.split('/').map(encodeURIComponent).join('/');

/**
 * L'adresse publique d'une référence : le domaine R2 public pour `r2:`, le stockage public Supabase pour un ancien
 * chemin. `null` si le domaine nécessaire n'est pas configuré.
 */
export function urlPubliqueDeReference(reference: string, bucketSupabase: 'partages' | 'pub-track', bases: { r2: string | null; supabase: string | null }): string | null {
  if (!reference) return null;
  const cle = cleDeReference(reference);
  if (cle !== null) return bases.r2 ? `${bases.r2.replace(/\/+$/, '')}/${encoderChemin(cle)}` : null;
  return bases.supabase ? `${bases.supabase.replace(/\/+$/, '')}/storage/v1/object/public/${bucketSupabase}/${reference}` : null;
}
