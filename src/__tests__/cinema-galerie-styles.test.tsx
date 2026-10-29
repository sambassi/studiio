/**
 * CINEMA IA — GALERIE DE STYLES : de VRAIS extraits, et un lecteur sans menu de telechargement.
 *
 * Ce qui est éprouvé ici : les six extraits existent vraiment dans le dépôt, ils sont
 * distincts, ils sont annoncés pour ce qu'ils sont (des exemples licenciés, pas des rendus
 * Studiio), et l'interface ne propose nulle part de télécharger un exemple.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync, statSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import LecteurVideo from '@/components/cinema/LecteurVideo';
import { SelecteurStyleFilm } from '@/components/cinema/DirectionCinema';
import ChoixMouvements from '@/components/cinema/ChoixMouvements';
import ApercuExemple from '@/components/cinema/ApercuExemple';
import { MOUVEMENTS_CAMERA } from '@/lib/cinema/mouvements-camera';
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

  it('fichiers mp4 h264 réels, 1280×720, muets, et un dossier sous 3 Mo', () => {
    let total = 0;
    for (const id of IDS_STYLES) {
      const f = `public${EXTRAITS_STYLES[id].video}`;
      total += statSync(f).size;
      expect(readFileSync(f).subarray(4, 8).toString(), id).toBe('ftyp');
      const p = ffprobe(f, 'stream=codec_type,codec_name,width,height');
      if (p.status !== 0) continue; // ffprobe absent : les contrôles de contenu sont sautés
      const sortie = p.stdout.trim();
      expect(sortie, id).toMatch(/h264,video,1280,720/);
      // Aucune piste audio : un exemple ne doit pas se mettre à parler tout seul.
      expect(sortie, id).not.toMatch(/audio/);
    }
    expect(total).toBeLessThan(3_000_000);
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
    // Licence Pexels : ne jamais laisser croire que les personnes filmees recommandent Studiio.
    expect(MENTION_EXTRAITS).toMatch(/aucun lien avec Studiio ni ne le recommandent/);
  });

  it('les extraits de STYLE et les plans de MOUVEMENT sont des fichiers séparés', () => {
    const styles = IDS_STYLES.map((id) => EXTRAITS_STYLES[id].video);
    for (const m of MOUVEMENTS_CAMERA) expect(styles).not.toContain(m.video);
    expect(CLIPS_DEMO).toEqual(MOUVEMENTS_CAMERA.map((m) => m.video));
  });

  it('les quatre mouvements sont de vrais fichiers filmes, distincts, avec credit', () => {
    expect(MOUVEMENTS_CAMERA).toHaveLength(4);
    expect(MOUVEMENTS_CAMERA.map((m) => m.camera)).toEqual(['travelling_avant', 'pano_droite', 'suivi_lateral', 'orbite']);
    const vus = new Set<string>();
    for (const m of MOUVEMENTS_CAMERA) {
      expect(existsSync(`public${m.video}`), m.video).toBe(true);
      expect(existsSync(`public${m.poster}`), m.poster).toBe(true);
      expect(readFileSync(`public${m.video}`).subarray(4, 8).toString()).toBe('ftyp');
      vus.add(readFileSync(`public${m.video}`).toString('base64').slice(0, 2000));
      expect(m.credit.url).toMatch(/^https:\/\/www\.pexels\.com\/video\//);
      expect(m.quoiRegarder.length).toBeGreaterThan(15);
      const p = ffprobe(`public${m.video}`, 'stream=codec_type,codec_name,width,height');
      if (p.status === 0) {
        expect(p.stdout.trim(), m.camera).toMatch(/h264,video,1280,720/);
        expect(p.stdout.trim(), m.camera).not.toMatch(/audio/);
      }
    }
    expect(vus.size).toBe(4);
  });

  it('plus aucun clip dessine : le dossier des anciennes demonstrations a disparu', () => {
    expect(existsSync('public/cinema-demo')).toBe(false);
  });
});

describe('galerie : un clic choisit le style ET demande l’exemple à l’aperçu', () => {
  it('le style est choisi et l’exemple est DEMANDE — aucun second lecteur dans la colonne', () => {
    const choix = vi.fn(); const montrer = vi.fn();
    render(<SelecteurStyleFilm valeur={null} surChoisir={choix} surMontrerExemple={montrer} />);
    fireEvent.click(screen.getByRole('radio', { name: /Publicité premium/ }));
    expect(choix).toHaveBeenLastCalledWith('publicite');
    expect(montrer).toHaveBeenLastCalledWith('publicite');
    // La grille ne joue aucune vidéo elle-même.
    expect(document.querySelector('video')).toBeNull();
  });

  it('sans aperçu disponible, les cartes choisissent le style sans rien exiger', () => {
    const choix = vi.fn();
    render(<SelecteurStyleFilm valeur={null} surChoisir={choix} />);
    fireEvent.click(screen.getByRole('radio', { name: /Film noir/ }));
    expect(choix).toHaveBeenLastCalledWith('noir');
  });

  it('l’aperçu d’exemple montre le bon extrait, son crédit, et le retour au film', () => {
    const revenir = vi.fn();
    render(<ApercuExemple exemple={{ type: 'style', id: 'romantique' }} format="16:9" surRevenir={revenir} surAgrandir={() => {}} />);
    const v = document.querySelector('video') as HTMLVideoElement;
    expect(v.getAttribute('src')).toBe('/cinema-styles-extraits/romantique.mp4');
    expect(v.hasAttribute('controls')).toBe(false);
    expect(document.body.textContent).toMatch(/Exemple de style — Romantique/);
    expect(document.body.textContent).toMatch(/Naveen G \(Pexels\)/);
    fireEvent.click(screen.getByText('Revenir à mon film'));
    expect(revenir).toHaveBeenCalled();
  });

  it('un mouvement s’affiche dans le même aperçu, avec ce qu’il faut regarder', () => {
    render(<ApercuExemple exemple={{ type: 'mouvement', id: 'orbite' }} format="16:9" surRevenir={() => {}} surAgrandir={() => {}} />);
    expect(document.body.textContent).toMatch(/Mouvement de caméra — Orbite/);
    expect(document.body.textContent).toMatch(/tourne autour/);
    expect(document.querySelector('video')!.getAttribute('src')).toBe('/cinema-mouvements/orbite.mp4');
  });

  it('le format 9:16 garde un cadre vertical pour l’exemple', () => {
    render(<ApercuExemple exemple={{ type: 'style', id: 'noir' }} format="9:16" surRevenir={() => {}} surAgrandir={() => {}} />);
    const cadre = document.querySelector('video')!.closest('div')!.parentElement as HTMLElement;
    expect(cadre.style.aspectRatio.replace(/\s/g, '')).toMatch(/9\/16|0\.5625/);
  });

  it('un exemple inconnu n’invente rien', () => {
    const { container } = render(<ApercuExemple exemple={{ type: 'mouvement', id: 'zoom_fou' }} format="16:9" surRevenir={() => {}} surAgrandir={() => {}} />);
    expect(container.firstChild).toBeNull();
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
    render(<ApercuExemple exemple={{ type: 'mouvement', id: 'suivi_lateral' }} format="16:9" surRevenir={() => {}} surAgrandir={() => {}} />);
    sansTelechargement(document.querySelector('[data-apercu="exemple"]') as HTMLElement);
    cleanup();
    render(<ChoixMouvements actif={null} surChoisir={() => {}} />);
    sansTelechargement(document.querySelector('[data-bloc="mouvements"]') as HTMLElement);
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
