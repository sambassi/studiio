import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pickTopics, AUTOPILOT_TOPICS } from '@/lib/autopilot/topics';
import { sanitizeConfig, DEFAULT_CONFIG } from '@/lib/autopilot/rules';
import { THEMES, themeLabel, isCustomTopic } from '@/lib/themes';

/**
 * Les thèmes que l'utilisateur choisit.
 *
 * ⚠️ VIDE = TOUS LES THÈMES, et c'est ce qui rend l'ajout rétro-compatible.
 * Une configuration existante n'a rien choisi : elle continue de parcourir les
 * douze thèmes, exactement comme avant. Le choix RESTREINT, il n'active rien.
 *
 * ⚠️ ET UN THÈME PERSONNALISÉ N'EST PAS DANS LA LISTE — par définition. Le
 * valider contre `AUTOPILOT_TOPICS` l'aurait jeté en silence, et l'utilisateur
 * aurait vu son thème disparaître à la première relecture.
 */

const panneau = readFileSync(resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf-8');
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8',
);
const migration = readFileSync(
  resolve(__dirname, '../../migrations/2026-08-06-autopilot-topics.sql'), 'utf-8',
);

describe('La rotation respecte le choix', () => {
  it('elle ne sort QUE des thèmes du pool', () => {
    const t = pickTopics({ count: 2, pool: ['finance', 'beauty'] });
    expect(t).toHaveLength(2);
    for (const x of t) expect(['finance', 'beauty']).toContain(x);
    expect(t[0]).not.toBe(t[1]);
  });

  it('un pool d un seul thème le répète — sans échouer', () => {
    expect(pickTopics({ count: 2, pool: ['danse'] })).toEqual(['danse']);
  });

  it('sans pool, les douze thèmes', () => {
    const t = pickTopics({ count: 3 });
    for (const x of t) expect(AUTOPILOT_TOPICS).toContain(x);
  });

  it('un pool VIDE vaut « tous » — pas « aucun »', () => {
    // Le piège : un tableau vide se teste faux par `.length`, mais un pool
    // vide passé tel quel aurait rendu zéro sujet et un cycle sans contenu.
    const t = pickTopics({ count: 1, pool: [] });
    expect(AUTOPILOT_TOPICS).toContain(t[0]);
  });

  it('l exclusion des récents joue AUSSI dans un pool', () => {
    const t = pickTopics({ count: 1, pool: ['finance', 'beauty'], exclude: ['finance'] });
    expect(t[0]).toBe('beauty');
  });
});

describe('La configuration accepte les thèmes personnalisés', () => {
  it('un thème hors liste est CONSERVÉ', () => {
    const c = sanitizeConfig({ topics: ['récupération après le sport'] });
    expect(c.topics).toEqual(['récupération après le sport']);
  });

  it('le défaut est vide — donc « tous »', () => {
    expect(DEFAULT_CONFIG.topics).toEqual([]);
    expect(sanitizeConfig({}).topics).toEqual([]);
  });

  it('les doublons et les vides sautent', () => {
    expect(sanitizeConfig({ topics: ['danse', 'danse', '  ', 'eau'] }).topics)
      .toEqual(['danse', 'eau']);
  });

  it('les valeurs absurdes sont bornées', () => {
    const c = sanitizeConfig({ topics: [Array(200).fill('x').join(''), 42, null] });
    expect(c.topics).toHaveLength(1);
    expect(c.topics[0].length).toBe(40);
  });

  it('la liste entière est bornée', () => {
    const c = sanitizeConfig({ topics: Array.from({ length: 40 }, (_, i) => `t${i}`) });
    expect(c.topics).toHaveLength(20);
  });
});

describe('Les thèmes sont la MÊME liste que Créer simple', () => {
  it('les deux écrans importent le même module', () => {
    expect(wizard).toContain("from '@/lib/themes'");
    expect(panneau).toContain("from '@/lib/themes'");
    expect(wizard).toContain('const THEMES = SHARED_THEMES;');
  });

  it('douze thèmes, avec des icônes lucide — jamais d emoji', () => {
    expect(THEMES).toHaveLength(12);
    for (const t of THEMES) {
      // Un emoji sortirait de la plage ASCII : la règle du dépôt est absolue.
      expect(t.icon, t.id).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it('le panneau les rend par `CardIcon`, pas en texte', () => {
    expect(panneau).toContain('<CardIcon name={t.icon}');
    expect(panneau).toContain('data-autopilot-topic={t.id}');
  });

  it('un libellé connu est traduit, un thème perso reste tel quel', () => {
    expect(themeLabel('sommeil')).toBe('Sommeil & récupération');
    expect(themeLabel('mon sujet à moi')).toBe('mon sujet à moi');
    expect(isCustomTopic('sommeil')).toBe(false);
    expect(isCustomTopic('mon sujet à moi')).toBe(true);
  });
});

describe('Le wizard', () => {
  it('cinq étapes, une seule visible', () => {
    expect(panneau).toContain('const ETAPES = [');
    expect(panneau).toContain('{etape === 0 && (');
    expect(panneau).toContain('{etape === 4 && (');
  });

  it('les hooks sont AVANT le retour anticipé', () => {
    // `if (loading) return …` sort du composant : des hooks posés après ne
    // seraient appelés que sur certains rendus — React refuse
    // (« Rendered more hooks than during the previous render »).
    expect(panneau.indexOf('const basculerTheme')).toBeLessThan(panneau.indexOf('if (loading) {'));
    expect(panneau.indexOf('const bloqueEtape')).toBeLessThan(panneau.indexOf('if (loading) {'));
  });

  it('l étape des rushes BLOQUE tant qu il n y en a aucun', () => {
    expect(panneau).toContain('const bloqueEtape = etape === 1 && config.rushUrls.length === 0;');
    expect(panneau).toContain('disabled={!ready || bloqueEtape}');
  });

  it('les repères des tests existants sont conservés', () => {
    for (const marqueur of [
      'data-autopilot-panel', 'data-autopilot-toggle', 'data-autopilot-mode',
      'data-autopilot-voice', 'data-autopilot-platform', 'data-autopilot-add-rush',
    ]) {
      expect(panneau, marqueur).toContain(marqueur);
    }
  });

  it('le récapitulatif dit les thèmes retenus', () => {
    expect(panneau).toContain("['Thèmes', config.topics.length === 0");
    expect(panneau).toContain("'Tous (12 thèmes)'");
  });

  it('et annonce le prochain départ, à l heure CHOISIE', () => {
    // L'heure est devenue réglable : le prochain départ se cherche dans le
    // fuseau de l'utilisateur, pas sur un 06:00 UTC en dur.
    expect(panneau).toContain('function prochainDepart(');
    expect(panneau).toContain('timeZone: timezone,');
    expect(panneau).toContain('Prochain départ');
    // L'ancienne notice ne dit plus vrai : le déclencheur est configuré.
    expect(panneau).not.toContain('démarre une fois le déclencheur planifié');
  });
});

describe('La migration', () => {
  it('ajoute la colonne sans toucher aux lignes existantes', () => {
    expect(migration).toContain("add column if not exists topics text[] not null default '{}'");
  });

  it('et n oublie pas les deux étapes de PostgREST', () => {
    expect(migration).toContain('grant all on table public.autopilot_config to public');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });
});
