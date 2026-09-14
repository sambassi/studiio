/**
 * A_8f (correctif Gap-2) — UNE NOUVELLE VERSION N'HÉRITE JAMAIS D'UNE VALIDATION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE FICHIER FERME
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `user_avatars.version` existait depuis A_8b, et rien ne l'incrémentait :
 * remplacer sa vidéo insère une nouvelle ligne, et le réentraînement n'est
 * pas encore écrit. Le jour où il le sera, rien n'empêchait d'écrire
 * `version = 2` en laissant le `validated_at` de la version 1 — un clone que
 * personne n'a regardé, et qu'Autopilote aurait fait parler.
 *
 * La primitive `commencerNouvelleVersionAvatar` est désormais le SEUL chemin.
 * Elle écrit l'incrément et la remise à zéro dans la même mutation, sous
 * condition de version (échange comparé), et un test tient qu'aucun autre
 * fichier n'écrit cette colonne.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const VOIX = 'eeeeeeee-5555-4555-8555-555555555555';

let tables: Record<string, Ligne[]> = {};

function requete(table: string) {
  const eq: [string, unknown][] = [];
  const estNul: string[] = [];
  let majPatch: Ligne | null = null;
  const filtrees = () => {
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    for (const c of estNul) out = out.filter((l) => l[c] === null || l[c] === undefined);
    return out;
  };
  const executer = () => {
    if (majPatch) {
      const cibles = filtrees();
      for (const l of cibles) Object.assign(l, majPatch);
      return { data: cibles, error: null };
    }
    return { data: filtrees(), error: null };
  };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    is: (c: string, v: unknown) => { if (v === null) estNul.push(c); return api; },
    update: (l: Ligne) => { majPatch = l; return api; },
    single: async () => {
      const { data } = executer();
      return data.length ? { data: data[0], error: null } : { data: null, error: { message: 'aucune ligne' } };
    },
    maybeSingle: async () => ({ data: executer().data[0] ?? null, error: null }),
    then: (r: (v: unknown) => unknown) => r(executer()),
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

import { patchNouvelleVersion, commencerNouvelleVersionAvatar } from '@/lib/avatar/version';
import { resoudreJumeauPourGeneration, type ConfigJumeauNumerique } from '@/lib/avatar/jumeau';
import { generationPossible } from '@/lib/avatar/etats';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';

const V1_VALIDEE = () => ({
  id: AVATAR, user_id: UID, status: 'completed', provider_avatar_id: 'hg_v1',
  validated_at: '2026-09-10T12:00:00Z', version: 1, deleted_at: null, subject_type: 'self',
  training_error: 'ancien', source_object_key: `${UID}/avatar/source-1.mp4`,
});
const GENERATIONS_V1 = () => [
  { id: 'g1', user_id: UID, user_avatar_id: AVATAR, avatar_version: 1, intention: 'apercu', status: 'completed', video_url: 'https://x/v1-apercu.mp4' },
  { id: 'g2', user_id: UID, user_avatar_id: AVATAR, avatar_version: 1, intention: 'normale', status: 'completed', video_url: 'https://x/v1-video.mp4' },
];
const CONFIG: ConfigJumeauNumerique = { active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX };
const VOIX_OK = { id: VOIX, user_id: UID, provider_voice_id: 'el_voix', consent_at: '2026-09-01T00:00:00Z' };

beforeEach(() => {
  tables = { user_avatars: [V1_VALIDEE()], avatar_generations: GENERATIONS_V1() };
});

const avatar = () => tables.user_avatars[0];
const bump = (versionAttendue: number, complement?: Record<string, unknown>) =>
  commencerNouvelleVersionAvatar({ userId: UID, avatarId: AVATAR, versionAttendue, complement });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le correctif, sans base', () => {
  it('1.1 ⚠️ VERSION N+1, VALIDATION NULL, FOURNISSEUR NULL, ÉTAT SOURCE PRÊTE — dans le même objet', () => {
    expect(patchNouvelleVersion({ version: 1, validated_at: 'x', provider_avatar_id: 'hg' })).toEqual({
      version: 2, validated_at: null, provider_avatar_id: null, provider_asset_id: null,
      training_error: null, status: ETAT_SOURCE_PRETE,
    });
  });

  it('1.2 la remise à zéro est systématique, pas conditionnelle', () => {
    const p = patchNouvelleVersion({ version: 3, validated_at: null, provider_avatar_id: null });
    expect(p).toMatchObject({ version: 4, validated_at: null, provider_avatar_id: null });
  });

  it('1.3 une version illisible ne produit rien', () => {
    expect(patchNouvelleVersion({ version: 0 })).toBeNull();
    expect(patchNouvelleVersion({ version: '2' })).toBeNull();
    expect(patchNouvelleVersion({})).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La primitive, sur la base', () => {
  it('2.1 ⚠️ CE TEST ÉCHOUAIT AVANT LE CORRECTIF : v1 validée → v2 non validée, sans fournisseur, source prête', async () => {
    const issue = await bump(1);
    expect(issue.ok).toBe(true);
    expect(avatar()).toMatchObject({
      version: 2, validated_at: null, provider_avatar_id: null, status: ETAT_SOURCE_PRETE,
      training_error: null,
    });
  });

  it('2.2 ⚠️ IMPOSSIBLE D’OBTENIR N+1 AVEC LE validated_at DE N — même en le demandant', async () => {
    const issue = await bump(1, { validated_at: '2026-09-10T12:00:00Z', provider_avatar_id: 'hg_v1', status: 'completed' });
    expect(issue.ok).toBe(true);
    expect(avatar().validated_at).toBeNull();
    expect(avatar().provider_avatar_id).toBeNull();
    expect(avatar().status).toBe(ETAT_SOURCE_PRETE);
    expect(avatar().version).toBe(2);
  });

  it('2.3 le complément légitime passe (nouvelle source)', async () => {
    await bump(1, { source_object_key: `${UID}/avatar/source-2.mp4` });
    expect(avatar().source_object_key).toBe(`${UID}/avatar/source-2.mp4`);
  });

  it('2.4 ⚠️ ÉCHANGE COMPARÉ : une version déjà changée n’est pas écrasée', async () => {
    await bump(1);
    const issue = await bump(1);          // l'appelant croit encore à la v1
    expect(issue).toEqual({ ok: false, motif: 'version_concurrente' });
    expect(avatar().version).toBe(2);     // pas 3
  });

  it('2.5 deux demandes simultanées ne font qu’un seul bond', async () => {
    const [x, y] = await Promise.all([bump(1), bump(1)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(avatar().version).toBe(2);
  });

  it('2.6 le clone d’autrui est introuvable, rien n’est écrit', async () => {
    const issue = await commencerNouvelleVersionAvatar({ userId: AUTRUI, avatarId: AVATAR, versionAttendue: 1 });
    expect(issue).toEqual({ ok: false, motif: 'introuvable' });
    expect(avatar()).toMatchObject({ version: 1, validated_at: '2026-09-10T12:00:00Z' });
  });

  it('2.7 un clone supprimé ne change plus de version', async () => {
    avatar().deleted_at = '2026-09-11T00:00:00Z';
    expect((await bump(1)).ok).toBe(false);
    expect(avatar().version).toBe(1);
  });

  it('2.8 ⚠️ DOUBLE VERSION : v1 validée → v2 → v2 validée (fixture) → v3 non validée', async () => {
    await bump(1);
    Object.assign(avatar(), { provider_avatar_id: 'hg_v2', status: 'completed', validated_at: '2026-09-12T00:00:00Z' });
    await bump(2);
    expect(avatar()).toMatchObject({ version: 3, validated_at: null, provider_avatar_id: null });
  });

  it('2.9 ⚠️ L’HISTORIQUE DES GÉNÉRATIONS EST INTACT', async () => {
    await bump(1);
    expect(tables.avatar_generations).toEqual(GENERATIONS_V1());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Ce que la nouvelle version ferme, et ce qu’elle rouvre', () => {
  it('3.1 avant : Autopilote autorisé sur la version 1', () => {
    const issue = resoudreJumeauPourGeneration({ config: CONFIG, userId: UID, avatar: avatar(), voix: VOIX_OK });
    expect(issue).toEqual({ etat: 'pret', identite: { avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX } });
  });

  it('3.2 ⚠️ APRÈS LE BOND : AUTOPILOTE BLOQUÉ, AVEC UN MOTIF — pas de repli sur v1', async () => {
    await bump(1);
    const issue = resoudreJumeauPourGeneration({ config: CONFIG, userId: UID, avatar: avatar(), voix: VOIX_OK });
    /* Le premier fait manquant est le fournisseur (identifiant remis à
       NULL) ; la validation est vérifiée juste derrière. Dans les deux cas :
       bloqué, nommé, jamais « ignoré en silence ». */
    expect(issue).toEqual({ etat: 'bloque', motif: 'avatar_non_entraine' });
  });

  it('3.3 v2 entraînée (fixture) mais non validée : toujours bloqué, motif validation', async () => {
    await bump(1);
    Object.assign(avatar(), { provider_avatar_id: 'hg_v2', status: 'completed' });
    const issue = resoudreJumeauPourGeneration({ config: CONFIG, userId: UID, avatar: avatar(), voix: VOIX_OK });
    expect(issue).toEqual({ etat: 'bloque', motif: 'clone_non_valide' });
  });

  it('3.4 v2 entraînée : l’aperçu v2 est autorisable, la génération normale non', async () => {
    await bump(1);
    Object.assign(avatar(), { provider_avatar_id: 'hg_v2', status: 'completed' });
    expect(generationPossible({ avatar: avatar(), intention: 'apercu', apercuOccupe: false })).toEqual({ ok: true, version: 2 });
    expect(generationPossible({ avatar: avatar(), intention: 'normale', apercuOccupe: false })).toEqual({ ok: false, motif: 'clone_non_valide' });
  });

  it('3.5 v2 validée (fixture) : Autopilote autorisé, et l’identité porte la version 2', async () => {
    await bump(1);
    Object.assign(avatar(), { provider_avatar_id: 'hg_v2', status: 'completed', validated_at: '2026-09-12T00:00:00Z' });
    const issue = resoudreJumeauPourGeneration({ config: CONFIG, userId: UID, avatar: avatar(), voix: VOIX_OK });
    expect(issue).toEqual({ etat: 'pret', identite: { avatarId: AVATAR, avatarVersion: 2, userVoiceId: VOIX } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Un seul chemin d’écriture de la version', () => {
  const sansProse = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  function fichiers(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) { if (!p.includes('__tests__')) fichiers(p, out); }
      else if (/\.tsx?$/.test(f)) out.push(p);
    }
    return out;
  }

  it('4.1 ⚠️ AUCUN AUTRE FICHIER N’ÉCRIT `version` SUR user_avatars', () => {
    const racine = path.join(process.cwd(), 'src');
    const fautifs = fichiers(racine).filter((p) => {
      const src = sansProse(readFileSync(p, 'utf8'));
      if (!src.includes("from('user_avatars')")) return false;
      if (p.endsWith(path.join('lib', 'avatar', 'version.ts'))) return false;
      /* Les écritures LITTÉRALES sur la table : `.from('user_avatars') … .update({ … })`
         ou `.insert({ … })`. Une clé `version` dedans, ou un `version + 1`
         n'importe où dans un fichier qui touche la table, est fautif. */
      const ecritures = src.matchAll(/from\('user_avatars'\)[\s\S]{0,600}?\.(?:update|insert)\(\{([\s\S]*?)\}\)/g);
      for (const m of ecritures) if (/\bversion\s*:/.test(m[1])) return true;
      return /\bversion\s*\+\s*1/.test(src);
    });
    expect(fautifs.map((p) => path.relative(process.cwd(), p))).toEqual([]);
  });

  it('4.2 la primitive écrit l’incrément et la remise à zéro dans le MÊME update', () => {
    const src = sansProse(readFileSync(path.join(process.cwd(), 'src/lib/avatar/version.ts'), 'utf8'));
    expect(src.match(/\.update\(/g)).toHaveLength(1);
    expect(src).toContain(".eq('version', versionAttendue)");
  });

  it('4.3 ⚠️ SEULE LA MIGRATION A_8f TOUCHE À `intention` — liste fermée', () => {
    const dossier = path.join(process.cwd(), 'migrations');
    const parlantes = readdirSync(dossier).filter((f) => f.endsWith('.sql')).filter((f) => {
      const sql = readFileSync(path.join(dossier, f), 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/--.*$/gm, '');
      return /\bintention\b/.test(sql) || sql.includes('avatar_generations_apercu_unique');
    });
    expect(parlantes).toEqual(['2026-09-14-avatar-generations-intention-apercu.sql']);
  });

  it('4.4 cette migration est additive et rejouable', () => {
    const sql = readFileSync(path.join(process.cwd(), 'migrations/2026-09-14-avatar-generations-intention-apercu.sql'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();
    expect(sql).not.toMatch(/drop (table|column)|delete from|truncate|^\s*update /m);
    expect(sql).toContain('add column if not exists intention text not null default \'normale\'');
    expect(sql).toContain('create unique index if not exists avatar_generations_apercu_unique');
    expect(sql).toMatch(/where intention = 'apercu' and status <> 'failed'/);
    expect(sql).toContain("check (intention <> 'apercu' or avatar_version is not null)");
  });
});
