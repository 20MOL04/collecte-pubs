import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defautPubFournie, lirePageSource, premiereAdresse, RefusSource, traduire, versLigneFournie, type PubFournie } from '../lib/pub-track/source-autorisee';

const pub: PubFournie = {
  id: '1234567890123',
  page_id: '998877',
  page_nom: 'Belle Peau CI',
  texte: 'Savon eclaircissant naturel, livraison gratuite a Abidjan. 5000 FCFA',
  titre: 'Commandez sur WhatsApp',
  appel_action: 'Envoyer un message',
  lien: 'https://wa.me/2250700000000',
  pays: ['ci', 'SN', 'ci'],
  plateformes: ['facebook', 'instagram'],
  date_debut: '2026-10-20',
  active: true,
  video_url: 'https://cdn.fournisseur.example/v/1234567890123.mp4',
  video_duree_s: 24,
  image_url: 'https://cdn.fournisseur.example/i/1234567890123.jpg',
  variantes: 3,
};

test('une pub fournie devient une ligne Pub Track par le meme traducteur que la bibliotheque', () => {
  const l = versLigneFournie(pub);
  assert.ok(l);
  assert.equal(l.source, 'meta');
  assert.equal(l.id_source, '1234567890123');
  assert.deepEqual(l.pays, ['CI', 'SN']);
  assert.equal(l.format, 'video');
  assert.equal(l.video_url, pub.video_url, 'le lien reste en memoire pour le depot ; l ecriture ne le garde jamais');
  assert.equal(l.apercu_source, pub.image_url);
  assert.equal(l.date_debut, '2026-10-20');
  assert.equal(l.variantes_source, 3);
  assert.deepEqual(l.reseaux.sort(), ['facebook', 'instagram']);
  assert.equal(l.prix_fcfa, 5000);
  assert.equal(l.marche, undefined, 'au moins un pays de Pub Track : marche Afrique');
});

test('une pub vue seulement hors d Afrique va dans la Tendance occidentale', () => {
  assert.equal(versLigneFournie({ ...pub, pays: ['FR', 'US'] })?.marche, 'occident');
});

test('une pub sans video est une image, une pub mal formee est ecartee avec son motif', () => {
  assert.equal(versLigneFournie({ ...pub, video_url: null })?.format, 'image');
  assert.equal(defautPubFournie({ ...pub, id: 'abc' }), 'id absent ou invalide');
  assert.equal(defautPubFournie({ ...pub, pays: [] }), 'pays absents');
  const { lignes, ecartees } = traduire([pub, { ...pub }, { ...pub, page_id: '' }, 'x']);
  assert.equal(lignes.length, 1, 'le doublon est fusionne');
  assert.deepEqual(ecartees, { 'page_id absent': 1, 'pas un objet': 1 });
});

test('l adresse de la premiere page porte les pays et la date', () => {
  assert.equal(premiereAdresse('https://api.example/pubs?format=json', ['CI', 'SN'], '2026-11-01'), 'https://api.example/pubs?format=json&pays=CI%2CSN&depuis=2026-11-01');
});

test('un refus de la source (403, 429) arrete la collecte, sans nouvel essai', async () => {
  const avant = globalThis.fetch;
  let appels = 0;
  try {
    for (const statut of [401, 403, 429]) {
      globalThis.fetch = (async () => {
        appels += 1;
        return new Response('non', { status: statut });
      }) as typeof fetch;
      await assert.rejects(lirePageSource('https://api.example/pubs', 'cle'), RefusSource);
    }
    assert.equal(appels, 3, 'un seul appel par refus');
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer cle');
      return Response.json({ pubs: [pub], suivant: 'http://pas-https.example/2' });
    }) as typeof fetch;
    const page = await lirePageSource('https://api.example/pubs', 'cle');
    assert.equal(page.pubs.length, 1);
    assert.equal(page.suivant, null, 'une page suivante non https n est pas suivie');
  } finally {
    globalThis.fetch = avant;
  }
});
