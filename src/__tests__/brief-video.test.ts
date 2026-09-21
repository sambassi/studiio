import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  sanitizeBrief, briefRempli, briefPourPrompt, BRIEF_KEYS, BRIEF_MAX_CHARS,
} from '@/lib/creer/brief';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';
import { sanitizeConfig, DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { preparePosts } from '@/lib/autopilot/engine';
import { voiceTexts } from '@/lib/autopilot/voice';
import { buildAutoFillText } from '@/lib/types/voice';

/**
 * Le brief de la vidéo — objectif, message, public, CTA.
 *
 * « Danse » ne dit pas ce que le jumeau dira. Le brief le dit, et il doit
 * (1) survivre au brouillon et à la configuration de l'Autopilote,
 * (2) atteindre la génération de contenu et les narrations,
 * (3) ne RIEN changer quand il est absent — tous les brouillons et toutes
 * les configurations existantes n'en ont pas.
 */

const BRIEF = {
  objectif: 'Donner envie de découvrir Afroboost à Neuchâtel et réserver un cours d’essai.',
  message: 'Un cours accessible qui donne de l’énergie.',
  public: 'Adultes de Neuchâtel.',
  cta: 'Réservez votre cours d’essai.',
};

describe('sanitizeBrief', () => {
  it('rogne, borne à 300 caractères et ignore les clés vides ou inconnues', () => {
    const b = sanitizeBrief({
      objectif: '  ' + 'x'.repeat(400) + '  ',
      message: '   ',
      public: 42,
      cta: ' Réservez ',
      inconnu: 'jeté',
    });
    expect(b.objectif).toHaveLength(BRIEF_MAX_CHARS);
    expect('message' in b).toBe(false);
    expect('public' in b).toBe(false);
    expect(b.cta).toBe('Réservez');
    expect('inconnu' in b).toBe(false);
  });

  it('tout ce qui n est pas un objet vaut {}', () => {
    for (const brut of [null, undefined, 'texte', 3, [], true]) {
      expect(sanitizeBrief(brut), String(brut)).toEqual({});
    }
  });

  it('briefRempli ne voit que du texte non vide', () => {
    expect(briefRempli({})).toBe(false);
    expect(briefRempli({ cta: '  ' })).toBe(false);
    expect(briefRempli({ cta: 'Réservez' })).toBe(true);
    expect(briefRempli(null)).toBe(false);
  });

  it('les quatre champs sont ceux demandés', () => {
    expect([...BRIEF_KEYS]).toEqual(['objectif', 'message', 'public', 'cta']);
  });
});

describe('briefPourPrompt', () => {
  it('sans brief : chaîne VIDE — le prompt d avant, à l identique', () => {
    expect(briefPourPrompt(undefined)).toBe('');
    expect(briefPourPrompt({})).toBe('');
    expect(briefPourPrompt({ objectif: ' ' })).toBe('');
  });

  it('avec brief : chaque champ renseigné, nommé', () => {
    const p = briefPourPrompt(BRIEF);
    expect(p).toContain(BRIEF.objectif);
    expect(p).toContain(BRIEF.message);
    expect(p).toContain(BRIEF.public);
    expect(p).toContain(BRIEF.cta);
    expect(p).toContain('Objectif de la vidéo');
    expect(p).toContain('Public visé');
    // Un seul champ : une seule ligne, pas d'en-tête orphelin pour les autres.
    const seul = briefPourPrompt({ cta: 'Réservez' });
    expect(seul).toContain('Réservez');
    expect(seul).not.toContain('Objectif');
  });
});

// ── Brouillon de Créer ──────────────────────────────────────────────────

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'],
  toneIds: ['punchy'],
  formats: ['9:16'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 5, cards: 8, video: 10, cta: 7 },
  },
};

describe('Le brouillon de Créer', () => {
  it('persiste le brief, nettoyé', () => {
    const d = sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, brief: { ...BRIEF, message: '  ' } }, DEPS)!;
    expect(d.brief).toEqual({ objectif: BRIEF.objectif, public: BRIEF.public, cta: BRIEF.cta });
  });

  it('un brouillon sans brief se relit sans brief — pas de {} fantôme', () => {
    expect(sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1 }, DEPS)!.brief).toBeUndefined();
    expect(sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, brief: 'texte' }, DEPS)!.brief).toBeUndefined();
    expect(sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, brief: { cta: '' } }, DEPS)!.brief).toBeUndefined();
  });

  it('borne chaque champ à 300 caractères', () => {
    const d = sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, brief: { objectif: 'o'.repeat(1000) } }, DEPS)!;
    expect(d.brief!.objectif).toHaveLength(300);
  });
});

