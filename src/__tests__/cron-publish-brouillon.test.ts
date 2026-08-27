/**
 * Invariant absolu du cron : `status === 'draft'` n'est JAMAIS publie.
 *
 * Ces assertions portent sur le source. Le gestionnaire fait 1 356 lignes et
 * enchaine Zernio, quatre reseaux sociaux, un rendu et des minuteries — le
 * faire tourner demanderait un faux client si large qu'il testerait surtout
 * lui-meme. Ce qu'on protege ici tient sur deux clauses SQL, et une mutation
 * de l'une ou l'autre fait tomber un test (verifie par mutation).
 *
 * Rappel de l'etat d'avant, etabli par l'historique git :
 * - `36834e4` avait ajoute `'draft'` au filtre, pour le SEUL declencheur
 *   manuel `?force=true` ;
 * - `0220815` l'avait recopie dans le claim atomique, par coherence d'ensemble
 *   et non par besoin — son message documente que « Publier maintenant » passe
 *   par `status='scheduled'` ;
 * - `6f2e64d` documente que la requete candidate du chemin normal filtre deja
 *   strictement `scheduled`.
 * Aucun flux produit ne dependait donc de la publication des brouillons.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const cron = readFileSync(
  join(process.cwd(), 'src/app/api/cron/publish/route.ts'),
  'utf-8',
);

/** Les lignes qui filtrent un statut, hors commentaires. */
const clausesStatut = cron
  .split('\n')
  .map((l, i) => ({ n: i + 1, texte: l.trim() }))
  .filter(({ texte }) => !texte.startsWith('//') && /\.(in|eq)\('status'/.test(texte));

describe('Aucune selection ne peut ramasser un brouillon', () => {
  it("le couple ['scheduled', 'draft'] a totalement disparu du fichier", () => {
    expect(cron).not.toContain("['scheduled', 'draft']");
    expect(cron).not.toContain("['draft', 'scheduled']");
  });

  it('la selection de ?force=true est strictement « scheduled »', () => {
    // `?force=true` contourne le contrôle horaire, jamais le statut.
    expect(cron).toMatch(/force=true[\s\S]{0,900}\.eq\('status', 'scheduled'\)/);
  });

  it('la requete candidate du chemin normal reste strictement « scheduled »', () => {
    expect(cron).toContain(".eq('status', 'scheduled')");
  });

  it('le claim atomique ne peut plus reclamer un brouillon', () => {
    expect(cron).toMatch(/update\(\{ status: 'publishing' \}\)[\s\S]{0,600}\.eq\('status', 'scheduled'\)/);
  });
});

describe('Seuls des statuts explicitement publiables sont filtres', () => {
  const PUBLIABLES = new Set(['scheduled', 'publishing']);

  it('aucune clause de statut ne mentionne « draft », sauf le diagnostic', () => {
    const fautives = clausesStatut.filter(({ texte }) => {
      if (!texte.includes("'draft'")) return false;
      // Seule exception admise : le `select` de comptage qui alimente le log
      // `pipeline`. Il ne publie rien — il rend au contraire VISIBLE un post
      // resté en brouillon alors qu'on l'attendait publié.
      return !texte.includes("['scheduled', 'publishing', 'draft']");
    });
    expect(fautives.map((f) => `L${f.n}: ${f.texte}`)).toEqual([]);
  });

  it('chaque statut filtre hors diagnostic est publiable', () => {
    const horsDiagnostic = clausesStatut
      .filter(({ texte }) => !texte.includes("['scheduled', 'publishing', 'draft']"));
    expect(horsDiagnostic.length).toBeGreaterThan(0);
    for (const { n, texte } of horsDiagnostic) {
      const statuts = [...texte.matchAll(/'([a-z]+)'/g)]
        .map((m) => m[1])
        .filter((v) => v !== 'status');
      for (const s of statuts) {
        expect(PUBLIABLES.has(s), `L${n} filtre « ${s} », qui n'est pas publiable`).toBe(true);
      }
    }
  });
});

describe('Le diagnostic reste, et reste inoffensif', () => {
  it('le comptage voit toujours les brouillons', () => {
    expect(cron).toContain("['scheduled', 'publishing', 'draft']");
  });

  it("c'est un select, jamais un update", () => {
    const i = cron.indexOf("['scheduled', 'publishing', 'draft']");
    const bloc = cron.slice(Math.max(0, i - 400), i);
    expect(bloc).toContain(".select('id, status')");
    expect(bloc).not.toContain('.update(');
  });
});

describe('Rien d autre n a bouge dans la publication', () => {
  it('le garde « aucune plateforme » est intact', () => {
    expect(cron).toContain('if (!post.platforms || post.platforms.length === 0)');
  });

  it('le garde « aucun media » est intact', () => {
    expect(cron).toContain('if (!videoUrl && requiresSocialAccount(post.platforms))');
  });

  it('la recuperation des posts bloques a « publishing » est intacte', () => {
    expect(cron).toMatch(/update\(\{ status: 'scheduled' \}\)[\s\S]{0,200}\.eq\('status', 'publishing'\)/);
  });

  it('le controle du CRON_SECRET est intact', () => {
    expect(cron).toContain("{ error: 'Unauthorized' }");
  });
});
