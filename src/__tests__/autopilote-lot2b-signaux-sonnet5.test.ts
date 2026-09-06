// @vitest-environment node
/**
 * LOT 2B — ÉTAPE 4C.2 : L'ADAPTATEUR SIGNAUX FACE À UN MODÈLE RÉCENT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `AUTOPILOT_SIGNAUX_ANTHROPIC_MODEL` est décidé par l'exploitant, et la
 * valeur retenue est un modèle récent. Or ces modèles changent DEUX choses
 * que l'adaptateur n'avait jamais rencontrées :
 *
 *   1. ils REFUSENT les réglages d'échantillonnage (`temperature`, `top_p`,
 *      `top_k`) — une requête qui en porte un est rejetée d'emblée ;
 *   2. ils RAISONNENT par défaut, et le raisonnement arrive dans `content`
 *      AVANT le texte. Un lecteur qui prendrait `content[0]` lirait un bloc
 *      de raisonnement au lieu de la réponse, et n'en dirait rien.
 *
 * Les deux pannes sont muettes : la première fait échouer chaque appel, la
 * seconde rend chaque appel inutile. Dans les deux cas l'enrichissement
 * retombe à `signaux: null`, donc le montage à `m3g-v2`, pendant que chaque
 * appel est facturé.
 *
 * ⚠️ AUCUN APPEL RÉEL. Le transport est injecté et les réponses sont
 * fabriquées : ce fichier vérifie le CONTRAT de l'adaptateur, il ne mesure
 * pas un fournisseur.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  fournisseurSignauxAnthropic,
} from '@/lib/autopilot/analyse/candidat-signaux-anthropic';
import {
  enrichirCandidats, definirFournisseurSignaux,
} from '@/lib/autopilot/analyse/candidat-signaux';
import {
  lireReponseCandidats, type CandidatMontage,
} from '@/lib/autopilot/analyse/candidat-contrat';

const DUREE_RUSH = 40;
const POSITIONS = [5, 14, 30];

const ENV = [
  'AUTOPILOT_SIGNAUX_ANTHROPIC_ENABLED', 'AUTOPILOT_SIGNAUX_ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
] as const;
let sauvegarde: Record<string, string | undefined> = {};

beforeEach(() => {
  definirFournisseurSignaux(null);
  sauvegarde = {};
  for (const k of ENV) { sauvegarde[k] = process.env[k]; delete process.env[k]; }
  process.env.AUTOPILOT_SIGNAUX_ANTHROPIC_ENABLED = 'true';
  process.env.ANTHROPIC_API_KEY = 'cle-de-test';
  // Le modèle réellement retenu par l'exploitant.
  process.env.AUTOPILOT_SIGNAUX_ANTHROPIC_MODEL = 'claude-sonnet-5';
});
afterEach(() => {
  definirFournisseurSignaux(null);
  for (const k of ENV) {
    if (sauvegarde[k] === undefined) delete process.env[k];
    else process.env[k] = sauvegarde[k];
  }
});

function releve(over: Record<string, unknown> = {}) {
  return {
    personnes: 'une', echellePlan: 'plan_moyen', expression: 'neutre',
    objetMisEnAvant: 'non', mainsEnAction: 'non', marqueVisible: 'non',
    texteALEcran: 'non', nettete: 0.8,
    ...over,
  };
}

function candidatsFiges(): CandidatMontage[] {
  const r = lireReponseCandidats({
    candidats: [
      { secondeReference: 5, dureeCibleSecondes: 8, scoreMontage: 90, raison: 'salle pleine' },
      { secondeReference: 14, dureeCibleSecondes: 8, scoreMontage: 80, raison: 'face caméra' },
      { secondeReference: 30, dureeCibleSecondes: 8, scoreMontage: 70, raison: 'mains sur objet' },
    ],
  }, { positions: POSITIONS, dureeSecondes: DUREE_RUSH });
  if (!r.ok) throw new Error(`candidats invalides: ${r.motif}:${r.champ}`);
  return r.valeur;
}

function imagesPour(positions: readonly number[]) {
  return positions.map((seconde) => ({
    seconde, mimeType: 'image/jpeg' as const, data: Buffer.from([0xff, 0xd8]),
  }));
}

const MOMENT = {
  indice: 0, seconde: 14, mimeType: 'image/jpeg' as const, data: Buffer.from([0xff, 0xd8]),
};

/** Un transport qui rend le `content` fourni, tel quel, et note la requête. */
function transportContenu(content: unknown[]) {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  const t = async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ content, usage: { input_tokens: 10, output_tokens: 5 } }),
    };
  };
  return { t, appels };
}

