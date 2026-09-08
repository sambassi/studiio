/**
 * A_5b — LA BANQUE AUDIO À L'ÉCRAN.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ UN SEUL MORCEAU À LA FOIS, ET C'EST STRUCTUREL
 * ---------------------------------------------------------------------------
 *
 * Un `<audio>` par carte laisserait deux musiques jouer ensemble dès le
 * second clic — et vingt fichiers se télécharger au chargement. Il y a donc
 * UN élément audio pour toute la grille : lancer une piste arrête la
 * précédente par construction, pas par précaution.
 *
 * ⚠️ ET RIEN NE SE TÉLÉCHARGE AVANT D'ÊTRE ÉCOUTÉ. La `src` n'est posée qu'au
 * clic, et le proxy de stockage répond en `Accept-Ranges: bytes` — le
 * navigateur ne descend que ce qu'il écoute.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  LIBELLES_MOOD, POINTS_FORME_ONDE, type PisteAudio,
} from '@/lib/creatif/audio';

const Bibliotheque = (await import('@/components/creer/BibliothequeAudio')).default;
const { adresseEcoute, traceFormeOnde } =
  await import('@/components/creer/BibliothequeAudio');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const GRILLE = lire('src/components/creer/BibliothequeAudio.tsx');
const HOOK = lire('src/lib/hooks/useBanqueAudio.ts');
const REGLAGES = lire('src/components/creer/ReglagesAudio.tsx');

const U = 'user-42';
const piste = (n: string, extra: Partial<PisteAudio> = {}): PisteAudio => ({
  cle: `${U}/musiques/${n}.mp3`,
  nom: n,
  moods: ['energique'],
  dureeMs: 185_000,
  silenceInitialMs: 800,
  octets: 4_200_000,
  empreinte: `4200000-${n}`,
  droitsConfirmesLe: '2026-09-08T10:00:00.000Z',
  formeOnde: Buffer.from(
    Uint8Array.from(Array.from({ length: POINTS_FORME_ONDE }, (_, i) => (i * 4) % 256)),
  ).toString('base64'),
  ...extra,
});

const PISTES = [
  piste('Sprint', { moods: ['sport', 'energique'] }),
  piste('Montee', { moods: ['calme'] }),
  piste('Generique', { moods: [] }),
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rendre = (extra = {}) => render(
  <Bibliotheque pistes={PISTES} cleActive={null} onChoisir={() => {}} {...extra} />,
);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La grille', () => {
  it('1.1 « Tout » montre les pistes du compte', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-audio-rayon="tout"]') as HTMLElement);
    expect(container.querySelectorAll('[data-audio-carte]').length).toBe(3);
  });

  it('1.2 la piste ACTIVE est la première de « Pour vous »', () => {
    const { container } = rendre({ cleActive: PISTES[2].cle });
    const premiere = container.querySelector('[data-audio-carte]');
    expect(premiere?.getAttribute('data-audio-carte')).toBe(PISTES[2].cle);
  });

  it('1.3 ⚠️ LES RAYONS NE MONTRENT QUE LES AMBIANCES PRÉSENTES', () => {
    const { container } = rendre();
    expect(container.querySelector('[data-audio-rayon="sport"]')).not.toBeNull();
    expect(container.querySelector('[data-audio-rayon="calme"]')).not.toBeNull();
    // Un rayon vide serait un titre suivi de rien.
    expect(container.querySelector('[data-audio-rayon="urbain"]')).toBeNull();
  });

  it('1.4 la recherche porte sur le nom et sur l’ambiance', () => {
    const { container } = rendre();
    const champ = container.querySelector('[data-audio-recherche]') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: 'sprint' } });
    expect(container.querySelectorAll('[data-audio-carte]').length).toBe(1);
    fireEvent.change(champ, { target: { value: 'calme' } });
    expect(container.querySelector(`[data-audio-carte="${PISTES[1].cle}"]`)).not.toBeNull();
    fireEvent.change(champ, { target: { value: 'zzz' } });
    expect(container.querySelector('[data-audio-vide]')).not.toBeNull();
  });

  it('1.5 une banque vide invite à en ajouter une', () => {
    const { container } = render(
      <Bibliotheque pistes={[]} cleActive={null} onChoisir={() => {}} />,
    );
    expect(container.querySelector('[data-audio-banque-vide]')).not.toBeNull();
  });

  it('1.6 chaque carte montre sa durée et ses ambiances, en français', () => {
    const { container } = rendre();
    const carte = container.querySelector(`[data-audio-carte="${PISTES[0].cle}"]`)!;
    expect(carte.textContent).toContain('3:05');
    expect(carte.textContent).toContain(LIBELLES_MOOD.sport);
  });

  it('1.7 la forme d’onde est tracée depuis les vraies valeurs', () => {
    const { container } = rendre();
    const onde = container.querySelector(`[data-audio-onde="${PISTES[0].cle}"]`);
    expect(onde).not.toBeNull();
    expect(onde!.getAttribute('viewBox')).toBe(`0 0 ${POINTS_FORME_ONDE} 24`);
    const d = onde!.querySelector('path')!.getAttribute('d')!;
    expect(d.startsWith('M0 ')).toBe(true);
    expect((d.match(/M/g) ?? []).length).toBe(POINTS_FORME_ONDE);
    // Une piste sans onde n'en invente pas une.
    expect(traceFormeOnde([])).toBe('');
  });

  it('1.8 choisir remonte la clé, et re-cliquer la retire', () => {
    const choix: (string | null)[] = [];
    const { container } = rendre({ onChoisir: (c: string | null) => choix.push(c) });
    fireEvent.click(container.querySelector(`[data-audio-choisir="${PISTES[0].cle}"]`) as HTMLElement);
    expect(choix[0]).toBe(PISTES[0].cle);
    cleanup();
    const { container: c2 } = rendre({
      cleActive: PISTES[0].cle, onChoisir: (c: string | null) => choix.push(c),
    });
    fireEvent.click(c2.querySelector(`[data-audio-choisir="${PISTES[0].cle}"]`) as HTMLElement);
    expect(choix[1]).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. L’écoute', () => {
  it('2.1 ⚠️ UN SEUL ÉLÉMENT AUDIO POUR TOUTE LA GRILLE', () => {
    const { container } = rendre();
    expect(container.querySelectorAll('audio').length).toBe(1);
    expect(container.querySelectorAll('[data-audio-ecouter]').length).toBe(3);
  });

  it('2.2 ⚠️ RIEN N’EST TÉLÉCHARGÉ AVANT UN CLIC', () => {
    const { container } = rendre();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('preload')).toBe('none');
    expect(audio.getAttribute('src')).toBeNull();
  });

  it('2.3 lire pose la source et saute le blanc de départ', () => {
    const { container } = rendre();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    const jouer = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    fireEvent.click(container.querySelector(`[data-audio-ecouter="${PISTES[0].cle}"]`) as HTMLElement);
    expect(audio.src).toContain(encodeURIComponent('musiques'));
    // 800 ms de blanc mesurés à l'import : l'écoute commence après.
    expect(audio.currentTime).toBeCloseTo(0.8, 3);
    expect(jouer).toHaveBeenCalled();
  });

  it('2.4 l’adresse d’écoute passe par le proxy existant, pas par une route neuve', () => {
    expect(adresseEcoute(`${U}/musiques/a b.mp3`))
      .toBe(`/storage/v1/object/public/audio/${U}/musiques/a%20b.mp3`);
    // Le proxy gère déjà les requêtes partielles : rien à réinventer.
    expect(sansProse(lire('src/app/storage/v1/object/public/[bucket]/[...path]/route.ts')))
      .toContain("'Accept-Ranges': 'bytes'");
  });

  it('2.5 aucune URL n’est fabriquée à la main dans la grille', () => {
    expect(sansProse(GRILLE)).not.toMatch(/https?:\/\//);
    expect(sansProse(GRILLE)).toContain('BUCKET_MUSIQUE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Renommer, retirer, aimer', () => {
  it('3.1 renommer ne renomme pas le fichier', () => {
    const noms: [string, string][] = [];
    const { container } = rendre({ onRenommer: (c: string, n: string) => noms.push([c, n]) });
    fireEvent.click(container.querySelector(`[data-audio-renommer="${PISTES[0].cle}"]`) as HTMLElement);
    fireEvent.change(
      container.querySelector(`[data-audio-renommer-champ="${PISTES[0].cle}"]`) as HTMLInputElement,
      { target: { value: 'Nouveau titre' } },
    );
    fireEvent.click(
      container.querySelector(`[data-audio-renommer-valider="${PISTES[0].cle}"]`) as HTMLElement,
    );
    expect(noms).toEqual([[PISTES[0].cle, 'Nouveau titre']]);
    // La clé — donc le fichier — n'a pas bougé.
    expect(noms[0][0]).toBe(PISTES[0].cle);
  });

  it('3.2 le cœur se bascule depuis la carte', () => {
    const aimes: string[] = [];
    const { container } = rendre({
      favoris: [PISTES[1].cle], onBasculerFavori: (c: string) => aimes.push(c),
    });
    const coeur = container.querySelector(`[data-audio-favori="${PISTES[1].cle}"]`) as HTMLElement;
    expect(coeur.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(coeur);
    expect(aimes).toEqual([PISTES[1].cle]);
  });

  it('3.3 les favoris et les récents ont leurs rayons', () => {
    const { container } = rendre({ favoris: [PISTES[1].cle], recents: [PISTES[2].cle] });
    fireEvent.click(container.querySelector('[data-audio-rayon="favoris"]') as HTMLElement);
    expect(container.querySelectorAll('[data-audio-carte]').length).toBe(1);
    fireEvent.click(container.querySelector('[data-audio-rayon="recents"]') as HTMLElement);
    expect(container.querySelector(`[data-audio-carte="${PISTES[2].cle}"]`)).not.toBeNull();
  });

  it('3.4 retirer remonte la clé', () => {
    const retires: string[] = [];
    const { container } = rendre({ onRetirer: (c: string) => retires.push(c) });
    fireEvent.click(container.querySelector(`[data-audio-retirer="${PISTES[0].cle}"]`) as HTMLElement);
    expect(retires).toEqual([PISTES[0].cle]);
  });

  it('3.5 ⚠️ RETIRER LA PISTE CHOISIE LAISSE LE MONTAGE SANS MUSIQUE', () => {
    // Plutôt qu'avec une référence morte.
    expect(REGLAGES).toContain('if (valeur.musique?.cle === cle)');
    expect(REGLAGES).toContain('majuscule({ musique: null })');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le chargement', () => {
  it('4.1 ⚠️ LA BANQUE N’EST PAS DEMANDÉE AU CHARGEMENT DE LA PAGE', () => {
    expect(sansProse(HOOK)).toContain('if (actif) void charger()');
    expect(sansProse(REGLAGES)).toContain('useBanqueAudio(!desactive)');
  });

  it('4.2 ce qui revient, ce sont des fiches — pas des octets audio', () => {
    const h = sansProse(HOOK);
    expect(h).toContain("fetch(ADRESSE, { credentials: 'same-origin' })");
    expect(h).not.toMatch(/arrayBuffer|blob\(/);
  });

  it('4.3 renommer et retirer sont optimistes, avec retour en arrière', () => {
    const h = sansProse(HOOK);
    expect(h).toContain('const avant = pistes');
    expect(h).toContain('setPistes(avant)');
    expect(h).toContain('setErreur(');
  });

  it('4.4 sans réseau, le panneau marche — il n’a simplement rien à proposer', () => {
    expect(sansProse(HOOK)).toMatch(/catch \{[\s\S]{0,120}\} finally/);
  });

  it('4.5 ⚠️ LA BANQUE PASSE DEVANT LA MÉDIATHÈQUE', () => {
    // Choisir dans une liste de fichiers oblige à se souvenir d'un nom ;
    // choisir dans une banque montre une durée, une ambiance, une onde.
    const i = REGLAGES.indexOf('BibliothequeAudio');
    const j = REGLAGES.indexOf('MediaLibrary', i);
    expect(i).toBeGreaterThan(-1);
    expect(REGLAGES).toContain('banque.pistes.length > 0');
    expect(j).toBeGreaterThan(i);
  });
});