// ── Narration ───────────────────────────────────────────────────────────

describe('buildAutoFillText et le brief', () => {
  const base = {
    title: 'DANSE',
    subtitle: 'Bouger fait du bien',
    cards: [{ label: 'Énergie', value: '+30%', description: 'Plus de pêche.' }],
    ctaMainText: 'DÉCOUVRIR',
    ctaSubText: 'Lien en bio',
  };

  it('sans brief : les textes d avant, à l identique', () => {
    expect(buildAutoFillText(base)).toEqual(buildAutoFillText({ ...base, brief: null }));
    expect(buildAutoFillText(base)).toEqual(buildAutoFillText({ ...base, brief: {} }));
    expect(buildAutoFillText(base).cta).toBe('DÉCOUVRIR. Lien en bio');
  });

  it('le CTA du brief REMPLACE le CTA générique', () => {
    expect(buildAutoFillText({ ...base, brief: { cta: BRIEF.cta } }).cta).toBe(BRIEF.cta);
  });

  it('le message nourrit la narration du titre, après titre et sous-titre', () => {
    const t = buildAutoFillText({ ...base, brief: { message: BRIEF.message } });
    expect(t.titre).toBe(`DANSE. Bouger fait du bien. ${BRIEF.message}`);
    // Les cartes ne bougent pas.
    expect(t.cartes).toBe(buildAutoFillText(base).cartes);
  });
});

// ── Autopilote ──────────────────────────────────────────────────────────

const T0 = Date.parse('2026-09-21T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, rushUrls: ['https://cdn.test/a.mp4'], ...p,
});

describe('La configuration de l Autopilote', () => {
  it('porte un brief vide par défaut, et le nettoie', () => {
    expect(DEFAULT_CONFIG.brief).toEqual({});
    expect(sanitizeConfig({}).brief).toEqual({});
    expect(sanitizeConfig({ brief: null }).brief).toEqual({});
    expect(sanitizeConfig({ brief: { ...BRIEF, objectif: ' ' } }).brief)
      .toEqual({ message: BRIEF.message, public: BRIEF.public, cta: BRIEF.cta });
  });

  it('le brief survit à l aller-retour', () => {
    expect(sanitizeConfig(sanitizeConfig({ brief: BRIEF })).brief).toEqual(BRIEF);
  });
});

describe('Le cron transmet le brief aux textes', () => {
  it('preparePosts recopie le brief sur chaque montage', () => {
    const posts = preparePosts({ config: cfg({ brief: BRIEF }), topic: ['danse', 'yoga'], count: 2, now: T0 });
    expect(posts.map((p) => p.brief)).toEqual([BRIEF, BRIEF]);
  });

  it('sans brief : {} — et une configuration sans le champ ne lève pas', () => {
    const sans = { ...cfg() } as Record<string, unknown>;
    delete sans.brief;
    const p = preparePosts({ config: sans as unknown as AutopilotConfig, topic: 'danse', count: 1, now: T0 })[0];
    expect(p.brief).toEqual({});
  });

  it('voiceTexts : le CTA du brief remplace la phrase générique, le message entre dans le titre', () => {
    const avec = voiceTexts(preparePosts({ config: cfg({ brief: BRIEF }), topic: 'danse', count: 1, now: T0 })[0]);
    const sansBrief = voiceTexts(preparePosts({ config: cfg(), topic: 'danse', count: 1, now: T0 })[0]);
    expect(avec.cta).toBe(BRIEF.cta);
    expect(sansBrief.cta).not.toBe(BRIEF.cta);
    expect(avec.titre).toContain(BRIEF.message);
    expect(sansBrief.titre).not.toContain(BRIEF.message);
    expect(avec.cartes).toBe(sansBrief.cartes);
  });

  it('la route du cron relit la colonne `brief`', () => {
    const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
    expect(cron).toContain('brief: ligne.brief,');
  });
});

