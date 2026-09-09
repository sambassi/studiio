/**
 * A_9b — LA ROUTE D'IMPORT, DE BOUT EN BOUT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTÈGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le corps de la requête porte un fichier et un nom — deux choses que
 * n'importe qui peut écrire. Il ne porte NI le compte NI la clé de stockage :
 * les deux sont fabriqués ici, et c'est ce qui rend un nom de fichier piégé
 * inoffensif.
 *
 * Et la réponse doit être utilisable par une interface qui n'existe pas encore
 * (A_9c) : un motif stable, une phrase française, et jamais un message de la
 * base ni un chemin de serveur.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';

let lignes: Ligne[] = [];
let objets: Map<string, number>;
let echecEnvoi = false;

function requete(table: string) {
  const eq: [string, unknown][] = [];
  let majPatch: Ligne | null = null;
  let insertion: Ligne | null = null;

  const filtrees = () => {
    let out = [...lignes];
    for (const [c, v] of eq) out = out.filter((l) => String(l[c]) === String(v));
    return out;
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    is: () => api,
    order: () => api,
    limit: () => api,
    upsert: (l: Ligne) => { insertion = l; return api; },
    update: (l: Ligne) => { majPatch = l; return api; },
    maybeSingle: async () => ({ data: filtrees()[0] ?? null, error: null }),
    single: async () => ({ data: filtrees()[0] ?? null, error: null }),
    then: (resoudre: (v: unknown) => unknown) => {
      if (insertion) {
        if (!lignes.some((l) => l.user_id === insertion!.user_id)) {
          lignes.push({
            user_id: insertion.user_id, design_style: {},
            updated_at: new Date().toISOString(),
          });
        }
        return resoudre({ data: null, error: null });
      }
      if (majPatch) {
        const cibles = filtrees();
        for (const l of cibles) Object.assign(l, majPatch);
        return resoudre({ data: cibles.map((l) => ({ user_id: l.user_id })), error: null });
      }
      return resoudre({ data: filtrees(), error: null });
    },
  };
  if (table !== 'autopilot_config') throw new Error(`table inattendue : ${table}`);
  return api;
}

let utilisateurConnecte: string | null = UID;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => requete(t),
    rpc: async () => ({ error: { message: 'function does not exist' } }),
    storage: {
      from: () => ({
        upload: async (cle: string, octets: Buffer) => {
          if (echecEnvoi) return { data: null, error: { message: 'stockage plein' } };
          objets.set(cle, octets.length);
          return { data: { path: cle }, error: null };
        },
      }),
    },
  },
  supabase: { from: (t: string) => requete(t) },
}));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (utilisateurConnecte ? { user: { id: utilisateurConnecte } } : null),
}));

import { POST, GET } from '@/app/api/creatif/luts/route';
import { LUTS_UTILISATEUR_MAX, OCTETS_LUT_MAX } from '@/lib/creatif/lut-utilisateur';

/** Un vrai cube 3D. */
function cube(taille: number, titre?: string): string {
  const l: string[] = [];
  if (titre) l.push(`TITLE "${titre}"`);
  l.push(`LUT_3D_SIZE ${taille}`);
  const d = taille - 1;
  for (let b = 0; b < taille; b += 1) {
    for (let g = 0; g < taille; g += 1) {
      for (let r = 0; r < taille; r += 1) {
        l.push(`${(r / d).toFixed(6)} ${(g / d).toFixed(6)} ${(b / d).toFixed(6)}`);
      }
    }
  }
  return `${l.join('\n')}\n`;
}

async function importer(
  contenu: string | Buffer, nomFichier = 'MyCinema.cube', nom?: string,
) {
  const fd = new FormData();
  fd.append('fichier', new File([contenu], nomFichier, { type: 'application/octet-stream' }));
  if (nom !== undefined) fd.append('nom', nom);
  return POST({ formData: async () => fd } as never);
}

const catalogue = (userId = UID) => {
  const l = lignes.find((x) => x.user_id === userId);
  const style = (l?.design_style ?? {}) as Ligne;
  const biblio = (style.bibliothequeCreative ?? {}) as Ligne;
  return (biblio.luts ?? []) as Ligne[];
};

function socle(style: Ligne = {}) {
  lignes = [{ user_id: UID, design_style: style, updated_at: '2026-09-09T10:00:00.000Z' }];
  objets = new Map();
  echecEnvoi = false;
  utilisateurConnecte = UID;
}

