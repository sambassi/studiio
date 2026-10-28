// @vitest-environment node
//
// ⚠️ ENVIRONNEMENT NODE OBLIGATOIRE, pour la meme raison que
// `cinema-generation-reelle.test.ts` : les tests qui font rapatrier un media LISENT un
// vrai fichier et passent par `Buffer` / `Uint8Array` natifs, que `jsdom` remplace par des
// globaux differents — `bytes instanceof Uint8Array` y est alors toujours faux.
/**
 * CINEMA IA — CONNECTEUR HIGGSFIELD : branche, eteint, et jamais appele par erreur.
 *
 * ⚠️ AUCUN APPEL SORTANT ICI. `fetch` est remplace dans CHAQUE test qui touche au reseau,
 * et plusieurs tests verifient explicitement COMBIEN d'appels sont partis et VERS QUOI :
 * un refus de budget ne doit laisser passer que l'estimation, jamais une soumission.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync, statSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  higgsfieldActif, higgsfieldChoisi, higgsfieldConfigure, estimerUsd, dureeVideoAutorisee,
  urlHiggsfieldSure, FOURNISSEUR_HIGGSFIELD_IMAGE, FOURNISSEUR_HIGGSFIELD_VIDEO,
  ID_HIGGSFIELD_IMAGE, ID_HIGGSFIELD_VIDEO, ID_HIGGSFIELD_VIDEO_HAPPYHORSE,
  MODELE_IMAGE_HF, MODELE_VIDEO_HF, BASE_HIGGSFIELD, DUREES_VIDEO_HF, TAILLE_MAX_RAPATRIEMENT,
} from '@/lib/cinema/generation/higgsfield';
import { fournisseurServeur, modeGenerationAffiche } from '@/lib/cinema/garde';
import { ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO } from '@/lib/cinema/generation/replicate';
import {
  tarifGeneration, devisGeneration, verifierPlafond, PLAFOND_USD_PAR_FILM_DEFAUT,
} from '@/lib/cinema/generation/couts';
import { executer } from '@/lib/cinema/rendu-local';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const ENV0 = { ...process.env };
const src = (p: string) => readFileSync(p, 'utf8');

/** Les trois conditions reunies, pour les tests qui appellent reellement le connecteur. */
const CLES = {
  CINEMA_FOURNISSEUR: 'higgsfield',
  CINEMA_GENERATION_REELLE: 'true',
  HIGGSFIELD_API_KEY_ID: 'k-id',
  HIGGSFIELD_API_KEY_SECRET: 'k-secret',
};

afterEach(() => { process.env = { ...ENV0 }; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Une reponse JSON simulee, de la forme minimale que lit le connecteur. */
function reponse(statut: number, corps: unknown) {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: async () => corps,
    // > 1024 octets : passe le controle de taille du rapatriement, lu en flux comme en vrai.
    get body() { return new Response(new Uint8Array(4096)).body; },
  } as unknown as Response;
}

/** Un media binaire simule (pour le rapatriement). */
function reponseMedia() {
  return new Response(new Uint8Array(4096), { status: 200 });
}

/** Un flux de `n` morceaux de `taille` octets, SANS Content-Length ; compte ce qui a ete lu. */
function fluxSansLongueur(n: number, taille: number) {
  const morceau = new Uint8Array(taille);
  const compteur = { lus: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (compteur.lus >= n) { c.close(); return; }
      compteur.lus++;
      c.enqueue(morceau);
    },
  }, { highWaterMark: 0 }); // aucun pre-chargement : `lus` ne compte que ce qui a ete demande

  return { reponse: new Response(body, { status: 200 }), compteur };
}

