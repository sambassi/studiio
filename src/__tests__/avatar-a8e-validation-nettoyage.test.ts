/**
 * A_8e — VALIDER SON CLONE, ET NE PAS LAISSER DE SOURCE ORPHELINE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTEGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux gestes qui n'ont l'air de rien et qui, mal faits, coutent tres cher.
 *
 * 1. VALIDER. « J'accepte que ceci parle a ma place » est la seule porte qui
 *    ouvrira l'usage du clone. Elle ne doit s'ouvrir que sur un clone
 *    REELLEMENT entraine et REELLEMENT regarde : une inscription
 *    `source_ready` n'a ni modele ni apercu, et la laisser passer reviendrait
 *    a faire signer quelqu'un pour ce qu'il n'a jamais vu.
 *
 * 2. REMPLACER SA VIDEO. L'ancienne source doit disparaitre — mais SEULEMENT
 *    apres que la nouvelle inscription a reussi, SEULEMENT si elle appartient
 *    au compte, et JAMAIS quand il s'agit du media d'origine de la
 *    mediatheque, que l'inscription ne fait que copier.
 *
 * ⚠️ AUCUNE ASSERTION N'EST UNE EXPRESSION REGULIERE SUR LE SOURCE. Chaque
 * test monte la route, l'appelle, et lit la reponse, la base et le stockage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ───────────────────────────────────────────────────────────────────────────
// La base et le stockage, en memoire
// ───────────────────────────────────────────────────────────────────────────

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';

let tables: Record<string, Ligne[]> = {};
/** Les objets presents dans le stockage, et ceux qu'on a retires. */
let objets: Set<string>;
let retires: string[];
let echecInsert = false;
let echecUpload = false;

function requete(table: string) {
  const eq: [string, unknown][] = [];
  const estNul: string[] = [];
  let tri: { c: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let majPatch: Ligne | null = null;
  let suppression = false;
  let insertion: Ligne | null = null;

  const filtrees = (): Ligne[] => {
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    for (const c of estNul) out = out.filter((l) => l[c] === null || l[c] === undefined);
    if (tri) {
      const { c, asc } = tri;
      out.sort((a, b) => {
        const x = String(a[c] ?? ''); const y = String(b[c] ?? '');
        return asc ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  /** Applique l'ecriture en attente et rend les lignes concernees. */
  const executer = (): { data: Ligne[]; error: unknown } => {
    if (insertion) {
      if (echecInsert) return { data: [], error: { message: 'insert refuse' } };
      const ligne = { id: AVATAR, ...insertion };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: [ligne], error: null };
    }
    if (suppression) {
      const cibles = filtrees();
      tables[table] = (tables[table] ?? []).filter((l) => !cibles.includes(l));
      return { data: cibles, error: null };
    }
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
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (l: Ligne) => { insertion = l; return api; },
    update: (l: Ligne) => { majPatch = l; return api; },
    delete: () => { suppression = true; return api; },
    single: async () => {
      const { data, error } = executer();
      if (error) return { data: null, error };
      return data.length
        ? { data: data[0], error: null }
        : { data: null, error: { message: 'aucune ligne' } };
    },
    maybeSingle: async () => {
      const { data, error } = executer();
      return { data: error ? null : (data[0] ?? null), error: error ?? null };
    },
    then: (resoudre: (v: unknown) => unknown) => resoudre(executer()),
  };
  return api;
}

function stockage() {
  return {
    from: () => ({
      upload: async (cle: string) => {
        if (echecUpload) return { data: null, error: { message: 'stockage plein' } };
        objets.add(cle);
        return { data: { path: cle }, error: null };
      },
      download: async (cle: string) => (objets.has(cle)
        ? { data: new Blob([new Uint8Array([0, 1, 2, 3])]), error: null }
        : { data: null, error: { message: 'absent' } }),
      remove: async (cles: string[]) => {
        for (const c of cles) { retires.push(c); objets.delete(c); }
        return { data: null, error: null };
      },
    }),
  };
}

let utilisateurConnecte: string | null = UID;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t), storage: { from: () => stockage().from() } },
  supabase: { from: (t: string) => requete(t), storage: { from: () => stockage().from() } },
}));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (utilisateurConnecte ? { user: { id: utilisateurConnecte } } : null),
}));
vi.mock('@/lib/ffmpeg/binaires', () => ({ cheminFfprobe: () => '/faux/ffprobe' }));

