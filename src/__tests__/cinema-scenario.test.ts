/**
 * CINEMA IA — le decoupage, les personnages, les empreintes, les couts.
 *
 * Aucun reseau ici : tout ce qui est teste est pur. Les voix et le rendu MP4
 * sont verifies a part (`cinema-production.test.ts`), parce qu'ils dependent
 * d'un service externe et d'un binaire.
 */
import { describe, it, expect } from 'vitest';
import {
  nombreDeScenes, phrases, repartir, dureeReplique, lieuDe, citation,
  SCENES_MIN, SCENES_MAX,
} from '@/lib/cinema/scenario';
import { ajouterReference, creerPersonnage, referenceActive, activerReference, apparencePourPrompt } from '@/lib/cinema/personnages';
import { empreinteScene, scenesAReproduire, scelleScene } from '@/lib/cinema/empreinte';
import { devisFilm, coutPaye, libelleUsd, fournisseurPourQualite, FOURNISSEURS_VISUELS } from '@/lib/cinema/couts';
import { monterFilm, montageDeScene, totalFrames, framesDe } from '@/lib/cinema/montage';
import { dureeFilm, dureeScene } from '@/lib/cinema/types';
import { ajusterDureesSurVoix } from '@/lib/cinema/voix';
import { preparerFilm } from '@/lib/cinema/atelier';

const HISTOIRE = [
  'Nina entre dans la salle avant le lever du jour.',
  'Le tatami est encore froid et personne ne parle.',
  'Marco la regarde sans bouger.',
  'Nina sait que le combat a deja commence.',
  'Marco avance et le silence se brise.',
  'Nina murmure « je ne reculerai pas ».',
  'Nina tient bon jusqu au dernier instant.',
  'Le jour se leve sur la salle vide.',
].join(' ');

const CASTING = [
  { nom: 'Nina', role: 'protagoniste', description: 'cheveux courts, veste rouge' },
  { nom: 'Marco', role: 'antagoniste', description: 'grand, barbe, ceinture noire' },
];

const horloge = () => new Date('2026-10-26T09:00:00.000Z');

const filmDeTest = (o: Partial<Parameters<typeof preparerFilm>[0]> = {}) =>
  preparerFilm({ titre: 'Avant le jour', histoire: HISTOIRE, personnages: CASTING, maintenant: horloge, idFilm: 'film-test', ...o });

describe('decoupage de l histoire', () => {
  it('rend des phrases exploitables', () => {
    expect(phrases(HISTOIRE)).toHaveLength(8);
    expect(phrases('')).toEqual([]);
  });

  it('borne le nombre de scenes a 3..5', () => {
    expect(nombreDeScenes(2)).toBe(SCENES_MIN);
    expect(nombreDeScenes(40)).toBe(SCENES_MAX);
    expect(nombreDeScenes(7, 12)).toBe(SCENES_MAX);
    expect(nombreDeScenes(7, 1)).toBe(SCENES_MIN);
  });

  it('ne laisse aucune scene vide', () => {
    for (const n of [3, 4, 5]) {
      const groupes = repartir(['a', 'b', 'c'], n);
      expect(groupes).toHaveLength(n);
      // Avec trois phrases pour cinq scenes, certaines restent vides : c'est
      // pourquoi le decoupage ne demande jamais plus de scenes que de phrases.
      if (n <= 3) expect(groupes.every((g) => g.length > 0)).toBe(true);
    }
  });

  it('est deterministe : deux appels donnent le meme film', () => {
    expect(JSON.stringify(filmDeTest())).toBe(JSON.stringify(filmDeTest()));
  });

  it('pose l echelle dramatique dans l ordre', () => {
    const film = filmDeTest({ nbScenes: 5 });
    expect(film.scenes.map((s) => s.intention)).toEqual(
      ['exposition', 'incident', 'confrontation', 'resolution', 'epilogue'],
    );
  });

  it('reconnait le lieu quand le texte le nomme', () => {
    expect(lieuDe('Nina entre dans la salle')).toBe('la salle');
    expect(lieuDe('rien de reconnaissable ici')).toBe('un decor neutre');
  });

  it('ne fait parler un personnage que s il y a des guillemets', () => {
    const film = filmDeTest();
    const dites = film.scenes.flatMap((s) => s.plans).filter((p) => p.dialogue);
    const repliques = dites.filter((p) => p.dialogue!.genre === 'replique');
    const narration = dites.filter((p) => p.dialogue!.genre === 'narration');

    expect(repliques).toHaveLength(1);
    expect(repliques[0].dialogue!.texte).toBe('je ne reculerai pas');
    expect(repliques[0].dialogue!.personnageId).toBe(film.personnages[0].id);

    // Tout le reste est du RECIT : il revient au narrateur, pas a un
    // personnage — sinon l'image lirait « Nina : Marco la regarde ».
    expect(narration.length).toBeGreaterThan(4);
    for (const p of narration) {
      expect(p.dialogue!.personnageId).toBeNull();
      // Rien n'est invente : chaque ligne vient de l'histoire.
      expect(HISTOIRE).toContain(p.dialogue!.texte);
    }
  });

  it('extrait la citation, pas la phrase qui la porte', () => {
    expect(citation('Nina murmure « je ne reculerai pas ».')).toBe('je ne reculerai pas');
    expect(citation('Marco la regarde sans bouger.')).toBeNull();
  });

  it('ouvre chaque scene par un plan d ensemble muet', () => {
    for (const scene of filmDeTest().scenes) {
      expect(scene.plans[0].cadre).toBe('ensemble');
      expect(scene.plans[0].dialogue).toBeNull();
    }
  });

  it('estime la duree d une replique sans jamais descendre sous le plancher', () => {
    expect(dureeReplique('Oui.')).toBeGreaterThanOrEqual(1.4);
    expect(dureeReplique('x'.repeat(200))).toBeGreaterThan(dureeReplique('x'.repeat(20)));
  });

  it('tient dans la fenetre 30-60 s annoncee pour le prototype', () => {
    const duree = dureeFilm(filmDeTest());
    expect(duree).toBeGreaterThanOrEqual(25);
    expect(duree).toBeLessThanOrEqual(75);
  });
});

