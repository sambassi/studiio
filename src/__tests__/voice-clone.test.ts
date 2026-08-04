import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  validateCloneRequest,
  ACCEPTED_AUDIO_TYPES,
  MAX_SAMPLE_BYTES,
  MAX_SAMPLES,
  VOICE_CONSENT_TEXT,
} from '@/lib/voice/store';

/**
 * Clonage vocal — rattachement d'une voix à son propriétaire.
 *
 * Le fait qui commande toute la conception : `ELEVENLABS_API_KEY` désigne **un
 * seul compte** ElevenLabs, partagé par tous les utilisateurs de Studiio. La
 * voix clonée de chacun atterrit donc au même endroit, et `GET /v2/voices` les
 * renvoie toutes, sans aucune notion de propriétaire.
 *
 * `user_voices` est la seule chose qui dise à qui appartient quoi. D'où deux
 * exigences que ces tests verrouillent :
 *
 * 1. **Sonder la table AVANT d'appeler ElevenLabs.** Cloner puis découvrir
 *    qu'on ne peut pas ranger le `voice_id` laisserait dans le compte partagé
 *    une voix orpheline — irrattachable, insupprimable, et comptée dans le
 *    quota du plan.
 * 2. **Ne jamais lister une voix clonée qui n'est pas la sienne.**
 */

const clone = readFileSync(resolve(__dirname, '../app/api/voice/clone/route.ts'), 'utf-8');
const tts = readFileSync(resolve(__dirname, '../app/api/tts/elevenlabs/route.ts'), 'utf-8');
const store = readFileSync(resolve(__dirname, '../lib/voice/store.ts'), 'utf-8');
const migration = readFileSync(
  resolve(__dirname, '../../migrations/2026-08-04-user-voices.sql'),
  'utf-8',
);

const bon = { type: 'audio/webm', size: 500_000 };
const requete = (extra: Record<string, unknown> = {}) =>
  validateCloneRequest({ name: 'Ma voix', consent: true, samples: [bon], ...extra });

