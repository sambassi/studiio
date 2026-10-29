/**
 * CINEMA IA — l'interface de direction : choisir n'appelle que `surChoisir` (jamais de reseau),
 * les miniatures sont annoncees comme illustrations, et rien n'impose d'emoji ni de gros bouton.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { SelecteurStyleFilm, SelecteurStyleScene, SelecteurCamera, ResumeStyle, PlanAregenerer } from '@/components/cinema/DirectionCinema';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('style du film', () => {
  it('six choix, six PHOTOGRAMMES distincts, chargement differe', () => {
    render(<SelecteurStyleFilm valeur={null} surChoisir={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    const imgs = Array.from(document.querySelectorAll('img'));
    expect(new Set(imgs.map((i) => i.getAttribute('src'))).size).toBe(6);
    for (const i of imgs) {
      expect(i.getAttribute('alt')).toBe('');
      expect(i.getAttribute('src')).toMatch(/^\/cinema-styles-extraits\/\w+\.jpg$/);
      expect(i.getAttribute('loading')).toBe('lazy');
    }
    // Aucun extrait tant qu'on n'a rien demande : la page ne charge pas six videos.
    expect(document.querySelector('[data-direction="extrait-style"]')).toBeNull();
  });

  it('un clic choisit le style ET demande son extrait a l’apercu principal', () => {
    const choix = vi.fn(); const montrer = vi.fn();
    render(<SelecteurStyleFilm valeur={null} surChoisir={choix} surMontrerExemple={montrer} />);
    fireEvent.click(screen.getByRole('radio', { name: /Film noir/ }));
    expect(choix).toHaveBeenLastCalledWith('noir');
    expect(montrer).toHaveBeenLastCalledWith('noir');
    // UN SEUL apercu dans la page : la grille ne joue aucune video.
    expect(document.querySelector('video')).toBeNull();
  });

  it('chaque carte demande SON extrait : six demandes différentes', () => {
    const montrer = vi.fn();
    render(<SelecteurStyleFilm valeur={null} surChoisir={() => {}} surMontrerExemple={montrer} />);
    for (const s of ['Cinéma réaliste', 'Film noir', 'Publicité premium', 'Romantique', 'Documentaire', 'Science-fiction']) {
      fireEvent.click(screen.getByRole('radio', { name: new RegExp(s) }));
    }
    expect(new Set(montrer.mock.calls.map((c) => c[0])).size).toBe(6);
  });

  it('le detail du style actif (eclairage, palette, ambiance, texture) est disponible', () => {
    render(<SelecteurStyleFilm valeur="romantique" surChoisir={() => {}} />);
    expect(document.body.textContent).toMatch(/Eclairage :.*Palette :.*Ambiance :.*Texture :/s);
  });
});

describe('exception de scene et resume', () => {
  it('la liste propose « Style du film » par defaut, indique le style herite, et renvoie null pour y revenir', () => {
    const choix = vi.fn();
    render(<SelecteurStyleScene valeur={null} styleFilm="noir" surChoisir={choix} />);
    const sel = screen.getByLabelText('Style de cette scene') as HTMLSelectElement;
    expect(sel.options[0].textContent).toBe('Style du film (Film noir)');
    fireEvent.change(sel, { target: { value: 'scifi' } });
    expect(choix).toHaveBeenLastCalledWith('scifi');
    fireEvent.change(sel, { target: { value: '' } });
    expect(choix).toHaveBeenLastCalledWith(null);
  });

  it('le resume compte les scenes en exception', () => {
    render(<ResumeStyle styleFilm="noir" exceptions={2} />);
    expect(document.body.textContent).toMatch(/Film noir/);
    expect(document.body.textContent).toMatch(/2 scenes avec un style different/);
  });
});

describe('camera', () => {
  it('huit options ; l’automatique montre le mouvement qu’il choisirait ; le choix est transmis', () => {
    const choix = vi.fn();
    render(<SelecteurCamera valeur="auto" automatique="orbite" surChoisir={choix} />);
    const sel = screen.getByLabelText('Mouvement de camera de ce plan') as HTMLSelectElement;
    expect(sel.options).toHaveLength(8);
    expect(sel.options[0].textContent).toMatch(/^Automatique \(.+\)$/);
    fireEvent.change(sel, { target: { value: 'pano_gauche' } });
    expect(choix).toHaveBeenLastCalledWith('pano_gauche');
  });

  it('l’info « pas une garantie » est repliee derriere une icone', () => {
    render(<SelecteurCamera valeur="fixe" automatique="orbite" surChoisir={() => {}} />);
    expect(document.body.textContent).not.toMatch(/peut s’en ecarter/);
    fireEvent.click(screen.getByLabelText('A propos du mouvement de camera'));
    expect(document.body.textContent).toMatch(/peut s’en ecarter/);
  });
});

describe('anciens films et plans a regenerer', () => {
  it('un ancien film propose « Camera d’origine », pas une automatique qu’il n’a jamais eue', () => {
    render(<SelecteurCamera valeur="auto" automatique="orbite" ancien surChoisir={() => {}} />);
    const sel = screen.getByLabelText('Mouvement de camera de ce plan') as HTMLSelectElement;
    expect(sel.options[0].textContent).toBe('Camera d’origine (douce)');
  });
  it('le signalement dit que le media est conserve et que regenerer demande le devis, sans bouton de depense', () => {
    render(<PlanAregenerer genre="video" />);
    expect(document.body.textContent).toMatch(/Video a regenerer : direction modifiee/);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-direction="a-regenerer"]')!.getAttribute('title')).toMatch(/conserve.*devis a valider/);
  });
});

describe('regles de design du projet', () => {
  it('aucun emoji dans le composant ; aucune classe Tailwind arbitraire purgeable', () => {
    const src = readFileSync('src/components/cinema/DirectionCinema.tsx', 'utf8');
    expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(src).not.toMatch(/(aspect|w|h)-\[/);
  });
});
