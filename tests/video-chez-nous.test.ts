import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estAdresseMeta, estVideoChezNous, ordreDepot, sourceADeposer, urlPubliqueR2, videoAEcrire } from '../lib/pub-track/video-chez-nous';

const R2 = 'https://media.creafrik.com/videos/123.mp4?v=1';
const FBCDN = 'https://video-cdg4-1.xx.fbcdn.net/v/t42.1790-2/abc.mp4?_nc_cat=1';
const FOURNISSEUR = 'https://cdn.fournisseur.example/v/abc.mp4';
const env = {};

test('une video de media.creafrik.com est chez nous, un lien fbcdn non', () => {
  assert.equal(estVideoChezNous(R2, env), true);
  assert.equal(estVideoChezNous(FBCDN, env), false);
  assert.equal(estVideoChezNous('https://media.creafrik.com.pirate.example/x.mp4', env), false);
  assert.equal(estVideoChezNous(null, env), false);
  assert.equal(estVideoChezNous('https://x.supabase.co/storage/v1/object/public/pub-track/videos/9.mp4', env), true);
});

test('le verrou tient meme si la variable designe un autre domaine', () => {
  const autre = { R2_URL_PUBLIQUE_PUB_TRACK: 'https://autre.example' };
  assert.equal(estVideoChezNous(R2, autre), true);
  assert.equal(estVideoChezNous('https://autre.example/videos/1.mp4', autre), true);
  assert.equal(urlPubliqueR2({ R2_URL_PUBLIQUE_PUB_TRACK: 'pas une adresse' }), 'https://media.creafrik.com');
  assert.equal(urlPubliqueR2({ R2_URL_PUBLIQUE_PUB_TRACK: 'https://media.creafrik.com/' }), 'https://media.creafrik.com');
});

test('VERROU : une video_url chez nous n est jamais reecrite', () => {
  assert.equal(videoAEcrire(R2, FBCDN, env), R2);
  assert.equal(videoAEcrire(R2, null, env), R2);
  assert.equal(videoAEcrire(R2, FOURNISSEUR, env), R2);
  assert.equal(videoAEcrire(R2, 'https://media.creafrik.com/videos/autre.mp4', env), R2);
});

test('un lien fbcdn ou externe n est jamais garde comme video_url', () => {
  assert.equal(videoAEcrire(null, FBCDN, env), null);
  assert.equal(videoAEcrire(FBCDN, FBCDN, env), null, 'un vieux lien fbcdn en base est efface a la reecriture');
  assert.equal(videoAEcrire(FBCDN, null, env), null);
  assert.equal(videoAEcrire(null, FOURNISSEUR, env), null);
  assert.equal(videoAEcrire(null, R2, env), R2);
});

test('la source a deposer : jamais une pub deja chez nous, jamais un CDN de Meta sans autorisation', () => {
  assert.equal(sourceADeposer(null, FOURNISSEUR, { env }), FOURNISSEUR);
  assert.equal(sourceADeposer(R2, FOURNISSEUR, { env }), null);
  assert.equal(sourceADeposer(null, FBCDN, { env }), null);
  assert.equal(sourceADeposer(null, FBCDN, { env, autoriserMeta: true }), FBCDN);
  assert.equal(sourceADeposer(null, 'http://cdn.example/a.mp4', { env }), null);
  assert.equal(sourceADeposer(null, R2, { env }), null);
  assert.equal(sourceADeposer(null, null, { env }), null);
});

test('les hotes de Meta sont reconnus', () => {
  assert.equal(estAdresseMeta(FBCDN), true);
  assert.equal(estAdresseMeta('https://scontent.cdninstagram.com/x.mp4'), true);
  assert.equal(estAdresseMeta('https://www.facebook.com/ads/library/'), true);
  assert.equal(estAdresseMeta(FOURNISSEUR), false);
  assert.equal(estAdresseMeta('https://notfbcdn.net.example/x'), false);
});

test('l ordre du depot : gagnantes, montantes, puis score', () => {
  const ordre = ordreDepot([
    { id: 'a', score: 90, statut: 'nouvelle' },
    { id: 'b', score: 40, statut: 'gagnante' },
    { id: 'c', score: 70, statut: 'gagnante' },
    { id: 'd', score: 95, statut: null },
    { id: 'e', score: 50, statut: 'montante' },
    { id: 'f', score: null, statut: null },
  ]);
  assert.deepEqual(ordre.map((x) => x.id), ['c', 'b', 'e', 'a', 'd', 'f']);
});