describe('validateCloneRequest — le refus dit POURQUOI', () => {
  it('une requête complète passe', () => {
    expect(requete()).toEqual({ ok: true });
  });

  it('le nom est obligatoire, et pas seulement des espaces', () => {
    expect(requete({ name: '' })).toMatchObject({ ok: false, status: 400 });
    expect(requete({ name: '   ' })).toMatchObject({ ok: false, status: 400 });
    expect(requete({ name: 42 })).toMatchObject({ ok: false, status: 400 });
  });

  it('le nom est borné', () => {
    expect(requete({ name: 'a'.repeat(61) })).toMatchObject({ ok: false, status: 400 });
    expect(requete({ name: 'a'.repeat(60) })).toEqual({ ok: true });
  });

  it('SANS consentement, rien ne part', () => {
    // Ce n'est pas une case décorative : on crée une empreinte biométrique.
    for (const consent of [false, undefined, null, 'oui', 1, '']) {
      expect(requete({ consent }), String(consent)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('le consentement passe aussi en chaîne — c est du multipart', () => {
    // `FormData` ne transporte que du texte : `true` y devient `'true'`.
    expect(requete({ consent: 'true' })).toEqual({ ok: true });
  });

  it('il faut au moins un enregistrement', () => {
    expect(requete({ samples: [] })).toMatchObject({ ok: false, status: 400 });
  });

  it('le nombre d enregistrements est plafonné', () => {
    const trop = Array.from({ length: MAX_SAMPLES + 1 }, () => bon);
    expect(requete({ samples: trop })).toMatchObject({ ok: false, status: 400 });
    expect(requete({ samples: trop.slice(0, MAX_SAMPLES) })).toEqual({ ok: true });
  });

  it('un enregistrement vide est refusé — il ne clonerait rien', () => {
    expect(requete({ samples: [{ type: 'audio/webm', size: 0 }] })).toMatchObject({ ok: false });
  });

  it('un enregistrement trop lourd répond 413, pas 400', () => {
    const verdict = requete({ samples: [{ type: 'audio/webm', size: MAX_SAMPLE_BYTES + 1 }] });
    expect(verdict).toMatchObject({ ok: false, status: 413 });
  });

  it('accepte ce que MediaRecorder produit — Chrome ET Safari', () => {
    // Chrome enregistre en `audio/webm;codecs=opus`, Safari en `audio/mp4`.
    // Refuser l'un des deux rendrait l'enregistrement in-app inutilisable sur
    // la moitié des navigateurs.
    expect(requete({ samples: [{ type: 'audio/webm;codecs=opus', size: 1000 }] })).toEqual({ ok: true });
    expect(requete({ samples: [{ type: 'audio/mp4', size: 1000 }] })).toEqual({ ok: true });
  });

  it('le type est comparé sans ses paramètres de codec, et sans la casse', () => {
    expect(requete({ samples: [{ type: 'AUDIO/WEBM; codecs=opus', size: 1000 }] })).toEqual({ ok: true });
  });

  it('refuse ce qui n est pas de l audio', () => {
    for (const type of ['video/mp4', 'image/png', 'application/pdf', '']) {
      expect(requete({ samples: [{ type, size: 1000 }] }), type).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('le message nomme le format refusé', () => {
    const verdict = requete({ samples: [{ type: 'image/png', size: 1000 }] });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain('image/png');
  });

  it('la liste des formats couvre les usages courants', () => {
    for (const t of ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']) {
      expect(ACCEPTED_AUDIO_TYPES, t).toContain(t);
    }
  });
});

describe('L ordre des opérations protège le compte partagé', () => {
  it('la table est sondée AVANT l appel payé à ElevenLabs', () => {
    // Sinon : voix créée, rattachement impossible, voix orpheline dans le
    // compte partagé — irrattachable et comptée dans le quota.
    const post = clone.slice(clone.indexOf('export async function POST'));
    expect(post.indexOf('await voiceStoreReady()')).toBeLessThan(post.indexOf('/v1/voices/add'));
  });

  it('la validation aussi passe avant l appel', () => {
    const post = clone.slice(clone.indexOf('export async function POST'));
    expect(post.indexOf('validateCloneRequest(')).toBeLessThan(post.indexOf('/v1/voices/add'));
  });

  it('sans migration, le clonage REFUSE — il ne clone pas à moitié', () => {
    expect(clone).toContain('la migration user_voices n’a pas été appliquée');
    expect(clone).toContain('{ status: 503 }');
  });

  it('si le rattachement échoue quand même, la voix distante est supprimée', () => {
    // Rattrapage : une voix sans propriétaire est un déchet permanent.
    expect(clone).toContain('await deleteRemoteVoice(voiceId, key);');
    const bloc = clone.slice(clone.indexOf('const saved = await saveUserVoice'));
    expect(bloc.indexOf('deleteRemoteVoice')).toBeLessThan(bloc.indexOf('elle a été supprimée'));
  });
});

describe('L appel de clonage est conforme à la doc', () => {
  it('POST /v1/voices/add', () => {
    expect(clone).toContain('`${ELEVENLABS_BASE}/v1/voices/add`');
  });

  it('le champ s appelle `files` — au pluriel, SANS crochets', () => {
    // `files[]` produit un 422 « field required ».
    expect(clone).toContain("upstreamForm.append('files', sample");
    expect(clone).not.toContain("'files[]'");
  });

  it('le nom part avec les fichiers', () => {
    expect(clone).toContain("upstreamForm.append('name', name);");
  });

  it('aucun Content-Type écrit à la main sur le multipart', () => {
    // `fetch` doit poser lui-même la frontière multipart ; un en-tête en dur
    // l'écrase et le corps devient illisible côté serveur.
    const appel = clone
      .slice(clone.indexOf('upstream = await fetch('), clone.indexOf('const rawBody'))
      .replace(/\/\/.*$/gm, '');
    expect(appel).toContain("headers: { 'xi-api-key': key },");
    expect(appel).not.toContain('Content-Type');
  });

  it('authentification par xi-api-key', () => {
    const code = clone.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain("'xi-api-key': key");
    expect(code).not.toContain('Bearer');
  });

  it('le message réel du fournisseur est relayé', () => {
    // La doc ne publie pas de liste fermée de formats : un « 422 » sec
    // obligerait à deviner ce que l'enregistrement a de fautif.
    expect(clone).toContain('detail: rawBody.slice(0, 300)');
  });

  it('une réponse sans voice_id est une erreur, pas un succès silencieux', () => {
    expect(clone).toContain('ElevenLabs n’a renvoyé aucun identifiant de voix.');
  });

  it('`requires_verification` est remonté au client', () => {
    expect(clone).toContain('requiresVerification: parsed?.requires_verification === true');
  });
});

describe('Personne ne voit ni ne supprime la voix d un autre', () => {
  it('la liste est filtrée sur l utilisateur de la session', () => {
    expect(store).toContain(".eq('user_id', userId)");
    expect(clone).toContain('await listUserVoices(session.user.id)');
  });

  it('la suppression vérifie la propriété AVANT d agir', () => {
    const del = clone.slice(clone.indexOf('export async function DELETE'));
    expect(del.indexOf('const mine = await listUserVoices(session.user.id);'))
      .toBeLessThan(del.indexOf('deleteRemoteVoice'));
    expect(del).toContain("return NextResponse.json({ success: false, error: 'Voix introuvable.' }, { status: 404 });");
  });

  it('le catalogue distant reste filtré des catégories clonées', () => {
    // Elles contiendraient les voix de tous les autres comptes.
    expect(tts).toContain("SHARED_CATEGORIES.has(String(raw?.category ?? ''))");
  });

  it('les voix clonées ne passent JAMAIS par le cache global', () => {
    // Le cache est partagé entre requêtes, donc entre utilisateurs.
    const bloc = tts.slice(tts.indexOf('export async function GET'), tts.indexOf('export async function POST'));
    expect(bloc).toContain('listUserVoices(session.user.id)');
    expect(bloc).not.toContain('voicesCache');
  });

  it('les voix clonées sont listées EN PREMIER', () => {
    expect(tts).toContain('voices: [...clonees, ...catalogue]');
  });

  it('le nombre de voix par utilisateur est plafonné', () => {
    // Le quota de voix du plan est global au compte : un seul utilisateur
    // pourrait le consommer entièrement.
    expect(clone).toContain('const MAX_VOICES_PER_USER = 3;');
    expect(clone).toContain('existing.length >= MAX_VOICES_PER_USER');
    expect(clone).toContain('{ status: 409 }');
  });
});

describe('Le consentement est conservé, daté', () => {
  it('un texte explicite, et non une case anonyme', () => {
    expect(VOICE_CONSENT_TEXT).toContain('la voix enregistree est la mienne');
  });

  it('il est écrit avec la voix', () => {
    expect(store).toContain('consent_at: new Date().toISOString()');
    expect(store).toContain('consent_text: VOICE_CONSENT_TEXT');
  });

  it('la table les rend obligatoires', () => {
    expect(migration).toContain('consent_at timestamptz not null');
    expect(migration).toContain('consent_text text not null');
  });
});

describe('La migration suit les règles de cette infrastructure', () => {
  it('elle ne touche à aucune table existante', () => {
    expect(migration).toContain('create table if not exists user_voices');
    expect(migration).not.toMatch(/alter table (?!.*user_voices)/i);
    expect(migration).not.toContain('drop table');
  });

  it('elle donne les droits à PostgREST', () => {
    // Sans ce grant, la table n'entre jamais dans le cache de schéma et
    // l'API répond « table not in schema cache ».
    expect(migration).toContain('grant all on table public.user_voices to public;');
  });

  it('elle rappelle le rechargement du cache de schéma', () => {
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });

  it('un voice_id ne peut pas être revendiqué deux fois', () => {
    expect(migration).toContain('create unique index if not exists user_voices_provider_voice_id_key');
  });

  it('la suppression d un compte emporte ses voix', () => {
    expect(migration).toContain('references users(id) on delete cascade');
  });
});

describe('Default-safe', () => {
  it('sans clé, le clonage le dit en 503 — il ne plante pas', () => {
    expect(clone).toContain('Le clonage vocal n’est pas configuré sur ce serveur.');
  });

  it('sans table, la liste rend un tableau vide plutôt qu une erreur', () => {
    expect(store).toContain('if (!userId || !(await voiceStoreReady())) return [];');
  });

  it('une panne de base ne vide pas le sélecteur du catalogue', () => {
    const bloc = store.slice(store.indexOf('export async function listUserVoices'));
    expect(bloc).toContain('return [];');
    expect(bloc).toContain('} catch (err) {');
  });

  it('la sonde est mémoïsée — pas une requête par appel', () => {
    expect(store).toContain('if (storeProbe?.ready) return true;');
    expect(store).toContain('const STORE_PROBE_TTL_MS = 60_000;');
  });
});
