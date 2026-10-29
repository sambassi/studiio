/**
 * CINEMA IA — LES MODELES DE DEPART : utiles a un debutant, et inoffensifs.
 *
 * Deux proprietes comptent plus que l'habillage :
 *   1. un modele n'ECRASE JAMAIS une saisie sans confirmation ;
 *   2. choisir un modele ne GENERE RIEN (aucun appel, aucun credit).
 *
 * Le reste verifie que les exemples sont reellement exploitables par le decoupage
 * existant (`lib/cinema/scenario`) : phrases, repliques entre guillemets, personnages
 * nommes dans le texte, et vignettes qui existent vraiment dans le depot.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import ModelesFilm, { MODELES_FILM } from '@/components/cinema/ModelesFilm';
import { phrases, citation, personnagesCites, nombreDeScenes, SCENES_MIN, SCENES_MAX } from '@/lib/cinema/scenario';

afterEach(() => cleanup());

const src = (p: string) => readFileSync(p, 'utf8');

describe('les exemples sont exploitables par le decoupage existant', () => {
  it('quatre themes distincts, aucun doublon', () => {
    expect(MODELES_FILM).toHaveLength(4);
    expect(new Set(MODELES_FILM.map((m) => m.id)).size).toBe(4);
    expect(MODELES_FILM.map((m) => m.theme.toLowerCase()).join(' ')).toMatch(/science-fiction/);
    expect(MODELES_FILM.map((m) => m.theme.toLowerCase()).join(' ')).toMatch(/aventure/);
    expect(MODELES_FILM.map((m) => m.theme.toLowerCase()).join(' ')).toMatch(/romance/);
    expect(MODELES_FILM.map((m) => m.theme.toLowerCase()).join(' ')).toMatch(/publicite/);
  });

  it('chaque vignette est un fichier STATIQUE qui existe dans public/', () => {
    for (const m of MODELES_FILM) {
      expect(m.vignette.startsWith('/'), m.id).toBe(true);
      expect(existsSync(join('public', m.vignette.replace(/^\//, ''))), `${m.id} → ${m.vignette}`).toBe(true);
    }
  });

  it('quatre PHOTOGRAMMES reels, distincts — plus aucun dessin', () => {
    const fichiers = MODELES_FILM.map((m) => join('public', m.vignette.replace(/^\//, '')));
    const contenus = fichiers.map((f) => readFileSync(f).toString('base64').slice(0, 2000));
    expect(new Set(contenus).size).toBe(4);
    for (const [i, f] of fichiers.entries()) {
      // JPEG (ffd8ff) : une image filmee, pas un SVG dessine.
      expect(readFileSync(f).subarray(0, 3).toString('hex'), f).toBe('ffd8ff');
      expect(MODELES_FILM[i].vignette, f).toMatch(/\.jpg$/);
      expect(statSync(f).size).toBeLessThan(150_000);
    }
  });

  it('chaque histoire donne assez de phrases pour le nombre de scenes demande', () => {
    for (const m of MODELES_FILM) {
      const p = phrases(m.valeurs.histoire);
      // Au moins une phrase par scene, sinon une scene arriverait vide.
      expect(p.length, m.id).toBeGreaterThanOrEqual(m.valeurs.nbScenes);
      expect(m.valeurs.nbScenes, m.id).toBeGreaterThanOrEqual(SCENES_MIN);
      expect(m.valeurs.nbScenes, m.id).toBeLessThanOrEqual(SCENES_MAX);
      // Le decoupage retient bien ce que le modele demande.
      expect(nombreDeScenes(p.length, m.valeurs.nbScenes), m.id).toBe(m.valeurs.nbScenes);
    }
  });

  it('chaque histoire contient de vraies REPLIQUES, reconnues comme telles', () => {
    for (const m of MODELES_FILM) {
      const citees = phrases(m.valeurs.histoire).map(citation).filter(Boolean);
      expect(citees.length, m.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('chaque personnage du casting est NOMME dans l’histoire — sinon il n’apparaitrait dans aucun plan', () => {
    for (const m of MODELES_FILM) {
      const casting = m.valeurs.casting.map((c, i) => ({ ...c, id: `p${i}` }));
      for (const c of casting) {
        expect(personnagesCites(m.valeurs.histoire, casting as never), `${m.id} / ${c.nom}`).toContain(c.id);
      }
      // Et chacun a une apparence decrite : c'est elle qui sert de reference visuelle.
      for (const c of m.valeurs.casting) expect(c.description.length, `${m.id} / ${c.nom}`).toBeGreaterThan(10);
    }
  });

  it('format, qualite et ambiance sont renseignes', () => {
    for (const m of MODELES_FILM) {
      expect(['16:9', '9:16'], m.id).toContain(m.valeurs.format);
      expect(['brouillon', 'standard', 'cinema'], m.id).toContain(m.valeurs.qualite);
      expect(m.ambiance.length, m.id).toBeGreaterThan(20);
      expect(m.scenes.length, m.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('un modele n’ecrase jamais une saisie sans confirmation', () => {
  it('page vierge : un seul clic applique', () => {
    const surAppliquer = vi.fn();
    render(<ModelesFilm aDesSaisies={false} surAppliquer={surAppliquer} surPartirDeZero={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Utiliser l’exemple L’ascension/i));
    expect(surAppliquer).toHaveBeenCalledTimes(1);
    expect(surAppliquer.mock.calls[0][0].id).toBe('aventure');
  });

  it('saisie existante : le premier clic DEMANDE, le second applique', () => {
    const surAppliquer = vi.fn();
    render(<ModelesFilm aDesSaisies surAppliquer={surAppliquer} surPartirDeZero={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Utiliser l’exemple Deux cafes/i));
    expect(surAppliquer).not.toHaveBeenCalled();
    expect(screen.getByText(/Remplacer votre saisie/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Confirmer/i));
    expect(surAppliquer).toHaveBeenCalledTimes(1);
    expect(surAppliquer.mock.calls[0][0].id).toBe('romance');
  });

  it('annuler laisse la saisie intacte', () => {
    const surAppliquer = vi.fn();
    render(<ModelesFilm aDesSaisies surAppliquer={surAppliquer} surPartirDeZero={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Utiliser l’exemple Trente secondes/i));
    fireEvent.click(screen.getByLabelText(/Annuler le remplacement/i));
    expect(surAppliquer).not.toHaveBeenCalled();
    expect(screen.queryByText(/Remplacer votre saisie/i)).toBeNull();
  });

  it('« partir de zero » suit la MEME regle', () => {
    const surPartirDeZero = vi.fn();
    const { unmount } = render(<ModelesFilm aDesSaisies surAppliquer={vi.fn()} surPartirDeZero={surPartirDeZero} />);
    fireEvent.click(screen.getByText(/Partir de zero/i));
    expect(surPartirDeZero).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Confirmer/i));
    expect(surPartirDeZero).toHaveBeenCalledTimes(1);
    unmount();

    const direct = vi.fn();
    render(<ModelesFilm aDesSaisies={false} surAppliquer={vi.fn()} surPartirDeZero={direct} />);
    fireEvent.click(screen.getByText(/Partir de zero/i));
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it('aucune boite native : elle bloquerait tout le fil de la page', () => {
    const code = src('src/components/cinema/ModelesFilm.tsx');
    // L'appel, pas la mention : le fichier EXPLIQUE en commentaire pourquoi il n'en fait pas.
    expect(code).not.toMatch(/window\.(confirm|alert|prompt)\(/);
  });

  it('choisir un modele ne declenche AUCUN appel reseau', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<ModelesFilm aDesSaisies={false} surAppliquer={vi.fn()} surPartirDeZero={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Utiliser l’exemple L’ascension/i));
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    // Et le composant ne connait meme pas `fetch`.
    expect(src('src/components/cinema/ModelesFilm.tsx')).not.toContain('fetch(');
  });

  it('cote page, appliquer un modele REMPLIT des champs et ne compose rien', () => {
    const page = src('src/app/dashboard/cinema/page.tsx');
    const i = page.indexOf('const appliquerModele = (m: ModeleFilm) => {');
    expect(i).toBeGreaterThan(0);
    const corps = page.slice(i, page.indexOf('};', i));
    // Que des `set…` de formulaire : aucun appel, aucune production, aucune generation.
    for (const interdit of ['appel(', 'composer', 'produire', 'generer', 'fetch(']) {
      expect(corps, interdit).not.toContain(interdit);
    }
    expect(corps).toContain('setHistoire(m.valeurs.histoire)');
    expect(corps).toContain('setCasting(');
  });

  it('la confirmation n’est exigee QUE s’il y a quelque chose a perdre', () => {
    const page = src('src/app/dashboard/cinema/page.tsx');
    expect(page).toContain('const aDesSaisies = !!film');
    expect(page).toContain('(titre === TITRE_EXEMPLE && histoire === HISTOIRE_EXEMPLE) || (!titre.trim() && !histoire.trim())');
  });
});

describe('exemple science-fiction : complet, et sans aucune génération', () => {
  const sf = MODELES_FILM.find((m) => m.id === 'scifi')!;
  it('histoire, deux personnages, deux répliques, quatre scènes, ambiance et style science-fiction', () => {
    expect(sf.nom).toBe('Signal perdu');
    expect(sf.valeurs.nbScenes).toBe(4);
    expect(sf.valeurs.casting.map((c) => c.nom)).toEqual(['Ada', 'Orion']);
    expect(phrases(sf.valeurs.histoire).map(citation).filter(Boolean)).toHaveLength(2);
    expect(sf.scenes).toHaveLength(4);
    expect(sf.ambiance).toMatch(/neons|etoiles/);
    expect(sf.valeurs.styleCinema).toBe('scifi');
    // Les autres exemples ne choisissent aucun style : leur comportement est inchange.
    for (const m of MODELES_FILM.filter((x) => x.id !== 'scifi')) expect(m.valeurs.styleCinema).toBeUndefined();
  });
});
