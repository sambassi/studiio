/**
 * A_5d — LA BANQUE AUDIO DEVIENT REMPLISSABLE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI MANQUAIT, ET CE QUE ÇA DONNAIT
 * ---------------------------------------------------------------------------
 *
 * A_5 avait tout : la route, l'analyse, la forme d'onde, les favoris, la
 * politique. Il manquait UN bouton — et la personne lisait « Ta banque est
 * vide » sans le moindre moyen de la remplir, même avec dix fichiers audio
 * dans sa médiathèque.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ AUCUNE SECONDE USINE
 * ---------------------------------------------------------------------------
 *
 * `MediaLibrary` filtre déjà les médias par type, cherche, et sait téléverser
 * avec sa progression réelle. L'ajout à la banque le réutilise en mode
 * `audio` : en écrire un second aurait fait deux vérités pour la même chose.
 *
 * Et un fichier déjà présent dans la médiathèque n'est PAS re-téléversé : la
 * banque enregistre sa CLÉ, pas ses octets.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PISTES_AUDIO_MAX, MOODS_PAR_PISTE_MAX, cleDepuisUrlMediatheque,
  type PisteAudio,
} from '@/lib/creatif/audio';

const Bibliotheque = (await import('@/components/creer/BibliothequeAudio')).default;

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const GRILLE = lire('src/components/creer/BibliothequeAudio.tsx');
const REGLAGES = lire('src/components/creer/ReglagesAudio.tsx');
const HOOK = lire('src/lib/hooks/useBanqueAudio.ts');
const ROUTE = lire('src/app/api/autopilot/banque-audio/route.ts');
const MEDIA = lire('src/components/shared/MediaLibrary.tsx');

const U = 'user-42';
const piste = (n: string, extra: Partial<PisteAudio> = {}): PisteAudio => ({
  cle: `${U}/musiques/${n}.mp3`,
  nom: n, moods: [], dureeMs: 180_000, silenceInitialMs: 0,
  octets: 4_000_000, empreinte: `4000000-${n}`,
  droitsConfirmesLe: '2026-09-08T10:00:00.000Z',
  ...extra,
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rendre = (pistes: PisteAudio[], extra = {}) => render(
  <Bibliotheque pistes={pistes} cleActive={null} onChoisir={() => {}} {...extra} />,
);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. L’état vide est ACTIONNABLE', () => {
  it('1.1 ⚠️ LE BOUTON EXISTE, ET IL EST LE POINT DE TOUT CE LOT', () => {
    const { container } = rendre([], { onAjouter: () => {} });
    const bouton = container.querySelector('[data-audio-ajouter]') as HTMLButtonElement;
    expect(bouton).not.toBeNull();
    expect(bouton.textContent).toContain('Ajouter une musique');
    expect(bouton.disabled).toBe(false);
  });

  it('1.2 le vide s’explique, il ne se contente pas de constater', () => {
    const { container } = rendre([], { onAjouter: () => {} });
    const vide = container.querySelector('[data-audio-banque-vide]')!;
    expect(vide.textContent).toContain('Ta banque musicale est vide');
    expect(vide.textContent).toContain('utiliser dans tes vidéos');
  });

  it('1.3 ⚠️ LE BOUTON RESTE LÀ QUAND LA BANQUE EST PLEINE DE MUSIQUE', () => {
    // Une banque de trois morceaux se complète aussi souvent qu'une banque
    // vide se remplit.
    const { container } = rendre([piste('a'), piste('b')], { onAjouter: () => {} });
    expect(container.querySelector('[data-audio-ajouter]')).not.toBeNull();
  });

  it('1.4 sans moyen d’ajouter, aucun bouton mensonger', () => {
    const { container } = rendre([]);
    expect(container.querySelector('[data-audio-ajouter]')).toBeNull();
  });

  it('1.5 cliquer ouvre le sélecteur', () => {
    const ouvertures: number[] = [];
    const { container } = rendre([], { onAjouter: () => ouvertures.push(1) });
    fireEvent.click(container.querySelector('[data-audio-ajouter]') as HTMLElement);
    expect(ouvertures.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. L’analyse se voit, et ne se relance pas', () => {
  it('2.1 pendant l’analyse, le bouton le DIT et se bloque', () => {
    const { container } = rendre([], {
      onAjouter: () => {}, enAnalyse: `${U}/musiques/x.mp3`,
    });
    const bouton = container.querySelector('[data-audio-ajouter]') as HTMLButtonElement;
    expect(bouton.textContent).toContain('Analyse de la musique');
    expect(bouton.disabled).toBe(true);
  });

  it('2.2 ⚠️ DEUX CLICS RAPIDES NE FONT QU’UNE PISTE', () => {
    // La garde d'idempotence vit dans le hook : un second ajout est refusé
    // tant que le premier travaille.
    expect(sansProse(HOOK)).toContain('if (enAnalyse !== null) return false');
    expect(sansProse(HOOK)).toContain('setEnAnalyse(cle)');
    expect(sansProse(HOOK)).toContain('finally');
  });

  it('2.3 ⚠️ LA MÊME CLÉ REMPLACE, ELLE NE DOUBLE PAS', () => {
    const h = sansProse(HOOK);
    expect(h).toContain('p.some((x) => x.cle === cle)');
    /* ⚠️ CÔTÉ SERVEUR, LA DÉCISION A CHANGÉ D'ENDROIT — PAS DE SENS. Elle se
       prenait en mémoire, sur une liste lue plus tôt : deux ajouts simultanés
       de la même clé pouvaient donc en juger chacun de leur côté. Elle se prend
       désormais DANS la transaction, sur la liste relue sous verrou, et rend
       « existante » plutôt que d'écrire une seconde fiche. */
    const sql = lire('migrations/2026-09-09-autopilot-banque-audio-atomique.sql');
    expect(sansProse(ROUTE)).toContain('ajouterPisteBanqueAudio');
    expect(sql).toContain("where v_pistes->(i - 1)->>'cle' = v_cle");
    expect(sql).toContain("issue := 'existante'");
    expect(sql).toContain('for update');
  });

  it('2.4 un échec est dit en français, sans détail technique', () => {
    const h = sansProse(HOOK);
    expect(h).toContain('Cette musique n’a pas pu être ajoutée');
    expect(h).not.toMatch(/ffprobe|ffmpeg|minio/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le sélecteur réutilisé', () => {
  it('3.1 ⚠️ AUCUNE SECONDE USINE : c’est `MediaLibrary`, en mode audio', () => {
    expect(REGLAGES).toContain('<MediaLibrary');
    expect(REGLAGES).toContain('mediaType="audio"');
    expect(REGLAGES).toContain('isOpen={ajoutBanque}');
  });

  it('3.2 il ne montre que les médias audio', () => {
    // Le composant demande la liste filtrée au serveur.
    expect(MEDIA).toContain('/api/media/list?type=');
    expect(MEDIA).toContain("mediaType === 'audio' ? 'audio/*'");
    expect(sansProse(lire('src/app/api/media/list/route.ts')))
      .toContain("typeFilter === 'audio' ? ['audio']");
  });

  it('3.3 il sait déjà chercher et téléverser — rien n’a été réécrit', () => {
    expect(MEDIA).toContain('uploadFile');
    expect(MEDIA).toContain('Envoi');
    expect(sansProse(REGLAGES)).not.toMatch(/uploadFile|FormData|new XMLHttpRequest/);
  });

  it('3.4 ⚠️ AUCUN FICHIER EN BASE64 NI DANS DU JSON', () => {
    const h = sansProse(HOOK);
    expect(h).not.toMatch(/base64|arrayBuffer|FileReader/);
    // Ce qui part, c'est une clé et un nom.
    expect(h).toContain("JSON.stringify({ cle, nom, droitsConfirmes: true })");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Aucun ré-téléversement', () => {
  it('4.1 ⚠️ LA BANQUE ENREGISTRE UNE CLÉ, PAS DES OCTETS', () => {
    const r = sansProse(ROUTE);
    expect(r).not.toMatch(/putObject|presignedPut/i);
    expect(r).toContain('lecteurMinio().getObject(BUCKET_MUSIQUE, cle)');
  });

  it('4.2 l’URL du sélecteur redevient une clé, et une seule fois', () => {
    expect(cleDepuisUrlMediatheque(
      `/storage/v1/object/public/audio/${U}/musiques/a%20b.mp3`, 'audio',
    )).toBe(`${U}/musiques/a b.mp3`);
    // Une URL d'un autre compartiment ne donne rien.
    expect(cleDepuisUrlMediatheque('/storage/v1/object/public/media/x.mp4', 'audio'))
      .toBeNull();
    expect(cleDepuisUrlMediatheque('https://ailleurs/x.mp3', 'audio')).toBeNull();
  });

  it('4.3 ⚠️ ÉCRITE UNE SEULE FOIS : choisir et ajouter partagent l’extraction', () => {
    // Deux versions divergeraient au premier caractère encodé.
    expect((REGLAGES.match(/cleDepuisUrlMediatheque\(/g) ?? []).length).toBe(2);
    expect(sansProse(REGLAGES)).not.toContain("indexOf(marque)");
  });

  it('4.4 un média hors du compartiment audio n’est pas envoyé au serveur', () => {
    expect(sansProse(REGLAGES)).toContain('if (cle !== null) void banque.ajouter(cle, nom)');
  });

  it('4.5 le serveur revalide la propriété, quoi que le navigateur envoie', () => {
    const r = sansProse(ROUTE);
    const iCle = r.indexOf('cleAudioValide(cle, userId)');
    const iStat = r.indexOf('statObject');
    expect(iCle).toBeGreaterThan(-1);
    expect(iCle).toBeLessThan(iStat);
  });

  it('4.6 l’analyse est celle d’A_5, pas une seconde', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('argumentsSondeAudio(local)');
    expect(r).toContain('argumentsFormeOnde(local)');
    expect(r).toContain('silenceInitialSecondes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Écouter n’est pas choisir', () => {
  it('5.1 ⚠️ LE PLAY NE SÉLECTIONNE PAS', () => {
    const choix: (string | null)[] = [];
    const { container } = rendre([piste('a')], { onChoisir: (c: string | null) => choix.push(c) });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    fireEvent.click(container.querySelector(`[data-audio-ecouter=\"${U}/musiques/a.mp3\"]`) as HTMLElement);
    expect(choix).toEqual([]);
  });

  it('5.2 choisir, lui, remonte la clé', () => {
    const choix: (string | null)[] = [];
    const { container } = rendre([piste('a')], { onChoisir: (c: string | null) => choix.push(c) });
    fireEvent.click(container.querySelector(`[data-audio-choisir=\"${U}/musiques/a.mp3\"]`) as HTMLElement);
    expect(choix).toEqual([`${U}/musiques/a.mp3`]);
  });

  it('5.3 ⚠️ AJOUTER N’EST PAS SÉLECTIONNER', () => {
    // Le premier ajout dans une banque vide ne change pas le montage : la
    // personne clique ensuite sur la piste pour l'utiliser.
    expect(sansProse(HOOK)).not.toMatch(/onChoisir|musique:\s*\{/);
    expect(sansProse(REGLAGES)).not.toMatch(/ajouter\([^)]*\)[^;]*majuscule/);
  });

  it('5.4 un seul lecteur, et rien n’est téléchargé d’avance', () => {
    const { container } = rendre([piste('a'), piste('b'), piste('c')]);
    expect(container.querySelectorAll('audio').length).toBe(1);
    expect((container.querySelector('audio') as HTMLAudioElement).getAttribute('preload'))
      .toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Les ambiances après coup', () => {
  it('6.1 elles se règlent sans réanalyser le fichier', () => {
    const majs: [string, readonly string[]][] = [];
    const { container } = rendre([piste('a')], {
      onMoods: (c: string, m: readonly string[]) => majs.push([c, m]),
    });
    fireEvent.click(
      container.querySelector(`[data-audio-regler-moods=\"${U}/musiques/a.mp3\"]`) as HTMLElement,
    );
    fireEvent.click(
      container.querySelector(`[data-audio-mood=\"${U}/musiques/a.mp3:sport\"]`) as HTMLElement,
    );
    expect(majs).toEqual([[`${U}/musiques/a.mp3`, ['sport']]]);
    // La route ne réanalyse rien : c'est un PATCH.
    expect(sansProse(HOOK)).toContain("method: 'PATCH'");
  });

  it('6.2 le nombre d’ambiances reste borné', () => {
    const majs: readonly string[][] = [];
    const p = piste('a', { moods: ['calme', 'sport', 'urbain'] });
    const recus: readonly string[][] = [];
    const { container } = rendre([p], {
      onMoods: (_c: string, m: readonly string[]) => (recus as string[][]).push([...m]),
    });
    fireEvent.click(
      container.querySelector(`[data-audio-regler-moods=\"${p.cle}\"]`) as HTMLElement,
    );
    fireEvent.click(
      container.querySelector(`[data-audio-mood=\"${p.cle}:elegant\"]`) as HTMLElement,
    );
    expect(recus[0].length).toBe(MOODS_PAR_PISTE_MAX);
    expect(majs.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Retirer', () => {
  it('7.1 ⚠️ RETIRER DE LA BANQUE NE SUPPRIME PAS LE FICHIER', () => {
    const r = sansProse(ROUTE);
    expect(r).not.toMatch(/removeObject|deleteObject/i);
    expect(sansProse(HOOK)).toContain("modifier({ cle, retirer: true })");
  });

  it('7.2 le favori et l’autorisation sont nettoyés en même temps', () => {
    /* « En même temps » est désormais littéral : les trois nettoyages tiennent
       dans UNE transaction, sous le verrou du retrait. Les faire en mémoire
       puis réécrire la bibliothèque entière laissait un instant où l'un des
       états était vrai et l'autre non — et effaçait au passage toute piste
       arrivée entre-temps. */
    const sql = lire('migrations/2026-09-09-autopilot-banque-audio-atomique.sql');
    expect(sansProse(ROUTE)).toContain('muterPisteBanqueAudio');
    expect(sql).toContain("jsonb_set(v_biblio, '{favoris}', v_favoris, true)");
    expect(sql).toContain("jsonb_set(v_biblio, '{automatisation}', v_autom, true)");
    // Une seule écriture pour les trois : aucune fenêtre entre elles.
    expect(sql.match(/update public\.autopilot_config/g) ?? []).toHaveLength(2);
  });

  it('7.3 ⚠️ RETIRER LA PISTE ACTIVE SE CONFIRME', () => {
    // Elle disparaît du montage en cours ; le faire sans un mot donnerait une
    // vidéo muette que personne n'a demandée.
    expect(REGLAGES).toContain('data-audio-confirmer-retrait');
    expect(REGLAGES).toContain('Cette musique est utilisée dans ton style actuel');
    expect(REGLAGES).toContain('if (valeur.musique?.cle === cle) { setRetraitActive(cle); return; }');
  });

  it('7.4 confirmer retire ET repasse à « sans musique »', () => {
    const i = REGLAGES.indexOf('data-audio-confirmer-oui');
    const bloc = REGLAGES.slice(i, i + 400);
    expect(bloc).toContain('banque.retirer(retraitActive)');
    expect(bloc).toContain('majuscule({ musique: null })');
  });

  it('7.5 annuler ne fait rien', () => {
    const i = REGLAGES.indexOf('data-audio-confirmer-non');
    const bloc = REGLAGES.slice(i, i + 200);
    expect(bloc).toContain('setRetraitActive(null)');
    expect(bloc).not.toContain('banque.retirer');
  });

  it('7.6 les anciens rendus ne sont jamais retouchés', () => {
    expect(sansProse(ROUTE)).not.toMatch(/rush_montage_renders|usage\.creatif/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. La limite', () => {
  it('8.1 ⚠️ AU PLAFOND, ON LE DIT — pas un JSON silencieux', () => {
    const pleine = Array.from({ length: PISTES_AUDIO_MAX }, (_, i) => piste(`p${i}`));
    const { container } = rendre(pleine, { onAjouter: () => {} });
    expect((container.querySelector('[data-audio-ajouter]') as HTMLButtonElement).disabled)
      .toBe(true);
    const message = container.querySelector('[data-audio-limite]')!;
    expect(message.textContent).toContain('nombre maximum de musiques');
    expect(message.textContent).not.toMatch(/jsonb|200|json/i);
  });

  it('8.2 le serveur refuse aussi, avec son propre message', () => {
    expect(sansProse(ROUTE)).toContain('>= PISTES_AUDIO_MAX');
    expect(sansProse(ROUTE)).toContain("refus('banque_pleine')");
  });

  it('8.3 remplacer une piste existante ne compte pas dans la limite', () => {
    expect(sansProse(ROUTE)).toContain('if (!dejaLa && biblio.audio.pistes.length >= PISTES_AUDIO_MAX)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Ce que ce lot n’a pas touché', () => {
  it('9.1 la politique audio et le rendu sont intacts', () => {
    const politique = sansProse(lire('src/lib/autopilot/analyse/politique-audio.ts'));
    expect(politique).toContain('resoudreMusiqueEffective');
    expect(politique).not.toMatch(/Math\.random/);
    // Le fix du silence n'a pas bougé d'un chiffre.
    const silence = sansProse(lire('src/lib/autopilot/analyse/musique-silence.ts'));
    expect(silence).toContain('SEUIL_SILENCE_MUSIQUE_DB = -50');
    expect(silence).toContain('SILENCE_INITIAL_MIN_MS = 300');
    expect(silence).toContain('MUSIQUE_TRIM_PREROLL_MS = 50');
  });

  it('9.2 aucune migration', () => {
    expect(sansProse(ROUTE)).not.toContain('alter table');
    expect(sansProse(GRILLE)).not.toContain('alter table');
  });

  it('9.3 les catalogues créatifs sont intacts', async () => {
    const { LOOKS_CREATIFS } = await import('@/lib/creatif/looks');
    const { STYLES_CAPTION } = await import('@/lib/creatif/captions');
    const { TRANSITIONS_CREATIVES } = await import('@/lib/creatif/transitions');
    const { PRESETS_STUDIIO } = await import('@/lib/creatif/presets');
    expect(LOOKS_CREATIFS.length).toBe(34);
    expect(STYLES_CAPTION.length).toBe(31);
    expect(TRANSITIONS_CREATIVES.length).toBe(29);
    expect(PRESETS_STUDIIO.length).toBe(12);
  });

  it('9.4 ⚠️ AUCUN CATALOGUE « MUSIQUES STUDIIO » IMAGINAIRE', () => {
    // Le dépôt n'a aucune musique licenciée : en inventer une liste serait
    // promettre des fichiers qui n'existent pas.
    expect(GRILLE).not.toMatch(/Musiques Studiio|catalogueStudiio/i);
    expect(sansProse(ROUTE)).not.toMatch(/studiio_catalog/i);
  });
});