describe('activation : ETEINT par defaut, et par TROIS conditions', () => {
  it('rien du tout : eteint', () => {
    expect(higgsfieldActif(env({}))).toBe(false);
  });

  it('chaque condition seule ne suffit pas', () => {
    expect(higgsfieldActif(env({ CINEMA_FOURNISSEUR: 'higgsfield' }))).toBe(false);
    expect(higgsfieldActif(env({ CINEMA_GENERATION_REELLE: 'true' }))).toBe(false);
    expect(higgsfieldActif(env({ HIGGSFIELD_API_KEY_ID: 'a', HIGGSFIELD_API_KEY_SECRET: 'b' }))).toBe(false);
    // Les deux premieres sans les cles : toujours eteint.
    expect(higgsfieldActif(env({ CINEMA_FOURNISSEUR: 'higgsfield', CINEMA_GENERATION_REELLE: 'true' }))).toBe(false);
    // Les cles et l'interrupteur, mais SANS le choix explicite du fournisseur.
    expect(higgsfieldActif(env({ ...CLES, CINEMA_FOURNISSEUR: '' }))).toBe(false);
    // Une seule cle sur les deux.
    expect(higgsfieldActif(env({ ...CLES, HIGGSFIELD_API_KEY_SECRET: '' }))).toBe(false);
  });

  it('les trois conditions reunies : allume', () => {
    expect(higgsfieldActif(env(CLES))).toBe(true);
    for (const d of ['true', 'TRUE', ' true ', '1']) {
      expect(higgsfieldActif(env({ ...CLES, CINEMA_GENERATION_REELLE: d }))).toBe(true);
    }
    for (const f of ['higgsfield', 'HIGGSFIELD', ' Higgsfield ']) {
      expect(higgsfieldActif(env({ ...CLES, CINEMA_FOURNISSEUR: f }))).toBe(true);
    }
  });

  it('une decision approchante ne suffit pas', () => {
    for (const d of ['false', '0', 'oui', 'on', 'yes', '']) {
      expect(higgsfieldActif(env({ ...CLES, CINEMA_GENERATION_REELLE: d }))).toBe(false);
    }
    for (const f of ['replicate', 'higgs', 'higgsfield-ai', 'true']) {
      expect(higgsfieldActif(env({ ...CLES, CINEMA_FOURNISSEUR: f }))).toBe(false);
    }
  });

  it('les deux conditions se lisent separement (diagnostic)', () => {
    expect(higgsfieldChoisi(env({ CINEMA_FOURNISSEUR: 'higgsfield' }))).toBe(true);
    expect(higgsfieldConfigure(env({ HIGGSFIELD_API_KEY_ID: 'a', HIGGSFIELD_API_KEY_SECRET: 'b' }))).toBe(true);
    expect(higgsfieldConfigure(env({ HIGGSFIELD_API_KEY_ID: '  ', HIGGSFIELD_API_KEY_SECRET: 'b' }))).toBe(false);
  });

  it('les fournisseurs declares restent eteints sans les trois conditions', () => {
    process.env = { ...ENV0 } as NodeJS.ProcessEnv;
    delete process.env.CINEMA_FOURNISSEUR;
    expect(FOURNISSEUR_HIGGSFIELD_IMAGE.actif).toBe(false);
    expect(FOURNISSEUR_HIGGSFIELD_VIDEO.actif).toBe(false);
  });
});

