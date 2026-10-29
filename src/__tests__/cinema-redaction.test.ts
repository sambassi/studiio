// @vitest-environment node
/**
 * CINEMA IA — AIDE A LA REDACTION : le MEME moteur de texte que « Creer », le contexte du
 * film dans le prompt, et aucune generation ni aucun credit.
 *
 * Anthropic est double : on lit ce que la route lui envoie. Aucun appel reel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId, email: 'x@example.org' } } : null),
}));
process.env.CINEMA_ACTIVE = 'true';

import {
  ACTIONS_REDACTION, actionRedaction, estActionRedaction, promptRedaction,
  diagnostiquerProposition, nettoyerContexte, HISTOIRE_MAX, PERSONNAGES_MAX,
} from '@/lib/cinema/redaction';
import { MODELE_TEXTE_PRIMAIRE, MODELE_TEXTE_REPLI, extraireTexte, estErreurFacturation } from '@/lib/ia/texte';
import * as route from '@/app/api/cinema/redaction/route';

const ENV = { ...process.env };
/** Ce qui part REELLEMENT vers le fournisseur. */
let envois: Array<{ url: string; entetes: Record<string, string>; corps: Record<string, unknown> }>;
let reponses: Array<{ ok: boolean; status: number; texte?: string; erreur?: string }>;

const CASTING = [
  { nom: 'Ada', role: 'protagoniste', description: 'cheveux courts argentes, combinaison blanche' },
  { nom: 'Orion', role: 'droide', description: 'chassis argent, un oeil bleu' },
];
const CONTEXTE = { histoire: 'Ada se reveille seule dans la station.', personnages: CASTING, styleCinema: 'scifi' as const, nbScenes: 4, format: '16:9', titre: 'Signal perdu' };
const REPONSE_OK = 'Ada ouvre les yeux dans le couloir bleu. Orion attend devant le sas. Ada dit : « On y va, prepare la navette ». La navette decolle dans la vapeur froide.';

beforeEach(() => {
  session.userId = 'u1';
  process.env = { ...ENV, CINEMA_ACTIVE: 'true', ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv;
  envois = [];
  reponses = [{ ok: true, status: 200, texte: JSON.stringify({ text: REPONSE_OK }) }];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    envois.push({ url: String(url), entetes: (init?.headers ?? {}) as Record<string, string>, corps: JSON.parse(String(init?.body ?? '{}')) });
    const r = reponses.shift() ?? reponses[0];
    return {
      ok: r.ok, status: r.status,
      json: async () => (r.ok ? { content: [{ type: 'text', text: r.texte }] } : {}),
      text: async () => r.erreur ?? '',
    } as unknown as Response;
  }));
});
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); });

const post = async (corps: unknown) => {
  const res = await route.POST({ json: async () => corps } as never);
  return { status: res.status, body: await res.json() as Record<string, any> };
};
const prompt = (i = 0) => String((envois[i].corps.messages as Array<{ content: string }>)[0].content);

