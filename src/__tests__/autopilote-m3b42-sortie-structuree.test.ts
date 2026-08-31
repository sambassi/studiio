// @vitest-environment node
/**
 * M3-B4.2 — LA SORTIE EST CONTRAINTE, ET LE REFUS EST ENFIN LISIBLE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES DEUX DÉFAUTS QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. LE DIAGNOSTIC PERDU. `lireReponseVisuelle` refuse en NOMMANT la cause
 *    fine et le champ fautif ; `visuel.ts` les assemble dans `detail` ;
 *    `moteur-visuel.ts` les conserve — et la route les jetait. En base comme
 *    à l'écran il ne restait que `resultat_visuel_invalide`, qui dit qu'une
 *    réponse a été refusée sans dire pourquoi. C'est exactement ce qui s'est
 *    produit sur l'analyse v6 en production : la cause est PERDUE, et aucun
 *    test ne peut la reconstituer.
 *
 * 2. LE VOCABULAIRE JAMAIS FOURNI. L'invite système promet des défauts
 *    « choisis UNIQUEMENT dans le vocabulaire fourni ». Ce vocabulaire
 *    n'était transmis nulle part — ni dans l'invite, ni dans un schéma. Le
 *    modèle ne lit pas notre TypeScript : il ne pouvait qu'inventer, et le
 *    validateur ne pouvait que refuser.
 *
 * ⚠️ CE FICHIER NE PRÉTEND PAS CONNAÎTRE LA CAUSE DE v6. Il prouve qu'une
 * CLASSE d'erreurs est désormais empêchée à la génération, et que la
 * prochaine cause, quelle qu'elle soit, sera lisible.
 *
 * ⚠️ AUCUNE IA RÉELLE. Le transport est injecté, et le garde-fou réseau de
 * `setup.ts` fait rougir tout appel sortant.
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
  chargerMoteurVisuel, definirMoteurVisuel, diagnosticVisuelSur,
  DIAGNOSTIC_INVALIDE, DIAGNOSTIC_VISUEL_MAX,
} from '@/lib/autopilot/analyse/moteur-visuel';
import {
  definirFournisseurVisuel, moteurVisuelDisponible, IMAGES_MAX,
} from '@/lib/autopilot/analyse/visuel';
import { fournisseurAnthropic, type Transport } from '@/lib/autopilot/analyse/visuel-anthropic';
import {
  PROBLEMES_VISUELS, PROBLEMES_MAX, RESUME_MAX,
  TEXTES_VISIBLES_MAX, TEXTE_VISIBLE_MAX, MOTIFS_VISUEL,
} from '@/lib/autopilot/analyse/visuel-contrat';
import type { VignetteAnalyse } from '@/lib/autopilot/analyse/contrat';

const USER = 'u-m3b42';
const ANALYSE = 'a-m3b42';

const SOURCE_ROUTE = resolve(
  process.cwd(), 'src/app/api/autopilot/rushes/[id]/analyse/route.ts',
);
const SOURCE_CONTRAT = resolve(
  process.cwd(), 'src/lib/autopilot/analyse/visuel-contrat.ts',
);

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

/** Un transport qui capture ce qu'on lui donne et rend ce qu'on lui dit. */
function transportFactice(texte?: string, statut = 200) {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  const t: Transport = async (url, init) => {
    appels.push({ url, init });
    return {
      ok: statut >= 200 && statut < 300,
      status: statut,
      json: async () => ({
        content: [{ type: 'text', text: texte ?? JSON.stringify(reponseValide()) }],
        usage: { input_tokens: 800, output_tokens: 150 },
      }),
    };
  };
  return { t, appels };
}

