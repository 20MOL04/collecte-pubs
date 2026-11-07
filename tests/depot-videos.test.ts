/**
 * Le dépôt dans R2 et sa file, sans réseau : de faux outils (R2, téléchargement, ffmpeg, base) mesurent ce qui part.
 * Un dernier test lance le VRAI ffmpeg s'il est installé : 480p, H.264, faststart.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { deposerDansLOrdre } from '../scripts/pub-track/deposer-videos';
import { cleVideo, deposerVideoPubTrack, reencoder480p, type OutilsDepot } from '../services/pub-track/videos';
import { signerS3, type ConfigR2 } from '../services/stockage/r2';

const r2: ConfigR2 = { compte: 'compte', cleId: 'id', secret: 'secret', bucket: 'creafrik-pub-track', urlPublique: 'https://media.creafrik.com' };
const MO = 1024 ** 2;

function fauxOutils(occupeOctets: number, tailleEncodee = 2 * MO) {
  const deposes: string[] = [];
  const poses: [string, string][] = [];
  let occupe = occupeOctets;
  const outils: OutilsDepot = {
    async occupation() {
      return { total: occupe, objet: 0 };
    },
    async deposer(c, cle, corps) {
      deposes.push(cle);
      occupe += corps.byteLength;
      return `${c.urlPublique}/${cle}`;
    },
    async telecharger() {
      return new Uint8Array(10);
    },
    async reencoder() {
      return { ok: true, fichier: new Uint8Array(tailleEncodee) };
    },
    async majBase(id, url) {
      poses.push([id, url]);
      return null;
    },
  };
  return { outils, deposes, poses };
}

test('un depot reussi range videos/<id>.mp4 et pose l adresse publique', async () => {
  const f = fauxOutils(0);
  const r = await deposerVideoPubTrack('42', 'https://cdn.fournisseur.example/a.mp4', { outils: f.outils, r2 });
  assert.equal(r.ok, true);
  assert.deepEqual(f.deposes, [cleVideo('42')]);
  assert.match(f.poses[0]?.[1] ?? '', /^https:\/\/media\.creafrik\.com\/videos\/42\.mp4\?v=\d+$/);
});

test('refus : CDN de Meta sans autorisation, http, id invalide, R2 absent', async () => {
  const f = fauxOutils(0);
  assert.deepEqual(await deposerVideoPubTrack('1', 'https://video.xx.fbcdn.net/a.mp4', { outils: f.outils, r2 }), { ok: false, raison: 'url_meta' });
  assert.deepEqual(await deposerVideoPubTrack('1', 'http://cdn.example/a.mp4', { outils: f.outils, r2 }), { ok: false, raison: 'url_invalide' });
  assert.deepEqual(await deposerVideoPubTrack('1/../x', 'https://cdn.example/a.mp4', { outils: f.outils, r2 }), { ok: false, raison: 'id_invalide' });
  assert.deepEqual(await deposerVideoPubTrack('1', 'https://cdn.example/a.mp4', { outils: f.outils, r2: null }), { ok: false, raison: 'r2_absent' });
  assert.equal(f.deposes.length, 0);
});

test('le plafond de 8 Go est mesure : bucket plein, ou depot qui le ferait depasser', async () => {
  const plein = fauxOutils(8 * 1024 ** 3);
  assert.equal((await deposerVideoPubTrack('1', 'https://cdn.example/a.mp4', { outils: plein.outils, r2 })).ok, false);
  const presque = fauxOutils(8 * 1024 ** 3 - MO);
  const r = await deposerVideoPubTrack('1', 'https://cdn.example/a.mp4', { outils: presque.outils, r2 });
  assert.deepEqual(r.ok ? null : r.raison, 'plafond_atteint');
  assert.equal(presque.deposes.length, 0);
});

test('la file : meilleures pubs d abord, arret au plafond', async () => {
  const f = fauxOutils(0, 3 * MO);
  const candidates = [
    { id: 'faible', urlSource: 'https://cdn.example/1.mp4', score: 10, statut: null },
    { id: 'gagnante', urlSource: 'https://cdn.example/2.mp4', score: 65, statut: 'gagnante' },
    { id: 'montante', urlSource: 'https://cdn.example/3.mp4', score: 80, statut: 'montante' },
  ];
  const bilan = await deposerDansLOrdre(candidates, (c) => deposerVideoPubTrack(c.id, c.urlSource, { outils: f.outils, r2, plafondOctets: 7 * MO }), Date.now() + 60_000);
  assert.deepEqual(f.deposes, ['videos/gagnante.mp4', 'videos/montante.mp4']);
  assert.equal(bilan.deposees, 2);
  assert.equal(bilan.arret, 'plafond_atteint');
});

test('la file s arrete a l heure', async () => {
  let t = 0;
  const bilan = await deposerDansLOrdre(
    [{ id: 'a', urlSource: 'https://x.example/a.mp4', score: 1, statut: null }],
    async () => ({ ok: true, cle: 'x', url: 'x', octets: 1, occupeOctets: 1 }),
    10,
    () => (t += 100),
  );
  assert.equal(bilan.deposees, 0);
  assert.equal(bilan.arret, 'temps');
});

test('signature S3 (SigV4) : les exemples publies par AWS', () => {
  const base = { date: new Date(Date.UTC(2013, 4, 24)), region: 'us-east-1', cleId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const vide = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const get = signerS3({ ...base, methode: 'GET', hote: 'examplebucket.s3.amazonaws.com', chemin: '/test.txt', entetes: { range: 'bytes=0-9' }, empreinteCorps: vide });
  assert.ok(get.authorization?.endsWith('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'));
  const liste = signerS3({ ...base, methode: 'GET', hote: 'examplebucket.s3.amazonaws.com', chemin: '/', requete: { 'max-keys': '2', prefix: 'J' }, empreinteCorps: vide });
  assert.ok(liste.authorization?.endsWith('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7'));
});

const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const ffmpegPresent = spawnSync(ffmpeg, ['-version']).status === 0;

test('le vrai ffmpeg : une video portrait 720x1280 devient 480 de large (~852 de haut selon la version), H.264, faststart', { skip: !ffmpegPresent && 'ffmpeg absent' }, async () => {
  const source = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', 'pipe:1'], { maxBuffer: 50 * MO });
  assert.equal(source.status, 0, String(source.stderr));
  const r = await reencoder480p(new Uint8Array(source.stdout));
  assert.ok(r.ok, r.ok ? '' : r.detail);
  const sortie = Buffer.from(r.fichier);
  const sonde = spawnSync(ffmpeg, ['-hide_banner', '-i', 'pipe:0'], { input: sortie });
  const info = String(sonde.stderr);
  // 852 ou 854 selon l'arrondi de la version d'ffmpeg : le petit côté vaut 480, le format reste vertical 9:16.
  assert.match(info, /Video: h264[^\n]*480x85[2-4]\b/);
  assert.match(info, /Audio: aac/);
  // faststart : l'index (moov) précède les données (mdat).
  assert.ok(sortie.indexOf('moov') < sortie.indexOf('mdat'));
});