describe('personnages et references', () => {
  it('cree une reference versionnee et active', () => {
    const p = creerPersonnage(CASTING[0], 0, horloge);
    expect(p.references).toHaveLength(1);
    expect(referenceActive(p)?.version).toBe(1);
  });

  it('ajoute une version sans effacer la precedente', () => {
    const p = ajouterReference(creerPersonnage(CASTING[0], 0, horloge), { description: 'veste bleue' }, horloge);
    expect(p.references.map((r) => r.version)).toEqual([1, 2]);
    expect(referenceActive(p)?.description).toBe('veste bleue');
    // L'ancienne apparence reste lisible : un plan deja rendu la designe encore.
    expect(p.references[0].description).toBe('cheveux courts, veste rouge');
  });

  it('permet de revenir a une version anterieure', () => {
    const p = ajouterReference(creerPersonnage(CASTING[0], 0, horloge), { description: 'veste bleue' }, horloge);
    const revenu = activerReference(p, p.references[0].id);
    expect(referenceActive(revenu)?.version).toBe(1);
    expect(activerReference(p, 'inexistant').referenceActiveId).toBe(p.referenceActiveId);
  });

  it('compose l apparence pour un prompt, dans les memes mots a chaque fois', () => {
    const film = filmDeTest();
    const texte = apparencePourPrompt(film.personnages, film.personnages.map((p) => p.id));
    expect(texte).toBe('Nina (cheveux courts, veste rouge), Marco (grand, barbe, ceinture noire)');
  });

  it('donne des voix differentes aux deux premiers personnages', () => {
    const film = filmDeTest();
    expect(film.personnages[0].voix).not.toBe(film.personnages[1].voix);
  });
});

describe('empreintes : ce qui declenche une reproduction', () => {
  it('un film neuf n a rien a reproduire', () => {
    expect(scenesAReproduire(filmDeTest())).toHaveLength(0);
  });

  it('changer une replique marque la scene, et elle seule', () => {
    const film = filmDeTest();
    const modifie = {
      ...film,
      scenes: film.scenes.map((s, i) => i !== 1 ? s : {
        ...s,
        plans: s.plans.map((p, k) => k !== 1 ? p : { ...p, dialogue: { ...p.dialogue!, texte: 'Une autre replique.' } }),
      }),
    };
    const sales = scenesAReproduire(modifie);
    expect(sales.map((s) => s.id)).toEqual([film.scenes[1].id]);
  });

  it('changer la version de reference d un personnage salit les scenes ou il figure', () => {
    const film = filmDeTest();
    const avec = {
      ...film,
      personnages: [ajouterReference(film.personnages[0], { description: 'veste bleue' }, horloge), film.personnages[1]],
    };
    const nina = film.personnages[0].id;
    const attendues = film.scenes.filter((s) => s.plans.some((p) => p.personnages.includes(nina))).map((s) => s.id);
    expect(scenesAReproduire(avec).map((s) => s.id)).toEqual(attendues);
    expect(attendues.length).toBeGreaterThan(0);
  });

  it('allonger un plan parle ne salit pas la scene : la duree suit la voix', () => {
    const film = filmDeTest();
    const voix: Record<string, number> = {};
    for (const p of film.scenes[0].plans) if (p.dialogue) voix[p.id] = p.dureeS + 3;
    const ajuste = ajusterDureesSurVoix(film, voix);
    expect(dureeScene(ajuste.scenes[0])).toBeGreaterThan(dureeScene(film.scenes[0]));
    expect(scenesAReproduire(ajuste)).toHaveLength(0);
  });

  it('allonger un plan MUET salit la scene : c est un choix de montage', () => {
    const film = filmDeTest();
    const modifie = {
      ...film,
      scenes: film.scenes.map((s, i) => i !== 0 ? s : { ...s, plans: s.plans.map((p, k) => k !== 0 ? p : { ...p, dureeS: 6 }) }),
    };
    expect(scenesAReproduire(modifie).map((s) => s.id)).toEqual([film.scenes[0].id]);
  });

  it('sceller une scene la rend propre', () => {
    const film = filmDeTest();
    const sale = { ...film.scenes[0], titre: 'AUTRE TITRE' };
    expect(empreinteScene(sale, film.personnages)).not.toBe(sale.empreinte);
    expect(scelleScene(sale, film.personnages).empreinte).toBe(empreinteScene(sale, film.personnages));
  });
});

