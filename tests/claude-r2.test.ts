/**
 * Le passage de Pub Track sur Claude (17/11/2026, Gemini à sec) et des images sur Cloudflare R2 (15/11/2026), sans
 * réseau : la réponse d'Anthropic est lue sous contrôle, la dépense remonte avec l'échec, la nuit s'arrête sur une
 * clé, un débit ou un solde refusé, et aucune image ne part plus dans Supabase.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { coutFacture } from '../lib/pub-track/classeur';
import { MODELE_COLLECTE_DEFAUT, modeleCollectePubTrack } from '../lib/pub-track/modele';
import { referenceR2, urlPubliqueDeReference } from '../lib/stockage/reference';
import { appelerModele, ECHECS_DE_SUITE_MAX, ECHECS_FACTURES_MAX, recadrerProduit, type Compteur } from '../scripts/pub-track/nommer-produits';
import { recopierMiniature } from '../scripts/pub-track/ecriture';
import type { LignePub } from '../scripts/pub-track/analyser-reponse';
import { coutEngage } from '../services/ai/providers/depense-engagee';
import { TARIF_TEXTE, coutTexteUsd } from '../services/ai/providers/cout-texte';
import { AVEC_SECOURS_SERVEUR, ErreurClaude, appelerClaude, extraireJson, lireReponseClaude } from '../services/pub-track/claude';

const lire = (f: string) => readFileSync(f, 'utf8');
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
function fichiers(racine: string): string[] {
  return readdirSync(racine).flatMap((e) => {
    const c = join(racine, e);
    return statSync(c).isDirectory() ? fichiers(c) : /\.ts$/.test(e) ? [c] : [];
  });
}
const echoue = (f: () => unknown): ErreurClaude | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof ErreurClaude ? e : null;
  }
};
const usage = { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 1000 };
const VARIABLES_R2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PUB_TRACK', 'R2_URL_PUBLIQUE_PUB_TRACK'];

async function sansR2<T>(f: () => Promise<T>): Promise<T> {
  const avant = Object.fromEntries(VARIABLES_R2.map((v) => [v, process.env[v]]));
  for (const v of VARIABLES_R2) delete process.env[v];
  try {
    return await f();
  } finally {
    for (const [v, val] of Object.entries(avant)) if (val !== undefined) process.env[v] = val;
  }
}

test('plus aucun appel ni réglage Gemini, ni dans le code ni dans les workflows', () => {
  for (const f of [...fichiers('scripts'), ...fichiers('lib'), ...fichiers('services')]) {
    assert.doesNotMatch(sansCommentaires(lire(f)), /generativelanguage|GEMINI_API_KEY|GEMINI_VISION_MODEL|modeleVisionPubTrack|appelerGemini|inline_data|CLASSEUR_GRATUIT/, f);
  }
  const classeur = lire('.github/workflows/classeur.yml');
  assert.match(classeur, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.doesNotMatch(classeur, /GEMINI_API_KEY|CLASSEUR_GRATUIT/);
  for (const wf of ['classeur.yml', 'collecte.yml', 'source.yml']) {
    for (const v of VARIABLES_R2) assert.match(lire(`.github/workflows/${wf}`), new RegExp(`${v}: \\$\\{\\{ secrets\\.${v} \\}\\}`), `${wf} : ${v}`);
  }
  assert.match(lire('scripts/pub-track/collecter.ts'), /const NOMMAGE = !!process\.env\.ANTHROPIC_API_KEY/);
});

test('la collecte lit Claude Haiku 5.5, et un reste de réglage non Claude retombe sur le défaut', () => {
  const avant = process.env.CLAUDE_PUB_TRACK_COLLECTE_MODEL;
  const erreur = console.error;
  console.error = () => undefined;
  try {
    delete process.env.CLAUDE_PUB_TRACK_COLLECTE_MODEL;
    assert.equal(MODELE_COLLECTE_DEFAUT, 'claude-haiku-5-5');
    assert.equal(modeleCollectePubTrack(), 'claude-haiku-5-5');
    process.env.CLAUDE_PUB_TRACK_COLLECTE_MODEL = 'gemini-3.6-flash';
    assert.equal(modeleCollectePubTrack(), 'claude-haiku-5-5');
  } finally {
    console.error = erreur;
    if (avant === undefined) delete process.env.CLAUDE_PUB_TRACK_COLLECTE_MODEL;
    else process.env.CLAUDE_PUB_TRACK_COLLECTE_MODEL = avant;
  }
  assert.ok(!AVEC_SECOURS_SERVEUR.test('claude-haiku-5-5'), 'Haiku 5.5 refuse le secours serveur (400)');
  assert.deepEqual([TARIF_TEXTE['claude-haiku-5-5']?.entree, TARIF_TEXTE['claude-haiku-5-5']?.sortie], [0.1, 0.5]);
});

test('la réponse d Anthropic : dépense cache compris, refus et coupure facturés, arrêt sur clé, débit ou solde', () => {
  const ok = lireReponseClaude(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '[{"i":1,"vend":true}]' }], usage }, 'claude-haiku-5-5', false);
  assert.ok(Array.isArray(ok.json));
  assert.ok(Math.abs(ok.coutUsd - coutTexteUsd('claude-haiku-5-5', { jetonsEntree: 2000, jetonsSortie: 400, jetonsCache: 1000 })) < 1e-12);
  assert.equal(ok.jetonsEntree, 3000);
  for (const corps of [
    { stop_reason: 'refusal', content: [], usage },
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: '[{"i":1' }], usage },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Désolé.' }], usage },
  ]) {
    const e = echoue(() => lireReponseClaude(200, corps, 'claude-haiku-5-5', false));
    assert.ok(e && coutEngage(e) > 0 && !e.arret, corps.stop_reason);
  }
  for (const [statut, message, arret] of [
    [401, 'invalid x-api-key', true],
    [403, 'forbidden', true],
    [429, 'rate limit', true],
    [400, 'Your credit balance is too low to access the Anthropic API.', true],
    [529, 'Overloaded', false],
    [400, 'image too large', false],
  ] as const) {
    assert.equal(echoue(() => lireReponseClaude(statut, { error: { message } }, 'claude-haiku-5-5', false))?.arret, arret, `${statut} ${message}`);
  }
  assert.ok(Array.isArray(extraireJson('Voici :\n```json\n[{"i":1}]\n```')));
  assert.equal(coutFacture(0.123456), 0.1235);
});

test('appelerModele : effort low sans outils, échec facturé compté, pause, arrêt net et arrêt après 5 échecs de suite', async () => {
  assert.equal(ECHECS_DE_SUITE_MAX, 5);
  assert.equal(ECHECS_FACTURES_MAX, 2);
  const vrai = globalThis.fetch;
  const vraiTimeout = globalThis.setTimeout;
  const pauses: number[] = [];
  globalThis.setTimeout = ((f: () => void, ms?: number) => {
    pauses.push(ms ?? 0);
    f();
    return 0;
  }) as unknown as typeof setTimeout;
  const erreur = console.error;
  console.error = () => undefined;
  const corpsVus: Record<string, unknown>[] = [];
  let reponse: () => Response = () => new Response('{}');
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    corpsVus.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
    return reponse();
  }) as typeof fetch;
  try {
    const c: Compteur = { coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
    reponse = () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[{"i":1}]' }], usage }), { status: 200 });
    const r = await appelerModele('k', 'claude-haiku-5-5', 'consigne', ['QUJD'], c);
    assert.deepEqual(r, { json: [{ i: 1 }] });
    const envoye = corpsVus[0]!;
    assert.equal(envoye.model, 'claude-haiku-5-5');
    assert.deepEqual((envoye.output_config as { effort: string }).effort, 'low');
    assert.equal(envoye.tools, undefined);
    assert.equal(envoye.fallbacks, undefined);
    assert.ok(c.coutUsd > 0 && c.echecsDeSuite === 0);

    // Payé mais coupé : la dépense entre au compteur, le lot rend `json: null`, une pause de 7 s suit.
    const avant = c.coutUsd;
    reponse = () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '[' }], usage }), { status: 200 });
    assert.deepEqual(await appelerModele('k', 'claude-haiku-5-5', 'c', [], c), { json: null });
    assert.ok(c.coutUsd > avant);
    assert.ok(pauses.includes(7000));

    // Solde vide : arrêt net, sans pause.
    reponse = () => new Response(JSON.stringify({ error: { message: 'Your credit balance is too low' } }), { status: 400 });
    pauses.length = 0;
    assert.equal(await appelerModele('k', 'claude-haiku-5-5', 'c', [], { coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 }), 'arret');
    assert.equal(pauses.length, 0);

    // Modèle surchargé : échec, échec... puis arrêt au cinquième de suite.
    reponse = () => new Response(JSON.stringify({ error: { message: 'Overloaded' } }), { status: 529 });
    const s: Compteur = { coutUsd: 0, jetonsEntree: 0, jetonsSortie: 0 };
    const issues = [];
    for (let i = 0; i < 5; i++) issues.push(await appelerModele('k', 'claude-haiku-5-5', 'c', [], s));
    assert.deepEqual(issues, ['echec', 'echec', 'echec', 'echec', 'arret']);
  } finally {
    globalThis.fetch = vrai;
    globalThis.setTimeout = vraiTimeout;
    console.error = erreur;
  }
});

test('un délai dépassé se signale comme un coût incertain', async () => {
  const vrai = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new DOMException('timeout', 'TimeoutError');
  }) as typeof fetch;
  try {
    const e = await appelerClaude({ cle: 'k', modele: 'claude-haiku-5-5', texte: 't', maxTokens: 10, timeoutMs: 1000 }).catch((x: unknown) => x);
    assert.ok(e instanceof ErreurClaude && e.coutIncertain);
  } finally {
    globalThis.fetch = vrai;
  }
});

test('les références R2 : r2:<clé> vers le domaine public, un ancien chemin vers Supabase', () => {
  assert.equal(referenceR2('meta/1.webp'), 'r2:meta/1.webp');
  const bases = { r2: 'https://media.exemple.com/', supabase: 'https://x.supabase.co' };
  assert.equal(urlPubliqueDeReference('r2:produits/9.webp', 'pub-track', bases), 'https://media.exemple.com/produits/9.webp');
  assert.equal(urlPubliqueDeReference('meta/1.webp', 'pub-track', bases), 'https://x.supabase.co/storage/v1/object/public/pub-track/meta/1.webp');
  assert.equal(urlPubliqueDeReference('r2:a.webp', 'pub-track', { r2: null, supabase: bases.supabase }), null);
});

test('sans R2, miniature et découpe du produit lèvent une erreur au lieu de disparaître en silence', async () => {
  const ligne = { source: 'meta', id_source: '1', apercu_source: 'https://exemple.com/a.jpg' } as LignePub;
  await sansR2(async () => {
    await assert.rejects(recopierMiniature(ligne), /R2 non configur/);
    await assert.rejects(recadrerProduit('https://x.supabase.co', 'r2:meta/1.webp', [0, 0, 1000, 1000], '1'), /R2 non configur/);
  });
  for (const f of ['scripts/pub-track/ecriture.ts', 'scripts/pub-track/nommer-produits.ts', 'scripts/pub-track/collecter.ts', 'scripts/pub-track/collecter-source.ts']) {
    assert.doesNotMatch(sansCommentaires(lire(f)), /storage\.from\(|storage\/v1\/object/, `${f} : une image part encore dans Supabase`);
  }
});