const JSON_VALIDE = JSON.stringify({ signaux: [{ indice: 0, ...releve() }] });

// ═══════════════════════════════════════════════════════════════════════════
describe('A. La REQUÊTE reste acceptable par un modèle récent', () => {
  it('A.1 aucun réglage d’échantillonnage n’est envoyé', async () => {
    const { t, appels } = transportContenu([{ type: 'text', text: JSON_VALIDE }]);
    const f = fournisseurSignauxAnthropic(t);
    expect(f).not.toBeNull();
    await f!({ moments: [MOMENT] });

    const corps = JSON.parse(String(appels[0].init.body));
    // ⚠️ Sur les modèles récents, chacune de ces clés fait REJETER la requête.
    for (const interdit of ['temperature', 'top_p', 'top_k']) {
      expect(Object.keys(corps)).not.toContain(interdit);
    }
  });

  it('A.2 le plafond de jetons laisse la place à un raisonnement', async () => {
    const { t, appels } = transportContenu([{ type: 'text', text: JSON_VALIDE }]);
    await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });

    const corps = JSON.parse(String(appels[0].init.body));
    // Le JSON lui-même tient en quelques centaines de jetons. Le reste est la
    // marge SANS LAQUELLE un modèle qui raisonne par défaut épuiserait le
    // plafond avant d'écrire, et rendrait une réponse tronquée.
    expect(corps.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it('A.3 le schéma ne porte aucune contrainte de tableau', async () => {
    const { t, appels } = transportContenu([{ type: 'text', text: JSON_VALIDE }]);
    await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });

    const corps = JSON.parse(String(appels[0].init.body));
    const tableau = corps.output_config.format.schema.properties.signaux;
    // Les sorties structurées refusent les contraintes de tableau, comme
    // elles refusent `minimum` / `maximum`. `lireReponseSignaux` exige déjà
    // un relevé par image : la contrainte ne se perd pas, elle se déplace.
    for (const interdit of ['minItems', 'maxItems', 'uniqueItems']) {
      expect(Object.keys(tableau)).not.toContain(interdit);
    }
  });

  it('A.4 les images partent en base64 JPEG, dans le format attendu', async () => {
    const { t, appels } = transportContenu([{ type: 'text', text: JSON_VALIDE }]);
    await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });

    const corps = JSON.parse(String(appels[0].init.body));
    const image = corps.messages[0].content.find(
      (b: { type?: string }) => b?.type === 'image',
    );
    expect(image.source.type).toBe('base64');
    expect(image.source.media_type).toBe('image/jpeg');
    expect(typeof image.source.data).toBe('string');
    // Pas de prefill : le dernier message reste `user`.
    expect(corps.messages[corps.messages.length - 1].role).toBe('user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B. La RÉPONSE est lue par TYPE de bloc, jamais par position', () => {
  it('B.1 un `content` de texte seul est lu', async () => {
    const { t } = transportContenu([{ type: 'text', text: JSON_VALIDE }]);
    const sortie = await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });
    expect(sortie.reponse).toBe(JSON_VALIDE);
  });

  it('B.2 un bloc de raisonnement PLACÉ AVANT le texte ne masque pas la réponse', async () => {
    // ⚠️ LA SITUATION EXACTE d'un modèle qui raisonne par défaut. Un lecteur
    // qui prendrait `content[0]` lirait ceci, et rendrait `''`.
    const { t } = transportContenu([
      { type: 'thinking', thinking: 'je regarde les images…' },
      { type: 'text', text: JSON_VALIDE },
    ]);
    const sortie = await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });
    expect(sortie.reponse).toBe(JSON_VALIDE);
  });

  it('B.3 un bloc de raisonnement VIDE, tel qu’il arrive par défaut, ne gêne pas', async () => {
    const { t } = transportContenu([
      { type: 'thinking', thinking: '' },
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'text', text: JSON_VALIDE },
    ]);
    const sortie = await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });
    expect(sortie.reponse).toBe(JSON_VALIDE);
  });

  it('B.4 une réponse SANS bloc texte ne lève pas — elle rend une chaîne vide', async () => {
    // Le cas d'un refus, ou d'une sortie coupée avant le texte.
    const { t } = transportContenu([{ type: 'thinking', thinking: 'x' }]);
    const sortie = await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });
    expect(sortie.reponse).toBe('');
  });

  it('B.5 le modèle rapporté est le modèle CONFIGURÉ, pas celui de la réponse', async () => {
    const { t } = transportContenu([{ type: 'text', text: JSON_VALIDE }]);
    const sortie = await fournisseurSignauxAnthropic(t)!({ moments: [MOMENT] });
    expect(sortie.modele).toBe('claude-sonnet-5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C. Une sortie inexploitable dégrade SANS casser', () => {
  async function avecReponse(reponse: unknown) {
    const figes = candidatsFiges();
    definirFournisseurSignaux(async () => ({
      reponse, usage: { inputTokens: 7, outputTokens: 3 }, modele: 'claude-sonnet-5',
    }));
    const r = await enrichirCandidats({
      candidats: figes, images: imagesPour(POSITIONS),
    });
    return { figes, r };
  }

  it('C.1 une sortie structurée VALIDE attache les relevés', async () => {
    const { r } = await avecReponse({
      signaux: [0, 1, 2].map((indice) => ({ indice, ...releve() })),
    });
    expect(r.applique).toBe(true);
    expect(r.motif).toBeNull();
    for (const c of r.candidats) expect(c.signaux).not.toBeNull();
  });

  it('C.2 une sortie TRONQUÉE n’attache rien, et ne lève pas', async () => {
    // Ce que rend un `max_tokens` atteint : du JSON coupé en plein milieu.
    const { figes, r } = await avecReponse('{"signaux":[{"indice":0,"personnes":');
    expect(r.applique).toBe(false);
    expect(r.motif).not.toBeNull();
    for (const c of r.candidats) expect(c.signaux).toBeNull();
    // ⚠️ ET LES CANDIDATS SONT INTACTS : la sélection ne dépend pas du relevé.
    expect(r.candidats.map((c) => c.secondeReference))
      .toEqual(figes.map((c) => c.secondeReference));
    expect(r.candidats.map((c) => c.scoreMontage))
      .toEqual(figes.map((c) => c.scoreMontage));
  });

  it('C.3 une sortie HORS CONTRAT n’attache rien, et ne lève pas', async () => {
    const { r } = await avecReponse({ signaux: [{ indice: 0, inconnu: 'x' }] });
    expect(r.applique).toBe(false);
    for (const c of r.candidats) expect(c.signaux).toBeNull();
  });

  it('C.4 un fournisseur qui LÈVE dégrade de la même façon', async () => {
    const figes = candidatsFiges();
    definirFournisseurSignaux(async () => { throw new Error('fournisseur_http_400'); });
    const r = await enrichirCandidats({
      candidats: figes, images: imagesPour(POSITIONS),
    });
    expect(r.applique).toBe(false);
    for (const c of r.candidats) expect(c.signaux).toBeNull();
  });
});