/** Une sonde acceptable : 3 minutes, 1080×1920, 30 i/s, avec son. */
const SONDE_BONNE = JSON.stringify({
  format: { duration: '180.0', size: '52428800' },
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1', r_frame_rate: '30/1' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
});
/** Une sonde refusee : huit secondes, donc trop courte pour un clone. */
const SONDE_COURTE = JSON.stringify({
  format: { duration: '8.0', size: '2000000' },
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1', r_frame_rate: '30/1' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
});
let sortieSonde = SONDE_BONNE;

vi.mock('node:child_process', async (original) => {
  const reel = await original<typeof import('node:child_process')>();
  const faux = (
    _f: string, _a: string[], _o: unknown,
    cb: (e: unknown, r: { stdout: string; stderr: string }) => void,
  ) => cb(null, { stdout: sortieSonde, stderr: '' });
  return { ...reel, default: { ...reel, execFile: faux }, execFile: faux };
});

import { POST as VALIDER } from '@/app/api/avatar/[id]/validation/route';
import { POST as INSCRIRE } from '@/app/api/avatar/enrollment/route';
import { retirerSourceAvatar, cleSourceAvatar } from '@/lib/avatar/source';
import { validationPossible } from '@/lib/avatar/etats';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';

const ANCIENNE = `${UID}/avatar/source-1700000000.mp4`;
const MEDIATHEQUE = `${UID}/library/cours-du-samedi.mp4`;

/** `avatar: null` = aucune inscription existante. */
function socle(avatar: Partial<Ligne> | null = {}, generations: Ligne[] = []) {
  tables = {
    user_avatars: avatar === null ? [] : [{
      id: AVATAR, user_id: UID, provider: 'heygen', avatar_type: 'video',
      provider_avatar_id: null, status: ETAT_SOURCE_PRETE,
      source_object_key: ANCIENNE, validated_at: null,
      created_at: '2026-09-09T10:00:00Z',
      ...avatar,
    }],
    avatar_generations: generations,
  };
  objets = new Set([ANCIENNE, MEDIATHEQUE]);
  retires = [];
}

beforeEach(() => {
  utilisateurConnecte = UID;
  echecInsert = false;
  echecUpload = false;
  sortieSonde = SONDE_BONNE;
  socle();
});

const valider = async (id = AVATAR) => VALIDER({} as never, { params: { id } });