describe('La migration', () => {
  const migration = readFileSync(
    resolve(__dirname, '../../migrations/2026-09-21-autopilot-brief.sql'), 'utf-8',
  );

  it('ajoute la colonne jsonb, {} par défaut, contrainte à un objet', () => {
    expect(migration).toContain("add column if not exists brief jsonb not null default '{}'::jsonb");
    expect(migration).toContain("check (jsonb_typeof(brief) = 'object')");
  });

  it('rappelle les deux étapes PostgREST', () => {
    expect(migration).toContain('grant all on table public.autopilot_config to public');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });
});

// ── Route de configuration : lecture/écriture SEULEMENT si la colonne existe ──

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

let colonnesConnues: Set<string>;
let ligneEnBase: Record<string, unknown> | null;
const upserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'autopilot_config') throw new Error(`table inattendue : ${table}`);
    let selection = '';
    const chaine = {
      select(cols: string) { selection = cols; return chaine; },
      eq() { return chaine; },
      async limit() {
        if (selection !== '*' && selection !== 'id' && !colonnesConnues.has(selection)) {
          return { data: null, error: { message: `column autopilot_config.${selection} does not exist` } };
        }
        return { data: ligneEnBase ? [ligneEnBase] : [], error: null };
      },
      async upsert(valeurs: Record<string, unknown>) {
        for (const k of Object.keys(valeurs)) {
          if (!['user_id', 'updated_at'].includes(k) && !colonnesConnues.has(k)) {
            return { error: { message: `column "${k}" of relation "autopilot_config" does not exist` } };
          }
        }
        upserts.push(valeurs);
        return { error: null };
      },
    };
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

const COLONNES_DE_BASE = [
  'enabled', 'mode', 'cadence', 'count_per_cycle', 'platforms', 'credit_floor', 'voice_enabled',
  'topics', 'run_hour', 'run_timezone', 'rush_urls',
  'card_gradient_start', 'card_gradient_end', 'title_color', 'cards_show_poster', 'music_url',
  'voice_id', 'keep_rush_audio', 'music_volume', 'voice_volume', 'rush_volume',
  'design_style', 'poster_urls', 'poster_mode', 'publish_time',
];

async function chargerRoute() {
  vi.resetModules();
  return import('@/app/api/autopilot/config/route');
}

function requetePut(corps: unknown) {
  return new Request('http://test/api/autopilot/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  }) as unknown as import('next/server').NextRequest;
}

describe('La route de configuration', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    upserts.length = 0;
    ligneEnBase = null;
  });

  it('lit `brief` quand la colonne existe, et dit qu il est enregistrable', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'brief']);
    ligneEnBase = { user_id: 'u1', mode: 'review', brief: BRIEF };
    const { GET } = await chargerRoute();
    const corps = await (await GET()).json();
    expect(corps.briefReady).toBe(true);
    expect(corps.config.brief).toEqual(BRIEF);
  });

  it('sans la colonne : {} et l écran est prévenu', async () => {
    colonnesConnues = new Set(COLONNES_DE_BASE);
    ligneEnBase = { user_id: 'u1', mode: 'review' };
    const { GET } = await chargerRoute();
    const corps = await (await GET()).json();
    expect(corps.briefReady).toBe(false);
    expect(corps.config.brief).toEqual({});
  });

  it('écrit `brief`, nettoyé, quand la colonne existe', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'brief']);
    const { PUT } = await chargerRoute();
    const res = await PUT(requetePut({ ...DEFAULT_CONFIG, brief: { ...BRIEF, message: ' ', inconnu: 'x' } }));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.briefReady).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].brief).toEqual({ objectif: BRIEF.objectif, public: BRIEF.public, cta: BRIEF.cta });
  });

  it('⚠️ sans la colonne, l upsert part SANS `brief` — et réussit', async () => {
    colonnesConnues = new Set(COLONNES_DE_BASE);
    const { PUT } = await chargerRoute();
    const res = await PUT(requetePut({ ...DEFAULT_CONFIG, brief: BRIEF, cadence: 'daily' }));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.success).toBe(true);
    expect(corps.briefReady).toBe(false);
    expect(upserts).toHaveLength(1);
    expect('brief' in upserts[0]).toBe(false);
    expect(upserts[0].cadence).toBe('daily');
  });
});
