// @vitest-environment node
/**
 * LOT 2B — ÉTAPE 4A.1 : L'ENRICHISSEMENT NE TOUCHE PAS À LA SÉLECTION.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'étape 4A avait ajouté le relevé sémantique au schéma de M3-C. Le score
 * gardait sa définition, l'invite interdisait au relevé d'y entrer — mais on
 * demandait TOUT DE MÊME davantage au modèle qui CHOISIT les moments.
 *
 * Personne ne peut promettre qu'un modèle à qui l'on demande autre chose
 * choisira pareil. Le chemin générique — celui d'un compte qui n'a déclaré
 * aucun objectif — aurait donc pu se mettre à produire d'autres plans : sans
 * objectif, sans changement de version d'algorithme, et sans qu'aucune ligne
 * ne le signale. Exactement la panne muette que le versionnement de `m3g-v2`
 * et `m3e-v3` existe pour empêcher.
 *
 * ⚠️ CE FICHIER NE VÉRIFIE PAS QUE LE CODE « DIT » LA BONNE CHOSE. Il
 * fabrique les situations : un `signaux` glissé dans la réponse de M3-C, un
 * indice de trop, un indice qui manque, un fournisseur qui lève. Un test qui
 * ne peut pas échouer quand le produit est cassé n'est pas une vérification.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  lireReponseCandidats, type CandidatMontage,
} from '@/lib/autopilot/analyse/candidat-contrat';
import {
  fournisseurCandidatsAnthropic,
} from '@/lib/autopilot/analyse/candidat-anthropic';
import {
  fournisseurSignauxAnthropic,
} from '@/lib/autopilot/analyse/candidat-signaux-anthropic';
import {
  enrichirCandidats, definirFournisseurSignaux,
} from '@/lib/autopilot/analyse/candidat-signaux';
import { lireReponseSignaux } from '@/lib/autopilot/analyse/candidat-signaux-contrat';
import { planifierMontage } from '@/lib/autopilot/analyse/montage';
import { calerCoupes } from '@/lib/autopilot/analyse/coupe';
import type { ClipMaterialise } from '@/lib/autopilot/analyse/clip-contrat';
import { SIGNAUX_ABSENTS } from '@/lib/autopilot/analyse/signaux-contrat';

/** Le commit de référence : l'état de M3-C AVANT tout signal. */
const REFERENCE = '1768c47';
const DUREE_RUSH = 40;
const POSITIONS = [5, 14, 30];

const ENV = [
  'AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED', 'AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL',
  'AUTOPILOT_SIGNAUX_ANTHROPIC_ENABLED', 'AUTOPILOT_SIGNAUX_ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
] as const;
let sauvegarde: Record<string, string | undefined> = {};

