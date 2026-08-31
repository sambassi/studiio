// @vitest-environment node
/**
 * M3-C — LES CANDIDATS DE MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE EN PRIORITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un modèle qui n'a vu que huit images fixes ne sait pas ce qui se passe à la
 * seconde 4,25. Toute la sécurité du lot tient dans une séparation :
 *
 *   il CHOISIT un instant parmi ceux qu'on lui a montrés ;
 *   Studiio CALCULE les bornes, le rang et l'ordre.
 *
 * Les tests les plus importants sont donc ceux qui refusent un instant
 * inventé, et ceux qui vérifient que les bornes ne sortent jamais du rush.
 *
 * ⚠️ AUCUNE IA RÉELLE. Le transport est injecté, et le garde-fou réseau de
 * `setup.ts` fait rougir tout appel sortant. Un test le prouve en direct.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ───────────────────────────────────────────────────────────────────────────
// Stockage doublé — les octets sont de vraies JPEG
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
  chargerMoteurCandidats, definirMoteurCandidats, diagnosticCandidatsSur,
  DIAGNOSTIC_CANDIDATS_INVALIDE, resultatCandidatsEtapeValide,
  FOURNISSEUR_CANDIDATS,
} from '@/lib/autopilot/analyse/moteur-candidat';
import {
  definirFournisseurCandidats, moteurCandidatsDisponible, IMAGES_MAX,
} from '@/lib/autopilot/analyse/candidat';
import {
  fournisseurCandidatsAnthropic, candidatsAnthropicActif,
  ConfigurationCandidatsInvalide, type TransportCandidats,
} from '@/lib/autopilot/analyse/candidat-anthropic';
import {
  fenetreCandidat, lireReponseCandidats, normaliserReference, candidatValide,
  DUREES_CANDIDAT_SECONDES, CANDIDATS_MAX, RAISON_MAX, MOTIFS_CANDIDATS,
} from '@/lib/autopilot/analyse/candidat-contrat';
import type { VignetteAnalyse } from '@/lib/autopilot/analyse/contrat';

const USER = 'u-m3c';
const ANALYSE = 'a-m3c';
const DUREE = 40;

const SOURCE_ROUTE = resolve(
  process.cwd(), 'src/app/api/autopilot/analyses/[id]/candidats/route.ts',
);
const MIGRATION = resolve(process.cwd(), 'migrations/2026-09-02-rush-candidate-sets.sql');

function jpeg(octets = 2048): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(Math.max(0, octets - 5), 0x20),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Des vignettes à 2, 4, … secondes. */
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

const CONTEXTE = {
  resume: 'Un cours de danse en extérieur, plusieurs plans larges.',
  textesVisibles: [{ texte: 'STUDIIO', seconde: 2, confiance: 0.9 }],
  qualite: { scoreGlobal: 62, problemes: ['flou'] },
};

function reponseValide() {
  return {
    candidats: [
      { secondeReference: 4, dureeCibleSecondes: 5, scoreMontage: 80, raison: 'sujet net et centré' },
      { secondeReference: 2, dureeCibleSecondes: 3, scoreMontage: 90, raison: 'mouvement lisible' },
    ],
  };
}

function transportFactice(texte?: string, statut = 200) {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  const t: TransportCandidats = async (url, init) => {
    appels.push({ url, init });
    return {
      ok: statut >= 200 && statut < 300,
      status: statut,
      json: async () => ({
        content: [{ type: 'text', text: texte ?? JSON.stringify(reponseValide()) }],
        usage: { input_tokens: 3200, output_tokens: 210 },
      }),
    };
  };
  return { t, appels };
}

/** Fait tourner l'étape complète et rend le corps de requête envoyé. */
async function tourner(texte?: string, nbVignettes = 12) {
  process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
  process.env.ANTHROPIC_API_KEY = 'cle-de-test';
  process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'claude-test-montage';

  const { t, appels } = transportFactice(texte);
  definirFournisseurCandidats(fournisseurCandidatsAnthropic(t));
  const moteur = await chargerMoteurCandidats();
  const r = await moteur!({
    userId: USER, analysisId: ANALYSE,
    vignettes: poserVignettes(nbVignettes), dureeSecondes: DUREE, contexte: CONTEXTE,
  });
  return { r, appels, corps: JSON.parse(String(appels[0]?.init.body ?? '{}')) };
}