describe('le SERVEUR choisit le fournisseur — et Replicate reste le defaut', () => {
  it('sans CINEMA_FOURNISSEUR : Replicate, exactement comme avant ce lot', () => {
    const e = env({ CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: 'r8_x' });
    expect(fournisseurServeur('image', 'u1', e)).toEqual({ id: ID_REPLICATE_IMAGE, mode: 'reelle' });
    expect(fournisseurServeur('video', 'u1', e)).toEqual({ id: ID_REPLICATE_VIDEO, mode: 'reelle' });
  });

  it('CINEMA_FOURNISSEUR=higgsfield + cles : Higgsfield', () => {
    const e = env({ ...CLES, REPLICATE_API_TOKEN: 'r8_x' });
    expect(fournisseurServeur('image', 'u1', e)).toEqual({ id: ID_HIGGSFIELD_IMAGE, mode: 'reelle' });
    expect(fournisseurServeur('video', 'u1', e)).toEqual({ id: ID_HIGGSFIELD_VIDEO, mode: 'reelle' });
    expect(modeGenerationAffiche('u1', e)).toBe('reelle');
  });

  it('Higgsfield choisi mais sans cles : on ne retombe pas sur Replicate par surprise… sauf si Replicate est lui-meme allume', () => {
    // Sans cles Higgsfield ET sans jeton Replicate : aucune generation reelle.
    expect(fournisseurServeur('image', 'u1', env({ CINEMA_FOURNISSEUR: 'higgsfield', CINEMA_GENERATION_REELLE: 'true' }))).toBe(null);
    // Avec le jeton Replicate, le comportement d'avant ce lot continue de s'appliquer.
    expect(fournisseurServeur('image', 'u1', env({
      CINEMA_FOURNISSEUR: 'higgsfield', CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: 'r8_x',
    }))).toEqual({ id: ID_REPLICATE_IMAGE, mode: 'reelle' });
  });

  it('aucun compte autorise : rien, meme avec les trois conditions', () => {
    const e = env({ ...CLES, CINEMA_GENERATION_REELLE_COMPTES: '' });
    expect(fournisseurServeur('image', 'u1', e)).toBe(null);
    expect(fournisseurServeur('image', null, e)).toBe(null);
  });
});

describe('tarifs : des bornes verifiees, et un modele volontairement refuse', () => {
  it('l’image Soul 2 est tarifee, avec sa source officielle datee', () => {
    const t = tarifGeneration(ID_HIGGSFIELD_IMAGE, 'image');
    expect(t?.usdParUnite).toBe(0.0032);
    expect(t?.actif).toBe(true);
    expect(t?.source).toContain('higgsfield.ai');
    expect(t?.source).toContain('2026-10-28');
    expect(t?.source).toContain('estimate');
  });

  it('la video Kling 2.5 est bornee au PIRE CAS (10 s)', () => {
    const t = tarifGeneration(ID_HIGGSFIELD_VIDEO, 'video');
    // 0,042 $/s x 10 s : la borne haute du schema, jamais la duree la plus courte.
    expect(t?.usdParUnite).toBe(0.42);
    expect(t?.usdParUnite).toBe(Math.round(0.042 * 10 * 1000) / 1000);
    expect(t?.source).toContain('x 10 s au pire');
  });

  it('Happy Horse est declare SANS tarif : le devis le refuse', () => {
    const t = tarifGeneration(ID_HIGGSFIELD_VIDEO_HAPPYHORSE, 'video');
    expect(t?.usdParUnite).toBe(null);
    expect(t?.actif).toBe(false);
    const devis = devisGeneration(ID_HIGGSFIELD_VIDEO_HAPPYHORSE, [{ planId: 'p1', operations: ['video'] }]);
    expect(devis.totalUsd).toBe(null);
    // Un cout inconnu est refuse par le plafond, quel que soit le plafond.
    expect(verifierPlafond({ dejaDepenseUsd: 0, coutProposeUsd: devis.totalUsd, plafondUsd: 1000 }).autorise).toBe(false);
  });

  it('le tarif de Kling n’est JAMAIS applique a Happy Horse', () => {
    const kling = tarifGeneration(ID_HIGGSFIELD_VIDEO, 'video');
    const happy = tarifGeneration(ID_HIGGSFIELD_VIDEO_HAPPYHORSE, 'video');
    expect(happy?.usdParUnite).not.toBe(kling?.usdParUnite);
    expect(happy?.source).toContain('non publie');
  });

  it('le plafond par film n’est PAS releve par ce lot', () => {
    expect(PLAFOND_USD_PAR_FILM_DEFAUT).toBe(2);
    // Consequence assumee, et non relevee en douce : a 0,42 $ la video, un film n'en passe
    // QUE QUATRE (4 x 0,42 = 1,68 $) ; la cinquieme depasse les 2 $ et est refusee.
    expect(verifierPlafond({ dejaDepenseUsd: 1.26, coutProposeUsd: 0.42, plafondUsd: 2 }).autorise).toBe(true);
    expect(verifierPlafond({ dejaDepenseUsd: 1.68, coutProposeUsd: 0.42, plafondUsd: 2 }).autorise).toBe(false);
  });
});

