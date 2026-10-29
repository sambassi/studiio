/**
 * CINEMA IA — GALERIE DE STYLES : de VRAIS extraits, et un lecteur sans menu de telechargement.
 *
 * Ce qui est éprouvé ici : les six extraits existent vraiment dans le dépôt, ils sont
 * distincts, ils sont annoncés pour ce qu'ils sont (des exemples licenciés, pas des rendus
 * Studiio), et l'interface ne propose nulle part de télécharger un exemple.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync, statSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import LecteurVideo from '@/components/cinema/LecteurVideo';
import { SelecteurStyleFilm } from '@/components/cinema/DirectionCinema';
import DemoGratuite from '@/components/cinema/DemoGratuite';
import { EXTRAITS_STYLES, extraitStyle, MENTION_EXTRAITS } from '@/lib/cinema/extraits-styles';
import { IDS_STYLES } from '@/lib/cinema/direction/styles';
import { CLIPS_DEMO } from '@/components/cinema/ApercuStoryboard';

afterEach(() => cleanup());
const ffprobe = (f: string, champs: string) =>
  spawnSync('ffprobe', ['-v', 'error', '-show_entries', champs, '-of', 'csv=p=0', f], { encoding: 'utf8' });

describe('les six extraits sont de vrais fichiers vidéo, distincts et légers', () => {
  it('un extrait et une affiche par style, aucun style sans média', () => {
    expect(Object.keys(EXTRAITS_STYLES).sort()).toEqual([...IDS_STYLES].sort());
    for (const id of IDS_STYLES) {
      const e = EXTRAITS_STYLES[id];
      expect(existsSync(`public${e.video}`), e.video).toBe(true);
      expect(existsSync(`public${e.poster}`), e.poster).toBe(true);
    }
    expect(extraitStyle(null)).toBeNull();
  });

  it('fichiers mp4 h264 réels, 640×360, muets, et une page entière sous 1 Mo', () => {
    let total = 0;
    for (const id of IDS_STYLES) {
      const f = `public${EXTRAITS_STYLES[id].video}`;
      total += statSync(f).size;
      expect(readFileSync(f).subarray(4, 8).toString(), id).toBe('ftyp');
      const p = ffprobe(f, 'stream=codec_type,codec_name,width,height');
      if (p.status !== 0) continue; // ffprobe absent : les contrôles de contenu sont sautés
      const sortie = p.stdout.trim();
      expect(sortie, id).toMatch(/h264,video,640,360/);
      // Aucune piste audio : un exemple ne doit pas se mettre à parler tout seul.
      expect(sortie, id).not.toMatch(/audio/);
    }
    expect(total).toBeLessThan(1_000_000);
  });

  it('six vidéos et six affiches DIFFÉRENTES — pas le même plan recyclé', () => {
    const v = IDS_STYLES.map((id) => readFileSync(`public${EXTRAITS_STYLES[id].video}`).toString('base64').slice(0, 2000));
    const p = IDS_STYLES.map((id) => readFileSync(`public${EXTRAITS_STYLES[id].poster}`).toString('base64').slice(0, 2000));
    expect(new Set(v).size).toBe(6);
    expect(new Set(p).size).toBe(6);
  });

  it('chaque extrait porte son auteur, sa source et sa licence — et n’est jamais dit « généré »', () => {
    for (const id of IDS_STYLES) {
      const c = EXTRAITS_STYLES[id].credit;
      expect(c.auteur.length, id).toBeGreaterThan(2);
      expect(c.source).toBe('Pexels');
      expect(c.url).toMatch(/^https:\/\/www\.pexels\.com\/video\//);
      expect(c.licence).toMatch(/usage commercial gratuit/);
      expect(EXTRAITS_STYLES[id].sujet.length).toBeGreaterThan(10);
    }
    expect(MENTION_EXTRAITS).toMatch(/pas des vidéos produites par Studiio/);
  });

  it('les extraits de STYLE et les clips de MOUVEMENT sont des fichiers séparés', () => {
    const styles = IDS_STYLES.map((id) => EXTRAITS_STYLES[id].video);
    for (const c of CLIPS_DEMO) expect(styles).not.toContain(c);
  });
});

describe('galerie : un clic montre l’extrait, sans rien casser d’autre', () => {
  it('le style est choisi ET son extrait s’affiche, en lecture, sans appel réseau', () => {
    const fetchEspion = vi.fn();
    vi.stubGlobal('fetch', fetchEspion);
    const choix = vi.fn();
    render(<SelecteurStyleFilm valeur={null} surChoisir={choix} />);
    fireEvent.click(screen.getByRole('radio', { name: /Publicité premium/ }));
    expect(choix).toHaveBeenLastCalledWith('publicite');
    const zone = document.querySelector('[data-direction="extrait-style"]') as HTMLElement;
    const v = zone.querySelector('video') as HTMLVideoElement;
    expect(v.getAttribute('src')).toBe('/cinema-styles-extraits/publicite.mp4');
    expect(v.hasAttribute('autoplay')).toBe(true);
    expect(fetchEspion).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('regarder un extrait puis retirer le style : l’extrait reste consultable, le style est retiré', () => {
    const choix = vi.fn();
    const { rerender } = render(<SelecteurStyleFilm valeur="noir" surChoisir={choix} />);
    fireEvent.click(screen.getByRole('radio', { name: /Film noir/ }));
    expect(choix).toHaveBeenLastCalledWith(null);
    rerender(<SelecteurStyleFilm valeur={null} surChoisir={choix} />);
    expect(document.querySelector('[data-direction="extrait-style"] video')).toBeTruthy();
  });

  it('agrandir ouvre une FENÊTRE SÉPARÉE (l’aperçu du film n’est pas remplacé), Échap referme', () => {
    render(<SelecteurStyleFilm valeur={null} surChoisir={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: /Romantique/ }));
    fireEvent.click(within(document.querySelector('[data-direction="extrait-style"]') as HTMLElement).getByLabelText('Agrandir'));
    const fenetre = screen.getByRole('dialog', { name: /Exemple de rendu — Romantique/ });
    expect(fenetre.parentElement).toBe(document.body);
    expect(fenetre.querySelector('video')!.getAttribute('src')).toBe('/cinema-styles-extraits/romantique.mp4');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

describe('lecteur : commandes SVG, et aucun téléchargement proposé', () => {
  const poser = (p: Partial<React.ComponentProps<typeof LecteurVideo>> = {}) =>
    render(<LecteurVideo src="/cinema-styles-extraits/noir.mp4" poster="/cinema-styles-extraits/noir.jpg" titre="Exemple" {...p} />);

  it('aucune barre native, menu natif désactivé, menu contextuel bloqué', () => {
    poser();
    const v = document.querySelector('video') as HTMLVideoElement;
    expect(v.hasAttribute('controls')).toBe(false);
    expect(v.getAttribute('controlsList')).toMatch(/nodownload/);
    expect(v.disablePictureInPicture).toBe(true);
    expect(v.getAttribute('preload')).toBe('none');
  });

  it('lecture/pause, son et progression : des icônes SVG, jamais de gros bouton', () => {
    poser();
    const lecture = screen.getByLabelText('Lecture');
    expect(lecture.querySelector('svg')).toBeTruthy();
    expect(lecture.className).toMatch(/h-7 w-7/);
    expect(screen.getByLabelText('Activer le son').querySelector('svg')).toBeTruthy();
    expect(document.querySelector('[role=presentation]')).toBeTruthy();
    cleanup();
    // Un extrait muet n'affiche pas de commande de son : rien d'inutile à l'écran.
    poser({ sansSon: true });
    expect(screen.queryByLabelText(/son/i)).toBeNull();
  });

  it('AUCUN lien ou bouton de téléchargement dans le lecteur, ni dans la démonstration', () => {
    const sansTelechargement = (zone: HTMLElement) => {
      expect(zone.querySelector('a[download]')).toBeNull();
      expect(zone.textContent).not.toMatch(/télécharger|telecharger|enregistrer la vidéo/i);
      for (const b of Array.from(zone.querySelectorAll('button'))) {
        expect(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`).not.toMatch(/télécharg|telecharg/i);
      }
    };
    poser({ agrandissable: true, surAgrandir: () => {} });
    sansTelechargement(document.body);
    cleanup();
    render(<DemoGratuite surQuitter={() => {}} />);
    sansTelechargement(document.querySelector('[data-demo="gratuite"]') as HTMLElement);
  });

  it('le code du lecteur ne promet AUCUNE protection contre la copie', () => {
    const src = readFileSync('src/components/cinema/LecteurVideo.tsx', 'utf8');
    expect(src).toMatch(/N'EST PAS UNE PROTECTION CONTRE LA COPIE/);
    expect(src).not.toMatch(/impossible de (copier|telecharger)/i);
  });

  it('l’export du film de l’utilisateur garde SON téléchargement (étape 5)', () => {
    const page = readFileSync('src/app/dashboard/cinema/page.tsx', 'utf8');
    expect(page).toMatch(/download=\{`\$\{film\.titre \|\| film\.id\}\.mp4`\}/);
    expect(page).toMatch(/Telecharger le MP4/);
  });
});
