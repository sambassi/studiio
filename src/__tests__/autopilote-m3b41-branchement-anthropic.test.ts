// @vitest-environment node
/**
 * M3-B4.1 — L'adaptateur Anthropic est enfin BRANCHÉ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-B4 livrait `visuel-anthropic.ts` complet — drapeau, clé, modèle,
 * transport injectable, délai, huit images — et PERSONNE NE L'IMPORTAIT.
 * `chargerMoteurVisuel()` ne chargeait que `visuel.ts`, dont
 * `moteurVisuelDisponible()` ne regarde qu'un fournisseur injecté à la main.
 *
 * Conséquence mesurée en production : le fichier source était bien dans
 * l'image, mais le nom du drapeau n'apparaissait NULLE PART dans le paquet
 * serveur — le traceur de Next ne voyait pas de module orphelin. Poser
 * `AUTOPILOT_VISUEL_ANTHROPIC_ENABLED=true` n'aurait donc RIEN changé :
 * l'analyse serait restée extraction-only, en silence.
 *
 * ⚠️ AUCUNE IA RÉELLE N'EST APPELÉE ICI. Le transport est injecté, et le
 * garde-fou de `setup.ts` ferme la socket vers tout hôte hors boucle locale :
 * un appel vers `api.anthropic.com` fait ROUGIR le test au lieu de coûter des
 * jetons. Un test le prouve en direct.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ───────────────────────────────────────────────────────────────────────────
// Stockage doublé — les octets, eux, sont de vraies JPEG
// ───────────────────────────────────────────────────────────────────────────
let objets: Record<string, Buffer> = {};

vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (b: string, c: string) => {
      const o = objets[`${b}/${c}`];
      if (!o) throw new Error('The specified key does not exist.');
      return { size: o.length };
    },
  }),
  lecteurMinio: () => ({
    getObject: async (b: string, c: string) => {
      const o = objets[`${b}/${c}`];
      if (!o) throw new Error('The specified key does not exist.');
      const { Readable } = await import('stream');
      return Readable.from([o]);
    },
  }),
  signeurInterne: () => ({ presignedGetObject: async () => 'http://127.0.0.1:1/x' }),
  signeurPublic: () => null,
}));

import {
  chargerMoteurVisuel, definirMoteurVisuel,
} from '@/lib/autopilot/analyse/moteur-visuel';
import {
  definirFournisseurVisuel, moteurVisuelDisponible, IMAGES_MAX,
} from '@/lib/autopilot/analyse/visuel';
import {
  anthropicActive, fournisseurAnthropic, ConfigurationVisuelleInvalide,
  type Transport,
} from '@/lib/autopilot/analyse/visuel-anthropic';
import type { VignetteAnalyse } from '@/lib/autopilot/analyse/contrat';

const USER = 'u-m3b41';
const ANALYSE = 'a-m3b41';

function jpeg(octets = 2048): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(Math.max(0, octets - 5), 0x20),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function poserVignettes(n: number): VignetteAnalyse[] {
  const liste: VignetteAnalyse[] = [];
  for (let i = 1; i <= n; i += 1) {
    const v: VignetteAnalyse = {
      bucket: 'media',
      cle: `${USER}/analyse/${ANALYSE}/vignette-${String(i).padStart(2, '0')}.jpg`,
      seconde: i * 2,
    };
    objets[`${v.bucket}/${v.cle}`] = jpeg();
    liste.push(v);
  }
  return liste;
}

function reponseValide() {
  return {
    resume: 'Un plan fixe sur une rue de jour.',
    textesVisibles: [{ texte: 'STUDIIO', seconde: 2, confiance: 0.9 }],
    qualite: {
      scoreGlobal: 70, nettete: 80, lumiere: 65,
      cadrage: 60, energie: 40, interetVisuel: 55, problemes: [],
    },
  };
}

/** Un transport qui compte ses appels et ne touche à rien. */
function transportFactice() {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  const t: Transport = async (url, init) => {
    appels.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify(reponseValide()) }],
        usage: { input_tokens: 800, output_tokens: 150 },
      }),
    };
  };
  return { t, appels };
}

const ENV = [
  'AUTOPILOT_VISUEL_ANTHROPIC_ENABLED',
  'ANTHROPIC_API_KEY',
  'AUTOPILOT_VISUEL_ANTHROPIC_MODEL',
] as const;
let sauvegarde: Record<string, string | undefined> = {};