beforeEach(() => {
  definirFournisseurSignaux(null);
  sauvegarde = {};
  for (const k of ENV) { sauvegarde[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  definirFournisseurSignaux(null);
  for (const k of ENV) {
    if (sauvegarde[k] === undefined) delete process.env[k];
    else process.env[k] = sauvegarde[k];
  }
});

/** La réponse HISTORIQUE de M3-C : quatre champs, pas un de plus. */
function reponseHistorique() {
  return {
    candidats: [
      { secondeReference: 5, dureeCibleSecondes: 8, scoreMontage: 90, raison: 'salle pleine' },
      { secondeReference: 14, dureeCibleSecondes: 8, scoreMontage: 80, raison: 'face caméra' },
      { secondeReference: 30, dureeCibleSecondes: 8, scoreMontage: 70, raison: 'mains sur objet' },
    ],
  };
}

function candidatsFiges(): CandidatMontage[] {
  const r = lireReponseCandidats(reponseHistorique(), {
    positions: POSITIONS, dureeSecondes: DUREE_RUSH,
  });
  if (!r.ok) throw new Error(`candidats invalides: ${r.motif}:${r.champ}`);
  return r.valeur;
}

function releve(over: Record<string, unknown> = {}) {
  return {
    personnes: 'une', echellePlan: 'plan_moyen', expression: 'neutre',
    objetMisEnAvant: 'non', mainsEnAction: 'non', marqueVisible: 'non',
    texteALEcran: 'non', nettete: 0.8,
    ...over,
  };
}

function imagesPour(positions: readonly number[]) {
  return positions.map((seconde) => ({
    seconde, mimeType: 'image/jpeg' as const, data: Buffer.from([0xff, 0xd8]),
  }));
}

/** Un transport qui note ce qu'on lui a demandé d'envoyer. */
function transportFactice(reponse: unknown) {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  const t = async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    return {
      ok: true, status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify(reponse) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
  };
  return { t, appels };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('A. Le chemin de SÉLECTION est redevenu historique', () => {
  it('A.1 l’invite et l’adaptateur de M3-C sont identiques au commit de référence', () => {
    // ⚠️ COMPARAISON D'OCTETS, pas de lecture d'intention. Le jour où
    // quelqu'un rajoutera un champ au schéma de sélection, ce test tombera —
    // et c'est précisément le service qu'il rend.
    for (const chemin of [
      'src/lib/autopilot/analyse/candidat-invite.ts',
      'src/lib/autopilot/analyse/candidat-anthropic.ts',
    ]) {
      const historique = execFileSync('git', ['show', `${REFERENCE}:${chemin}`], {
        cwd: process.cwd(), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      });
      const courant = readFileSync(resolve(process.cwd(), chemin), 'utf8');
      expect(courant).toBe(historique);
    }
  });

  it('A.2 le schéma envoyé au fournisseur de sélection ne demande QUE les 4 champs', async () => {
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL = 'modele-test';

    const { t, appels } = transportFactice(reponseHistorique());
    const f = fournisseurCandidatsAnthropic(t);
    expect(f).not.toBeNull();
    await f!({
      images: imagesPour(POSITIONS),
      dureeSecondes: DUREE_RUSH,
      contexte: { resume: 'r', textesVisibles: [], qualite: {} },
    });

    const corps = JSON.parse(String(appels[0].init.body));
    const item = corps.output_config.format.schema.properties.candidats.items;
    expect(item.required.sort()).toEqual([
      'dureeCibleSecondes', 'raison', 'scoreMontage', 'secondeReference',
    ]);
    expect(Object.keys(item.properties).sort()).toEqual([
      'dureeCibleSecondes', 'raison', 'scoreMontage', 'secondeReference',
    ]);
    // Aucun mot du vocabulaire sémantique n'a été soumis au modèle qui choisit.
    const envoye = JSON.stringify(corps);
    for (const mot of [
      'signaux', 'personnes', 'echellePlan', 'marqueVisible',
      'objetMisEnAvant', 'mainsEnAction', 'texteALEcran',
    ]) {
      expect(envoye).not.toContain(mot);
    }
  });

  it('A.3 un `signaux` glissé dans la réponse de M3-C est REFUSÉ', () => {
    const r = lireReponseCandidats({
      candidats: [{
        secondeReference: 14, dureeCibleSecondes: 8, scoreMontage: 80, raison: 'r',
        signaux: releve(),
      }],
    }, { positions: POSITIONS, dureeSecondes: DUREE_RUSH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('champ_inconnu');
    expect(r.champ).toBe('candidats[0].signaux');
  });

  it('A.4 la sortie de M3-C est exactement l’historique, `signaux` toujours `null`', () => {
    // Les quatre champs, le rang posé par nous, les bornes calculées par nous,
    // l'ordre par score décroissant : tout est écrit en clair plutôt que
    // recalculé, sans quoi le test réimplémenterait ce qu'il vérifie.
    expect(candidatsFiges()).toEqual([
      {
        rang: 1, secondeReference: 5, dureeCibleSecondes: 8,
        debutSecondes: 1, finSecondes: 9,
        scoreMontage: 90, raison: 'salle pleine', signaux: null,
      },
      {
        rang: 2, secondeReference: 14, dureeCibleSecondes: 8,
        debutSecondes: 10, finSecondes: 18,
        scoreMontage: 80, raison: 'face caméra', signaux: null,
      },
      {
        rang: 3, secondeReference: 30, dureeCibleSecondes: 8,
        debutSecondes: 26, finSecondes: 34,
        scoreMontage: 70, raison: 'mains sur objet', signaux: null,
      },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B. L’enrichissement ne peut PAS changer un candidat', () => {
  const CHAMPS_SELECTION = [
    'rang', 'secondeReference', 'dureeCibleSecondes',
    'debutSecondes', 'finSecondes', 'scoreMontage', 'raison',
  ] as const;

  async function enrichirTout(parSeconde: Record<number, Record<string, unknown>>) {
    const figes = candidatsFiges();
    definirFournisseurSignaux(async ({ moments }) => ({
      reponse: {
        signaux: moments.map((m) => ({ indice: m.indice, ...(parSeconde[m.seconde] ?? releve()) })),
      },
      usage: { inputTokens: 7, outputTokens: 3 },
      modele: 'modele-signaux-test',
    }));
    const r = await enrichirCandidats({
      candidats: figes, images: imagesPour(POSITIONS),
    });
    return { figes, r };
  }

  it('B.1 tous les champs de sélection sont inchangés, champ par champ', async () => {
    const { figes, r } = await enrichirTout({
      5: releve({ personnes: 'foule' }), 14: releve({ expression: 'souriante' }),
    });
    expect(r.applique).toBe(true);
    expect(r.candidats).toHaveLength(figes.length);
    for (const [i, c] of r.candidats.entries()) {
      for (const champ of CHAMPS_SELECTION) {
        expect(c[champ]).toEqual(figes[i][champ]);
      }
    }
  });

  it('B.2 l’ordre est identique, et les relevés suivent le bon moment', async () => {
    const { figes, r } = await enrichirTout({
      5: releve({ personnes: 'foule' }),
      14: releve({ personnes: 'une' }),
      30: releve({ personnes: 'deux' }),
    });
    expect(r.candidats.map((c) => c.rang)).toEqual(figes.map((c) => c.rang));
    expect(r.candidats.map((c) => c.secondeReference)).toEqual([5, 14, 30]);
    // Le relevé de la foule reste sur la foule : c'est le glissement d'un
    // moment vers un autre que l'appariement strict existe pour empêcher.
    const parInstant = new Map(r.candidats.map((c) => [c.secondeReference, c.signaux?.personnes]));
    expect(parInstant.get(5)).toBe('foule');
    expect(parInstant.get(14)).toBe('une');
    expect(parInstant.get(30)).toBe('deux');
  });

  it('B.3 le schéma de l’enrichissement ne porte AUCUN champ de sélection', async () => {
    process.env.AUTOPILOT_SIGNAUX_ANTHROPIC_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    process.env.AUTOPILOT_SIGNAUX_ANTHROPIC_MODEL = 'modele-signaux';

    const { t, appels } = transportFactice({ signaux: [{ indice: 0, ...releve() }] });
    const f = fournisseurSignauxAnthropic(t);
    expect(f).not.toBeNull();
    await f!({
      moments: [{ indice: 0, seconde: 14, mimeType: 'image/jpeg', data: Buffer.from([1]) }],
    });

    const corps = JSON.parse(String(appels[0].init.body));
    const item = corps.output_config.format.schema.properties.signaux.items;
    // ⚠️ AUCUN de ces champs n'existe dans le contrat de sortie. Ce n'est pas
    // une consigne au modèle : il n'a structurellement aucun endroit où
    // écrire un nouveau moment, une nouvelle durée ou une nouvelle note.
    for (const interdit of [
      'secondeReference', 'dureeCibleSecondes', 'scoreMontage', 'raison', 'rang',
    ]) {
      expect(Object.keys(item.properties)).not.toContain(interdit);
    }
    expect(Object.keys(item.properties)).toContain('indice');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C. L’appariement est STRICT — jamais « au mieux »', () => {
  const OK = [
    { indice: 0, ...releve() }, { indice: 1, ...releve() }, { indice: 2, ...releve() },
  ];

  it('C.1 trois relevés pour trois moments : accepté', () => {
    const r = lireReponseSignaux({ signaux: OK }, 3);
    expect(r.ok).toBe(true);
  });

  it('C.2 un indice hors de la plage envoyée est refusé', () => {
    const r = lireReponseSignaux({
      signaux: [OK[0], OK[1], { indice: 7, ...releve() }],
    }, 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('indice_invalide');
  });

  it('C.3 un indice en double est refusé', () => {
    const r = lireReponseSignaux({
      signaux: [OK[0], OK[1], { indice: 1, ...releve() }],
    }, 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('indice_duplique');
  });

  it('C.4 un relevé de trop est refusé', () => {
    const r = lireReponseSignaux({ signaux: [...OK, { indice: 0, ...releve() }] }, 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('borne_depassee');
  });

  it('C.5 un relevé manquant est refusé — PAS un jeu partiel', () => {
    // Retenir « ce qui est appariable » laisserait un jeu dont personne ne
    // pourrait dire lequel des relevés a glissé.
    const r = lireReponseSignaux({ signaux: [OK[0], OK[1]] }, 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('indice_manquant');
  });

  it('C.6 une clé inconnue à la racine est refusée', () => {
    const r = lireReponseSignaux({ signaux: OK, commentaire: 'bonjour' }, 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('champ_inconnu');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('D. L’image est celle du candidat, à la seconde près', () => {
  it('D.1 chaque moment envoyé porte l’instant EXACT de son candidat', async () => {
    const figes = candidatsFiges();
    let vus: Array<{ indice: number; seconde: number }> = [];
    definirFournisseurSignaux(async ({ moments }) => {
      vus = moments.map((m) => ({ indice: m.indice, seconde: m.seconde }));
      return {
        reponse: { signaux: moments.map((m) => ({ indice: m.indice, ...releve() })) },
        usage: {}, modele: 'm',
      };
    });
    await enrichirCandidats({ candidats: figes, images: imagesPour(POSITIONS) });

    expect(vus).toEqual([
      { indice: 0, seconde: 5 }, { indice: 1, seconde: 14 }, { indice: 2, seconde: 30 },
    ]);
    // Décalage temporel maximal : ZÉRO. L'appariement est une égalité.
    for (const [i, v] of vus.entries()) {
      expect(Math.abs(v.seconde - figes[i].secondeReference)).toBe(0);
    }
  });

  it('D.2 sans image à l’instant exact, le candidat n’est PAS enrichi', async () => {
    // ⚠️ JAMAIS « LA PLUS PROCHE ». Relever la vignette de 30 s pour un
    // candidat de 34 s produirait un signal faux que rien ne distinguerait
    // d'un vrai.
    const figes = candidatsFiges();
    definirFournisseurSignaux(async ({ moments }) => ({
      reponse: { signaux: moments.map((m) => ({ indice: m.indice, ...releve() })) },
      usage: {}, modele: 'm',
    }));
    // On retire l'image de 14 s, et on en propose une voisine à 15 s.
    const r = await enrichirCandidats({
      candidats: figes, images: imagesPour([5, 15, 30]),
    });
    const parInstant = new Map(r.candidats.map((c) => [c.secondeReference, c.signaux]));
    expect(parInstant.get(5)).not.toBeNull();
    expect(parInstant.get(30)).not.toBeNull();
    expect(parInstant.get(14)).toBeNull();
  });

  it('D.3 aucune image appariée : rien n’est appelé, rien n’est perdu', async () => {
    let appele = false;
    definirFournisseurSignaux(async () => {
      appele = true;
      return { reponse: {}, usage: {}, modele: 'm' };
    });
    const figes = candidatsFiges();
    const r = await enrichirCandidats({ candidats: figes, images: imagesPour([99]) });
    expect(appele).toBe(false);
    expect(r.motif).toBe('aucune_image_appariee');
    expect(r.candidats.map((c) => c.rang)).toEqual(figes.map((c) => c.rang));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('E. Un échec d’enrichissement ne coûte JAMAIS le montage', () => {
  const CHAMPS = ['rang', 'secondeReference', 'scoreMontage', 'raison'] as const;

  async function echec(poser: () => void) {
    poser();
    const figes = candidatsFiges();
    const r = await enrichirCandidats({ candidats: figes, images: imagesPour(POSITIONS) });
    expect(r.applique).toBe(false);
    expect(r.candidats).toHaveLength(figes.length);
    for (const [i, c] of r.candidats.entries()) {
      for (const champ of CHAMPS) expect(c[champ]).toEqual(figes[i][champ]);
      expect(c.signaux).toBeNull();
    }
    return r;
  }

  it('E.1 fournisseur éteint — le cas par défaut, en production aujourd’hui', async () => {
    const r = await echec(() => definirFournisseurSignaux(null));
    expect(r.motif).toBe('fournisseur_absent');
  });

  it('E.2 le fournisseur lève', async () => {
    const r = await echec(() => definirFournisseurSignaux(async () => {
      throw new Error('fournisseur_http_500 sur https://api.exemple/secret');
    }));
    expect(r.motif).toBe('fournisseur_en_erreur');
    // L'URL est masquée : un message d'erreur de transport peut porter une
    // clé, un identifiant de requête, une adresse de stockage.
    expect(r.detail).not.toContain('https://');
    expect(r.detail).toContain('[url]');
  });

  it('E.3 la réponse est hors contrat', async () => {
    const r = await echec(() => definirFournisseurSignaux(async () => ({
      reponse: { signaux: [{ indice: 0, ...releve() }] }, usage: {}, modele: 'm',
    })));
    expect(r.motif).toBe('indice_manquant');
  });

  it('E.4 la réponse est illisible', async () => {
    const r = await echec(() => definirFournisseurSignaux(async () => ({
      reponse: 'ceci n’est pas du JSON', usage: {}, modele: 'm',
    })));
    expect(r.motif).toBe('reponse_illisible');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('F. Le plan est le même : sans, avec, ou après échec d’enrichissement', () => {
  function clipsDepuis(candidats: readonly CandidatMontage[]): ClipMaterialise[] {
    const coupes = calerCoupes({
      dureeRushSecondes: DUREE_RUSH,
      candidats,
      silences: [],
      audioEtatMesure: 'absente',
      transcriptionRetenue: false,
      parolePresente: false,
      segments: [],
      mots: [],
    });
    return coupes.coupes.map((c) => ({
      rang: c.rang,
      debutSecondes: c.debutSecondes,
      finSecondes: c.finSecondes,
      dureeSecondes: c.dureeSecondes,
      bucket: 'videos',
      cle: `A/autopilote/clips/jeu/rang-0${c.rang}.mp4`,
      octets: 1_000_000,
      debutMesureSecondes: 0,
      dureeMesureeSecondes: c.dureeSecondes,
      signaux: c.signaux,
    }));
  }

  const DEMANDE = {
    format: '9:16' as const,
    dureeCibleSecondes: 20,
    geometrie: { largeur: 1920, hauteur: 1080, fps: 30 },
    dureeRushSecondes: DUREE_RUSH,
  };

  it('F.1 sans / avec / échec produisent le MÊME plan', async () => {
    // A. Sans enrichissement — le chemin générique historique.
    const sans = planifierMontage({ clips: clipsDepuis(candidatsFiges()), ...DEMANDE });

    // B. Avec enrichissement réussi.
    definirFournisseurSignaux(async ({ moments }) => ({
      reponse: {
        signaux: moments.map((m) => ({
          indice: m.indice, ...releve({ personnes: 'foule', marqueVisible: 'oui' }),
        })),
      },
      usage: {}, modele: 'm',
    }));
    const enrichi = await enrichirCandidats({
      candidats: candidatsFiges(), images: imagesPour(POSITIONS),
    });
    expect(enrichi.applique).toBe(true);
    const avec = planifierMontage({ clips: clipsDepuis(enrichi.candidats), ...DEMANDE });

    // C. Enrichissement échoué.
    definirFournisseurSignaux(async () => { throw new Error('boum'); });
    const rate = await enrichirCandidats({
      candidats: candidatsFiges(), images: imagesPour(POSITIONS),
    });
    expect(rate.applique).toBe(false);
    const apresEchec = planifierMontage({ clips: clipsDepuis(rate.candidats), ...DEMANDE });

    expect(avec.resultat).toEqual(sans.resultat);
    expect(apresEchec.resultat).toEqual(sans.resultat);
    expect(sans.resultat?.plans.length).toBeGreaterThan(0);
  });

  it('F.2 les coupes sont identiques, signaux ou non', async () => {
    definirFournisseurSignaux(async ({ moments }) => ({
      reponse: { signaux: moments.map((m) => ({ indice: m.indice, ...releve() })) },
      usage: {}, modele: 'm',
    }));
    const enrichi = await enrichirCandidats({
      candidats: candidatsFiges(), images: imagesPour(POSITIONS),
    });

    const sansSignaux = clipsDepuis(candidatsFiges()).map((c) => ({ ...c, signaux: null }));
    const avecSignaux = clipsDepuis(enrichi.candidats).map((c) => ({ ...c, signaux: null }));
    // Les bornes, l'ordre et les durées ne bougent pas d'un millième.
    expect(avecSignaux).toEqual(sansSignaux);
    // Et sans enrichissement, la coupe porte bien l'absence explicite.
    expect(clipsDepuis(candidatsFiges())[0].signaux).toEqual(SIGNAUX_ABSENTS);
  });
});
