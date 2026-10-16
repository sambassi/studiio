/**
 * M2-c — Créer : avis de PERTINENCE dans le panneau Qualité existant.
 * Sans `contexte`, le panneau est celui de M1 (aucune lecture). Avec lui :
 * badges seulement pour « hors sujet » / « à vérifier », une phrase grise
 * pour le reste, les deux gestes existants, lectures GET seulement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import QualiteRushs, { CLE_ACCEPTES, CLE_PERTINENCE_ACCEPTES, type LecteurFiches } from '@/components/creer/QualiteRushs';
import type { MediaVideo } from '@/lib/creer/medias-video';
import type { AnalyseRush, EchantillonRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis } from '@/lib/creer/smart-montage-regles';
import { ficheContenuRush, type FicheContenuRush } from '@/lib/creer/fiche-contenu';
import { fusionnerFicheV2, type FicheContenuRushV2 } from '@/lib/creer/fiche-contenu-v2';
import { I18nContext } from '@/i18n/client';

const U = (n: string) => `https://studiio.pro/storage/v1/object/public/media/u1/${n}.mp4`;
const cle = (n: string) => `media/u1/${n}.mp4`;
function analyse(url: string, p: Partial<EchantillonRush> = {}): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < 10; t += 0.5) {
    echantillons.push({ t, mouvement: 0.05 + 0.01 * Math.sin(t), luminosite: 0.45, nettete: 0.2, audio: 0.2,
      empreinte: Array.from({ length: 64 }, (_, i) => ((Math.floor(t * 2) * 31 + i * 17) % 97) / 97), ...p });
  }
  return { url, duree: 10, echantillons };
}
const media = (id: string, n: string, source: MediaVideo['source'] = 'rush'): MediaVideo => ({ id, source, url: U(n), type: 'video', duree: 10 });
const v2 = (v1: FicheContenuRush, vision: string[]): FicheContenuRushV2 => fusionnerFicheV2({
  v1, vision: { objets: [], lieu: null, action: null, personnes: null, categories: vision.map((id) => ({ id, confiance: 'moyenne' as const })) },
  parole: null, langue: 'fr', paroleEcoutee: false, etapes: { vision: { etat: 'faite' }, transcription: { etat: 'a_faire' } }, usage: { tarifs: 't' },
});

const FINANCE = contexteMontageDepuis({ theme: 'Finance', titre: 'Épargner chaque mois', objectif: 'expliquer' });
const NUTRITION = contexteMontageDepuis({ theme: 'Nutrition', titre: 'Bien manger' });
const FICHES: Record<string, FicheContenuRush | FicheContenuRushV2 | null> = {
  [U('fete')]: v2(ficheContenuRush({ pexels: { description: 'people dancing at a party' } }), ['dance']), // hors sujet (2 sources)
  [U('danse-seule')]: ficheContenuRush({ pexels: { description: 'a woman dancing hip hop' } }), // à vérifier (1 source)
  [U('budget')]: v2(ficheContenuRush({ pexels: { description: 'a man calculating his monthly budget' } }), ['personal-finance']), // pertinent
  [U('perso')]: ficheContenuRush({ nomFichier: 'converted_1791985445290.mp4' }), // inconnu
};
const LISTE: MediaVideo[] = [media('a', 'fete', 'stock-video'), media('b', 'danse-seule', 'stock-video'), media('c', 'budget', 'stock-video'), media('d', 'perso')];
const MESURES: Record<string, AnalyseRush> = Object.fromEntries(LISTE.map((m) => [m.url, analyse(m.url as string)]));
const analyser = vi.fn(async (u: string) => MESURES[u] ?? null);
const lireFiches = vi.fn<LecteurFiches>(async (urls) => new Map(urls.map((u) => [u, FICHES[u] ?? null])));

beforeEach(() => { try { window.localStorage.clear(); } catch { /* */ } vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('QualiteRushs + pertinence — affichage', () => {
  it('hors sujet et à vérifier : badges et raison ; pertinent et inconnu : une phrase grise', async () => {
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} contexte={FINANCE} lireFiches={lireFiches} />);
    await waitFor(() => expect(document.querySelectorAll('[data-pertinence-rush]')).toHaveLength(2));
    const hs = document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)!;
    expect(hs.getAttribute('data-niveau')).toBe('hors_sujet');
    expect(hs.querySelector('[data-pertinence-badge]')!.textContent).toBe('Hors sujet pour Finance');
    expect(hs.textContent).toMatch(/Hors sujet pour Finance : montre Danse \(description \+ image\)/);
    expect(hs.textContent).toMatch(/Média 1/);
    expect(hs.textContent).toMatch(/Recommandation seulement/);
    const av = document.querySelector(`[data-pertinence-rush="${cle('danse-seule')}"]`)!;
    expect(av.querySelector('[data-pertinence-badge]')!.textContent).toBe('À vérifier');
    expect(av.textContent).toMatch(/À vérifier : semble montrer Danse, sujet Finance \(un seul indice fiable sur le contenu\)/);
    expect(document.querySelector(`[data-pertinence-rush="${cle('budget')}"]`)).toBeNull();
    expect(document.querySelector(`[data-pertinence-rush="${cle('perso')}"]`)).toBeNull();
    expect(document.querySelector('[data-pertinence-resume]')!.textContent).toBe('1 rush cohérent avec le sujet · Contenu non identifié pour 1 rush');
    // Aucune ligne qualité : les mesures sont saines (qualité et pertinence sont séparées).
    expect(document.querySelectorAll('[data-qualite-rush]')).toHaveLength(0);
  });

  it('par défaut AUCUN retrait ; « Écarter ce rush » = le retrait manuel existant, pour CE rush', async () => {
    const onEcarter = vi.fn(() => true);
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={onEcarter} analyser={analyser} contexte={FINANCE} lireFiches={lireFiches} />);
    await waitFor(() => expect(document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)).not.toBeNull());
    expect(onEcarter).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(`[data-pertinence-rush="${cle('fete')}"] [data-pertinence-ecarter]`)!);
    expect(onEcarter).toHaveBeenCalledTimes(1);
    expect(onEcarter).toHaveBeenCalledWith(U('fete'));
  });

  it('« Utiliser quand même » : masqué, mémorisé (clé séparée, par sujet), retrouvé au retour sur le projet', async () => {
    const props = { medias: LISTE, estDurable: () => true, onEcarter: () => true, analyser, lireFiches };
    const { unmount } = render(<QualiteRushs {...props} contexte={FINANCE} />);
    await waitFor(() => expect(document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)).not.toBeNull());
    act(() => { fireEvent.click(document.querySelector(`[data-pertinence-rush="${cle('fete')}"] [data-pertinence-accepter]`)!); });
    expect(document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)).toBeNull();
    expect(document.querySelector(`[data-pertinence-rush="${cle('danse-seule')}"]`)).not.toBeNull();
    const stocke = JSON.parse(window.localStorage.getItem(CLE_PERTINENCE_ACCEPTES)!);
    expect(stocke).toEqual([`${cle('fete')}|personal-finance`]);
    expect(window.localStorage.getItem(CLE_ACCEPTES)).toBeNull(); // la qualité n'est pas touchée
    unmount();
    // Retour sur le projet : le choix est relu.
    const r2 = render(<QualiteRushs {...props} contexte={FINANCE} />);
    await waitFor(() => expect(document.querySelector(`[data-pertinence-rush="${cle('danse-seule')}"]`)).not.toBeNull());
    expect(document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)).toBeNull();
    r2.unmount();
    // Autre sujet : l'accord ne vaut pas pour lui.
    render(<QualiteRushs {...props} contexte={NUTRITION} />);
    await waitFor(() => expect(document.querySelector(`[data-pertinence-rush="${cle('budget')}"]`)).not.toBeNull());
  });

  it('accepter un avertissement QUALITÉ ne masque pas un hors-sujet', async () => {
    window.localStorage.setItem(CLE_ACCEPTES, JSON.stringify([cle('fete')]));
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} contexte={FINANCE} lireFiches={lireFiches} />);
    await waitFor(() => expect(document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)).not.toBeNull());
  });

  it('rush FLOU mais pertinent : ligne qualité, aucune ligne pertinence (jamais mélangées)', async () => {
    const mesures = { ...MESURES, [U('budget')]: analyse(U('budget'), { nettete: 0.02, mouvement: 0.0005 }) };
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={async (u) => mesures[u] ?? null} contexte={FINANCE} lireFiches={lireFiches} />);
    await waitFor(() => expect(document.querySelector(`[data-qualite-rush="${cle('budget')}"]`)).not.toBeNull());
    await waitFor(() => expect(document.querySelectorAll('[data-pertinence-rush]')).toHaveLength(2));
    expect(document.querySelector(`[data-pertinence-rush="${cle('budget')}"]`)).toBeNull();
  });

  it('anglais / allemand : badges et raisons traduits', async () => {
    for (const [locale, badge, raison] of [['en', 'Off-topic for Finance', 'Off-topic for Finance: shows Dance (description + image)'], ['de', 'Themenfremd für Finanzen', 'Themenfremd für Finanzen: zeigt Tanz (Beschreibung + Bild)']] as const) {
      const { unmount } = render(
        <I18nContext.Provider value={{ locale, messages: {}, setLocale: () => {} }}>
          <QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} contexte={FINANCE} lireFiches={lireFiches} />
        </I18nContext.Provider>,
      );
      await waitFor(() => expect(document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)).not.toBeNull());
      const hs = document.querySelector(`[data-pertinence-rush="${cle('fete')}"]`)!;
      expect(hs.querySelector('[data-pertinence-badge]')!.textContent).toBe(badge);
      expect(hs.textContent).toContain(raison);
      unmount();
    }
  });

  it('sujet non reconnu : aucune lecture, aucun avis', async () => {
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} contexte={contexteMontageDepuis({ theme: 'Mon anniversaire' })} lireFiches={lireFiches} />);
    await waitFor(() => expect(analyser).toHaveBeenCalledTimes(LISTE.length));
    await new Promise((r) => setTimeout(r, 20));
    expect(lireFiches).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pertinence-resume]')).toBeNull();
  });
});

