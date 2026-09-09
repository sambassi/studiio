/**
 * CREER_PREMIUM_2B — UNE SEULE GRANDE SURFACE DANS LA COLONNE DE DROITE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI SE VOYAIT, ET POURQUOI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * En comparant avec la production, Bassi a vu DEUX écrans vidéo empilés à
 * droite : un petit cadre noir en haut, puis un grand « Aperçu du style ».
 *
 * L'arbitrage existait pourtant — l'aperçu du style ne se dessine que si la
 * vidéo n'occupe pas la place. Mais `VideosPretes` dessinait un cadre DÈS
 * QU'UNE VIGNETTE DE RUSH était disponible, tout en rapportant « vide » au
 * parent. Le parent, croyant la place libre, ajoutait l'aperçu du style.
 *
 * ⚠️ L'INVARIANT TESTÉ N'EST PAS « le cadre a disparu ». C'est : dans CHAQUE
 * état, le composant occupe la surface OU la laisse — jamais un entre-deux où
 * il dessine sans le dire. C'est cette contradiction qui produisait deux
 * écrans, et c'est elle qu'on ferme.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import VideosPretes from '@/components/creer/VideosPretes';

const SESSION = '11111111-1111-4111-8111-111111111111';
const ANALYSE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const reponse = (corps: unknown) => vi.fn(async () => new Response(
  JSON.stringify(corps), { headers: { 'Content-Type': 'application/json' } },
));

const AUCUNE = { ok: true, rendu: null, montage: null };
const EN_COURS = { ok: true, rendu: { id: 'r1', etat: 'en_cours', video: null }, montage: null };

/** Ce que le composant DIT occuper — c'est ce que le parent écoute. */
function monter(corps: unknown, props: Record<string, unknown> = {}) {
  const etats: string[] = [];
  render(
    <VideosPretes
      sessionId={SESSION}
      aucunRush={false}
      formatSouhaite="9:16"
      fetcher={reponse(corps) as never}
      onEtat={(e) => etats.push(e)}
      {...props}
    />,
  );
  return { etats };
}

/** Les grandes surfaces réellement dessinées dans le DOM. */
const surfaces = () => document.querySelectorAll('[data-videos-cadre]').length;
const dernier = (etats: string[]) => etats[etats.length - 1];

/**
 * L'arbitrage du parent, tel qu'il est écrit dans `AssistantWizard` : l'aperçu
 * du style ne se dessine QUE si le composant ne tient pas la surface.
 */
const styleSeDessine = (etat: string) =>
  !(etat === 'en_cours' || etat === 'prete' || etat === 'rush');

