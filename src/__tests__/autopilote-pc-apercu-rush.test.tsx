/**
 * L'APERCU MONTRE LE RUSH — ET LA NAVIGATION AUTONOME QUITTE LE PARCOURS MANUEL.
 *
 * ---------------------------------------------------------------------------
 * CE QUE BASSI A VU A L'ECRAN
 * ---------------------------------------------------------------------------
 *
 *   1. Un rush selectionne, et a droite un cadre noir. `CadreFormat` dessinait
 *      le bon format mais restait vide : rien ne disait ce qui allait etre
 *      monte. La matiere existait pourtant deja — `analyse.vignettes`, servie
 *      par une route authentifiee que la bande de rushes utilise depuis
 *      toujours.
 *
 *   2. Un « Suivant » plein d'accent, juste sous « Créer ma vidéo ». Il
 *      appartient au wizard de l'Autopilote AUTONOME, pas a la creation
 *      manuelle — mais rien ne le disait, et deux boutons principaux se
 *      disputaient le meme ecran.
 *
 * ⚠️ LA REGLE QUI NE PLIE PAS. Le lecteur video ne se monte qu'au clic. Cet
 * apercu est une IMAGE — quelques kilo-octets de JPEG — jamais un `<video>`,
 * jamais un `preload`, jamais un octet de MP4.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const VideosPretes = (await import('@/components/creer/VideosPretes')).default;

const SESSION = '11111111-1111-4111-8111-111111111111';
const ANALYSE_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ANALYSE_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Le serveur ne connait aucune video : c'est l'etat ou l'apercu doit parler. */
const aucuneVideo = vi.fn(async () => new Response(
  JSON.stringify({ ok: true, rendu: null, montage: null }),
  { headers: { 'Content-Type': 'application/json' } },
));

function monter(props: Record<string, unknown> = {}) {
  return render(
    <VideosPretes
      sessionId={SESSION}
      aucunRush={false}
      formatSouhaite="9:16"
      fetcher={aucuneVideo as never}
      {...props}
    />,
  );
}