describe('QualiteRushs + pertinence — défaut sûr et lectures', () => {
  it('SANS contexte : écran M1 identique, aucune lecture de fiche', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('aucun fetch attendu'); });
    vi.stubGlobal('fetch', fetchSpy);
    const sans = render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} lireFiches={lireFiches} />);
    await waitFor(() => expect(analyser).toHaveBeenCalledTimes(LISTE.length));
    await new Promise((r) => setTimeout(r, 20));
    const htmlSans = sans.container.innerHTML;
    sans.unmount();
    const nul = render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} contexte={null} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(nul.container.innerHTML).toBe(htmlSans);
    expect(htmlSans).toBe(''); // rushes sains : M1 ne rend rien
    expect(lireFiches).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lecture par défaut : GET v1, puis GET v2 pour les rushes PERSONNELS seulement ; jamais de POST ; 0 fetch pendant l’export', async () => {
    const appels: Array<{ url: string; method: string }> = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url, method: init?.method ?? 'GET' });
      if (url.startsWith('/api/creer/fiches-contenu?')) {
        const urls = new URLSearchParams(url.split('?')[1]).getAll('url');
        return new Response(JSON.stringify({ success: true, fiches: urls.map((u) => ({ url: u, fiche: FICHES[u] && FICHES[u]!.version === 1 ? FICHES[u] : ficheContenuRush({}) })) }), { status: 200 });
      }
      if (url.startsWith('/api/creer/fiches-contenu/approfondir?url=')) {
        // v2 en cache pour le rush personnel : danse vue par l'image.
        return new Response(JSON.stringify({ success: true, fiche: v2(ficheContenuRush({ pexels: { description: 'people dancing' } }), ['dance']) }), { status: 200 });
      }
      throw new Error(`inattendu ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const props = { medias: LISTE, estDurable: () => true, onEcarter: () => true, analyser, contexte: FINANCE };
    const { rerender } = render(<QualiteRushs {...props} enPause />);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSpy).not.toHaveBeenCalled();
    rerender(<QualiteRushs {...props} enPause={false} />);
    // Le rush personnel a une v2 (description + image) : hors sujet ; il prime sur sa v1 vide.
    await waitFor(() => expect(document.querySelector(`[data-pertinence-rush="${cle('perso')}"]`)?.getAttribute('data-niveau')).toBe('hors_sujet'));
    expect(appels.every((a) => a.method === 'GET')).toBe(true);
    expect(appels.filter((a) => a.url.includes('/approfondir'))).toEqual([{ url: `/api/creer/fiches-contenu/approfondir?url=${encodeURIComponent(U('perso'))}`, method: 'GET' }]);
    expect(appels.filter((a) => a.url.startsWith('/api/creer/fiches-contenu?'))).toHaveLength(1);
    // Mémorisé par URL : un nouveau rendu ne relit rien.
    const n = fetchSpy.mock.calls.length;
    rerender(<QualiteRushs {...props} medias={[...LISTE]} enPause={false} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSpy.mock.calls.length).toBe(n);
  });

  it('lecture qui ne répond jamais : abandonnée après le délai, aucun avis inventé', async () => {
    const jamais = vi.fn<LecteurFiches>(() => new Promise(() => {}));
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} contexte={FINANCE} lireFiches={jamais} delaiMs={30} />);
    await waitFor(() => expect(document.querySelector('[data-pertinence-resume]')?.textContent).toBe('Contenu non identifié pour 4 rushes'), { timeout: 1000 });
    expect(document.querySelectorAll('[data-pertinence-rush]')).toHaveLength(0);
  });
});

describe('QualiteRushs + pertinence — fiches transmises au diagnostic du post', () => {
  it('onFiches reçoit les fiches chargées (v2 comprise), et rien sans contexte', async () => {
    const onFiches = vi.fn();
    const { unmount } = render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} lireFiches={lireFiches} onFiches={onFiches} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(onFiches).not.toHaveBeenCalled();
    unmount();
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} contexte={FINANCE} lireFiches={lireFiches} onFiches={onFiches} />);
    await waitFor(() => expect(onFiches).toHaveBeenCalled());
    const derniere = onFiches.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(derniere[U('fete')]).toEqual(FICHES[U('fete')]);
    expect(Object.keys(derniere).sort()).toEqual(LISTE.map((m) => m.url).sort());
  });
});