beforeEach(() => { socle(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Un import qui aboutit', () => {
  it('1.1 ⚠️ LE FICHIER EST RANGÉ EN PRIVÉ ET LA FICHE ÉCRITE', async () => {
    const res = await importer(cube(8, 'Mon Cinéma'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.issue).toBe('creee');
    expect(json.lut.cle.startsWith(`${UID}/lut/`)).toBe(true);
    expect(objets.has(json.lut.cle)).toBe(true);
    expect(catalogue()).toHaveLength(1);
  });

  it('1.2 les métadonnées survivent à une relecture', async () => {
    await importer(cube(8, 'Mon Cinéma'));
    const json = await (await GET()).json();
    const [lut] = json.luts;
    expect(lut.taille).toBe(8);
    expect(lut.titre).toBe('Mon Cinéma');
    expect(lut.nom).toBe('Mon Cinéma');
    expect(lut.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(lut.octets).toBeGreaterThan(0);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(json.limite).toBe(LUTS_UTILISATEUR_MAX);
  });

  it('1.3 sans TITLE, le nom vient du fichier', async () => {
    await importer(cube(4), 'SonyWarm.cube');
    expect(catalogue()[0].nom).toBe('SonyWarm');
  });

  it('1.4 un nom explicite l’emporte', async () => {
    await importer(cube(4, 'Titre du fichier'), 'x.cube', 'Mon nom à moi');
    expect(catalogue()[0].nom).toBe('Mon nom à moi');
  });

  it('1.5 ⚠️ UN .CUBE NATIF DE STUDIIO PASSE LA ROUTE', async () => {
    const brut = readFileSync(path.join(process.cwd(), 'public/luts/teal-orange.cube'));
    const res = await importer(brut, 'teal-orange.cube');
    expect(res.status).toBe(200);
    expect((await res.json()).lut.taille).toBe(16);
  });

  it('1.6 l’avertissement colorimétrique accompagne la réussite', async () => {
    /* Rien ne sait lire le profil couleur d'une LUT — on le dit plutôt que de
       laisser croire à une vérification qui n'existe pas. */
    const json = await (await importer(cube(4))).json();
    expect(json.avertissement).toContain('profil couleur');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Ce que la route refuse', () => {
  it('2.1 ⚠️ UNE LUT 1D EST REFUSÉE, ET L’UTILISATEUR SAIT QUOI FAIRE', async () => {
    const res = await importer('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n');
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.motif).toBe('lut_1d_non_supportee');
    expect(json.error).toContain('LUT 3D');
    expect(objets.size).toBe(0);
    expect(catalogue()).toHaveLength(0);
  });

  it('2.2 un fichier texte renommé .cube est refusé', async () => {
    const res = await importer('bonjour', 'fake.cube');
    expect(res.status).toBe(422);
    expect((await res.json()).motif).toBe('cube_invalide');
    expect(objets.size).toBe(0);
  });

  it('2.3 un fichier binaire est refusé', async () => {
    const res = await importer(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'x.cube');
    expect((await res.json()).motif).toBe('binaire');
  });

  it('2.4 ⚠️ LE POIDS EST REFUSÉ, ET AVANT LE DÉCODAGE', async () => {
    const res = await importer(Buffer.alloc(OCTETS_LUT_MAX + 10, 0x20), 'gros.cube');
    expect(res.status).toBe(413);
    expect((await res.json()).motif).toBe('trop_volumineux');
    expect(objets.size).toBe(0);
  });

  it('2.5 sans fichier, refus nommé', async () => {
    const res = await POST({ formData: async () => new FormData() } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).motif).toBe('fichier_absent');
  });

  it('2.6 sans session, 401 et rien n’est écrit', async () => {
    utilisateurConnecte = null;
    expect((await importer(cube(4))).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect(objets.size).toBe(0);
    expect(catalogue()).toHaveLength(0);
  });

  it('2.7 ⚠️ AUCUNE RÉPONSE NE PORTE DE DÉTAIL TECHNIQUE', async () => {
    for (const mauvais of ['bonjour', 'LUT_3D_SIZE 4\n0 0 0\n', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n']) {
      const json = await (await importer(mauvais)).json();
      const texte = JSON.stringify(json);
      expect(texte).not.toMatch(/\/Users\/|node_modules|select |insert |PGRST|Error:/);
      expect(json.error).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le même contenu, deux fois', () => {
  it('3.1 ⚠️ DEUX NOMS, MÊMES OCTETS : UNE SEULE ENTRÉE', async () => {
    const texte = cube(8, 'Mon Cinéma');
    const a = await (await importer(texte, 'MyCinema.cube')).json();
    const b = await (await importer(texte, 'CinemaFinal.cube')).json();
    expect(a.issue).toBe('creee');
    expect(b.issue).toBe('existante');
    expect(b.lut.empreinte).toBe(a.lut.empreinte);
    expect(catalogue()).toHaveLength(1);
    expect(objets.size).toBe(1);
  });

  it('3.2 ⚠️ LE NOM EXISTANT N’EST PAS RÉÉCRIT EN SILENCE', async () => {
    /* Le renommage volontaire viendra avec son propre geste (A_9c) : un second
       fichier ne doit pas renommer la LUT de quelqu'un sans qu'il l'ait voulu. */
    const texte = cube(4);
    await importer(texte, 'Premier.cube');
    await importer(texte, 'Deuxieme.cube');
    expect(catalogue()[0].nom).toBe('Premier');
  });

  it('3.3 ⚠️ MÊMES OCTETS, DEUX COMPTES : DEUX OBJETS PRIVÉS', async () => {
    /* Aucune déduplication entre comptes : un objet partagé sans modèle de
       propriété explicite serait une porte ouverte. */
    const texte = cube(4);
    await importer(texte);
    utilisateurConnecte = AUTRUI;
    lignes.push({ user_id: AUTRUI, design_style: {}, updated_at: '2026-09-09T10:00:00.000Z' });
    await importer(texte);

    const cles = [...objets.keys()];
    expect(cles).toHaveLength(2);
    expect(cles.some((c) => c.startsWith(`${UID}/lut/`))).toBe(true);
    expect(cles.some((c) => c.startsWith(`${AUTRUI}/lut/`))).toBe(true);
    expect(catalogue(UID)).toHaveLength(1);
    expect(catalogue(AUTRUI)).toHaveLength(1);
  });

  it('3.4 ⚠️ UN NOM DE FICHIER PIÉGÉ NE SORT PAS DU NAMESPACE', async () => {
    const json = await (await importer(cube(4), '../../etc/passwd.cube')).json();
    expect(json.lut.cle.startsWith(`${UID}/lut/`)).toBe(true);
    expect(json.lut.cle).not.toContain('..');
    expect(json.lut.nom).toBe('passwd');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le plafond, vu de la route', () => {
  const pleine = () => ({
    bibliothequeCreative: {
      luts: Array.from({ length: LUTS_UTILISATEUR_MAX }, (_, i) => {
        const e = i.toString(16).padStart(64, '0');
        return {
          empreinte: e, cle: `${UID}/lut/${e}.cube`, nom: `L${i}`, titre: null,
          octets: 1000, taille: 16, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
          importeeLe: '2026-09-09T10:00:00.000Z',
        };
      }),
    },
  });

  it('4.1 la 41e est refusée, avec un message qui dit quoi faire', async () => {
    socle(pleine());
    const res = await importer(cube(4));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.motif).toBe('bibliotheque_pleine');
    expect(json.error).toContain(String(LUTS_UTILISATEUR_MAX));
    expect(objets.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Aucune régression sur les voisins', () => {
  it('5.1 ⚠️ AUDIO, PRONONCIATIONS ET AUTOMATISATION SURVIVENT', async () => {
    /* `bibliothequeCreative` est UN document : une écriture qui n'en relit pas
       la totalité efface ce qu'elle n'a pas vu. C'est le défaut payé au lot
       A_5, et il ne doit pas revenir par la porte des LUT. */
    socle({
      bibliothequeCreative: {
        /* Une piste COMPLÈTE : `pisteAudioValide` exige aussi `dureeMs` et
           `octets`, et une fixture incomplète serait écartée à la relecture —
           le test passerait alors pour de mauvaises raisons. */
        audio: { pistes: [{
          cle: `${UID}/library/a.mp3`, nom: 'Ma musique', empreinte: '123-abc',
          droitsConfirmesLe: '2026-09-01T10:00:00.000Z', moods: [],
          dureeMs: 120_000, octets: 3_000_000, silenceInitialMs: 0,
        }] },
        prononciations: [{ display: 'Afroboost', spoken: 'Afro boost' }],
        automatisation: { mode: 'marque-stricte', version: 'v1' },
        favoris: { lut: ['clean'] },
      },
    });
    await importer(cube(4));

    const style = lignes[0].design_style as Ligne;
    const biblio = style.bibliothequeCreative as Ligne;
    expect((biblio.luts as unknown[])).toHaveLength(1);
    expect((biblio.audio as Ligne).pistes).toHaveLength(1);
    expect(biblio.prononciations).toEqual([{ display: 'Afroboost', spoken: 'Afro boost' }]);
    expect((biblio.automatisation as Ligne).mode).toBe('marque-stricte');
    expect((biblio.favoris as Ligne).lut).toEqual(['clean']);
  });

  it('5.2 les LUT utilisateur n’entrent PAS encore dans les favoris', async () => {
    // A_9c s'en chargera ; ici, la famille `lut` ne connaît que le catalogue
    // natif, et un identifiant inconnu y serait filtré.
    await importer(cube(4));
    const biblio = (lignes[0].design_style as Ligne).bibliothequeCreative as Ligne;
    expect((biblio.favoris as Ligne).lut).toEqual([]);
  });
});
