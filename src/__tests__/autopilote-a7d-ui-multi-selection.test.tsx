/**
 * A_7d2 — CHOISIR PLUSIEURS RUSHES, SANS PERDRE CELUI QU'ON REGARDE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA DISTINCTION QUE CET ÉCRAN TIENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux notions se ressemblent et ne sont pas la même :
 *
 *   • LE RUSH REGARDÉ (`selection`) — celui dont l'aperçu de droite montre
 *     l'image, et dont le brouillon porte les réglages ;
 *   • LES RUSHES MONTÉS — la matière que la vidéo assemblera.
 *
 * Les confondre casse l'un ou l'autre : soit l'aperçu change à chaque case
 * cochée, soit il s'immobilise sur le premier pendant qu'on en ajoute quatre.
 * Le rush regardé fait TOUJOURS partie du montage ; les autres se cochent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BandeRushes from '@/components/creer/BandeRushes';
import {
  lireBrouillon, ecrireBrouillon, effacerBrouillon, cleBrouillon,
} from '@/lib/autopilot/brouillon-video';
import { MAX_RUSHES_MANUEL } from '@/lib/autopilot/analyse/montage-pool';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';

const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-11111111111${n}`;

const rush = (n: number) => ({
  id: ID(n),
  sessionId: 's1',
  bucket: 'rushes',
  cleObjet: `u/rushes/${n}.mp4`,
  nomOrigine: `rush-${n}.mp4`,
  contentType: 'video/mp4',
  tailleOctets: 1000,
  dureeSecondes: 30,
  rang: n,
  etat: 'verifie',
  metadata: {},
  creeLe: '2026-09-08T00:00:00Z',
  majLe: '2026-09-08T00:00:00Z',
}) as never;

const RUSHES = [rush(1), rush(2), rush(3)];
const ANALYSES = { [ID(1)]: null, [ID(2)]: null, [ID(3)]: null };

function poser(over: Record<string, unknown> = {}) {
  const onBasculer = vi.fn();
  const onSelectionner = vi.fn();
  const rendu = render(
    <BandeRushes
      rushes={RUSHES}
      analyses={ANALYSES as never}
      selection={ID(1)}
      onSelectionner={onSelectionner}
      onVoirAnalyse={() => {}}
      onReanalyser={() => {}}
      onAjouterFichiers={() => {}}
      envois={[]}
      onBasculer={onBasculer}
      maxRushes={MAX_RUSHES_MANUEL}
      {...over}
    />,
  );
  return { ...rendu, onBasculer, onSelectionner };
}

const carte = (n: number) => document.querySelector(`[data-bande-carte="${ID(n)}"]`);
const bascule = (n: number) =>
  document.querySelector(`[data-bande-basculer="${ID(n)}"]`) as HTMLButtonElement | null;

describe('A_7d2 — la sélection multiple', () => {
  it('sans `onBasculer`, l écran est celui d avant le lot', () => {
    render(
      <BandeRushes
        rushes={RUSHES}
        analyses={ANALYSES as never}
        selection={ID(1)}
        onSelectionner={() => {}}
        onVoirAnalyse={() => {}}
        onReanalyser={() => {}}
        onAjouterFichiers={() => {}}
        envois={[]}
      />,
    );
    /* ⚠️ AUCUNE CASE À COCHER : le mode multi n'existe que si le parent le
       demande, et la non-régression du chemin historique se lit ici. */
    expect(bascule(2)).toBeNull();
    expect(document.querySelector('[data-bande-compte]')).toBeNull();
  });

  it('le rush REGARDÉ est monté, et sa case est verrouillée', () => {
    poser();
    /* Le retirer laisserait un aperçu sans rush. On en change en cliquant la
       carte, pas en décochant. */
    expect(carte(1)?.getAttribute('data-bande-carte-montee')).toBe('1');
    expect(bascule(1)?.disabled).toBe(true);
  });

  it('cocher un autre rush ne change pas celui qu on regarde', () => {
    const { onBasculer, onSelectionner } = poser();
    fireEvent.click(bascule(2) as HTMLButtonElement);
    expect(onBasculer).toHaveBeenCalledWith(ID(2));
    /* ⚠️ SI LA CASE CHANGEAIT L'APERÇU, il sauterait à chaque ajout. */
    expect(onSelectionner).not.toHaveBeenCalled();
  });

  it('les rushes montés sont marqués, les autres non', () => {
    poser({ supplementaires: [ID(3)] });
    expect(carte(1)?.getAttribute('data-bande-carte-montee')).toBe('1');
    expect(carte(3)?.getAttribute('data-bande-carte-montee')).toBe('1');
    expect(carte(2)?.getAttribute('data-bande-carte-montee')).toBeNull();
  });

  it('le compte est DIT, parce que l aperçu n en montre qu un', () => {
    /* Sans cette ligne, rien ne dirait que la vidéo en assemblera trois, et la
       personne croirait monter le seul qu'elle voit. */
    poser({ supplementaires: [ID(2), ID(3)] });
    const p = document.querySelector('[data-bande-compte]');
    expect(p?.getAttribute('data-bande-compte')).toBe('3');
    expect(p?.textContent).toContain('3');
    expect(p?.textContent).toContain('assemblés');
  });

  it('un seul rush monté n affiche aucun compte', () => {
    poser();
    expect(document.querySelector('[data-bande-compte]')).toBeNull();
  });

  it('au plafond, les cases non cochées se ferment avec un motif lisible', () => {
    /* ⚠️ PAS UNE ERREUR TECHNIQUE. La personne doit lire ce qui l'arrête. */
    const autres = [2, 3].map(ID);
    poser({ supplementaires: autres, maxRushes: 3 });
    expect(bascule(2)?.disabled).toBe(false);
    const p = document.querySelector('[data-bande-compte]');
    expect(p?.textContent).toContain('maximum');
  });

  it('le plafond vient d A_7b, jamais d une seconde constante', () => {
    expect(MAX_RUSHES_MANUEL).toBe(8);
  });
});