const image = () => document.querySelector('[data-videos-apercu-rush]') as HTMLImageElement | null;
const cadre = () => document.querySelector('[data-videos-cadre]');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. L’aperçu montre le rush sélectionné', () => {
  it('1.1 une vignette réelle, pas un cadre vide', async () => {
    monter({ analyseApercuId: ANALYSE_A });
    await waitFor(() => expect(image()).not.toBeNull());
    expect(image()!.getAttribute('src'))
      .toBe(`/api/autopilot/analyses/${ANALYSE_A}/vignettes/0`);
  });

  it('1.2 elle couvre le cadre sans l’étirer', async () => {
    monter({ analyseApercuId: ANALYSE_A });
    await waitFor(() => expect(image()).not.toBeNull());
    expect(image()!.className).toContain('object-cover');
    expect(cadre()!.getAttribute('data-videos-cadre')).toBe('9:16');
  });

  it('1.3 le cadre suit le format demandé — 16:9', async () => {
    monter({ analyseApercuId: ANALYSE_A, formatSouhaite: '16:9' });
    await waitFor(() => expect(cadre()).not.toBeNull());
    expect(cadre()!.getAttribute('data-videos-cadre')).toBe('16:9');
    // La geometrie reste celle du produit : `geometrieApercu` pose un
    // `aspect-ratio` et des bornes, pas une hauteur en dur — c'est le ratio
    // qui empeche l'etirement, et c'est lui qu'on verifie.
    const style = (cadre() as HTMLElement).style;
    expect(style.aspectRatio.replace(/\s/g, '')).toBe('16/9');
    expect(style.maxHeight).not.toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Aucun octet de vidéo n’est demandé', () => {
  it('2.1 aucun <video> monté, aucun preload', async () => {
    // ⚠️ LA REGLE DU FICHIER. Un apercu qui monterait un lecteur pour
    // afficher une image ferait telecharger des megaoctets que personne n'a
    // demandes — c'est exactement ce que ce composant refuse depuis toujours.
    monter({ analyseApercuId: ANALYSE_A });
    await waitFor(() => expect(image()).not.toBeNull());
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('[preload]')).toBeNull();
  });

  it('2.2 la vignette est une image paresseuse', async () => {
    monter({ analyseApercuId: ANALYSE_A });
    await waitFor(() => expect(image()).not.toBeNull());
    expect(image()!.tagName).toBe('IMG');
    expect(image()!.getAttribute('loading')).toBe('lazy');
  });

  it('2.3 le lecteur reste derrière un geste, et l’aperçu n’en monte aucun', () => {
    // ⚠️ NE PAS INTERDIRE LA CHAINE `preload` : le lecteur post-clic porte
    // `preload="auto"` DELIBEREMENT — l'en-tete du fichier explique que
    // `preload="none"` + `autoPlay` ne chargeait rien du tout. Ce qui compte
    // est que le `<video>` n'existe qu'APRES un clic ; les tests 2.1 et 2.2
    // le mesurent dans le DOM, celui-ci verrouille la porte elle-meme.
    const src = lire('src/components/creer/VideosPretes.tsx');
    expect(src).toContain("LE LECTEUR NE SE MONTE QU'AU CLIC");
    expect(src).toContain('setLecture(true)');
    expect(src).toContain('data-videos-regarder');
    // L'apercu, lui, n'ajoute qu'une image.
    expect(src).toContain('data-videos-apercu-rush');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Changer de rush change l’image', () => {
  it('3.1 la vignette suit la sélection, sans rester sur l’ancienne', async () => {
    const { rerender } = monter({ analyseApercuId: ANALYSE_A });
    await waitFor(() => expect(image()).not.toBeNull());
    rerender(
      <VideosPretes
        sessionId={SESSION}
        aucunRush={false}
        formatSouhaite="9:16"
        fetcher={aucuneVideo as never}
        analyseApercuId={ANALYSE_B}
      />,
    );
    await waitFor(() => expect(image()!.getAttribute('src'))
      .toBe(`/api/autopilot/analyses/${ANALYSE_B}/vignettes/0`));
    expect(image()!.getAttribute('src')).not.toContain(ANALYSE_A);
  });

  it('3.2 l’élément est remonté, pas repeint — pas d’image fantôme', () => {
    // `key` sur l'URL : sans lui, React garde l'ancienne image a l'ecran
    // pendant que la nouvelle charge.
    expect(lire('src/components/creer/VideosPretes.tsx')).toContain('key={image}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Rush sans vignette', () => {
  it('4.1 sans analyse : une icône, pas une zone noire', async () => {
    monter({ analyseApercuId: null });
    await waitFor(() => expect(cadre()).not.toBeNull());
    expect(image()).toBeNull();
    expect(cadre()!.querySelector('svg')).not.toBeNull();
  });

  it('4.2 vignette introuvable : le cadre retombe sur son icône', async () => {
    monter({ analyseApercuId: ANALYSE_A });
    await waitFor(() => expect(image()).not.toBeNull());
    const img = image()!;
    await waitFor(() => { img.dispatchEvent(new Event('error')); });
    await waitFor(() => expect(image()).toBeNull());
    expect(cadre()!.querySelector('svg')).not.toBeNull();
  });

  it('4.3 l’échec ne se propage pas au rush suivant', () => {
    // Garder l'echec du rush precedent priverait le suivant de son image.
    expect(lire('src/components/creer/VideosPretes.tsx'))
      .toContain('useEffect(() => { setApercuCasse(false); }, [analyseApercuId]);');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. La navigation autonome quitte le parcours manuel', () => {
  const panneau = lire('src/components/creer/AutopilotPanel.tsx');

  it('5.1 aucun « Suivant » sur l’étape de création manuelle', () => {
    expect(panneau).toContain('{etape !== 1 && (');
    const nav = panneau.indexOf('{etape !== 1 && (');
    const suivant = panneau.indexOf('Suivant', nav);
    expect(suivant).toBeGreaterThan(nav);
  });

  it('5.2 « Suivant » existe toujours pour l’Autopilote autonome', () => {
    // ⚠️ RIEN N'EST SUPPRIME : le bouton et ses six etapes restent entiers.
    expect(panneau).toContain('data-autopilot-suivant');
    expect(panneau).toContain("setEtape((n) => Math.min(ETAPES.length - 1, n + 1))");
    expect(panneau).toContain('data-autopilot-etapes');
  });

  it('5.3 une porte nommée vers la configuration autonome', () => {
    expect(panneau).toContain('data-autonome-configurer');
    expect(panneau).toContain('Configurer l’Autopilote autonome');
    // Elle vit dans la section qui la nomme, pas au milieu du parcours.
    expect(panneau.indexOf('data-autonome-configurer'))
      .toBeGreaterThan(panneau.indexOf('data-autonome-titre'));
  });

  it('5.4 les six étapes autonomes sont intactes', () => {
    for (const t of ['Thèmes', 'Vos rushes', 'Style & médias',
      'Rythme & diffusion', 'Options', 'Récapitulatif']) {
      expect(panneau).toContain(t);
    }
    expect(panneau).toContain('data-autonome-rushes');
    expect(panneau).toContain('data-autonome-affiches');
  });

  it('5.5 « Créer ma vidéo » reste le dernier geste principal', () => {
    const passages = lire('src/components/creer/PassagesSuggeres.tsx');
    expect(passages.lastIndexOf('{avantAction}'))
      .toBeLessThan(passages.indexOf('data-chaine-bouton'));
    expect(passages).toContain("disabled={chaine.sorte === 'encours' || actionBloquee === true}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. L’identifiant d’analyse remonte jusqu’à l’aperçu', () => {
  it('6.1 le panneau émet l’analyse du rush CHOISI', () => {
    const src = lire('src/components/creer/SessionsTournagePanel.tsx');
    expect(src).toContain('analyseApercuId: (rushChoisi ? analyses[rushChoisi]?.id : null) ?? null,');
    // Sans cette dependance, changer de rush n'aurait rien re-emis.
    expect(src).toContain('rushChoisi ? analyses[rushChoisi]?.id : null, onSessionChange]);');
  });

  it('6.2 et l’écran le passe à l’aperçu', () => {
    const src = lire('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(src).toContain('analyseApercuId={tournageRegarde.analyseApercuId}');
  });
});
