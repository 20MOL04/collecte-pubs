import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * LA VITRINE SE RECALCULE DES QUE LA BASE CHANGE (audit du 03/11/2026). La vitrine de Pub Track est une vue
 * materialisee (migration 121), recalculee toutes les 15 minutes par pg_cron : apres une collecte, un classement ou
 * un nommage, elle pouvait montrer 15 minutes une pub rejetee ou un nom perime. Chaque script qui modifie
 * `pub_track_pubs` l'appelle a la fin. Un echec se journalise et ne fait jamais tomber le script : le cron reste le filet.
 */
export async function rafraichirVitrinePubTrack(sb: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await sb.rpc('pub_track_rafraichir_vitrine');
    if (error) {
      console.warn(`vitrine Pub Track : rafraichissement impossible (${error.message}), le cron de 15 min reprendra`);
      return false;
    }
    console.log('vitrine Pub Track : rafraichie');
    return true;
  } catch (err) {
    console.warn('vitrine Pub Track : rafraichissement impossible', err instanceof Error ? err.message : err);
    return false;
  }
}
