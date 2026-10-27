/**
 * CINEMA IA — LA GÉNÉRATION « IA » SIMULÉE EST ÉTEINTE EN PRODUCTION.
 *
 * Le seul fournisseur écrit à ce jour ne génère rien par IA : il DESSINE une image ou une
 * courte vidéo avec ffmpeg. L'offrir à un utilisateur reviendrait à lui présenter une
 * réussite qui n'en est pas une. Ces tests prouvent que, sans la variable
 * `CINEMA_GENERATION_SIMULEE`, le serveur refuse et l'écran ne propose rien.
 *
 * Ce que cela NE prouve PAS : le reste de Cinema IA (import de médias, rendu Remotion,
 * export), couvert par ses propres tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { cinemaActive, generationIaSimuleeActive, stockageCinemaUtilisable, accesCinemaAutorise } from '@/lib/cinema/garde';

/** Un environnement de test, sans prétendre porter tout `ProcessEnv`. */
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

const ENV0 = { ...process.env };
afterEach(() => { process.env = { ...ENV0 }; });

const src = (p: string) => readFileSync(p, 'utf8');

describe('l’interrupteur de la génération simulée', () => {
  it('absent : ÉTEINT (c’est l’état de la production)', () => {
    expect(generationIaSimuleeActive(env({}))).toBe(false);
  });

  it('seuls « true » et « 1 » l’allument ; tout le reste laisse éteint', () => {
    for (const v of ['true', 'TRUE', ' true ', '1']) {
      expect(generationIaSimuleeActive(env({ CINEMA_GENERATION_SIMULEE: v }))).toBe(true);
    }
    for (const v of ['false', '0', 'oui', 'yes', 'on', '', 'simule']) {
      expect(generationIaSimuleeActive(env({ CINEMA_GENERATION_SIMULEE: v }))).toBe(false);
    }
  });

  it('il est INDÉPENDANT de l’interrupteur général du module', () => {
    const e = env({ CINEMA_ACTIVE: 'true' });
    expect(cinemaActive(e)).toBe(true);
    expect(generationIaSimuleeActive(e)).toBe(false); // module ouvert, génération éteinte
  });
});

describe('le fournisseur simulé se déclare inactif', () => {
  it('éteint par défaut, et allumé seulement par la variable — relu à chaque lecture, sans redémarrage', async () => {
    delete process.env.CINEMA_GENERATION_SIMULEE;
    const { FOURNISSEUR_SIMULE } = await import('@/lib/cinema/generation/simule');
    expect(FOURNISSEUR_SIMULE.actif).toBe(false);
    process.env.CINEMA_GENERATION_SIMULEE = 'true';
    expect(FOURNISSEUR_SIMULE.actif).toBe(true); // même objet, nouvelle lecture
    process.env.CINEMA_GENERATION_SIMULEE = 'false';
    expect(FOURNISSEUR_SIMULE.actif).toBe(false);
  });

  it('il reste DÉCLARÉ au registre : le refus est explicite (« non branché »), pas un « fournisseur inconnu »', async () => {
    const { fournisseurGeneration } = await import('@/lib/cinema/generation/fournisseur');
    await import('@/lib/cinema/generation/simule');
    const f = fournisseurGeneration('simule');
    expect(f).not.toBeNull();
    expect(f!.libelle).toContain('simule');
  });
});

describe('câblage : le serveur refuse, l’écran ne propose pas', () => {
  it('l’atelier refuse un fournisseur inactif AVANT toute construction de prompt', () => {
    const a = src('src/lib/cinema/generation/atelier.ts');
    const iActif = a.indexOf('if (!fournisseur.actif)');
    expect(iActif).toBeGreaterThan(0);
    expect(a).toContain("non branche : aucune generation payante n'est autorisee");
    // Le contrôle vient avant le plan, le devis et le prompt.
    expect(iActif).toBeLessThan(a.indexOf("'plan inconnu'"));
  });

  it('la liste des films dit à l’écran si la génération est disponible', () => {
    const r = src('src/app/api/cinema/films/route.ts');
    expect(r).toContain('const mode = modeGenerationAffiche(s.userId);');
    expect(r).toContain('generationIa: mode !== null');
    expect(r).toContain('generationMode: mode');
  });

  it('l’écran n’affiche AUCUN bouton « Generer » tant que le serveur ne l’autorise pas', () => {
    const p = src('src/app/dashboard/cinema/page.tsx');
    expect(p).toContain('setGenerationIa(data.generationIa === true)');
    expect(p).toContain('{generationIa && (');
    expect(p).toContain("{generationIa && plan.media?.genre === 'image' && (");
    // Aucun bouton de génération hors de cette condition.
    for (const m of p.matchAll(/Generer \(IA, simule\)|Animer en video \(IA, simule\)/g)) {
      expect(p.slice(Math.max(0, m.index! - 900), m.index!)).toContain('generationIa &&');
    }
  });

  it('le reste de Cinema IA ne dépend pas de cet interrupteur (import, rendu, export)', () => {
    for (const f of [
      'src/lib/cinema/rendu-local.ts',
      'src/lib/cinema/montage.ts',
      'src/lib/cinema/medias.ts',
    ]) {
      expect(src(f)).not.toContain('generationIaSimuleeActive');
    }
  });
});

describe('en production, le module n’ouvre pas sans stockage durable', () => {
  const user = { id: '00000000-0000-4000-8000-000000000001' };

  it('hors production : le mode local reste utilisable (développement)', () => {
    expect(stockageCinemaUtilisable(env({ NODE_ENV: 'development' }))).toBe(true);
    expect(stockageCinemaUtilisable(env({ NODE_ENV: 'test' }))).toBe(true);
  });

  it('production + stockage local : FERMÉ — les films seraient perdus au remplacement du conteneur', () => {
    const e = env({ NODE_ENV: 'production', CINEMA_ACTIVE: 'true' });
    expect(stockageCinemaUtilisable(e)).toBe(false);
    expect(cinemaActive(e)).toBe(true); // l'interrupteur est bien posé…
    expect(accesCinemaAutorise(user, e)).toBe(false); // …mais la porte reste fermée
  });

  it('production + CINEMA_STOCKAGE=durable : ouvert', () => {
    const e = env({ NODE_ENV: 'production', CINEMA_ACTIVE: 'true', CINEMA_STOCKAGE: 'durable' });
    expect(stockageCinemaUtilisable(e)).toBe(true);
    expect(accesCinemaAutorise(user, e)).toBe(true);
  });

  it('une valeur approchante ne suffit pas : seul « durable » compte', () => {
    for (const v of ['Durable', 'DURABLE', 'postgres', 'minio', 'true', '1']) {
      expect(stockageCinemaUtilisable(env({ NODE_ENV: 'production', CINEMA_STOCKAGE: v }))).toBe(false);
    }
  });

  it('les routes referment le module (404) dans ce cas, comme si l’interrupteur était éteint', () => {
    const r = src('src/lib/cinema/routes-aide.ts');
    expect(r).toContain('if (!cinemaActive() || !stockageCinemaUtilisable()) {');
    expect(r).toContain("status: 404");
  });
});