describe('durees : seules celles du schema officiel', () => {
  it('le schema n’accepte que 5 s ou 10 s', () => {
    expect([...DUREES_VIDEO_HF]).toEqual([5, 10]);
  });

  it('une duree de plan est ramenee a une duree ACCEPTEE, jamais inventee', () => {
    expect(dureeVideoAutorisee(1)).toBe(5);
    expect(dureeVideoAutorisee(5)).toBe(5);
    expect(dureeVideoAutorisee(5.5)).toBe(10);
    expect(dureeVideoAutorisee(10)).toBe(10);
    expect(dureeVideoAutorisee(45)).toBe(10); // jamais au-dela du maximum du schema
  });
});

describe('URL rendues par le fournisseur : jamais suivies a l’aveugle', () => {
  it('seul l’hote officiel, et seulement en https', () => {
    expect(urlHiggsfieldSure(`${BASE_HIGGSFIELD}/requests/abc/status`)).toContain('api.higgsfield.ai');
    expect(urlHiggsfieldSure('http://api.higgsfield.ai/requests/abc/status')).toBe(null);
    expect(urlHiggsfieldSure('https://api.higgsfield.ai.evil.tld/requests/abc')).toBe(null);
    expect(urlHiggsfieldSure('https://169.254.169.254/latest/meta-data')).toBe(null);
    expect(urlHiggsfieldSure('pas une url')).toBe(null);
    expect(urlHiggsfieldSure(null)).toBe(null);
    expect(urlHiggsfieldSure(42)).toBe(null);
  });
});