beforeEach(() => {
  objets = {};
  definirMoteurVisuel(null);
  definirFournisseurVisuel(null);
  sauvegarde = {};
  for (const k of ENV) { sauvegarde[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  definirMoteurVisuel(null);
  definirFournisseurVisuel(null);
  for (const k of ENV) {
    if (sauvegarde[k] === undefined) delete process.env[k];
    else process.env[k] = sauvegarde[k];
  }
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. LE DRAPEAU FERMÉ — le comportement de production, à l'identique
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.1 — drapeau fermé : rien ne bouge', () => {
  it('drapeau absent : aucun moteur visuel, aucune clé lue', async () => {
    expect(anthropicActive()).toBe(false);
    expect(await chargerMoteurVisuel()).toBe(null);
    // ⚠️ La preuve qui compte : aucun fournisseur n'a été branché en douce.
    expect(moteurVisuelDisponible()).toBe(false);
  });

  it('les valeurs approchantes ne l ouvrent pas', async () => {
    for (const valeur of ['false', '1', 'oui', 'yes', 'TRUE', ' true', 'true ']) {
      process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = valeur;
      // Clé et modèle POSÉS : si le drapeau était lu avec indulgence, le
      // moteur serait branché. Il ne doit pas l'être.
      process.env.ANTHROPIC_API_KEY = 'cle-de-test';
      process.env.AUTOPILOT_VISUEL_ANTHROPIC_MODEL = 'claude-test-vision';
      expect(anthropicActive(), valeur).toBe(false);
      expect(await chargerMoteurVisuel(), valeur).toBe(null);
      expect(moteurVisuelDisponible(), valeur).toBe(false);
    }
  });

  it('drapeau fermé ET configuration absente : toujours aucune erreur', async () => {
    // Un serveur qui n'active pas l'étape visuelle n'a pas à être configuré
    // pour elle. Lever ici casserait toutes les analyses de production.
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'false';
    await expect(chargerMoteurVisuel()).resolves.toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE DRAPEAU OUVERT, MAL CONFIGURÉ — échec explicite, jamais silencieux
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.1 — drapeau ouvert, configuration invalide', () => {
  it('clé absente : l erreur REMONTE, elle n est pas avalée en `null`', async () => {
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    // ⚠️ C'est LE piège du lot : un `catch` qui rendrait `null` ici
    // transformerait « mal configuré » en « pas configuré », et l'analyse se
    // clôturerait `reussie` en laissant croire que tout va bien.
    await expect(chargerMoteurVisuel()).rejects.toThrow(ConfigurationVisuelleInvalide);
    await expect(chargerMoteurVisuel()).rejects.toThrow(/cle_absente/);
    expect(moteurVisuelDisponible()).toBe(false);
  });

  it('modèle absent : même traitement — aucun modèle par défaut', async () => {
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    await expect(chargerMoteurVisuel()).rejects.toThrow(/modele_absent/);
    expect(moteurVisuelDisponible()).toBe(false);
  });

  it('l erreur ne dit rien de la clé ni d une URL', async () => {
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-a-ne-pas-fuiter';
    let message = '';
    try { await chargerMoteurVisuel(); } catch (e) {
      message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    expect(message).toContain('modele_absent');
    expect(message).not.toContain('sk-ant-secret-a-ne-pas-fuiter');
    expect(message).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LE DRAPEAU OUVERT ET CONFIGURÉ — le moteur est branché
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.1 — drapeau ouvert et configuré', () => {
  it('le moteur visuel devient disponible', async () => {
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_MODEL = 'claude-test-vision';

    expect(moteurVisuelDisponible()).toBe(false);
    const moteur = await chargerMoteurVisuel();
    expect(moteur).not.toBe(null);
    // Le branchement a bien eu lieu dans `visuel.ts`.
    expect(moteurVisuelDisponible()).toBe(true);
  });

  it('bout en bout avec un transport MOCK : un seul appel, 8 images, vrai modèle', async () => {
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_MODEL = 'claude-test-vision';

    // Le transport est injecté à la main : `chargerMoteurVisuel` en
    // construirait un qui appellerait `fetch`, et le garde-fou réseau le
    // ferait rougir — ce qui est exactement le comportement voulu.
    const { t, appels } = transportFactice();
    definirFournisseurVisuel(fournisseurAnthropic(t));

    const moteur = await chargerMoteurVisuel();
    expect(moteur).not.toBe(null);

    const r = await moteur!({
      userId: USER, analysisId: ANALYSE,
      vignettes: poserVignettes(12), dureeSecondes: 30,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 9. Le vrai modèle configuré remonte jusqu'au résultat.
    expect(r.modele).toBe('claude-test-vision');
    expect(r.visuel.usage).toEqual({ images: 8, inputTokens: 800, outputTokens: 150 });
    // Les objets complets sont conservés (garde-fou M3-B4).
    expect(r.visuel.textesVisibles[0]).toEqual({ texte: 'STUDIIO', seconde: 2, confiance: 0.9 });

    // 7. UN SEUL appel au transport. Aucune reprise.
    expect(appels.length).toBe(1);
    // 8. AU PLUS HUIT images, malgré douze vignettes.
    const corps = JSON.parse(String(appels[0].init.body));
    const blocs = corps.messages[0].content as Array<{ type: string }>;
    expect(blocs.filter((b) => b.type === 'image').length).toBe(IMAGES_MAX);
    expect(corps.model).toBe('claude-test-vision');
    // La clé voyage en en-tête, jamais dans le corps.
    expect(String(appels[0].init.body)).not.toContain('cle-de-test');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LES PRIORITÉS D'INJECTION NE BOUGENT PAS
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.1 — l injection de test garde sa priorité', () => {
  it('un moteur injecté gagne sur tout, sans rien charger', async () => {
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    // Ni clé ni modèle : si l'adaptateur était consulté, ça lèverait.
    const faux = vi.fn(async () => ({ ok: false as const, motif: 'aucune_image' as const }));
    definirMoteurVisuel(faux);
    const moteur = await chargerMoteurVisuel();
    expect(moteur).toBe(faux);
    // L'adaptateur n'a même pas été regardé.
    expect(moteurVisuelDisponible()).toBe(false);
  });

  it('un fournisseur injecté suffit, drapeau ou pas', async () => {
    definirFournisseurVisuel(async () => ({
      reponse: reponseValide(), usage: {}, modele: 'factice-1',
    }));
    const moteur = await chargerMoteurVisuel();
    expect(moteur).not.toBe(null);
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE,
      vignettes: poserVignettes(3), dureeSecondes: 20,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modele).toBe('factice-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. AUCUN RÉSEAU, AUCUN CRÉDIT — prouvé
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.1 — rien ne sort, rien n est débité', () => {
  it('un appel vers api.anthropic.com fait ÉCHOUER le test', async () => {
    const net = await import('node:net');
    expect(() => {
      const s = new net.Socket();
      s.connect({ host: 'api.anthropic.com', port: 443 });
    }).toThrow(/Appel réseau externe interdit/);
  });

  it('le branchement complet ne produit aucun trafic', async () => {
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_MODEL = 'claude-test-vision';
    const { t } = transportFactice();
    definirFournisseurVisuel(fournisseurAnthropic(t));
    const moteur = await chargerMoteurVisuel();
    // Si quoi que ce soit sortait, `AppelReseauInterdit` remonterait ici.
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE,
      vignettes: poserVignettes(8), dureeSecondes: 30,
    });
    expect(r.ok).toBe(true);
  });

  it('la couture ne touche pas aux crédits', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const code = readFileSync(
      join(process.cwd(), 'src/lib/autopilot/analyse/moteur-visuel.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const interdit of ['lib/credits', 'debiter', 'credit_transactions']) {
      expect(code).not.toContain(interdit);
    }
    // Et elle ne parle à aucun réseau elle-même.
    expect(code).not.toMatch(/\bfetch\s*\(/);
  });

  it('la couture importe RÉELLEMENT l adaptateur — c est ce qui le met au paquet', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const code = readFileSync(
      join(process.cwd(), 'src/lib/autopilot/analyse/moteur-visuel.ts'), 'utf8');
    // ⚠️ Sans cet import, le traceur de Next ne voit pas le module et le
    // drapeau n'existe pas dans le paquet serveur : poser la variable en
    // production ne changerait rien. C'est le défaut que M3-B4.1 ferme.
    expect(code).toContain("import('@/lib/autopilot/analyse/visuel-anthropic')");
  });
});