/** Une inscription par fichier, comme le navigateur l'envoie. */
async function inscrireFichier(taille = 4096) {
  const fd = new FormData();
  fd.append('consentement', 'true');
  fd.append('fichier', new File([new Uint8Array(taille)], 'moi.mp4', { type: 'video/mp4' }));
  return INSCRIRE({ formData: async () => fd } as never);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Ce que « valider » exige, avant toute route', () => {
  it('1.1 ⚠️ UNE SOURCE PRÊTE N’EST PAS UN CLONE', () => {
    /* C'est le coeur du lot. `source_ready` veut dire « la video de reference
       est acceptee » — pas « un modele existe ». Confondre les deux, c'est
       proposer de valider ce qui n'a jamais ete produit. */
    const v = validationPossible({
      status: ETAT_SOURCE_PRETE, provider_avatar_id: null, validated_at: null,
    });
    expect(v).toEqual({ ok: false, motif: 'aucun_clone' });
  });

  it('1.2 un entraînement en cours n’est pas validable', () => {
    expect(validationPossible({
      status: 'processing', provider_avatar_id: 'hg_1', apercuUrl: 'https://x/a.mp4',
    })).toEqual({ ok: false, motif: 'entrainement_en_cours' });
  });

  it('1.3 ⚠️ SANS APERÇU RÉEL, RIEN N’EST VALIDABLE', () => {
    // Accepter sans avoir vu, c'est signer pour ce qu'on n'a pas regarde.
    expect(validationPossible({
      status: 'completed', provider_avatar_id: 'hg_1', apercuUrl: null,
    })).toEqual({ ok: false, motif: 'apercu_absent' });
  });

  it('1.4 les trois réunies ouvrent la porte, et elles seules', () => {
    expect(validationPossible({
      status: 'completed', provider_avatar_id: 'hg_1',
      validated_at: null, apercuUrl: 'https://x/a.mp4',
    })).toEqual({ ok: true });
  });

  it('1.5 une acceptation déjà donnée n’est pas redemandée', () => {
    expect(validationPossible({
      status: 'completed', provider_avatar_id: 'hg_1',
      validated_at: '2026-09-09T12:00:00Z', apercuUrl: 'https://x/a.mp4',
    })).toEqual({ ok: false, motif: 'deja_valide' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La route de validation', () => {
  it('2.1 sans session, 401 et rien n’est écrit', async () => {
    utilisateurConnecte = null;
    const res = await valider();
    expect(res.status).toBe(401);
    expect(tables.user_avatars[0].validated_at).toBeNull();
  });

  it('2.2 ⚠️ UNE SOURCE PRÊTE EST REFUSÉE, AVEC SON MOTIF', async () => {
    const res = await valider();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.motif).toBe('aucun_clone');
    expect(json.error).toContain('pas encore été créé');
    expect(tables.user_avatars[0].validated_at).toBeNull();
  });

  it('2.3 ⚠️ LE CLONE D’AUTRUI N’EXISTE PAS — 404, PAS 403', async () => {
    /* Un 403 confirmerait l'existence de l'avatar d'un tiers. Le 404 dit la
       meme chose que pour un identifiant inconnu : rien a voir ici. */
    socle({
      status: 'completed', provider_avatar_id: 'hg_1', user_id: AUTRUI,
    }, [{
      user_id: AUTRUI, user_avatar_id: AVATAR, status: 'completed',
      video_url: 'https://x/a.mp4', created_at: '2026-09-09T11:00:00Z',
    }]);
    const res = await valider();
    expect(res.status).toBe(404);
    expect(tables.user_avatars[0].validated_at).toBeNull();
  });

  it('2.4 ⚠️ UN CLONE ENTRAÎNÉ AVEC APERÇU EST VALIDÉ, ET LA DATE EST ÉCRITE', async () => {
    socle({ status: 'completed', provider_avatar_id: 'hg_1' }, [{
      user_id: UID, user_avatar_id: AVATAR, status: 'completed',
      video_url: 'https://x/apercu.mp4', created_at: '2026-09-09T11:00:00Z',
    }]);
    const res = await valider();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(typeof tables.user_avatars[0].validated_at).toBe('string');
  });

  it('2.5 ⚠️ UN SECOND CLIC NE RÉÉCRIT PAS LA DATE', async () => {
    /* Ce qui a ete accepte l'a ete a un instant donne : deux clics rapides ne
       doivent pas deplacer cette date. */
    socle({ status: 'completed', provider_avatar_id: 'hg_1' }, [{
      user_id: UID, user_avatar_id: AVATAR, status: 'completed',
      video_url: 'https://x/apercu.mp4', created_at: '2026-09-09T11:00:00Z',
    }]);
    await valider();
    const premiere = tables.user_avatars[0].validated_at;
    const res = await valider();
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('deja_valide');
    expect(tables.user_avatars[0].validated_at).toBe(premiere);
  });

  it('2.6 une génération inachevée ne compte pas comme aperçu', async () => {
    socle({ status: 'completed', provider_avatar_id: 'hg_1' }, [{
      user_id: UID, user_avatar_id: AVATAR, status: 'processing',
      video_url: null, created_at: '2026-09-09T11:00:00Z',
    }]);
    const res = await valider();
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('apercu_absent');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Ce qu’une suppression de source refuse', () => {
  it('3.1 ⚠️ UNE CLÉ DE MÉDIATHÈQUE N’EST JAMAIS SUPPRIMÉE', async () => {
    /* Le pire scenario du lot : remplacer sa video d'enrollment et perdre au
       passage le media d'origine, que l'inscription ne fait que COPIER. */
    expect(await retirerSourceAvatar(UID, MEDIATHEQUE)).toBe(false);
    expect(retires).toEqual([]);
    expect(objets.has(MEDIATHEQUE)).toBe(true);
  });

  it('3.2 ⚠️ LA CLÉ D’UN AUTRE COMPTE EST REFUSÉE', async () => {
    const cle = `${AUTRUI}/avatar/source-1.mp4`;
    objets.add(cle);
    expect(await retirerSourceAvatar(UID, cle)).toBe(false);
    expect(retires).toEqual([]);
  });

  it('3.3 ⚠️ LA SOURCE QU’ON VIENT D’ÉCRIRE EST PRÉSERVÉE', async () => {
    // Meme horodatage a la milliseconde : sans cette garde, on effacerait la
    // video qui vient pourtant d'etre acceptee.
    const cle = cleSourceAvatar(UID, 'mp4', 1_700_000_001);
    objets.add(cle);
    expect(await retirerSourceAvatar(UID, cle, cle)).toBe(false);
    expect(objets.has(cle)).toBe(true);
  });

  it('3.4 une clé absente ou malformée ne fait rien', async () => {
    for (const cle of [null, '', `${UID}/avatar/`, `${UID}/../avatar/a.mp4`]) {
      expect(await retirerSourceAvatar(UID, cle)).toBe(false);
    }
    expect(retires).toEqual([]);
  });

  it('3.5 une vraie source du compte est bien retirée', async () => {
    expect(await retirerSourceAvatar(UID, ANCIENNE)).toBe(true);
    expect(retires).toEqual([ANCIENNE]);
    expect(objets.has(ANCIENNE)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Remplacer sa vidéo, de bout en bout', () => {
  it('4.1 ⚠️ L’ANCIENNE SOURCE DISPARAÎT UNE FOIS LA NOUVELLE INSCRITE', async () => {
    const res = await inscrireFichier();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const nouvelle = json.avatar.source_object_key as string;
    expect(nouvelle).not.toBe(ANCIENNE);
    expect(objets.has(nouvelle)).toBe(true);
    expect(retires).toEqual([ANCIENNE]);
    expect(objets.has(ANCIENNE)).toBe(false);
  });

  it('4.2 ⚠️ SI L’INSCRIPTION ÉCHOUE, L’ANCIENNE SOURCE RESTE', async () => {
    /* Supprimer d'abord aurait laisse le compte sans aucune video de
       reference : l'ancienne est la seule encore designee. */
    echecInsert = true;
    const res = await inscrireFichier();
    expect(res.status).toBe(500);
    expect(retires).toEqual([]);
    expect(objets.has(ANCIENNE)).toBe(true);
  });

  it('4.3 ⚠️ UNE VIDÉO REFUSÉE NE TOUCHE À RIEN', async () => {
    // Huit secondes : le seuil de qualite la rejette avant toute ecriture.
    sortieSonde = SONDE_COURTE;
    const res = await inscrireFichier();
    expect(res.status).toBe(422);
    expect(retires).toEqual([]);
    expect(objets.has(ANCIENNE)).toBe(true);
    expect(tables.user_avatars[0].source_object_key).toBe(ANCIENNE);
  });

  it('4.4 ⚠️ LE MÉDIA D’ORIGINE DE LA MÉDIATHÈQUE SURVIT À L’INSCRIPTION', async () => {
    const fd = new FormData();
    fd.append('consentement', 'true');
    fd.append('cheminMediatheque', MEDIATHEQUE);
    const res = await INSCRIRE({ formData: async () => fd } as never);
    expect(res.status).toBe(200);

    // La copie est rangee dans le namespace prive…
    const cle = (await res.json()).avatar.source_object_key as string;
    expect(cle.startsWith(`${UID}/avatar/`)).toBe(true);
    // …et l'original n'a pas bouge.
    expect(objets.has(MEDIATHEQUE)).toBe(true);
    expect(retires).not.toContain(MEDIATHEQUE);
  });

  it('4.5 un premier enrollment ne retire rien', async () => {
    socle(null);
    const res = await inscrireFichier();
    expect(res.status).toBe(200);
    expect(retires).toEqual([]);
  });

  it('4.6 ⚠️ L’INSCRIPTION SORT TOUJOURS SANS IDENTIFIANT FOURNISSEUR', async () => {
    /* Le nettoyage ne doit pas avoir servi de pretexte a « finir » l'avatar :
       aucun entrainement n'est lance dans ce lot. */
    const json = await (await inscrireFichier()).json();
    expect(json.avatar.provider_avatar_id).toBeNull();
    expect(json.avatar.status).toBe(ETAT_SOURCE_PRETE);
    expect(json.avatar.validated_at).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. « Pas encore prêt » n’est pas « en cours d’entraînement »', () => {
  /* ⚠️ CE BLOC LIT LE SOURCE DE LA PAGE, ET C'EST ASSUME. Monter
     `AvatarPage` entrainerait tout le parcours photo historique — voix,
     enregistreur, generation — pour verifier une phrase. Le comportement
     visible est couvert par `avatar-a8e-voix-ui.test.tsx` sur le panneau
     `CloneVideoPanel` ; ici on verifie que la BANNIERE HISTORIQUE, elle, ne
     peut plus s'afficher sur un etat local. */
  const PAGE = readFileSync(
    path.join(process.cwd(), 'src/app/dashboard/avatar/page.tsx'), 'utf8',
  );

  it('5.1 ⚠️ LA PHRASE « HEYGEN ENTRAÎNE » EST SOUS GARDE', () => {
    /* Elle decrivait un travail qui n'existe pas : une inscription
       `source_ready` n'a jamais ete envoyee nulle part. */
    const banniere = PAGE.indexOf('HeyGen entraîne votre avatar vidéo');
    expect(banniere).toBeGreaterThan(-1);

    const garde = PAGE.indexOf('{training && !trainingFailed && !enAttenteEntrainement && (');
    expect(garde).toBeGreaterThan(-1);
    expect(banniere).toBeGreaterThan(garde);
    // Et l'ancienne condition, celle qui laissait passer un etat local, a bien
    // disparu : la garde n'a pas ete AJOUTEE a cote, elle a REMPLACE.
    expect(PAGE).not.toContain('{training && !trainingFailed && (');
  });

  it('5.2 l’état local est nommé par le vocabulaire partagé', () => {
    // Pas de liste de statuts recopiee : la source de verite reste `etats.ts`.
    expect(PAGE).toContain("estEtatLocal");
    expect(PAGE).toContain('estEtatLocal(avatar?.status)');
  });

  it('5.3 ⚠️ AUCUN SONDAGE N’EST LANCÉ POUR UN ÉTAT LOCAL', () => {
    /* `source_ready` ne progresse pas tout seul : interroger en boucle
       attendrait un resultat que personne ne calcule. */
    expect(PAGE).toContain('if (!training || trainingFailed || enAttenteEntrainement) return;');
  });

  it('5.4 la page annonce explicitement qu’aucun clone n’existe', () => {
    expect(PAGE).toContain('Votre clone n’a pas encore été créé');
  });
});
