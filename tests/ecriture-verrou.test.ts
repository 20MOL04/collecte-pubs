/**
 * Le verrou des vidéos, de bout en bout dans `ecrireRecherche` : une fausse base garde ce qui serait écrit.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LignePub } from '../scripts/pub-track/analyser-reponse';
import { FileVideos } from '../scripts/pub-track/deposer-videos';
import { ecrireRecherche } from '../scripts/pub-track/ecriture';

function ligne(id: string, video: string | null): LignePub {
  return {
    source: 'meta', id_source: id, annonceur_id: 'p1', annonceur_nom: 'Boutique', annonceur_avatar: null,
    texte: 'Savon', titre: '', appel_action: '', lien: null, domaine: null, destination: 'whatsapp' as LignePub['destination'],
    boutique_cle: null, format: 'video', duree_video_s: 20, video_url: video, reseaux: [], pays: ['CI'], langue: null,
    niche: 'beaute' as LignePub['niche'], type_produit: 'physique', categorie: 'application' as LignePub['categorie'],
    prix_fcfa: null, offres: [], active: true, date_debut: null, date_fin: null, groupe_cle: null, variantes_source: 1,
    apercu_source: null,
  };
}

function fausseBase(enBase: { id_source: string; miniature_chemin: string | null; video_url: string | null }[]) {
  const ecrit: Record<string, unknown>[] = [];
  const sb = {
    from() {
      return {
        select() {
          return { eq: () => ({ in: async () => ({ data: enBase, error: null }) }) };
        },
        async upsert(lignes: Record<string, unknown>[]) {
          ecrit.push(...lignes);
          return { error: null };
        },
      };
    },
  };
  return { sb: sb as never, ecrit };
}

const R2 = 'https://media.creafrik.com/videos/11.mp4?v=1';
const FBCDN = 'https://video.xx.fbcdn.net/v/abc.mp4?oh=1';
const FOURNISSEUR = 'https://cdn.fournisseur.example/v/abc.mp4';

test('ecrireRecherche garde la video R2 en base, efface un lien fbcdn, n en ecrit jamais un', async () => {
  const { sb, ecrit } = fausseBase([
    { id_source: 'a', miniature_chemin: null, video_url: R2 },
    { id_source: 'b', miniature_chemin: null, video_url: FBCDN },
  ]);
  const file = new FileVideos();
  await ecrireRecherche(sb, [ligne('a', FBCDN), ligne('b', FBCDN), ligne('c', FBCDN)], new Set(), { miniatures: 0 }, { file });
  const parId = Object.fromEntries(ecrit.map((l) => [l.id_source, l.video_url]));
  assert.deepEqual(parId, { a: R2, b: null, c: null });
  assert.ok(ecrit.every((l) => 'video_url' in l), 'video_url est toujours posee, pour que le lot n ecrase rien');
  assert.equal(file.taille, 0, 'le collecteur ne met aucun lien fbcdn dans la file des depots');
});

test('une video de fournisseur part dans la file, sauf pour une pub deja chez nous', async () => {
  const { sb, ecrit } = fausseBase([{ id_source: 'a', miniature_chemin: 'meta/a.webp', video_url: R2 }]);
  const file = new FileVideos();
  await ecrireRecherche(sb, [ligne('a', FOURNISSEUR), ligne('n', FOURNISSEUR)], new Set(), { miniatures: 0 }, { file });
  assert.deepEqual(file.entrees().map((e) => e.id_source), ['n']);
  assert.equal(ecrit.find((l) => l.id_source === 'n')?.video_url, null);
  assert.equal(ecrit.find((l) => l.id_source === 'a')?.video_url, R2);
  assert.equal(ecrit.find((l) => l.id_source === 'a')?.miniature_chemin, 'meta/a.webp');
});

test('une source sous contrat peut faire recopier une video hebergee chez Meta, si elle y est autorisee', async () => {
  const { sb } = fausseBase([]);
  const file = new FileVideos();
  await ecrireRecherche(sb, [ligne('x', FBCDN)], new Set(), { miniatures: 0 }, { file, autoriserMeta: true });
  assert.deepEqual(file.entrees(), [{ source: 'meta', id_source: 'x', url: FBCDN, autoriserMeta: true }]);
});