describe('estimation du prix : lue, ou refusee — jamais supposee', () => {
  beforeEach(() => { process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv; });

  it('le champ « usd » est lu, en chaine comme en nombre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponse(200, { usd: '0.094' })));
    expect(await estimerUsd('m', {})).toEqual({ ok: true, usd: 0.094 });
    vi.stubGlobal('fetch', vi.fn(async () => reponse(200, { usd: 0.21 })));
    expect(await estimerUsd('m', {})).toEqual({ ok: true, usd: 0.21 });
  });

  it('une forme inattendue est un prix INCONNU, pas un prix nul', async () => {
    for (const corps of [{}, { usd: null }, { usd: 'gratuit' }, { usd: -1 }, null]) {
      vi.stubGlobal('fetch', vi.fn(async () => reponse(200, corps)));
      const r = await estimerUsd('m', {});
      expect(r.ok).toBe(false);
    }
  });

  it('une erreur HTTP est rapportee avec son detail, sans etre interpretee', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponse(403, { detail: 'Insufficient balance' })));
    const r = await estimerUsd('m', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('Insufficient balance');
  });

  it('l’estimation part sur /estimate/<modele>, avec les cles en en-tete', async () => {
    const f = vi.fn(async () => reponse(200, { usd: '0.01' }));
    vi.stubGlobal('fetch', f);
    await estimerUsd(MODELE_IMAGE_HF, { prompt: 'x' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_HIGGSFIELD}/estimate/${MODELE_IMAGE_HF}`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Key k-id:k-secret');
  });
});

describe('aucune soumission payante sans estimation autorisee', () => {
  beforeEach(() => { process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv; });

  const demandeImage = {
    promptPlan: 'un plan', promptConstruit: 'a cinematic shot',
    personnages: [], format: '9:16' as const, graine: 7,
  };

  it('estimation SUPERIEURE au budget : refus, et AUCUN appel de generation', async () => {
    const f = vi.fn(async () => reponse(200, { usd: '9.99' }));
    vi.stubGlobal('fetch', f);
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.jamaisEnvoye).toBe(true);
      expect(r.erreur).toContain('9.9900');
      expect(r.erreur).toContain('budget autorise');
    }
    // UN SEUL appel, et c'est l'estimation : rien n'a ete soumis.
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('/estimate/');
  });

  it('estimation illisible : refus, et AUCUN appel de generation', async () => {
    const f = vi.fn(async () => reponse(500, { detail: 'boom' }));
    vi.stubGlobal('fetch', f);
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.jamaisEnvoye).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('estimation dans le budget : la soumission part, avec une cle d’idempotence', async () => {
    const appels: Array<[string, RequestInit | undefined]> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      appels.push([url, init]);
      if (url.includes('/estimate/')) return reponse(200, { usd: '0.002' });
      if (url.endsWith(MODELE_IMAGE_HF)) {
        return reponse(200, { status: 'queued', request_id: 'r1', status_url: `${BASE_HIGGSFIELD}/requests/r1/status` });
      }
      if (url.includes('/requests/r1/status')) {
        return reponse(200, { status: 'completed', images: [{ url: 'https://cdn.higgsfield.ai/out.jpg' }] });
      }
      return reponseMedia();
    });
    vi.stubGlobal('fetch', f);

    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(statSync(r.fichier).size).toBeGreaterThan(1024);
      expect(r.nomSuggere).toBe('higgsfield-7.jpg');
      rmSync(r.fichier, { force: true });
    }
    const soumission = appels.find(([u]) => u === `${BASE_HIGGSFIELD}/${MODELE_IMAGE_HF}`);
    expect(soumission).toBeTruthy();
    const entetes = soumission![1]!.headers as Record<string, string>;
    expect(entetes['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    // Le corps porte le format du film : pas de defaut 4:3 silencieux.
    expect(JSON.parse(String(soumission![1]!.body))).toMatchObject({ aspect_ratio: '9:16', prompt: 'a cinematic shot' });
  });

  it('un 5xx sur la soumission est rejoue UNE fois avec la MEME cle, puis rendu « incertain »', async () => {
    const cles: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/estimate/')) return reponse(200, { usd: '0.002' });
      cles.push((init!.headers as Record<string, string>)['Idempotency-Key']);
      return reponse(500, { detail: 'server error' });
    });
    vi.stubGlobal('fetch', f);
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.incertain).toBe(true);
      expect(r.jamaisEnvoye).toBeFalsy();
    }
    expect(cles).toHaveLength(2);
    expect(cles[0]).toBe(cles[1]); // la MEME cle : pas de doublon facture
  });

  it('un refus CLAIR (422, 403, 429) n’est pas rejoue et ne facture rien', async () => {
    for (const statut of [400, 403, 422, 429]) {
      const f = vi.fn(async (url: string) => (url.includes('/estimate/')
        ? reponse(200, { usd: '0.002' })
        : reponse(statut, { detail: 'refuse' })));
      vi.stubGlobal('fetch', f);
      const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.jamaisEnvoye).toBe(true);
      // Estimation + UNE seule soumission : aucun rejeu.
      expect(f).toHaveBeenCalledTimes(2);
    }
  });

  it('un suivi hors de l’hote officiel n’est jamais interroge', async () => {
    const f = vi.fn(async (url: string) => (url.includes('/estimate/')
      ? reponse(200, { usd: '0.002' })
      : reponse(200, { status: 'queued', request_id: 'r1', status_url: 'https://evil.tld/requests/r1/status' })));
    vi.stubGlobal('fetch', f);
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.incertain).toBe(true); // accepte chez eux, plus suivi chez nous
    const interroges = f.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(interroges.some((u) => u.includes('evil.tld'))).toBe(false);
  });
});

describe('issues terminales : ce que le fournisseur s’engage a ne pas facturer', () => {
  beforeEach(() => { process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv; });

  const demandeImage = {
    promptPlan: 'p', promptConstruit: 'a shot', personnages: [], format: '16:9' as const, graine: 1,
  };

  const avecStatut = (statutGeneration: Record<string, unknown>) => vi.fn(async (url: string) => {
    if (url.includes('/estimate/')) return reponse(200, { usd: '0.002' });
    if (url.endsWith(MODELE_IMAGE_HF)) {
      return reponse(200, { status: 'queued', request_id: 'r1', status_url: `${BASE_HIGGSFIELD}/requests/r1/status` });
    }
    return reponse(200, statutGeneration);
  });

  it('`failed` : non facture', async () => {
    vi.stubGlobal('fetch', avecStatut({ status: 'failed', error: 'Generation failed' }));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.nonFacture).toBe(true);
      expect(r.incertain).toBeFalsy();
      expect(r.erreur).toContain('Generation failed');
    }
  });

  it('`nsfw` : non facture', async () => {
    vi.stubGlobal('fetch', avecStatut({ status: 'nsfw' }));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.nonFacture).toBe(true);
  });

  it('`canceled` : non facture', async () => {
    vi.stubGlobal('fetch', avecStatut({ status: 'canceled' }));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.nonFacture).toBe(true);
  });

  it('`completed` sans media exploitable : echec FACTURE (rien n’est suppose rembourse)', async () => {
    vi.stubGlobal('fetch', avecStatut({ status: 'completed', images: [] }));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.nonFacture).toBeFalsy();
      expect(r.jamaisEnvoye).toBeFalsy();
    }
  });
});

describe('expiration de l’attente : annulation officielle, et rapatriement borne', () => {
  beforeEach(() => { process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv; });
  afterEach(() => { vi.useRealTimers(); });

  const demandeImage = {
    promptPlan: 'p', promptConstruit: 'a shot', personnages: [], format: '16:9' as const, graine: 1,
  };

  const UUID = '3f2b8c1e-9a4d-4e7f-b6a1-0c5d2e8f9a71';

  /** Une demande qui reste `queued` jusqu'a l'echeance ; l'annulation rend `statutAnnulation`. */
  const enFileSansFin = (statutAnnulation: number, requestId = UUID) => vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/estimate/')) return reponse(200, { usd: '0.002' });
    if (url.endsWith(MODELE_IMAGE_HF)) {
      return reponse(200, { status: 'queued', request_id: requestId, status_url: `${BASE_HIGGSFIELD}/requests/r1/status` });
    }
    if (url.endsWith('/cancel')) {
      expect(init?.method).toBe('POST');
      return reponse(statutAnnulation, null);
    }
    return reponse(200, { status: 'queued' });
  });

  async function genererJusquAEcheance() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const p = FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    await vi.advanceTimersByTimeAsync(200_000);
    return p;
  }

  it('encore en file : annulee (202), donc NON facturee', async () => {
    const f = enFileSansFin(202);
    vi.stubGlobal('fetch', f);
    const r = await genererJusquAEcheance();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.nonFacture).toBe(true);
      expect(r.incertain).toBeFalsy();
    }
    const annulations = f.mock.calls.filter(([u]) => String(u).endsWith('/cancel'));
    expect(annulations).toHaveLength(1);
    expect(annulations[0][0]).toBe(`${BASE_HIGGSFIELD}/requests/${UUID}/cancel`);
  });

  it('une reponse d’annulation non confirmee (5xx, reseau) ne libere RIEN', async () => {
    vi.stubGlobal('fetch', enFileSansFin(503));
    const r = await genererJusquAEcheance();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.incertain).toBe(true);
      expect(r.nonFacture).toBeFalsy();
    }
  });

  it('deja demarree (400) : la depense reste INCERTAINE, jamais liberee', async () => {
    vi.stubGlobal('fetch', enFileSansFin(400));
    const r = await genererJusquAEcheance();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.incertain).toBe(true);
      expect(r.nonFacture).toBeFalsy();
    }
  });

  it('un request_id hors du format UUID n’est jamais place dans un chemin', async () => {
    for (const id of ['../../estimate/x', 'r1', `${UUID}/../x`]) {
      const f = enFileSansFin(202, id);
      vi.stubGlobal('fetch', f);
      const r = await genererJusquAEcheance();
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.incertain, id).toBe(true);
      expect(f.mock.calls.some(([u]) => String(u).endsWith('/cancel')), id).toBe(false);
      vi.useRealTimers();
    }
  });

  /** Termine la generation et sert `media` au rapatriement. */
  const termineeAvec = (media: () => Response) => vi.fn(async (url: string) => {
    if (url.includes('/estimate/')) return reponse(200, { usd: '0.002' });
    if (url.endsWith(MODELE_IMAGE_HF)) {
      return reponse(200, { status: 'queued', request_id: UUID, status_url: `${BASE_HIGGSFIELD}/requests/${UUID}/status` });
    }
    if (url.startsWith(`${BASE_HIGGSFIELD}/requests/`)) {
      return reponse(200, { status: 'completed', images: [{ url: 'https://cdn.example/i.jpg' }] });
    }
    return media();
  });

  it('un media annonce trop volumineux est refuse sans etre lu', async () => {
    const { reponse: media, compteur } = fluxSansLongueur(4, 1024);
    media.headers.set('content-length', String(500 * 1024 * 1024));
    vi.stubGlobal('fetch', termineeAvec(() => media));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('trop volumineux');
    expect(compteur.lus).toBe(0);
  });

  it('SANS Content-Length : la reception s’arrete des que le plafond est franchi', async () => {
    const morceau = 16 * 1024 * 1024;
    const total = Math.ceil(TAILLE_MAX_RAPATRIEMENT / morceau) + 20; // ~520 Mo proposes
    const { reponse: media, compteur } = fluxSansLongueur(total, morceau);
    vi.stubGlobal('fetch', termineeAvec(() => media));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('trop volumineux');
    // Arrete au premier morceau qui franchit 200 Mo, pas au bout du flux.
    expect(compteur.lus).toBeLessThanOrEqual(Math.ceil(TAILLE_MAX_RAPATRIEMENT / morceau) + 2);
    expect(compteur.lus).toBeLessThan(total);
  });

  it('SANS Content-Length et sous le plafond : le media est rapatrie en entier', async () => {
    const { reponse: media, compteur } = fluxSansLongueur(3, 2048);
    vi.stubGlobal('fetch', termineeAvec(() => media));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage(demandeImage);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(statSync(r.fichier).size).toBe(3 * 2048);
      rmSync(r.fichier, { force: true });
    }
    expect(compteur.lus).toBe(3);
  });
});

describe('video : l’image source est verifiee AVANT tout appel', () => {
  let dossier: string;
  beforeEach(() => {
    process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv;
    dossier = mkdtempSync(join(tmpdir(), 'hf-test-'));
  });
  afterEach(() => rmSync(dossier, { recursive: true, force: true }));

  const demandeVideo = (fichier: string) => ({
    fichierImageSource: fichier, prompt: 'slow push in', dureeS: 4, format: '9:16' as const, graine: 3,
  });

  it('un fichier qui n’est pas une image : refus, AUCUN appel reseau', async () => {
    const f = vi.fn(async () => reponse(200, { usd: '0.01' }));
    vi.stubGlobal('fetch', f);
    const bidon = join(dossier, 'pas-une-image.png');
    require('fs').writeFileSync(bidon, 'ceci n’est pas une image');
    const r = await FOURNISSEUR_HIGGSFIELD_VIDEO.genererVideo(demandeVideo(bidon));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.jamaisEnvoye).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('un prompt vide : refus, AUCUN appel reseau', async () => {
    const f = vi.fn(async () => reponse(200, { usd: '0.01' }));
    vi.stubGlobal('fetch', f);
    const image = join(dossier, 'src.png');
    const ff = await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', '-y', image], { timeoutMs: 20_000 });
    expect(ff.code).toBe(0);
    const r = await FOURNISSEUR_HIGGSFIELD_VIDEO.genererVideo({ ...demandeVideo(image), prompt: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.jamaisEnvoye).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('le parcours complet : televersement, estimation sur le corps REEL, soumission, suivi', async () => {
    const image = join(dossier, 'src.png');
    const ff = await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', '-y', image], { timeoutMs: 20_000 });
    expect(ff.code).toBe(0);

    const appels: Array<[string, RequestInit | undefined]> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      appels.push([url, init]);
      if (url.endsWith('/files/generate-upload-url')) {
        return reponse(200, {
          upload_url: 'https://stockage.higgsfield.ai/presigne?sig=1',
          public_url: 'https://stockage.higgsfield.ai/public/src.png',
          upload_headers: { 'x-amz-tagging': 'retention=temporary' },
        });
      }
      if (url.includes('/presigne')) return reponse(200, {});
      if (url.includes('/estimate/')) return reponse(200, { usd: '0.21' });
      if (url.endsWith(MODELE_VIDEO_HF)) {
        return reponse(200, { status: 'queued', request_id: 'v1', status_url: `${BASE_HIGGSFIELD}/requests/v1/status` });
      }
      if (url.includes('/requests/v1/status')) {
        return reponse(200, { status: 'completed', video: { url: 'https://cdn.higgsfield.ai/out.mp4' } });
      }
      return reponseMedia();
    });
    vi.stubGlobal('fetch', f);

    const r = await FOURNISSEUR_HIGGSFIELD_VIDEO.genererVideo(demandeVideo(image));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nomSuggere).toBe('higgsfield-3.mp4');
      rmSync(r.fichier, { force: true });
    }

    // L'estimation porte le MEME corps que la soumission — y compris l'URL reelle de l'image.
    const estimation = appels.find(([u]) => u.includes('/estimate/'))!;
    const soumission = appels.find(([u]) => u === `${BASE_HIGGSFIELD}/${MODELE_VIDEO_HF}`)!;
    expect(JSON.parse(String(estimation[1]!.body))).toEqual(JSON.parse(String(soumission[1]!.body)));
    // La duree envoyee est une duree ACCEPTEE par le schema (4 s demandees → 5 s).
    expect(JSON.parse(String(soumission[1]!.body))).toMatchObject({ duration: 5, image_url: 'https://stockage.higgsfield.ai/public/src.png' });
    // Aucune cle n'est envoyee a l'URL presignee.
    const depot = appels.find(([u]) => u.includes('/presigne'))!;
    expect(JSON.stringify(depot[1]!.headers)).not.toContain('k-secret');
  });

  it('televersement refuse : refus AVANT estimation et AVANT soumission', async () => {
    const image = join(dossier, 'src.png');
    await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', '-y', image], { timeoutMs: 20_000 });
    const f = vi.fn(async (url: string) => (url.endsWith('/files/generate-upload-url')
      ? reponse(403, { detail: 'Insufficient balance' })
      : reponse(200, { usd: '0.21' })));
    vi.stubGlobal('fetch', f);
    const r = await FOURNISSEUR_HIGGSFIELD_VIDEO.genererVideo(demandeVideo(image));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.jamaisEnvoye).toBe(true);
    const urls = f.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(urls.some((u) => u.includes('/estimate/'))).toBe(false);
    expect(urls.some((u) => u === `${BASE_HIGGSFIELD}/${MODELE_VIDEO_HF}`)).toBe(false);
  });
});

describe('chacun son metier, et aucun nom de fournisseur a l’ecran', () => {
  it('le fournisseur image refuse une video, et l’inverse', async () => {
    const image = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererVideo({
      fichierImageSource: '/x.png', prompt: 'p', dureeS: 5, format: '9:16', graine: 1,
    });
    expect(image.ok).toBe(false);
    const video = await FOURNISSEUR_HIGGSFIELD_VIDEO.genererImage({
      promptPlan: 'p', promptConstruit: 'p', personnages: [], format: '9:16', graine: 1,
    });
    expect(video.ok).toBe(false);
  });

  it('le libelle montre a l’ecran ne nomme pas le fournisseur externe', () => {
    for (const f of [FOURNISSEUR_HIGGSFIELD_IMAGE, FOURNISSEUR_HIGGSFIELD_VIDEO]) {
      expect(f.libelle.toLowerCase()).not.toContain('higgsfield');
    }
    // Et la page Cinema IA ne l'importe ni ne le nomme.
    const page = src('src/app/dashboard/cinema/page.tsx');
    expect(page.toLowerCase()).not.toContain('higgsfield');
    expect(page.toLowerCase()).not.toContain('replicate');
  });
});
