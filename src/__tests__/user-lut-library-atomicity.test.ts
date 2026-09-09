/**
 * A_9b — DEUX IMPORTS SIMULTANÉS, ET AUCUN PERDU.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE FICHIER REPRODUIT AVANT DE LE FERMER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `bibliothequeCreative` est UN document JSON. L'écriture naïve — lire, ajouter
 * en mémoire, réécrire le tout — perd une entrée dès que deux requêtes se
 * chevauchent : la seconde écrit une liste calculée avant l'arrivée de la
 * première. La banque audio a payé exactement ce défaut au lot A_5, mesuré, et
 * il a fallu une RPC pour le fermer.
 *
 * Ici, la garantie vient d'un ÉCHANGE COMPARÉ sur `updated_at` : on écrit sous
 * condition que personne n'ait bougé la ligne, et on rejoue sinon. Aucune
 * migration — mais alors il faut le PROUVER, et le prouver sous une vraie
 * concurrence, pas par chance.
 *
 * ⚠️ CHAQUE TEST DE CONCURRENCE DE CE FICHIER ÉCHOUE si l'on remplace l'écriture
 * conditionnelle par un lire-modifier-écrire. C'est le critère qui les rend
 * utiles.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';

/** La table, et son horloge : `updated_at` est la version de la ligne. */
let lignes: Ligne[] = [];
/** Combien d'écritures conditionnelles ont été refusées puis rejouées. */
let collisions = 0;
/** Attente injectée entre lecture et écriture, pour forcer le chevauchement. */
let latenceEcriture = 0;

const attendre = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

function requete(table: string) {
  const eq: [string, unknown][] = [];
  let majPatch: Ligne | null = null;
  let insertion: Ligne | null = null;
  let ignorerDoublons = false;

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
    upsert: (l: Ligne, o?: { ignoreDuplicates?: boolean }) => {
      insertion = l; ignorerDoublons = o?.ignoreDuplicates === true; return api;
    },
    update: (l: Ligne) => { majPatch = l; return api; },
    maybeSingle: async () => ({ data: filtrees()[0] ?? null, error: null }),
    single: async () => ({ data: filtrees()[0] ?? null, error: null }),
    then: async (resoudre: (v: unknown) => unknown) => {
      if (insertion) {
        const existante = lignes.find((l) => l.user_id === insertion!.user_id);
        if (!existante) {
          lignes.push({
            user_id: insertion.user_id, design_style: {},
            updated_at: new Date().toISOString(),
          });
        } else if (!ignorerDoublons) {
          Object.assign(existante, insertion);
        }
        return resoudre({ data: null, error: null });
      }
      if (majPatch) {
        /* ⚠️ LA LATENCE EST ICI, ENTRE LA DÉCISION ET L'ÉCRITURE. C'est la
           fenêtre exacte dans laquelle un lire-modifier-écrire se perd. */
        if (latenceEcriture > 0) await attendre(latenceEcriture);
        const cibles = filtrees();
        if (cibles.length === 0) { collisions += 1; return resoudre({ data: [], error: null }); }
        for (const l of cibles) Object.assign(l, majPatch);
        return resoudre({ data: cibles.map((l) => ({ user_id: l.user_id })), error: null });
      }
      return resoudre({ data: filtrees(), error: null });
    },
  };
  if (table !== 'autopilot_config') throw new Error(`table inattendue : ${table}`);
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => requete(t),
    /* ⚠️ LA RPC DE FUSION N'EST PAS DISPONIBLE ICI, ET C'EST VOULU : le chemin
       testé est celui qui n'en a pas besoin. */
    rpc: async () => ({ error: { message: 'function does not exist' } }),
  },
  supabase: { from: (t: string) => requete(t) },
}));

import { ajouterLutUtilisateur } from '@/lib/autopilot/analyse/profil-compte';
import {
  cleLutUtilisateur, LUTS_UTILISATEUR_MAX, type LutUtilisateur,
} from '@/lib/creatif/lut-utilisateur';

const empreinte = (n: number) => n.toString(16).padStart(64, '0');