const ENV = [
  'AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED',
  'ANTHROPIC_API_KEY',
  'AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL',
  'AUTOPILOT_VISUEL_ANTHROPIC_ENABLED',
] as const;
let sauvegarde: Record<string, string | undefined> = {};

beforeEach(() => {
  objets = {};
  definirMoteurCandidats(null);
  definirFournisseurCandidats(null);
  sauvegarde = {};
  for (const k of ENV) { sauvegarde[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  definirMoteurCandidats(null);
  definirFournisseurCandidats(null);
  for (const k of ENV) {
    if (sauvegarde[k] === undefined) delete process.env[k];
    else process.env[k] = sauvegarde[k];
  }
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. LE DRAPEAU — SÉPARÉ DE CELUI DU VISUEL
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — activation', () => {
  it('1. drapeau absent : aucun fournisseur, aucune clé lue', async () => {
    expect(candidatsAnthropicActif()).toBe(false);
    expect(await chargerMoteurCandidats()).toBeNull();
    expect(moteurCandidatsDisponible()).toBe(false);
  });

  it('les valeurs approchantes ne l ouvrent pas', async () => {
    for (const v of ['1', 'oui', 'TRUE', 'True', ' true', 'false', '']) {
      process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = v;
      expect(candidatsAnthropicActif(), `« ${v} »`).toBe(false);
      expect(await chargerMoteurCandidats(), `« ${v} »`).toBeNull();
    }
  });

  it('⚠️ le drapeau du VISUEL n active PAS M3-C', async () => {
    // C'est la garantie qui protège la facture : M3-B4 tourne déjà en
    // production. S'ils partageaient un drapeau, chaque analyse paierait
    // silencieusement une seconde requête.
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    expect(candidatsAnthropicActif()).toBe(false);
    expect(await chargerMoteurCandidats()).toBeNull();
  });

  it('2. modèle absent avec drapeau posé : erreur CONTRÔLÉE, jamais un null', () => {
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    expect(() => fournisseurCandidatsAnthropic()).toThrow(ConfigurationCandidatsInvalide);
    try { fournisseurCandidatsAnthropic(); } catch (e) {
      expect((e as ConfigurationCandidatsInvalide).motif).toBe('modele_absent');
    }
  });

  it('clé absente : même traitement', () => {
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'm';
    try { fournisseurCandidatsAnthropic(); expect.fail('devait lever'); } catch (e) {
      expect((e as ConfigurationCandidatsInvalide).motif).toBe('cle_absente');
      // L'erreur ne dit rien de la clé ni d'une URL.
      expect(String((e as Error).message)).not.toContain('anthropic.com');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE SCHÉMA — LES DEUX ENUM QUI FERMENT TOUT
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — le schéma envoyé au fournisseur', () => {
  it('3. la racine ferme les propriétés supplémentaires, à chaque niveau', async () => {
    const { corps } = await tourner();
    const s = corps.output_config.format.schema;
    expect(corps.output_config.format.type).toBe('json_schema');
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.candidats.items.additionalProperties).toBe(false);
    expect(s.required).toEqual(['candidats']);
    expect(s.properties.candidats.items.required.sort())
      .toEqual(['dureeCibleSecondes', 'raison', 'scoreMontage', 'secondeReference']);
  });

  it('4. `secondeReference` est l enum EXACT des vignettes envoyées', async () => {
    const { corps } = await tourner(undefined, 12);
    const sec = corps.output_config.format.schema
      .properties.candidats.items.properties.secondeReference;
    expect(sec.type).toBe('number');
    // Huit vignettes seulement, malgré douze : l'enum suit ce qui est ENVOYÉ.
    expect(sec.enum).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('5. `dureeCibleSecondes` est l enum EXACT des durées autorisées', async () => {
    const { corps } = await tourner();
    const d = corps.output_config.format.schema
      .properties.candidats.items.properties.dureeCibleSecondes;
    // Identité de contenu avec la constante partagée, pas une copie écrite ici.
    expect(d.enum).toEqual([...DUREES_CANDIDAT_SECONDES]);
  });

  it('6. `scoreMontage` est un ENTIER, et sa borne est dite', async () => {
    const { corps } = await tourner();
    const s = corps.output_config.format.schema
      .properties.candidats.items.properties.scoreMontage;
    expect(s.type).toBe('integer');
    expect(s.description).toContain('0 à 100');
    // Et il annonce ce qu'il ne mesure pas.
    expect(s.description).toMatch(/son|parole|viral/);
  });

  it('7. la borne de `raison` est dite, et vient de la constante', async () => {
    const { corps } = await tourner();
    const r = corps.output_config.format.schema
      .properties.candidats.items.properties.raison;
    expect(r.type).toBe('string');
    expect(r.description).toContain(String(RAISON_MAX));
  });

  it('les mots-clés non supportés par la sortie structurée ne partent pas', async () => {
    const { corps } = await tourner();
    const brut = JSON.stringify(corps.output_config.format.schema);
    for (const m of ['"maximum"', '"minimum"', '"maxLength"', '"maxItems"', '"multipleOf"']) {
      expect(brut, m).not.toContain(m);
    }
    // `minItems: 1` est le seul autorisé par la documentation, et il est là.
    expect(corps.output_config.format.schema.properties.candidats.minItems).toBe(1);
  });

  it('22. `usage` n apparaît NULLE PART dans le schéma du modèle', async () => {
    const { corps } = await tourner();
    expect(JSON.stringify(corps.output_config.format.schema)).not.toContain('usage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LA LECTURE STRICTE
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — le validateur local refuse ce que le schéma promettait', () => {
  const ctx = { positions: [2, 4, 6, 8], dureeSecondes: DUREE };
  const bon = { secondeReference: 4, dureeCibleSecondes: 5, scoreMontage: 70, raison: 'ok' };

  it('8. un champ supplémentaire est refusé, et NOMMÉ', () => {
    const r = lireReponseCandidats({ candidats: [{ ...bon, bonus: 1 }] }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('champ_inconnu');
    expect(r.champ).toBe('candidats[0].bonus');
  });

  it('une clé inconnue à la racine est refusée', () => {
    const r = lireReponseCandidats({ candidats: [bon], extra: 1 }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('champ_inconnu');
  });

  it('9. ⚠️ UNE SECONDE INVENTÉE EST REFUSÉE', () => {
    // Le cœur du lot : 4.25 n'a jamais été montré.
    const r = lireReponseCandidats({ candidats: [{ ...bon, secondeReference: 4.25 }] }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('reference_inventee');
    expect(r.champ).toBe('candidats[0].secondeReference');
  });

  it('une seconde MICRO-décalée est ramenée sur la nôtre, pas rejetée', () => {
    // Un aller-retour JSON peut décaler d'un millionième ; ce n'est pas une
    // invention. Ce qui entre reste NOTRE valeur.
    expect(normaliserReference(2.3849999, [2.385, 7.156])).toBe(2.385);
    // Mais un instant voisin n'est pas un arrondi : c'est un autre instant.
    expect(normaliserReference(2.5, [2.385, 7.156])).toBeNull();
  });

  it('10. une seconde dupliquée est refusée', () => {
    const r = lireReponseCandidats({ candidats: [bon, { ...bon, scoreMontage: 10 }] }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('reference_dupliquee');
  });

  it('une durée hors du jeu proposé est refusée', () => {
    const r = lireReponseCandidats({ candidats: [{ ...bon, dureeCibleSecondes: 7 }] }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('duree_inconnue');
  });

  it('6bis. un score non entier ou hors plage est refusé', () => {
    for (const s of [70.5, -1, 101, '80', NaN]) {
      const r = lireReponseCandidats({ candidats: [{ ...bon, scoreMontage: s }] }, ctx);
      expect(r.ok, String(s)).toBe(false);
      if (!r.ok) expect(r.motif).toBe('valeur_hors_plage');
    }
  });

  it('7bis. une raison vide ou trop longue est refusée', () => {
    const vide = lireReponseCandidats({ candidats: [{ ...bon, raison: '  ' }] }, ctx);
    expect(vide.ok).toBe(false);
    if (!vide.ok) expect(vide.motif).toBe('forme_invalide');

    const longue = lireReponseCandidats(
      { candidats: [{ ...bon, raison: 'a'.repeat(RAISON_MAX + 1) }] }, ctx,
    );
    expect(longue.ok).toBe(false);
    if (!longue.ok) expect(longue.motif).toBe('borne_depassee');
  });

  it('19. une liste vide est refusée — une réussite doit dire quelque chose', () => {
    const r = lireReponseCandidats({ candidats: [] }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('forme_invalide');
  });

  it('18. au-delà de CANDIDATS_MAX, refus', () => {
    const trop = Array.from({ length: CANDIDATS_MAX + 1 }, (_, i) => ({
      ...bon, secondeReference: [2, 4, 6, 8][i % 4], scoreMontage: 50 + i,
    }));
    const r = lireReponseCandidats({ candidats: trop }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('borne_depassee');
  });

  it('aucune tolérance JSON : bloc de code et prose refusés', () => {
    const cloture = lireReponseCandidats('```json\n{"candidats":[]}\n```', ctx);
    expect(cloture.ok).toBe(false);
    if (!cloture.ok) expect(cloture.motif).toBe('reponse_illisible');

    const bavard = lireReponseCandidats('Voici : {"candidats":[]}', ctx);
    expect(bavard.ok).toBe(false);
    if (!bavard.ok) expect(bavard.motif).toBe('reponse_illisible');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LES BORNES — CALCULÉES ICI, JAMAIS LUES
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — la fenêtre est dérivée localement', () => {
  it('12. au milieu : la fenêtre est centrée', () => {
    expect(fenetreCandidat(20, 8, 40)).toEqual({ debutSecondes: 16, finSecondes: 24 });
  });

  it('11. près du DÉBUT : la durée est gardée, le centre se déplace', () => {
    // Centrée, elle commencerait à -3. On garde huit secondes.
    expect(fenetreCandidat(1, 8, 40)).toEqual({ debutSecondes: 0, finSecondes: 8 });
  });

  it('13. près de la FIN : même règle, en miroir', () => {
    expect(fenetreCandidat(39, 8, 40)).toEqual({ debutSecondes: 32, finSecondes: 40 });
  });

  it('14. rush plus COURT que la durée cible : la fenêtre est le rush', () => {
    expect(fenetreCandidat(1, 12, 2)).toEqual({ debutSecondes: 0, finSecondes: 2 });
    expect(fenetreCandidat(0.5, 8, 1)).toEqual({ debutSecondes: 0, finSecondes: 1 });
  });

  it('les invariants tiennent sur toutes les combinaisons plausibles', () => {
    const durees = [3, 5, 8, 12];
    for (const dureeRush of [0.4, 1, 2.5, 7, 38.165, 120]) {
      for (const d of durees) {
        for (const ref of [0, 0.001, dureeRush / 2, dureeRush - 0.001, dureeRush]) {
          const f = fenetreCandidat(ref, d, dureeRush);
          expect(f, `ref=${ref} d=${d} rush=${dureeRush}`).not.toBeNull();
          if (!f) continue;
          expect(Number.isFinite(f.debutSecondes)).toBe(true);
          expect(Number.isFinite(f.finSecondes)).toBe(true);
          expect(f.debutSecondes).toBeGreaterThanOrEqual(0);
          expect(f.finSecondes).toBeGreaterThan(f.debutSecondes);
          expect(f.finSecondes).toBeLessThanOrEqual(dureeRush);
          // Trois décimales, pas davantage.
          expect(String(f.debutSecondes).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
          expect(String(f.finSecondes).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('un rush de durée nulle ou une référence hors rush ne produit rien', () => {
    expect(fenetreCandidat(5, 5, 0)).toBeNull();
    expect(fenetreCandidat(50, 5, 40)).toBeNull();
    expect(fenetreCandidat(-1, 5, 40)).toBeNull();
    expect(fenetreCandidat(NaN, 5, 40)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LE CLASSEMENT — POSÉ PAR NOUS
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — tri et rang', () => {
  const ctx = { positions: [2, 4, 6, 8], dureeSecondes: DUREE };
  const c = (s: number, sc: number) => ({
    secondeReference: s, dureeCibleSecondes: 5, scoreMontage: sc, raison: 'x',
  });

  it('15. score décroissant', () => {
    const r = lireReponseCandidats({ candidats: [c(2, 40), c(4, 90), c(6, 65)] }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.map((x) => x.scoreMontage)).toEqual([90, 65, 40]);
  });

  it('16. à égalité, seconde croissante', () => {
    const r = lireReponseCandidats({ candidats: [c(8, 70), c(2, 70), c(6, 70)] }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.map((x) => x.secondeReference)).toEqual([2, 6, 8]);
  });

  it('17. le rang est attribué par le serveur, jamais par le modèle', () => {
    const r = lireReponseCandidats({ candidats: [c(2, 40), c(4, 90)] }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.map((x) => x.rang)).toEqual([1, 2]);
    // Le premier est celui du meilleur score, pas celui de la première place
    // dans la réponse.
    expect(r.valeur[0].secondeReference).toBe(4);
  });

  it('le rang n est pas un champ que le modèle puisse proposer', () => {
    const r = lireReponseCandidats(
      { candidats: [{ ...c(2, 40), rang: 1 }] }, ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('champ_inconnu');
  });

  it('les bornes ne sont pas proposables non plus', () => {
    for (const champ of ['debutSecondes', 'finSecondes']) {
      const r = lireReponseCandidats(
        { candidats: [{ ...c(2, 40), [champ]: 0 }] }, ctx,
      );
      expect(r.ok, champ).toBe(false);
      if (!r.ok) expect(r.champ).toBe(`candidats[0].${champ}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LE PARCOURS COMPLET
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — bout en bout, transport mocké', () => {
  it('20. au plus huit images, malgré douze vignettes', async () => {
    const { corps, r } = await tourner(undefined, 12);
    const blocs = corps.messages[0].content as Array<{ type: string }>;
    expect(blocs.filter((b) => b.type === 'image').length).toBe(IMAGES_MAX);
    expect(r.ok).toBe(true);
  });

  it('28. le fournisseur est appelé UNE seule fois', async () => {
    const { appels } = await tourner();
    expect(appels.length).toBe(1);
  });

  it('21. l usage vient du TRANSPORT, avec le nombre d images', async () => {
    const { r } = await tourner();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.usage).toEqual({ images: 8, inputTokens: 3200, outputTokens: 210 });
    expect(r.modele).toBe('claude-test-montage');
  });

  it('23. un usage annoncé DANS le JSON du modèle n est pas lu', async () => {
    const menteur = { candidats: reponseValide().candidats, usage: { inputTokens: 1 } };
    const { r } = await tourner(JSON.stringify(menteur));
    // Refusé comme champ inconnu : le contrat ne connaît pas `usage`.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toBe('champ_inconnu:usage');
  });

  it('la clé voyage en en-tête, jamais dans le corps', async () => {
    const { corps, appels } = await tourner();
    expect(JSON.stringify(corps)).not.toContain('cle-de-test');
    const entetes = appels[0].init.headers as Record<string, string>;
    expect(entetes['x-api-key']).toBe('cle-de-test');
  });

  it('le contexte M3-B4 part, sans URL ni clé de stockage', async () => {
    const { corps } = await tourner();
    const premier = (corps.messages[0].content as Array<{ text?: string }>)[0];
    expect(premier.text).toContain(CONTEXTE.resume);
    expect(premier.text).toContain('40 secondes');
    const brut = JSON.stringify(corps.messages);
    expect(brut).not.toContain('://');
    expect(brut).not.toContain(`${USER}/analyse/`);
  });

  it('26. aucune vignette : refus nommé, sans appeler le fournisseur', async () => {
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'm';
    const { t, appels } = transportFactice();
    definirFournisseurCandidats(fournisseurCandidatsAnthropic(t));
    const moteur = await chargerMoteurCandidats();
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE, vignettes: [], dureeSecondes: DUREE, contexte: CONTEXTE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('aucune_image');
    expect(appels.length, 'le fournisseur ne doit pas être appelé').toBe(0);
  });

  it('25. analyse sans durée exploitable : refus nommé', async () => {
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'm';
    const { t, appels } = transportFactice();
    definirFournisseurCandidats(fournisseurCandidatsAnthropic(t));
    const moteur = await chargerMoteurCandidats();
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE,
      vignettes: poserVignettes(3), dureeSecondes: 0, contexte: CONTEXTE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('analyse_inexploitable');
    expect(appels.length).toBe(0);
  });

  it('analyse sans résumé : refus, sans appeler le fournisseur', async () => {
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'm';
    const { t, appels } = transportFactice();
    definirFournisseurCandidats(fournisseurCandidatsAnthropic(t));
    const moteur = await chargerMoteurCandidats();
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE, vignettes: poserVignettes(3),
      dureeSecondes: DUREE, contexte: { ...CONTEXTE, resume: '   ' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toBe('resume:absent');
    expect(appels.length).toBe(0);
  });

  it('29. fournisseur en erreur : échec propre, sans corps de fournisseur', async () => {
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'm';
    const { t } = transportFactice(undefined, 500);
    definirFournisseurCandidats(fournisseurCandidatsAnthropic(t));
    const moteur = await chargerMoteurCandidats();
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE,
      vignettes: poserVignettes(3), dureeSecondes: DUREE, contexte: CONTEXTE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('fournisseur_en_erreur');
    expect(String(r.detail)).not.toContain('anthropic.com');
    expect(String(r.detail)).not.toContain('cle-de-test');
  });

  it('30. résultat invalide : AUCUN candidat partiel ne devient une réussite', async () => {
    const partiel = {
      candidats: [
        { secondeReference: 4, dureeCibleSecondes: 5, scoreMontage: 80, raison: 'bon' },
        { secondeReference: 99, dureeCibleSecondes: 5, scoreMontage: 90, raison: 'inventé' },
      ],
    };
    const { r } = await tourner(JSON.stringify(partiel));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('resultat_candidats_invalide');
    expect(r.detail).toBe('reference_inventee:candidats[1].secondeReference');
    // Et rien dans le résultat ne porte le premier candidat, pourtant valide.
    expect(JSON.stringify(r)).not.toContain('bon');
  });

  it('⚠️ une vignette ÉCARTÉE ne devient pas un instant proposable', async () => {
    // La vignette 2 est absente du stockage : elle n'a jamais été montrée.
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'm';
    const vignettes = poserVignettes(3);
    delete objets[`${vignettes[1].bucket}/${vignettes[1].cle}`];

    const { t, appels } = transportFactice(JSON.stringify({
      candidats: [{ secondeReference: 4, dureeCibleSecondes: 5, scoreMontage: 80, raison: 'x' }],
    }));
    definirFournisseurCandidats(fournisseurCandidatsAnthropic(t));
    const moteur = await chargerMoteurCandidats();
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE,
      vignettes, dureeSecondes: DUREE, contexte: CONTEXTE,
    });

    const corps = JSON.parse(String(appels[0].init.body));
    const sec = corps.output_config.format.schema
      .properties.candidats.items.properties.secondeReference;
    expect(sec.enum, 'la 4e seconde n a pas été montrée').toEqual([2, 6]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toBe('reference_inventee:candidats[0].secondeReference');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. LE DIAGNOSTIC SÛR
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — le diagnostic ne laisse passer que notre forme', () => {
  it('un diagnostic légitime passe tel quel', () => {
    expect(diagnosticCandidatsSur('reference_inventee:candidats[1].secondeReference'))
      .toBe('reference_inventee:candidats[1].secondeReference');
    for (const m of MOTIFS_CANDIDATS) {
      expect(diagnosticCandidatsSur(`${m}:candidats`), m).toBe(`${m}:candidats`);
    }
  });

  it('31. un détail malveillant n est JAMAIS journalisé tel quel', () => {
    const hostile = 'x\nhttps://evil/X-Amz-secret';
    expect(diagnosticCandidatsSur(hostile)).toBe(DIAGNOSTIC_CANDIDATS_INVALIDE);
    expect(diagnosticCandidatsSur('X-Amz-Signature:abc')).toBe(DIAGNOSTIC_CANDIDATS_INVALIDE);
    for (const d of [
      'champ_inconnu:a b', 'champ_inconnu:a\tb', 'champ_inconnu:https://x/y',
      'champ_inconnu:aHR0cHM=', ':candidats', 'sans-deux-points', '',
      `champ_inconnu:${'a'.repeat(200)}`, null, 42, {},
    ]) {
      expect(diagnosticCandidatsSur(d), JSON.stringify(d))
        .toBe(DIAGNOSTIC_CANDIDATS_INVALIDE);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. LA ROUTE, LA MIGRATION, LE PÉRIMÈTRE
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — la route et le socle', () => {
  const route = () => readFileSync(SOURCE_ROUTE, 'utf8');
  const migration = () => readFileSync(MIGRATION, 'utf8');

  it('23bis. la route exige l authentification et le propriétaire', () => {
    const s = route();
    expect(s).toContain('await auth()');
    expect(s).toContain("{ ok: false, error: 'Unauthorized' }");
    // La propriété vit dans `lireAnalyse(userId, ...)`, pas dans un `if`.
    expect(s).toContain('lireAnalyse(userId, params.id)');
  });

  it('24. une analyse non réussie est refusée', () => {
    expect(route()).toContain("analyse.etat !== 'reussie'");
    expect(route()).toContain("motif: 'analyse_non_reussie'");
  });

  it('27. l idempotence est portée par la BASE, pas par un `if`', () => {
    // Un `select` préalable ne prouverait rien : deux requêtes concurrentes le
    // passeraient toutes deux.
    //
    // ⚠️ `unique` EST LE MOT QUI PORTE TOUT. Un index non unique du même nom
    // passerait un test qui ne cherche que le nom, et ne garantirait plus
    // rien : deux générations actives coexisteraient, donc deux appels IA
    // payés pour la même analyse. La mutation qui retire `unique` doit faire
    // rougir ce test.
    expect(migration()).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_candidate_sets_active_unique/,
    );
    expect(migration()).toContain("where etat in ('en_attente', 'en_cours')");
    // Le même mot sur l'index de version : deux versions identiques seraient
    // deux générations concurrentes ayant calculé le même numéro.
    expect(migration()).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_candidate_sets_analyse_version_unique/,
    );
    expect(route()).toContain("motif === 'generation_active_existante'");
    // Et la route ne s'autorise PAS par un `select` préalable : c'est le
    // refus d'insertion qui tranche.
    expect(route()).not.toMatch(/if\s*\(\s*existante?\s*\)\s*return/);
  });

  it('la clé étrangère composite garantit le propriétaire', () => {
    const m = migration();
    expect(m).toContain('foreign key (analysis_id, user_id)');
    expect(m).toContain('references public.rush_analyses (id, user_id)');
    // Et l'index qui la rend possible.
    expect(m).toContain('rush_analyses_id_user_key');
  });

  it('la migration est ADDITIVE : ni drop, ni alter destructif', () => {
    const m = migration().toLowerCase();
    expect(m).not.toContain('drop table');
    expect(m).not.toContain('drop column');
    expect(m).not.toContain('truncate');
    expect(m).not.toContain('delete from');
    // Aucun droit ouvert à `public`.
    expect(m).not.toContain('grant all on table');
    // Et le rappel PostgREST est là, en commentaire.
    expect(m).toContain('sigusr1');
  });

  it('la version est versionnée, jamais écrasée', () => {
    const m = migration();
    // Insensible aux espaces d'alignement : c'est la contrainte qui compte,
    // pas la colonne où elle est écrite.
    expect(m.replace(/\s+/g, ' '))
      .toContain('version integer not null default 1 check (version >= 1)');
    expect(m).toContain('rush_candidate_sets_analyse_version_unique');
  });

  it('la route journalise une seule ligne, filtrée', () => {
    const s = route();
    expect((s.match(/console\.[a-z]+\(/g) ?? []).length).toBe(1);
    expect(s).toContain("resultat.motif === 'resultat_candidats_invalide' && resultat.detail !== undefined");
    expect(s).toContain('diagnosticCandidatsSur(resultat.detail)');
    expect(s).not.toMatch(/\$\{resultat\.detail\}/);
  });

  it('32/33/34. aucun crédit, aucun rendu, aucune publication', () => {
    const fichiers = [
      SOURCE_ROUTE,
      resolve(process.cwd(), 'src/lib/autopilot/analyse/candidat.ts'),
      resolve(process.cwd(), 'src/lib/autopilot/analyse/candidat-service.ts'),
      resolve(process.cwd(), 'src/lib/autopilot/analyse/candidat-anthropic.ts'),
      resolve(process.cwd(), 'src/lib/autopilot/analyse/candidat-contrat.ts'),
    ];
    for (const f of fichiers) {
      const code = readFileSync(f, 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      for (const interdit of [
        'lib/credits', 'debiter_credits', 'credit_transactions',
        'renderMedia', 'scheduled_posts', 'publier',
      ]) {
        expect(code, `${f} ne doit pas contenir ${interdit}`).not.toContain(interdit);
      }
    }
  });

  it('le fournisseur est nommé par le moteur, pas par la route', () => {
    // Même garde-fou qu'en M3-B4 : une route qui NOMME un fournisseur est une
    // route qu'on soupçonnera d'en appeler un.
    expect(FOURNISSEUR_CANDIDATS.fournisseur).toBe('anthropic');
    expect(route()).not.toContain("'anthropic'");
    expect(route()).toContain('FOURNISSEUR_CANDIDATS');
  });

  it('35. M3-B4 ne dépend de rien de M3-C', () => {
    // ⚠️ LA PROPRIÉTÉ EST L'ABSENCE DE COUPLAGE, pas l'absence du mot.
    // `visuel-contrat.ts` dit déjà, depuis M3-B4, « ni segment candidat, ni
    // score de montage » pour annoncer ce qu'il ne fait pas ; et
    // `moteur-visuel.ts` nomme `candidat` une variable locale. Interdire le
    // mot ferait rougir ce test sur du code que ce lot n'a pas touché.
    //
    // Ce qui compte est qu'aucun module M3-B4 n'IMPORTE M3-C : sans arête,
    // M3-C ne peut ni ralentir, ni casser, ni activer l'étape visuelle.
    for (const f of ['visuel.ts', 'visuel-contrat.ts', 'visuel-anthropic.ts', 'moteur-visuel.ts']) {
      const code = readFileSync(
        resolve(process.cwd(), 'src/lib/autopilot/analyse', f), 'utf8',
      );
      const imports = code.match(/from\s+'[^']+'/g) ?? [];
      for (const i of imports) {
        expect(i, `${f} ne doit pas importer M3-C`).not.toContain('candidat');
      }
      expect(code, `${f} ne doit pas lire le drapeau M3-C`)
        .not.toContain('CANDIDATS_ANTHROPIC');
    }
  });

  it('et M3-C ne modifie aucun fichier de M3-B4', () => {
    // Le pendant du test précédent : le lot est ADDITIF. Les quatre modules
    // de l'étape visuelle sont ceux de la base, au caractère près — ce que
    // `git diff --stat` confirme en validation, et que la CI rejouera.
    for (const f of ['visuel.ts', 'visuel-contrat.ts', 'visuel-anthropic.ts', 'moteur-visuel.ts']) {
      const code = readFileSync(
        resolve(process.cwd(), 'src/lib/autopilot/analyse', f), 'utf8',
      );
      expect(code, `${f} ne doit pas référencer la table M3-C`)
        .not.toContain('rush_candidate_sets');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. RIEN NE SORT
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-C — aucun réseau réel', () => {
  it('un appel vers api.anthropic.com fait ÉCHOUER le test', async () => {
    await expect(fetch('https://api.anthropic.com/v1/messages', { method: 'POST' }))
      .rejects.toThrow(/Appel réseau externe interdit|fetch failed/);
  });

  it('le parcours complet ne produit aucun trafic sortant', async () => {
    const { appels } = await tourner();
    expect(appels.length).toBe(1);
    expect(appels[0].url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('le validateur de sortie de moteur refuse un motif hors vocabulaire', () => {
    expect(resultatCandidatsEtapeValide({ ok: false, motif: 'inconnu' })).toBeNull();
    expect(resultatCandidatsEtapeValide({ ok: false, motif: 'aucune_image' }))
      .toEqual({ ok: false, motif: 'aucune_image', detail: undefined });
    // Une réussite sans candidat n'est pas une réussite.
    expect(resultatCandidatsEtapeValide({ ok: true, modele: 'm', candidats: [], usage: {} }))
      .toBeNull();
  });

  it('un candidat informe est écarté à la relecture', () => {
    expect(candidatValide({ rang: 1, secondeReference: 2, dureeCibleSecondes: 5, debutSecondes: 0, finSecondes: 5, scoreMontage: 80, raison: 'x' })).toBe(true);
    expect(candidatValide({ rang: 1, secondeReference: 2, dureeCibleSecondes: 5, debutSecondes: 5, finSecondes: 5, scoreMontage: 80, raison: 'x' })).toBe(false);
    expect(candidatValide({ rang: 1, raison: 'x' })).toBe(false);
    expect(candidatValide(null)).toBe(false);
  });
});