describe('A_7d2 — la sélection survit au rechargement', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('les autres rushes sont relus avec le brouillon', () => {
    ecrireBrouillon(ID(1), {
      objectif: null,
      montage: { format: '9:16', dureeSecondes: 16 } as never,
      audio: RECETTE_AUDIO_DEFAUT,
      sources: [ID(2), ID(3)],
    });
    expect(lireBrouillon(ID(1))?.sources).toEqual([ID(2), ID(3)]);
  });

  it('un brouillon d AVANT le lot se relit sans rien perdre', () => {
    /* ⚠️ LA VERSION N'A PAS BOUGÉ, et c'est délibéré : l'incrémenter aurait
       fait rejeter TOUS les brouillons existants — perdre les réglages en
       cours de tout le monde pour ajouter un champ qui peut manquer. */
    ecrireBrouillon(ID(1), {
      objectif: null,
      montage: { format: '1:1', dureeSecondes: 20 } as never,
      audio: RECETTE_AUDIO_DEFAUT,
    });
    const b = lireBrouillon(ID(1));
    expect(b).not.toBeNull();
    expect(b?.sources).toBeUndefined();
    expect(b?.montage.format).toBe('1:1');
  });

  it('le stockage local n est pas une source sûre : tout est relu', () => {
    /* `localStorage` est du texte que n'importe quoi a pu écrire. */
    window.localStorage.setItem(
      cleBrouillon(ID(1)) as string,
      JSON.stringify({
        version: 1, enregistreLe: 1, objectif: null,
        montage: { format: '9:16', dureeSecondes: 16 },
        audio: RECETTE_AUDIO_DEFAUT,
        sources: [ID(2), ID(2), 'pas-un-uuid', 42, null, ID(3)],
      }),
    );
    const b = lireBrouillon(ID(1));
    // Dédupliqué, et débarrassé de ce qui n'est pas un identifiant.
    expect(b?.sources).toEqual([ID(2), ID(3)]);
  });

  it('une liste démesurée est bornée avant d atteindre le serveur', () => {
    /* Sans cette borne, dix mille entrées déclencheraient autant de
       préparations de rush. */
    const trop = Array.from({ length: 500 }, (_, i) =>
      `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    window.localStorage.setItem(
      cleBrouillon(ID(1)) as string,
      JSON.stringify({
        version: 1, enregistreLe: 1, objectif: null,
        montage: { format: '9:16', dureeSecondes: 16 },
        audio: RECETTE_AUDIO_DEFAUT, sources: trop,
      }),
    );
    expect(lireBrouillon(ID(1))?.sources?.length).toBe(64);
  });

  it('effacer le brouillon efface aussi la sélection', () => {
    ecrireBrouillon(ID(1), {
      objectif: null,
      montage: { format: '9:16', dureeSecondes: 16 } as never,
      audio: RECETTE_AUDIO_DEFAUT,
      sources: [ID(2)],
    });
    effacerBrouillon(ID(1));
    expect(lireBrouillon(ID(1))).toBeNull();
  });
});
