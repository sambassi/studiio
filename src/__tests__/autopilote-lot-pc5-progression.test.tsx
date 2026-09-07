/**
 * LOT PC-5 — LA PROGRESSION PENDANT LA CREATION.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE LOT A COMMENCE PAR UNE ERREUR D'AUDIT, ET C'EST UTILE DE LE DIRE
 * ---------------------------------------------------------------------------
 *
 * L'audit annoncait « 25 s d'attente muette apres le clic ». C'etait FAUX.
 * `EtapesCreation` existait deja des deux cotes, avec les etapes REELLES
 * annoncees par la chaine puis par le moteur, une animation indeterminee et
 * aucun pourcentage. Le bouton se desarmait deja, et un rechargement pendant
 * le rendu retrouvait deja l'etat.
 *
 * Ces tests verrouillent donc ce qui existait — pour qu'un futur lot ne le
 * defasse pas — et couvrent le SEUL vrai manque trouve : pendant une nouvelle
 * creation, la video precedente disparaissait au profit d'un cadre vide,
 * exactement au moment ou l'on veut la comparer.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const VideosPretes = (await import('@/components/creer/VideosPretes')).default;

const SESSION = '11111111-1111-4111-8111-111111111111';
const VIDEO = {
  dureeSecondes: 13.1, largeur: 1080, hauteur: 1920,
  fps: 30, octets: 5493401, chemin: '/api/autopilot/rendus-montage/x/fichier',
};

function reponses(suite: unknown[]) {
  let i = 0;
  return vi.fn(async () => {
    const corps = suite[Math.min(i, suite.length - 1)];
    i += 1;
    return new Response(JSON.stringify(corps), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const prete = (montage: unknown = null) => ({
  ok: true,
  rendu: { id: 'r1', etat: 'reussie', etape: null, motif: null, video: VIDEO },
  montage,
});
const enCours = {
  ok: true,
  rendu: { id: 'r2', etat: 'en_cours', etape: 'encodage', motif: null, video: null },
};
const echoue = {
  ok: true,
  rendu: { id: 'r3', etat: 'echouee', etape: null, motif: 'clip_illisible', video: null },
};

function monter() {
  return render(
    <VideosPretes sessionId={SESSION} aucunRush={false} formatSouhaite="9:16" />,
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Aucune fausse progression — le garde qui compte', () => {
  it('1.1 pas un seul pourcentage fabriqué dans les écrans de création', () => {
    // ⚠️ LE PIEGE CLASSIQUE : 10 % → 50 % → 90 % pilotes par `setTimeout`.
    // Aucune route ne sait ou elle en est DANS son travail ; un pourcentage
    // serait une mesure sans mesure, qui avance quand rien ne bouge.
    for (const f of [
      'src/components/creer/VideosPretes.tsx',
      'src/components/creer/PassagesSuggeres.tsx',
      'src/components/creer/EtapesCreation.tsx',
    ]) {
      const src = readFileSync(path.join(process.cwd(), f), 'utf8');
      // ⚠️ ON CHERCHE LE PIEGE, PAS UN MOT. Un premier jet interdisait la
      // chaine « progress » : elle apparait dans « progression », mot francais
      // parfaitement legitime dans les commentaires. Ce qu'il faut refuser,
      // c'est un POURCENTAGE affiche et une minuterie qui le fait monter.
      expect(src).not.toMatch(/\d{1,3}\s*%\s*['"`]/);
      expect(src).not.toMatch(/setProgress|setPourcent|percent\s*[:=]/i);
      expect(src).not.toMatch(/setInterval\([^)]*progress/i);
    }
  });

  it('1.2 l’attente est une animation INDÉTERMINÉE', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/components/creer/EtapesCreation.tsx'), 'utf8');
    expect(src).toContain('animate-');
    /**
     * ⚠️ UNE LARGEUR N'EST PAS FORCEMENT UN MENSONGE, ET J'AI CRU LE
     * CONTRAIRE. Ce composant porte bien un `width` — mais il vaut
     * `(indice + 1) / nombre d'etapes`, c'est-a-dire COMBIEN D'ETAPES REELLES
     * sont franchies. C'est un reperage discret, pas une progression
     * fabriquee. Ce qu'il faut refuser, c'est une largeur pilotee par une
     * MINUTERIE : elle avancerait quand rien ne bouge.
     */
    expect(src).toMatch(/width:.*ETAPES_CREATION\.length/);
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Ce que l’écran dit pendant le rendu', () => {
  it('2.1 il annonce l’étape RÉELLE rapportée par le moteur', async () => {
    vi.stubGlobal('fetch', reponses([enCours]));
    monter();
    await waitFor(() => expect(
      document.querySelector('[data-videos-etat="en_cours"]')).toBeTruthy());
    // L'etape vient du serveur, pas d'une minuterie du navigateur.
    expect(document.querySelector('[data-videos-etape]')?.getAttribute('data-videos-etape'))
      .toBe('encodage');
  });

  it('2.2 un rendu pas encore demarré le dit autrement', async () => {
    vi.stubGlobal('fetch', reponses([{
      ok: true,
      rendu: { id: 'r2', etat: 'en_attente', etape: null, motif: null, video: null },
    }]));
    monter();
    await waitFor(() => expect(screen.getByText(/va démarrer/)).toBeTruthy());
  });

  it('2.3 un rechargement pendant le rendu RETROUVE l’état', async () => {
    // Le composant interroge des le montage : rafraichir la page pendant une
    // creation ne perd pas la trace du travail en cours.
    const reseau = reponses([enCours]);
    vi.stubGlobal('fetch', reseau);
    monter();
    await waitFor(() => expect(
      document.querySelector('[data-videos-etat="en_cours"]')).toBeTruthy());
    expect(reseau).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La vidéo précédente ne disparaît plus', () => {
  it('3.1 une nouvelle création garde l’ancienne sous les yeux', async () => {
    /**
     * ⚠️ LE SONDAGE S'ARRETE SUR UNE REUSSITE — mon premier scenario
     * attendait un second tour qui n'arrive jamais, et il a expire au bout de
     * cinq secondes. C'est `relance`, incremente par « Créer ma vidéo », qui
     * relance la lecture : on reproduit donc le vrai geste.
     */
    vi.stubGlobal('fetch', reponses([prete(), enCours]));
    const vue = render(
      <VideosPretes sessionId={SESSION} aucunRush={false} formatSouhaite="9:16" relance={0} />,
    );
    await waitFor(() => expect(screen.getByText(/Votre vidéo est prête/)).toBeTruthy());
    vue.rerender(
      <VideosPretes sessionId={SESSION} aucunRush={false} formatSouhaite="9:16" relance={1} />,
    );
    await waitFor(
      () => expect(document.querySelector('[data-videos-etat="en_cours"]')).toBeTruthy(),
    );
    // ⚠️ UNE PORTE, PAS UN LECTEUR MONTE D'OFFICE. Ce fichier defend depuis
    // un lot entier que le `<video>` n'existe qu'apres un clic : sans quoi
    // chaque affichage telecharge plusieurs megaoctets. La version precedente
    // reste donc ATTEIGNABLE, et se charge si on la reclame.
    expect(document.querySelector('[data-videos-precedente]')).toBeTruthy();
    expect(document.querySelector('[data-videos-precedente-regarder]')).toBeTruthy();
    expect(document.querySelector('[data-videos-precedente] video')).toBeNull();
    expect(screen.getByText(/Version précédente/)).toBeTruthy();
  });

  it('3.2 une PREMIÈRE création ne montre aucune vidéo fantôme', async () => {
    vi.stubGlobal('fetch', reponses([enCours]));
    monter();
    await waitFor(() => expect(
      document.querySelector('[data-videos-etat="en_cours"]')).toBeTruthy());
    // Rien a montrer : le cadre et son animation, et surtout pas la video
    // d'un autre tournage.
    expect(document.querySelector('[data-videos-precedente]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Fin de course', () => {
  it('4.1 la réussite remplace la progression par la vidéo', async () => {
    vi.stubGlobal('fetch', reponses([prete()]));
    monter();
    await waitFor(() => expect(screen.getByText(/Votre vidéo est prête/)).toBeTruthy());
    expect(document.querySelector('[data-videos-etat="en_cours"]')).toBeNull();
    // Meme regle : la vidéo prête offre sa PORTE, pas un telechargement.
    expect(document.querySelector('[data-videos-regarder]')).toBeTruthy();
  });

  it('4.2 l’échec sort de la progression et reste compréhensible', async () => {
    vi.stubGlobal('fetch', reponses([echoue]));
    monter();
    await waitFor(() => expect(
      document.querySelector('[data-videos-etat="en_cours"]')).toBeNull());
    const texte = document.body.textContent ?? '';
    // ⚠️ NI PILE D'APPELS, NI IDENTIFIANT, NI MESSAGE FFMPEG.
    for (const interdit of ['clip_illisible', 'ffmpeg', 'Error', 'r3', 'stack']) {
      expect(texte).not.toContain(interdit);
    }
  });

  it('4.3 après une réussite, l’explication de durée de LOT PC-3 tient encore', async () => {
    vi.stubGlobal('fetch', reponses([
      prete({ demandeeSecondes: 60, ecartSecondes: 46.9, clipsEcartes: 1 }),
    ]));
    monter();
    await waitFor(() => expect(document.querySelector('[data-videos-ecart]')).toBeTruthy());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le bouton ne part jamais deux fois', () => {
  it('5.1 il se désarme et le dit pendant la chaîne', () => {
    // Verrouille le comportement existant : `disabled` sur l'etat « encours »,
    // et un libelle qui suit l'etape plutot que « Creer ma video ».
    const src = readFileSync(
      path.join(process.cwd(), 'src/components/creer/PassagesSuggeres.tsx'), 'utf8');
    // Le verrou « encours » reste, mais il n'est plus SEUL : le lot « parcours
    // PC » y ajoute le verrou d'objectif non valide. On tient donc l'etat qui
    // desarme, pas la forme exacte de l'expression.
    expect(src).toMatch(/disabled=\{chaine\.sorte === 'encours'/);
    expect(src).toContain('phraseChaine(chaine.etape)');
    // Le verrou de tick, qui bloque le double clic avant meme le rendu React.
    expect(src).toContain('verrouRef.current');
  });
});
