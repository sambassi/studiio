/**
 * Les rushes indexés et les vignettes d'analyse survivent au nettoyage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX TROUS, ET LE PREMIER EXISTAIT DÉJÀ AVANT M3-B2
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **Les rushes de M3-A n'étaient protégés par personne.** Ils vivent dans
 *    `media/<userId>/rush/…`, donc sous la rétention de 24 h des vidéos. Or
 *    `getProtectedUrls` ne lit que `scheduled_posts`, et `autopilotRushKeys`
 *    ne lit que `autopilot_config.rush_urls` — aucune des deux ne connaît la
 *    table `rushes`. Un rush téléversé dans une session disparaissait donc le
 *    lendemain, et toute analyse ultérieure aurait échoué en 404 sur un
 *    fichier qui existait la veille.
 *
 * 2. **Les vignettes n'étaient même pas VISITÉES.** Le balayage descendait à
 *    trois niveaux ; elles vivent à quatre
 *    (`<userId>/analyse/<analysisId>/<fichier>`). Ni protégées, ni
 *    supprimées, ni comptées : une fuite de stockage silencieuse et
 *    permanente.
 *
 * Les deux se referment ensemble, parce que refermer le second sans le
 * premier serait pire : le balayage descendrait sur des vignettes que rien
 * n'exempte encore.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ORDRE DE LIVRAISON N'EST PAS NÉGOCIABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cette adaptation doit partir dans la MÊME livraison que la première
 * écriture de vignette, jamais après. Une fuite se rattrape au passage
 * suivant ; une suppression ne revient pas.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
/** Tables que la base ne connaît pas — socle non appliqué. */
let absentes: Set<string>;
/** Tables qui répondent une erreur de lecture — panne, pas absence. */
let enPanne: Set<string>;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        then: (resoudre: (v: unknown) => unknown) => {
          if (absentes.has(table)) {
            return resoudre({
              data: null,
              error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
            });
          }
          if (enPanne.has(table)) {
            return resoudre({
              data: null,
              error: { code: '57P01', message: 'terminating connection' },
            });
          }
          return resoudre({ data: tables[table] ?? [], error: null });
        },
      };
      return api;
    },
  },
  supabase: { from: () => ({}) },
}));

const { clesTournageEtAnalyses } = await import('@/lib/storage/cleanup');

const nettoyage = readFileSync(
  resolve(__dirname, '../app/api/cron/cleanup-media/route.ts'), 'utf-8',
);

beforeEach(() => {
  absentes = new Set();
  enPanne = new Set();
  tables = {
    rushes: [
      { bucket: 'media', cle_objet: 'u42/rush/plan.mp4' },
      { bucket: 'media', cle_objet: 'u43/rush/autre.mp4' },
    ],
    rush_analyses: [
      {
        vignettes: [
          { bucket: 'media', cle: 'u42/analyse/a-1/000.jpg', seconde: 0 },
          { bucket: 'media', cle: 'u42/analyse/a-1/001.jpg', seconde: 3 },
        ],
      },
    ],
  };
});

describe('Les clés à protéger sont lues des DEUX tables', () => {
  it('les rushes indexés et les vignettes reviennent ensemble', async () => {
    const cles = await clesTournageEtAnalyses();
    expect(cles).not.toBeNull();
    expect([...cles!].sort()).toEqual([
      'media/u42/analyse/a-1/000.jpg',
      'media/u42/analyse/a-1/001.jpg',
      'media/u42/rush/plan.mp4',
      'media/u43/rush/autre.mp4',
    ]);
  });

  it('la clé a la forme `<bucket>/<cle>` — celle que MinIO indexe', async () => {
    // Et non une URL : une URL s'écrit de plusieurs façons pour le même
    // objet, et deux formes ne se reconnaîtraient pas.
    const cles = await clesTournageEtAnalyses();
    for (const c of cles!) {
      expect(c).not.toMatch(/^https?:\/\//);
      expect(c).toMatch(/^[a-z]+\//);
    }
  });

  it('une vignette mal formée est ignorée, pas fatale', async () => {
    tables.rush_analyses = [
      { vignettes: [{ bucket: 'media' }, null, 'x', { cle: 'u/1.jpg' }] },
      { vignettes: 'pas un tableau' },
    ];
    const cles = await clesTournageEtAnalyses();
    expect(cles).not.toBeNull();
    expect([...cles!].filter((c) => c.includes('analyse'))).toEqual([]);
  });
});

describe('Absence et panne ne disent PAS la même chose', () => {
  it('`rush_analyses` absente = aucune vignette, pas une panne', async () => {
    // La migration M3-B1 n'est pas appliquée partout. Une table absente
    // signifie qu'aucune vignette n'existe : l'ensemble vide est la réponse
    // juste, et le nettoyage peut continuer.
    absentes.add('rush_analyses');
    const cles = await clesTournageEtAnalyses();
    expect(cles).not.toBeNull();
    expect([...cles!]).toEqual(['media/u42/rush/plan.mp4', 'media/u43/rush/autre.mp4']);
  });

  it('`rushes` illisible = `null`, et donc AUCUNE suppression', async () => {
    // Même contrat que `autopilotRushKeys` : un ensemble vide se lirait
    // « rien à protéger » et laisserait tout supprimer. Un nettoyage manqué
    // se rattrape au passage suivant ; un rush supprimé ne revient pas.
    enPanne.add('rushes');
    expect(await clesTournageEtAnalyses()).toBeNull();
  });

  it('`rush_analyses` illisible = `null` aussi', async () => {
    enPanne.add('rush_analyses');
    expect(await clesTournageEtAnalyses()).toBeNull();
  });

  it('les deux tables absentes rendent un ensemble vide, pas `null`', async () => {
    absentes.add('rushes');
    absentes.add('rush_analyses');
    const cles = await clesTournageEtAnalyses();
    expect(cles).not.toBeNull();
    expect([...cles!]).toEqual([]);
  });
});

describe('Le cron branche réellement cette source', () => {
  it('il lit les clés du tournage et refuse de balayer si elles manquent', () => {
    expect(nettoyage).toContain('clesTournageEtAnalyses');
    // Le même garde-fou que la banque : illisible → 503, aucune suppression.
    expect(nettoyage).toMatch(/tournageLu[\s\S]{0,400}status: 503/);
  });

  it('l exemption est appliquée AVANT le calcul d expiration', () => {
    // Sinon la protection ne servirait à rien : le fichier serait supprimé
    // puis « protégé ».
    const posExemption = nettoyage.indexOf('tournageLu.has(cle)');
    const posExpiration = nettoyage.indexOf('const expiresAt = getExpiresAt');
    expect(posExemption).toBeGreaterThan(0);
    expect(posExpiration).toBeGreaterThan(posExemption);
  });

  it('le balayage descend au QUATRIÈME niveau', () => {
    // `<userId>/analyse/<analysisId>/<fichier>`. Sans ce niveau, les
    // vignettes ne sont jamais visitées — ni protégées, ni nettoyées.
    expect(nettoyage).toContain('${userFolder.name}/${sub.name}/${file.name}/${sousFichier.name}');
    expect(nettoyage).toContain('.list(`${userFolder.name}/${sub.name}/${file.name}`');
  });

  it('le journal permet de VÉRIFIER l exemption en production', () => {
    // `tournage=0` alors que des rushes sont indexés signalerait que le
    // rapprochement ne prend pas — c'est la raison d'être du compteur.
    expect(nettoyage).toContain('exemptesTournage');
    expect(nettoyage).toMatch(/tournage=\$\{exemptesTournage\}/);
  });
});