/** Le compte total de grandes surfaces dans la colonne. */
const total = (etats: string[]) =>
  surfaces() + (styleSeDessine(dernier(etats)) ? 1 : 0);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CREER_PREMIUM_2B — jamais deux surfaces, dans aucun état', () => {
  it('AUCUN RUSH : une seule surface — l aperçu du style', async () => {
    const { etats } = monter(AUCUNE, { aucunRush: true, analyseApercuId: null });
    await waitFor(() => expect(etats.length).toBeGreaterThan(0));
    expect(surfaces()).toBe(0);
    expect(dernier(etats)).toBe('vide');
    expect(total(etats)).toBe(1);
  });

  it('RUSH SÉLECTIONNÉ avec vignette : une seule surface — le rush', async () => {
    /* ⚠️ LA FONCTIONNALITÉ EST PRÉSERVÉE : la vignette du rush s'affiche
       toujours. Ce qui change, c'est que le composant le DIT, et que l'aperçu
       du style s'efface au lieu de s'ajouter. */
    const { etats } = monter(AUCUNE, { analyseApercuId: ANALYSE });
    await waitFor(() => expect(dernier(etats)).toBe('rush'));
    expect(surfaces()).toBe(1);
    expect(document.querySelector('[data-videos-apercu-rush]')).not.toBeNull();
    expect(total(etats)).toBe(1);
  });

  it('RUSH SANS vignette : une seule surface — l aperçu du style', async () => {
    const { etats } = monter(AUCUNE, { analyseApercuId: null });
    await waitFor(() => expect(etats.length).toBeGreaterThan(0));
    expect(surfaces()).toBe(0);
    expect(dernier(etats)).toBe('vide');
    expect(total(etats)).toBe(1);
  });

  it('VIGNETTE EN 404 : la surface repasse à l aperçu du style', async () => {
    /* Le cas exact de l'environnement local, où aucune analyse ne porte de
       vignette — et où les deux écrans se voyaient le mieux. */
    const { etats } = monter(AUCUNE, { analyseApercuId: ANALYSE });
    await waitFor(() => expect(dernier(etats)).toBe('rush'));
    const img = document.querySelector('[data-videos-apercu-rush]') as HTMLImageElement;
    await waitFor(() => { img.dispatchEvent(new Event('error')); });
    await waitFor(() => expect(dernier(etats)).toBe('vide'));
    expect(surfaces()).toBe(0);
    expect(total(etats)).toBe(1);
  });

  it('RENDU EN COURS : une seule surface, et elle est au composant', async () => {
    const { etats } = monter(EN_COURS, { analyseApercuId: ANALYSE });
    await waitFor(() => expect(dernier(etats)).toBe('en_cours'));
    expect(surfaces()).toBe(1);
    expect(total(etats)).toBe(1);
  });

  /* ⚠️ L'ÉTAT `prete` N'EST PAS REJOUÉ ICI, ET C'EST DÉLIBÉRÉ. Sa charge
     serveur passe par `renduDepuisReponse`, dont la validation est stricte :
     une fixture approximative rendrait « réponse illisible » et le banc
     passerait pour une mauvaise raison. Cet état est déjà couvert par
     `autopilote-uxa1-videos-pretes` et `autopilote-apercu` ; l'invariant, lui,
     y est trivial — `prete` occupe la surface dans l'arbitrage du parent, et
     le dernier banc de ce fichier le vérifie sur la règle elle-même. */

  it('L INVARIANT TIENT DANS TOUS LES ÉTATS MESURÉS', async () => {
    /* ⚠️ LE BANC QUI COMPTE. Un état oublié réintroduirait exactement le
       défaut : un composant qui dessine sans le dire. */
    for (const [corps, props] of [
      [AUCUNE, { aucunRush: true, analyseApercuId: null }],
      [AUCUNE, { analyseApercuId: null }],
      [AUCUNE, { analyseApercuId: ANALYSE }],
      [EN_COURS, { analyseApercuId: ANALYSE }],
    ] as const) {
      cleanup();
      const { etats } = monter(corps, props as Record<string, unknown>);
      await waitFor(() => expect(etats.length).toBeGreaterThan(0));
      expect(total(etats), `état « ${dernier(etats)} »`).toBeLessThanOrEqual(1);
      expect(total(etats), `état « ${dernier(etats)} »`).toBeGreaterThan(0);
    }
  });
});

describe('CREER_PREMIUM_2B — le parent suit ce que le composant déclare', () => {
  it('l arbitrage du wizard inclut bien l état `rush`', async () => {
    /* Sans cette ligne, le composant dessinerait un cadre que le parent
       croirait absent — la contradiction d'origine, réintroduite. */
    const src = await import('node:fs').then((f) => f.readFileSync(
      `${process.cwd()}/src/app/dashboard/creer/AssistantWizard.tsx`, 'utf8'));
    const i = src.indexOf('const videoOccupeLApercu =');
    expect(i).toBeGreaterThan(-1);
    const regle = src.slice(i, i + 200);
    for (const etat of ['en_cours', 'prete', 'rush']) {
      expect(regle, `l'état « ${etat} » doit occuper la surface`).toContain(`'${etat}'`);
    }
  });
});