/** Fait tourner l'étape complète et rend le corps de requête envoyé. */
async function corpsEnvoye(texte?: string, nbVignettes = 12) {
  process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
  process.env.ANTHROPIC_API_KEY = 'cle-de-test';
  process.env.AUTOPILOT_VISUEL_ANTHROPIC_MODEL = 'claude-test-vision';

  const { t, appels } = transportFactice(texte);
  definirFournisseurVisuel(fournisseurAnthropic(t));
  const moteur = await chargerMoteurVisuel();
  const r = await moteur!({
    userId: USER, analysisId: ANALYSE,
    vignettes: poserVignettes(nbVignettes), dureeSecondes: 40,
  });
  return { r, appels, corps: JSON.parse(String(appels[0].init.body)) };
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
// 1. LA SORTIE STRUCTURÉE PART VRAIMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.2 — la requête porte la sortie structurée officielle', () => {
  it('1. `output_config.format` est envoyé, en `json_schema`', async () => {
    const { corps } = await corpsEnvoye();
    expect(corps.output_config, 'sans lui, on est revenu à « réponds en JSON, promis »')
      .toBeTruthy();
    expect(corps.output_config.format.type).toBe('json_schema');
    expect(corps.output_config.format.schema).toBeTruthy();
  });

  it('la forme dépréciée n est PAS utilisée', async () => {
    const { corps, appels } = await corpsEnvoye();
    // `output_format` et l'en-tête bêta restent acceptés par l'API pour une
    // période de transition, mais ce sont l'ancienne écriture.
    expect(corps.output_format).toBeUndefined();
    const entetes = appels[0].init.headers as Record<string, string>;
    expect(Object.keys(entetes).map((k) => k.toLowerCase()))
      .not.toContain('anthropic-beta');
  });

  it('2. la racine du schéma ferme les propriétés supplémentaires', async () => {
    const { corps } = await corpsEnvoye();
    const s = corps.output_config.format.schema;
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    // Et à CHAQUE niveau, pas seulement à la racine : la doc l'exige pour
    // tout objet, et un objet ouvert laisserait rentrer un champ que le
    // validateur refuserait ensuite.
    expect(s.properties.qualite.additionalProperties).toBe(false);
    expect(s.properties.textesVisibles.items.additionalProperties).toBe(false);
  });

  it('3. les champs obligatoires sont exactement ceux du contrat', async () => {
    const { corps } = await corpsEnvoye();
    const s = corps.output_config.format.schema;
    expect(s.required.sort()).toEqual(['qualite', 'resume', 'textesVisibles']);
    expect(s.properties.textesVisibles.items.required.sort())
      .toEqual(['confiance', 'seconde', 'texte']);
    expect(s.properties.qualite.required.sort()).toEqual([
      'cadrage', 'energie', 'interetVisuel', 'lumiere',
      'nettete', 'problemes', 'scoreGlobal',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LES BORNES — DITES AU MODÈLE, TENUES PAR NOUS
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.2 — les bornes voyagent en description, jamais en mots-clés non supportés', () => {
  it('4. les six notes sont des ENTIERS, et la borne 0-100 est dite', async () => {
    const { corps } = await corpsEnvoye();
    const q = corps.output_config.format.schema.properties.qualite.properties;
    for (const cle of ['scoreGlobal', 'nettete', 'lumiere', 'cadrage', 'energie', 'interetVisuel']) {
      expect(q[cle].type, `${cle} doit être un entier`).toBe('integer');
      expect(q[cle].description).toContain('0 à 100');
    }
  });

  it('les mots-clés que la doc ne supporte pas ne sont PAS envoyés', async () => {
    const { corps } = await corpsEnvoye();
    // La documentation des sorties structurées exclut `minimum`, `maximum`,
    // `maxLength` et `maxItems` ; les SDK officiels les retirent et les
    // reportent en description. Les envoyer quand même serait compter sur une
    // garantie que l'API ne donne pas.
    const brut = JSON.stringify(corps.output_config.format.schema);
    for (const motCle of ['"minimum"', '"maximum"', '"maxLength"', '"maxItems"', '"multipleOf"']) {
      expect(brut, `${motCle} n'est pas supporté par la sortie structurée`)
        .not.toContain(motCle);
    }
  });

  it('5. `confiance` est un nombre, et sa plage 0-1 est dite', async () => {
    const { corps } = await corpsEnvoye();
    const c = corps.output_config.format.schema
      .properties.textesVisibles.items.properties.confiance;
    expect(c.type).toBe('number');
    expect(c.description).toContain('0 à 1');
  });

  it('6. la borne de `textesVisibles` et des textes vient des constantes', async () => {
    const { corps } = await corpsEnvoye();
    const tv = corps.output_config.format.schema.properties.textesVisibles;
    expect(tv.type).toBe('array');
    expect(tv.description).toContain(String(TEXTES_VISIBLES_MAX));
    expect(tv.items.properties.texte.description).toContain(String(TEXTE_VISIBLE_MAX));
    expect(corps.output_config.format.schema.properties.resume.description)
      .toContain(String(RESUME_MAX));
  });

  it('les bornes NON envoyées restent tenues par le validateur local', async () => {
    // C'est le point qui rend l'arbitrage acceptable : ce qu'on ne peut pas
    // contraindre à la génération, on le refuse à la lecture.
    const trop = {
      ...reponseValide(),
      qualite: { ...reponseValide().qualite, scoreGlobal: 120 },
    };
    const { r } = await corpsEnvoye(JSON.stringify(trop));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('resultat_visuel_invalide');
    expect(r.detail).toBe('valeur_hors_plage:qualite.scoreGlobal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LE VOCABULAIRE — UNE SEULE SOURCE, DITE DEUX FOIS
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.2 — le vocabulaire des problèmes est enfin fourni', () => {
  it('7. `problemes` est un enum EXACT de PROBLEMES_VISUELS', async () => {
    const { corps } = await corpsEnvoye();
    const p = corps.output_config.format.schema.properties.qualite.properties.problemes;
    expect(p.type).toBe('array');
    expect(p.items.type).toBe('string');
    // Égalité stricte, ordre compris : c'est la MÊME liste, pas une copie.
    expect(p.items.enum).toEqual([...PROBLEMES_VISUELS]);
    expect(p.description).toContain(String(PROBLEMES_MAX));
  });

  it('la liste part AUSSI en toutes lettres dans le message', async () => {
    const { corps } = await corpsEnvoye();
    const blocs = corps.messages[0].content as Array<{ type: string; text?: string }>;
    const dernier = blocs[blocs.length - 1];
    expect(dernier.type).toBe('text');
    for (const p of PROBLEMES_VISUELS) {
      expect(dernier.text, `« ${p} » doit être nommé au modèle`).toContain(p);
    }
  });

  it('la forme n est plus recopiée à la main dans le message', async () => {
    const { corps } = await corpsEnvoye();
    const blocs = corps.messages[0].content as Array<{ type: string; text?: string }>;
    const dernier = String(blocs[blocs.length - 1].text);
    // La forme vit dans le schéma. La redire ici la ferait diverger.
    expect(dernier).not.toContain('"scoreGlobal":number');
    expect(dernier).not.toContain('string[]');
  });

  it('§11 — un défaut hors vocabulaire est REFUSÉ, et le schéma l interdisait', async () => {
    // Le type d'écart qu'un LLM non contraint produit spontanément : un
    // libellé lisible plutôt qu'une clé de notre vocabulaire.
    const hors = {
      ...reponseValide(),
      qualite: { ...reponseValide().qualite, problemes: ['image sombre'] },
    };
    const { r, corps } = await corpsEnvoye(JSON.stringify(hors));

    // a) Le validateur local le refuse, et nomme le champ.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('resultat_visuel_invalide');
    expect(r.detail).toBe('forme_invalide:qualite.problemes[0]');

    // b) Et cette valeur n'était pas atteignable : l'enum ne la contient pas.
    const enumere = corps.output_config.format.schema
      .properties.qualite.properties.problemes.items.enum as string[];
    expect(enumere).not.toContain('image sombre');
    expect(enumere).toContain('sous_expose');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CE QUI NE DOIT PAS AVOIR CHANGÉ
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.2 — le périmètre tient', () => {
  it('8. `usage` n apparaît NULLE PART dans le schéma du modèle', async () => {
    const { corps } = await corpsEnvoye();
    // Il vient du transport. Un modèle qui déclarerait sa propre consommation
    // écrirait le chiffre qu'on facture.
    expect(JSON.stringify(corps.output_config.format.schema)).not.toContain('usage');
  });

  it('9. au plus huit images, malgré douze vignettes', async () => {
    const { corps } = await corpsEnvoye(undefined, 12);
    const blocs = corps.messages[0].content as Array<{ type: string }>;
    expect(blocs.filter((b) => b.type === 'image').length).toBe(IMAGES_MAX);
  });

  it('10. le modèle vient toujours de la variable, jamais d un défaut', async () => {
    const { corps } = await corpsEnvoye();
    expect(corps.model).toBe('claude-test-vision');
    expect(corps.max_tokens).toBe(2000);
    // La clé reste en en-tête.
    expect(JSON.stringify(corps)).not.toContain('cle-de-test');
  });

  it('les instants montrés bornent `seconde` par un enum numérique', async () => {
    const { corps } = await corpsEnvoye();
    const s = corps.output_config.format.schema
      .properties.textesVisibles.items.properties.seconde;
    expect(s.type).toBe('number');
    // Huit vignettes à 2, 4, … 16 secondes.
    expect(s.enum).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('11. une réponse conforme traverse l adaptateur ET le validateur', async () => {
    const { r } = await corpsEnvoye();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.modele).toBe('claude-test-vision');
    expect(r.visuel.resume).toBe('Un plan fixe sur une rue de jour.');
    expect(r.visuel.textesVisibles[0]).toEqual({ texte: 'STUDIIO', seconde: 2, confiance: 0.9 });
    expect(r.visuel.usage).toEqual({ images: 8, inputTokens: 800, outputTokens: 150 });
  });

  it('12. une réponse hors contrat reste refusée par le validateur local', async () => {
    const inconnu = { ...reponseValide(), bonus: 'non demandé' };
    const { r } = await corpsEnvoye(JSON.stringify(inconnu));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toBe('champ_inconnu:bonus');
  });

  it('13. AUCUNE tolérance JSON n a été ajoutée', async () => {
    // Un bloc de code et une phrase avant : les deux complaisances qu'on
    // refuse par principe, parce qu'elles reviennent à deviner.
    const cloture = await corpsEnvoye('```json\n' + JSON.stringify(reponseValide()) + '\n```');
    expect(cloture.r.ok).toBe(false);

    const bavard = await corpsEnvoye('Voici le résultat : ' + JSON.stringify(reponseValide()));
    expect(bavard.r.ok).toBe(false);
    if (bavard.r.ok) return;
    expect(bavard.r.detail).toBe('reponse_illisible:reponse');
  });

  it('aucune des complaisances interdites n a été introduite', async () => {
    // Chacune est nommée dans le mandat. On les vérifie par le COMPORTEMENT,
    // pas par une sous-chaîne : `Number(` existe légitimement dans
    // `usageVisuel`, et un test qui l'interdirait rougirait pour rien.
    const base = reponseValide();

    const cas: Array<[string, unknown, string]> = [
      // Pas de conversion « 80 » → 80.
      ['chaîne non convertie', { ...base, qualite: { ...base.qualite, nettete: '80' } },
        'valeur_hors_plage:qualite.nettete'],
      // Pas de bornage automatique 120 → 100.
      ['note non bornée', { ...base, qualite: { ...base.qualite, lumiere: 120 } },
        'valeur_hors_plage:qualite.lumiere'],
      // Pas de remplacement d'un problème inconnu.
      ['problème non substitué', { ...base, qualite: { ...base.qualite, problemes: ['sombre'] } },
        'forme_invalide:qualite.problemes[0]'],
      // Pas de suppression silencieuse d'une clé en trop.
      ['clé en trop non ignorée', { ...base, extra: 1 }, 'champ_inconnu:extra'],
      // Pas d'invention d'une valeur absente.
      ['champ absent non inventé', { ...base, resume: undefined },
        'forme_invalide:resume'],
      // Pas de confiance ramenée dans la plage.
      ['confiance non ramenée', {
        ...base, textesVisibles: [{ texte: 'A', seconde: 2, confiance: 4 }],
      }, 'valeur_hors_plage:textesVisibles[0].confiance'],
    ];

    for (const [nom, charge, attendu] of cas) {
      const { r } = await corpsEnvoye(JSON.stringify(charge));
      expect(r.ok, nom).toBe(false);
      if (r.ok) continue;
      expect(r.detail, nom).toBe(attendu);
    }
  });

  it('le contrat reste le seul juge : il refuse sans jamais réparer', () => {
    const source = readFileSync(SOURCE_CONTRAT, 'utf8');
    // La seule indulgence tolérée du module est documentée et porte sur
    // l'usage, qui ne vient PAS du modèle. Elle doit rester unique.
    expect(source).toContain('le seul endroit de ce module où l\'indulgence est le');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LE DIAGNOSTIC — LISIBLE, BORNÉ, ET QUI NE FUIT PAS
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.2 — `diagnosticVisuelSur` ne laisse passer que notre forme', () => {
  it('un diagnostic légitime passe tel quel', () => {
    expect(diagnosticVisuelSur('valeur_hors_plage:qualite.nettete'))
      .toBe('valeur_hors_plage:qualite.nettete');
    expect(diagnosticVisuelSur('champ_inconnu:qualite.foo'))
      .toBe('champ_inconnu:qualite.foo');
    expect(diagnosticVisuelSur('forme_invalide:textesVisibles'))
      .toBe('forme_invalide:textesVisibles');
    expect(diagnosticVisuelSur('forme_invalide:qualite.problemes[0]'))
      .toBe('forme_invalide:qualite.problemes[0]');
  });

  it('chaque motif fin du vocabulaire est accepté', () => {
    for (const m of MOTIFS_VISUEL) {
      expect(diagnosticVisuelSur(`${m}:resume`), m).toBe(`${m}:resume`);
    }
  });

  it('17. un détail malveillant n est JAMAIS journalisé tel quel', () => {
    const hostile = 'x\nhttps://evil/X-Amz-secret';
    expect(diagnosticVisuelSur(hostile)).toBe(DIAGNOSTIC_INVALIDE);
    // Et rien de la charge ne survit dans la valeur rendue.
    expect(diagnosticVisuelSur(hostile)).not.toContain('evil');
    expect(diagnosticVisuelSur(hostile)).not.toContain('X-Amz');
    expect(diagnosticVisuelSur(hostile)).not.toContain('\n');
  });

  it('un motif inconnu suffit à tout refuser, même bien formé', () => {
    // `X-Amz-Signature` passerait un simple filtre de caractères.
    expect(diagnosticVisuelSur('X-Amz-Signature:abc')).toBe(DIAGNOSTIC_INVALIDE);
    expect(diagnosticVisuelSur('inconnu:resume')).toBe(DIAGNOSTIC_INVALIDE);
  });

  it('les formes dangereuses sont refusées une par une', () => {
    const refus = [
      'champ_inconnu:a b',                  // espace
      'champ_inconnu:a\tb',                 // tabulation
      'champ_inconnu:a\r\nb',               // retour chariot
      'champ_inconnu:[31mrouge',      // séquence ANSI
      'champ_inconnu:aHR0cHM6Ly9ldmls=',    // base64
      'champ_inconnu:https://x/y',          // URL
      'champ_inconnu:',                     // champ vide
      ':resume',                            // motif vide
      'sans-deux-points',                   // pas de séparateur
      `champ_inconnu:${'a'.repeat(DIAGNOSTIC_VISUEL_MAX)}`, // trop long
    ];
    for (const d of refus) {
      expect(diagnosticVisuelSur(d), JSON.stringify(d)).toBe(DIAGNOSTIC_INVALIDE);
    }
  });

  it('ce qui n est pas une chaîne est refusé sans lever', () => {
    for (const v of [undefined, null, 42, {}, [], true]) {
      expect(diagnosticVisuelSur(v)).toBe(DIAGNOSTIC_INVALIDE);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LA ROUTE — UNE LIGNE, ET RIEN AILLEURS
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.2 — la route journalise sans rien exposer', () => {
  const source = () => readFileSync(SOURCE_ROUTE, 'utf8');

  it('14. il y a EXACTEMENT une écriture de journal dans la route', () => {
    const lignes = source().match(/console\.[a-z]+\(/g) ?? [];
    expect(lignes.length, 'une seule ligne de diagnostic, pas deux').toBe(1);
  });

  it('elle est gardée par le motif, et par la présence du détail', () => {
    expect(source()).toContain(
      "visuel.motif === 'resultat_visuel_invalide' && visuel.detail !== undefined",
    );
  });

  it('elle passe par le filtre, jamais par la valeur brute', () => {
    const s = source();
    expect(s).toContain('diagnosticVisuelSur(visuel.detail)');
    // Le détail brut n'est jamais interpolé directement.
    expect(s).not.toMatch(/\$\{visuel\.detail\}/);
  });

  it('15. le motif écrit en base reste exactement `resultat_visuel_invalide`', () => {
    const s = source();
    // La seule chose que la branche écrit, c'est le motif de l'étape.
    expect(s).toContain("etat: 'echouee', motifEchec: visuel.motif.slice(0, 200)");
    expect(s).not.toContain('motifEchec: visuel.detail');
    expect(s).not.toMatch(/motifEchec:[^\n]*detail/);
  });

  it('16. la réponse HTTP ne porte PAS le détail', () => {
    const s = source();
    // La réponse de refus visuel ne cite que `refus.message` et `visuel.motif`.
    expect(s).toContain('{ ok: false, error: refus.message, motif: visuel.motif }');
    expect(s).not.toMatch(/detail:\s*visuel\.detail/);
  });

  it('18. `fournisseur_en_erreur` ne journalise rien du corps fournisseur', async () => {
    // Le garde est sur `resultat_visuel_invalide` seul : les autres motifs
    // n'atteignent pas `console.warn`. Et le détail qu'ils portent vient d'un
    // message de fournisseur, qu'on ne recopie pas.
    const { t } = transportFactice(undefined, 500);
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_VISUEL_ANTHROPIC_MODEL = 'claude-test-vision';
    definirFournisseurVisuel(fournisseurAnthropic(t));
    const moteur = await chargerMoteurVisuel();
    const r = await moteur!({
      userId: USER, analysisId: ANALYSE,
      vignettes: poserVignettes(3), dureeSecondes: 20,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('fournisseur_en_erreur');
    // Le statut, et rien de plus : ni corps, ni URL, ni clé.
    expect(String(r.detail)).not.toContain('api.anthropic.com');
    expect(String(r.detail)).not.toContain('cle-de-test');
    // Et ce motif n'est pas celui qui déclenche le journal.
    expect(diagnosticVisuelSur(r.detail)).toBe(DIAGNOSTIC_INVALIDE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. RIEN NE SORT, RIEN N'EST DÉBITÉ
// ═══════════════════════════════════════════════════════════════════════════

describe('M3-B4.2 — aucun réseau, aucun crédit', () => {
  it('19. drapeau fermé : aucun moteur, aucun appel, extraction-only intacte', async () => {
    // Ni drapeau, ni clé, ni modèle : exactement la production d'aujourd'hui.
    expect(await chargerMoteurVisuel()).toBeNull();
    expect(moteurVisuelDisponible()).toBe(false);

    // Et les valeurs approchantes ne l'ouvrent pas davantage.
    for (const v of ['1', 'oui', 'TRUE', 'True', ' true', '']) {
      process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED = v;
      expect(await chargerMoteurVisuel(), `« ${v} » ne doit rien ouvrir`).toBeNull();
    }
  });

  it('un appel vers api.anthropic.com fait ÉCHOUER le test', async () => {
    await expect(fetch('https://api.anthropic.com/v1/messages', { method: 'POST' }))
      .rejects.toThrow(/Appel réseau externe interdit|fetch failed/);
  });

  it('le parcours complet ne produit aucun trafic sortant', async () => {
    const { appels } = await corpsEnvoye();
    // Le transport injecté a tout reçu ; aucune socket n'a été ouverte.
    expect(appels.length).toBe(1);
    expect(appels[0].url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('20. aucun des modules touchés ne parle de crédits', () => {
    const fichiers = [
      'src/lib/autopilot/analyse/visuel-anthropic.ts',
      'src/lib/autopilot/analyse/moteur-visuel.ts',
    ];
    for (const f of fichiers) {
      const s = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(s, f).not.toContain('credits');
      expect(s, f).not.toContain('debiterCredits');
    }
  });
});