describe('UN SEUL moteur de texte : celui de Studiio, partage avec « Creer »', () => {
  it('la route n’ouvre aucun fournisseur : elle appelle le moteur partage (meme URL, meme cle, memes modeles)', async () => {
    await post({ action: 'rediger', ...CONTEXTE });
    expect(envois).toHaveLength(1);
    expect(envois[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(envois[0].entetes['x-api-key']).toBe('sk-test');
    expect(envois[0].entetes['anthropic-version']).toBe('2023-06-01');
    expect(envois[0].corps.model).toBe(MODELE_TEXTE_PRIMAIRE);
  });

  it('le code de la route ne contient NI appel HTTP NI cle de modele en dur (rien n’est duplique)', () => {
    const src = readFileSync('src/app/api/cinema/redaction/route.ts', 'utf8');
    expect(src).not.toMatch(/api\.anthropic\.com|x-api-key|claude-[a-z0-9-]+/);
    expect(src).toContain("from '@/lib/ia/texte'");
    // Et l'ancienne route de « Creer » passe desormais par le MEME module.
    const creer = readFileSync('src/app/api/content/ai-generate/route.ts', 'utf8');
    expect(creer).toContain("from '@/lib/ia/texte'");
    expect(creer).not.toMatch(/fetch\('https:\/\/api\.anthropic\.com/);
  });

  it('un echec passager bascule sur le second modele, sans resoumettre ailleurs', async () => {
    reponses = [{ ok: false, status: 529, erreur: 'overloaded' }, { ok: true, status: 200, texte: JSON.stringify({ text: REPONSE_OK }) }];
    const { status, body } = await post({ action: 'ameliorer', ...CONTEXTE });
    expect(status).toBe(200);
    expect(body.texte).toBe(REPONSE_OK);
    expect(envois.map((e) => e.corps.model)).toEqual([MODELE_TEXTE_PRIMAIRE, MODELE_TEXTE_REPLI]);
  });

  it('solde fournisseur epuise : 503 « indisponible », texte intact, aucun second essai', async () => {
    reponses = [{ ok: false, status: 400, erreur: 'Your credit balance is too low' }];
    const { status, body } = await post({ action: 'rediger', ...CONTEXTE });
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, indisponible: true });
    expect(body.erreur).toMatch(/n’a pas ete modifie/);
    expect(envois).toHaveLength(1);
    expect(estErreurFacturation('Your credit balance is too low')).toBe(true);
  });

  it('reponse illisible : 502 explicite, jamais un texte invente', async () => {
    reponses = [{ ok: true, status: 200, texte: '' }, { ok: true, status: 200, texte: '' }];
    const { status, body } = await post({ action: 'rediger', ...CONTEXTE });
    expect(status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.texte).toBeUndefined();
  });

  it('sans cle serveur : 503 dit clairement que l’aide IA n’est pas configuree', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { status, body } = await post({ action: 'rediger', ...CONTEXTE });
    expect(status).toBe(503);
    expect(body.indisponible).toBe(true);
    expect(envois).toHaveLength(0);
  });
});

describe('securite et couts', () => {
  it('sans session : 401, et rien n’est envoye', async () => {
    session.userId = null;
    const { status } = await post({ action: 'rediger', ...CONTEXTE });
    expect(status).toBe(401);
    expect(envois).toHaveLength(0);
  });

  it('module eteint : 404', async () => {
    process.env = { ...ENV, ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv;
    delete process.env.CINEMA_ACTIVE;
    expect((await post({ action: 'rediger', ...CONTEXTE })).status).toBe(404);
    expect(envois).toHaveLength(0);
  });

  it('action inconnue : 400, aucun appel', async () => {
    const { status, body } = await post({ action: 'ecrire-un-roman', ...CONTEXTE });
    expect(status).toBe(400);
    expect(body.erreur).toMatch(/action/);
    expect(envois).toHaveLength(0);
    expect(estActionRedaction('rediger')).toBe(true);
    expect(estActionRedaction('ecrire-un-roman')).toBe(false);
  });

  it('aucun credit, aucun quota, aucune generation : le CODE de la route ne touche qu’au texte', () => {
    // Commentaires retires : ils PARLENT des credits (pour dire qu'on n'y touche pas).
    const src = readFileSync('src/app/api/cinema/redaction/route.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/credit|quota|plafond|devis|reserver|debit/i);
    expect(src).not.toMatch(/genererMediaPlan|produire|travaux/);
  });

  it('les bornes d’entree tiennent : histoire tronquee, casting borne, scenes ramenees dans les limites', () => {
    const c = nettoyerContexte({ histoire: 'x'.repeat(HISTOIRE_MAX + 500), personnages: Array.from({ length: 20 }, (_, i) => ({ nom: `P${i}` })), nbScenes: 99 });
    expect(c.histoire).toHaveLength(HISTOIRE_MAX);
    expect(c.personnages).toHaveLength(PERSONNAGES_MAX);
    expect(c.nbScenes).toBeLessThanOrEqual(5);
    expect(nettoyerContexte({ histoire: '', personnages: [], nbScenes: 0 }).nbScenes).toBeGreaterThanOrEqual(3);
  });
});

describe('le contexte du film atteint vraiment le prompt', () => {
  it('genre, personnages, nombre de scenes, format, titre et texte existant', async () => {
    await post({ action: 'developper', ...CONTEXTE });
    const p = prompt();
    expect(p).toMatch(/Science-fiction/);
    expect(p).toContain('Ada');
    expect(p).toContain('cheveux courts argentes');
    expect(p).toContain('Orion');
    expect(p).toMatch(/Nombre de scenes voulu : 4/);
    expect(p).toContain('16:9');
    expect(p).toContain('Signal perdu');
    expect(p).toContain('Ada se reveille seule dans la station.');
    expect(p).toContain(actionRedaction('developper').consigne);
  });

  it('aucun personnage invente : la liste du casting est annoncee comme la SEULE autorisee', () => {
    const p = promptRedaction('rediger', CONTEXTE);
    expect(p).toMatch(/SEULS autorises/);
    expect(p).toMatch(/N’invente AUCUN personnage/);
    const vide = promptRedaction('rediger', { histoire: '', personnages: [] });
    expect(vide).toMatch(/aucun personnage defini/);
  });

  it('les regles du decoupage existant sont dans le prompt (une phrase = un plan, repliques)', () => {
    const p = promptRedaction('dialogues', CONTEXTE);
    expect(p).toMatch(/Une phrase = un plan/);
    expect(p).toMatch(/Nom dit : « texte de la replique »/);
    expect(p).toMatch(/JAMAIS de point/);
    expect(p).toMatch(/au moins 7 phrases/); // 4 scenes + 3
    expect(p).toMatch(/\{"text":"/);
  });

  it('les six actions existent, chacune avec sa consigne, et donnent six prompts differents', () => {
    expect(ACTIONS_REDACTION.map((a) => a.id)).toEqual(['rediger', 'ameliorer', 'developper', 'dialogues', 'structurer', 'raccourcir']);
    const prompts = ACTIONS_REDACTION.map((a) => promptRedaction(a.id, CONTEXTE));
    expect(new Set(prompts).size).toBe(6);
    // Seule « Rédiger depuis une idée » peut partir d'un texte vide.
    expect(ACTIONS_REDACTION.filter((a) => !a.exigeTexte).map((a) => a.id)).toEqual(['rediger']);
  });

  it('un style absent ne force aucun genre', () => {
    expect(promptRedaction('rediger', { histoire: '', personnages: [], styleCinema: null })).toMatch(/Genre : libre/);
  });
});

describe('ce que la proposition donnerait REELLEMENT (diagnostic, avant acceptation)', () => {
  it('compte les plans et les repliques avec le decoupage du serveur', async () => {
    const { body } = await post({ action: 'rediger', ...CONTEXTE });
    expect(body.diagnostic).toMatchObject({ plans: 4, repliques: 1, inconnus: [], repliquesCassees: 0, assezDePhrases: true });
  });

  it('signale un prenom hors casting — il n’apparaitrait dans aucun plan', () => {
    const d = diagnostiquerProposition('Ada entre. Marco la regarde sans bouger. Ada sourit.', CONTEXTE);
    expect(d.inconnus).toEqual(['Marco']);
  });

  it('les mots courants en debut de phrase ne sont PAS pris pour des personnages', () => {
    const texte = 'Le jour se leve sur la station. Elle avance dans le couloir. Soudain Ada s’arrete. Personne ne repond.';
    expect(diagnostiquerProposition(texte, CONTEXTE).inconnus).toEqual([]);
  });

  it('signale une replique cassee par un point a l’interieur des guillemets', () => {
    const d = diagnostiquerProposition('Ada dit : « On y va. Maintenant ».', CONTEXTE);
    expect(d.repliquesCassees).toBe(1);
  });

  it('signale un texte trop court pour le nombre de scenes', () => {
    expect(diagnostiquerProposition('Ada entre.', CONTEXTE).assezDePhrases).toBe(false);
  });
});

describe('le moteur partage lit les reponses comme avant', () => {
  it.each([
    ['{"text":"bonjour"}', 'bonjour'],
    ['```json\n{"text":"bonjour"}\n```', 'bonjour'],
    ['voici: {"text":"bonjour"} merci', 'bonjour'],
    ['bonjour', 'bonjour'],
  ])('%s', (brut, attendu) => {
    expect(extraireTexte(brut)).toBe(attendu);
  });

  it('un recit brut long reste lisible pour Cinema (borne elargie), mais pas pour un champ court', () => {
    const recit = 'Ada entre dans la station. '.repeat(20);
    expect(extraireTexte(recit)).toBeNull();
    expect(extraireTexte(recit, 6_000)).toBe(recit.trim());
  });
});