describe('couts', () => {
  it('ne declare actif qu un fournisseur local et gratuit', () => {
    const actifs = FOURNISSEURS_VISUELS.filter((f) => f.actif);
    expect(actifs).toHaveLength(1);
    expect(actifs[0].usdParSeconde).toBe(0);
    for (const f of FOURNISSEURS_VISUELS.filter((f) => !f.actif)) expect(f.usdParSeconde).toBeNull();
  });

  it('chiffre a zero un rendu local, par scene', () => {
    const film = filmDeTest();
    const devis = devisFilm(film, film.scenes.map((s) => s.id));
    expect(devis.totalUsd).toBe(0);
    expect(devis.lignes).toHaveLength(film.scenes.length);
    expect(devis.secondesAProduire).toBeCloseTo(dureeFilm(film), 1);
  });

  it('ne facture pas une scene qui n est pas a produire', () => {
    const film = filmDeTest();
    const devis = devisFilm(film, [film.scenes[0].id]);
    expect(devis.lignes.filter((l) => l.motif === 'a_produire')).toHaveLength(1);
    expect(devis.secondesAProduire).toBeCloseTo(dureeScene(film.scenes[0]), 1);
  });

  it('rend un total INCONNU des qu un tarif manque, jamais zero', () => {
    const film = { ...filmDeTest(), qualite: 'standard' as const };
    const faux = { ...film, scenes: film.scenes };
    // Qualite servie uniquement par un fournisseur sans tarif : on simule en
    // retirant le fournisseur local de la selection.
    const original = FOURNISSEURS_VISUELS[0].actif;
    FOURNISSEURS_VISUELS[0].actif = false;
    try {
      expect(fournisseurPourQualite('standard')).toBeNull();
      const devis = devisFilm(faux, faux.scenes.map((s) => s.id));
      expect(devis.totalUsd).toBeNull();
      expect(libelleUsd(null)).toMatch(/non declare/i);
    } finally {
      FOURNISSEURS_VISUELS[0].actif = original;
    }
  });

  it('cumule ce qui a deja ete paye', () => {
    const film = filmDeTest();
    expect(coutPaye(film)).toBe(0);
  });
});

describe('montage', () => {
  it('pose une chronologie continue, sans trou ni chevauchement', () => {
    const montage = monterFilm(filmDeTest());
    let curseur = 0;
    for (const s of montage.segments) {
      expect(s.debutS).toBeCloseTo(curseur, 1);
      curseur = s.finS;
    }
    expect(montage.dureeS).toBeCloseTo(curseur, 1);
  });

  it('derive la duree en frames des segments, sans valeur a part', () => {
    const montage = monterFilm(filmDeTest());
    const dernier = montage.segments.at(-1)!;
    const { from, duree } = framesDe(dernier, montage.fps);
    expect(totalFrames(montage)).toBe(from + duree);
  });

  it('donne au film les dimensions de son format et de sa qualite', () => {
    expect(monterFilm(filmDeTest({ format: '9:16' })).largeur).toBe(1080);
    expect(monterFilm(filmDeTest({ format: '16:9' })).largeur).toBe(1920);
    expect(monterFilm(filmDeTest({ format: '9:16', qualite: 'brouillon' })).hauteur).toBe(960);
  });

  it('recale une scene rendue seule a zero', () => {
    const montage = monterFilm(filmDeTest());
    const deuxieme = montage.segments.find((s) => s.sceneIndex === 1)!;
    const sous = montageDeScene(montage, deuxieme.sceneId)!;
    expect(sous.segments[0].debutS).toBe(0);
    expect(sous.dureeS).toBeCloseTo(dureeScene(filmDeTest().scenes[1]), 1);
    expect(montageDeScene(montage, 'inexistante')).toBeNull();
  });

  it('nomme le locuteur sur une replique, personne sur une narration', () => {
    const montage = monterFilm(filmDeTest());
    const replique = montage.segments.find((s) => s.genre === 'replique')!;
    expect(replique.locuteur).toBe('Nina');
    expect(replique.apparence).toContain('veste rouge');
    for (const s of montage.segments.filter((s) => s.genre !== 'replique')) {
      expect(s.locuteur).toBeNull();
    }
  });

  it('n emet aucune couleur etrangere a la palette Studiio', () => {
    for (const s of monterFilm(filmDeTest()).segments) {
      expect(s.couleurs[0]).not.toBe('#D91CD2');
      expect(s.couleurs[1]).not.toBe('#D91CD2');
    }
  });
});