function lut(n: number, userId = UID): LutUtilisateur {
  const e = empreinte(n);
  return {
    empreinte: e, cle: cleLutUtilisateur(userId, e), nom: `Look ${n}`, titre: null,
    octets: 1024, taille: 16, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
    importeeLe: '2026-09-09T10:00:00.000Z',
  };
}

function socle(luts: LutUtilisateur[] = [], userId = UID) {
  lignes = [{
    user_id: userId,
    design_style: { bibliothequeCreative: { luts } },
    updated_at: '2026-09-09T10:00:00.000Z',
  }];
  collisions = 0;
  latenceEcriture = 0;
}

const catalogue = (userId = UID) => {
  const l = lignes.find((x) => x.user_id === userId);
  const style = (l?.design_style ?? {}) as Ligne;
  const biblio = (style.bibliothequeCreative ?? {}) as Ligne;
  return (biblio.luts ?? []) as LutUtilisateur[];
};

beforeEach(() => { socle(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Un import seul', () => {
  it('1.1 une LUT est ajoutée', async () => {
    const r = await ajouterLutUtilisateur(UID, lut(1), LUTS_UTILISATEUR_MAX);
    expect(r).toMatchObject({ ok: true, issue: 'creee' });
    expect(catalogue()).toHaveLength(1);
  });

  it('1.2 ⚠️ RÉIMPORTER LE MÊME CONTENU EST IDEMPOTENT', async () => {
    await ajouterLutUtilisateur(UID, lut(1), LUTS_UTILISATEUR_MAX);
    const r = await ajouterLutUtilisateur(UID, { ...lut(1), nom: 'Autre nom' },
      LUTS_UTILISATEUR_MAX);
    expect(r).toMatchObject({ ok: true, issue: 'existante' });
    expect(catalogue()).toHaveLength(1);
    /* ⚠️ ET LE NOM EXISTANT NE BOUGE PAS. Le renommage est un geste à part ;
       un second fichier ne doit pas renommer la LUT en silence. */
    expect(catalogue()[0].nom).toBe('Look 1');
  });

  it('1.3 la ligne est créée si elle n’existe pas encore', async () => {
    lignes = [];
    const r = await ajouterLutUtilisateur(UID, lut(1), LUTS_UTILISATEUR_MAX);
    expect(r).toMatchObject({ ok: true, issue: 'creee' });
    expect(catalogue()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le plafond', () => {
  it('2.1 la 41e est refusée', async () => {
    socle(Array.from({ length: LUTS_UTILISATEUR_MAX }, (_, i) => lut(i + 1)));
    const r = await ajouterLutUtilisateur(UID, lut(999), LUTS_UTILISATEUR_MAX);
    expect(r).toEqual({ ok: false, motif: 'pleine' });
    expect(catalogue()).toHaveLength(LUTS_UTILISATEUR_MAX);
  });

  it('2.2 ⚠️ À 40, UN DOUBLON REND « EXISTANTE », PAS « PLEINE »', async () => {
    /* Rien n'est ajouté, donc rien ne déborde. Tester le plafond d'abord
       refuserait un geste qui ne consomme aucune place. */
    socle(Array.from({ length: LUTS_UTILISATEUR_MAX }, (_, i) => lut(i + 1)));
    const r = await ajouterLutUtilisateur(UID, lut(7), LUTS_UTILISATEUR_MAX);
    expect(r).toMatchObject({ ok: true, issue: 'existante' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La concurrence, pour de vrai', () => {
  it('3.1 ⚠️ DEUX IMPORTS DISTINCTS SIMULTANÉS : AUCUN PERDU', async () => {
    /* Ce test échoue avec un lire-modifier-écrire : les deux appels lisent une
       liste vide et le second écrase le premier. */
    latenceEcriture = 5;
    await Promise.all([
      ajouterLutUtilisateur(UID, lut(1), LUTS_UTILISATEUR_MAX),
      ajouterLutUtilisateur(UID, lut(2), LUTS_UTILISATEUR_MAX),
    ]);
    const final = catalogue().map((l) => l.empreinte).sort();
    expect(final).toEqual([empreinte(1), empreinte(2)].sort());
    expect(collisions).toBeGreaterThan(0);
  });

  it('3.2 ⚠️ DIX IMPORTS DU MÊME CONTENU : UNE SEULE ENTRÉE', async () => {
    latenceEcriture = 2;
    const issues = await Promise.all(
      Array.from({ length: 10 }, () => ajouterLutUtilisateur(UID, lut(1), LUTS_UTILISATEUR_MAX)),
    );
    expect(catalogue()).toHaveLength(1);
    expect(issues.every((i) => i.ok)).toBe(true);
  });

  it('3.3 ⚠️ HUIT IMPORTS DISTINCTS SIMULTANÉS : LES HUIT SURVIVENT', async () => {
    latenceEcriture = 3;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ajouterLutUtilisateur(UID, lut(i + 1), LUTS_UTILISATEUR_MAX)),
    );
    expect(catalogue()).toHaveLength(8);
    expect(new Set(catalogue().map((l) => l.empreinte)).size).toBe(8);
  });

  it('3.4 ⚠️ 39 + 2 SIMULTANÉS DONNE EXACTEMENT 40', async () => {
    /* Le plafond doit tenir SOUS concurrence : sans relecture avant écriture,
       les deux appels verraient 39 et écriraient 41. */
    socle(Array.from({ length: 39 }, (_, i) => lut(i + 1)));
    latenceEcriture = 5;
    const issues = await Promise.all([
      ajouterLutUtilisateur(UID, lut(900), LUTS_UTILISATEUR_MAX),
      ajouterLutUtilisateur(UID, lut(901), LUTS_UTILISATEUR_MAX),
    ]);
    expect(catalogue()).toHaveLength(LUTS_UTILISATEUR_MAX);
    expect(issues.filter((i) => i.ok)).toHaveLength(1);
    expect(issues.filter((i) => !i.ok && i.motif === 'pleine')).toHaveLength(1);
  });

  it('3.5 ⚠️ UNE ÉCRITURE VOISINE N’EST PAS ÉCRASÉE', async () => {
    /* Le cas qui a coûté la banque audio : pendant qu'un import calcule sa
       liste, quelqu'un d'autre écrit une AUTRE clé du même document. */
    latenceEcriture = 10;
    const importEnCours = ajouterLutUtilisateur(UID, lut(1), LUTS_UTILISATEUR_MAX);
    await attendre(2);
    const ligne = lignes[0];
    const style = ligne.design_style as Ligne;
    ligne.design_style = {
      ...style,
      bibliothequeCreative: {
        ...(style.bibliothequeCreative as Ligne),
        prononciations: [{ display: 'Afroboost', spoken: 'Afro boost' }],
      },
    };
    ligne.updated_at = new Date().toISOString();
    await importEnCours;

    const biblio = ((lignes[0].design_style as Ligne).bibliothequeCreative ?? {}) as Ligne;
    expect(catalogue()).toHaveLength(1);
    expect(biblio.prononciations).toEqual([{ display: 'Afroboost', spoken: 'Afro boost' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La propriété', () => {
  it('4.1 ⚠️ UNE CLÉ D’AUTRUI N’ENTRE PAS AU CATALOGUE', async () => {
    /* La clé porte la propriété dans son préfixe. Une clé d'un autre compte est
       rejetée à la relecture — donc elle ne s'installe pas. */
    const etrangere = { ...lut(1), cle: cleLutUtilisateur(AUTRUI, empreinte(1)) };
    await ajouterLutUtilisateur(UID, etrangere, LUTS_UTILISATEUR_MAX);
    expect(catalogue()).toHaveLength(0);
  });

  it('4.2 le catalogue relu appartient bien au compte', async () => {
    await ajouterLutUtilisateur(UID, lut(1), LUTS_UTILISATEUR_MAX);
    expect(catalogue()[0].cle.startsWith(`${UID}/lut/`)).toBe(true);
  });
});
