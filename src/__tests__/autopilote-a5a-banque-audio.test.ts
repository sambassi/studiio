/**
 * A_5a — LA BANQUE AUDIO PERSONNELLE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI AUCUNE MIGRATION
 * ---------------------------------------------------------------------------
 *
 * Une table `user_audio_tracks` serait plus propre au-delà de quelques
 * centaines de pistes. Elle a été écartée pour une raison précise : la
 * migration d'A_0c attend toujours d'être appliquée. Une seconde migration
 * non appliquée ferait d'A_5 du code mort en production, exactement comme
 * l'Autopilote automatique l'est aujourd'hui.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI A ÉTÉ MESURÉ AVANT D'ÊTRE ÉCRIT
 * ---------------------------------------------------------------------------
 *
 * 1. FORME D'ONDE. Soixante-quatre points, 88 caractères en base64,
 *    DÉTERMINISTE (deux décodages du même fichier donnent le même tableau) et
 *    DISTINCTE (une sinusoïde et un bruit rose diffèrent). Une piste précédée
 *    de 800 ms de blanc commence par `[0,0,0,0,0]` ; une de 200 ms par
 *    `[0,0,187,255,255]` : l'onde vient bien du signal.
 *
 * 2. SILENCE INITIAL. `silencedetect=n=-50dB:d=0.3` rend `silence_start: 0` /
 *    `silence_end: 0.800023` sur la piste à 800 ms, et RIEN sur celle à
 *    200 ms — le seuil historique de 300 ms se comporte exactement comme
 *    annoncé.
 *
 * 3. ⚠️ LA BOUCLE. Sur 14 s de boucle d'une piste de 5 s : AUCUN silence
 *    après la coupe préalable ; sans elle, des silences à 0, 5,8 et 11,6 s —
 *    le blanc revient À CHAQUE TOUR. C'est le bug que le fix historique
 *    empêche, et cette mesure le confirme.
 *
 * 4. FAUX AUDIO. Un fichier texte renommé `.mp3` est refusé par `ffprobe`
 *    lui-même : l'extension ne décide de rien.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MOODS_AUDIO, LIBELLES_MOOD, PISTES_AUDIO_MAX, NOM_PISTE_MAX,
  MOODS_PAR_PISTE_MAX, DUREE_AUDIO_MAX_MS, DUREE_AUDIO_MIN_MS, POINTS_FORME_ONDE,
  VERSION_BANQUE_AUDIO, BANQUE_AUDIO_VIDE,
  cleAudioValide, nomPisteValide, moodsValides, pisteAudioValide,
  banqueAudioValide, banqueAudioVide, pisteParCle, chercherPistes,
  dureeLisible, decoderFormeOnde, moodsPresents, entreePiste,
  type PisteAudio,
} from '@/lib/creatif/audio';
import {
  lireSondeAudio, formeOndeDepuisPcm, encoderFormeOnde, empreinteAsset,
  dureeAudioAcceptable, argumentsSondeAudio, argumentsFormeOnde,
  OCTETS_AUDIO_MAX, MOTIFS_IMPORT_AUDIO, MESSAGES_IMPORT_AUDIO,
} from '@/lib/autopilot/analyse/audio-import';
import {
  SEUIL_SILENCE_MUSIQUE_DB, SILENCE_INITIAL_MIN_MS, MUSIQUE_TRIM_PREROLL_MS,
  argumentsMesureSilence, argumentsCoupeSilence, silenceInitialSecondes,
} from '@/lib/autopilot/analyse/musique-silence';
import {
  FAMILLES_BIBLIOTHEQUE, LIBELLES_FAMILLE, CLE_USAGE_PAR_FAMILLE,
  BIBLIOTHEQUE_VIDE, bibliothequeValide, favorisValides, recentsDepuisUsages,
} from '@/lib/creatif/bibliotheque';
import { sanitizeDesignStyle } from '@/lib/autopilot/textStyle';
import { RECETTE_AUDIO_DEFAUT, recetteCanonique } from '@/lib/autopilot/analyse/recette-audio';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CONTRAT = lire('src/lib/creatif/audio.ts');
const IMPORT = lire('src/lib/autopilot/analyse/audio-import.ts');
const ROUTE = lire('src/app/api/autopilot/banque-audio/route.ts');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu.ts');

const U = 'user-42';
const piste = (extra: Partial<PisteAudio> = {}): PisteAudio => ({
  cle: `${U}/musiques/1700000000-morceau.mp3`,
  nom: 'Mon morceau',
  moods: ['energique'],
  dureeMs: 185_000,
  silenceInitialMs: 800,
  octets: 4_200_000,
  empreinte: '4200000-abc123',
  droitsConfirmesLe: '2026-09-08T10:00:00.000Z',
  ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le contrat', () => {
  it('1.1 dix ambiances, nommées en français', () => {
    expect(MOODS_AUDIO.length).toBe(10);
    for (const m of MOODS_AUDIO) expect(LIBELLES_MOOD[m].length).toBeGreaterThan(3);
    expect(LIBELLES_MOOD.cinematique).toBe('Cinématique');
  });

  it('1.2 ⚠️ LA PROPRIÉTÉ TIENT AU PRÉFIXE DE LA CLÉ', () => {
    expect(cleAudioValide(`${U}/musiques/a.mp3`, U)).toBe(true);
    expect(cleAudioValide('autre-compte/musiques/a.mp3', U)).toBe(false);
    expect(cleAudioValide(`${U}/../autre/a.mp3`, U)).toBe(false);
    expect(cleAudioValide(`${U}/a\\b.mp3`, U)).toBe(false);
    expect(cleAudioValide('https://ailleurs/a.mp3', U)).toBe(false);
    expect(cleAudioValide(`${U}/a.mp3`, '')).toBe(false);
  });

  it('1.3 ⚠️ AUCUNE URL, NULLE PART', () => {
    expect(sansProse(CONTRAT)).not.toMatch(/https?:\/\//);
    // `musicUrl` n'apparaît que dans un commentaire qui explique pourquoi il
    // est banni — le code, lui, n'en porte aucune trace.
    expect(sansProse(CONTRAT)).not.toContain('musicUrl');
  });

  it('1.4 une piste relue est TOUT OU RIEN', () => {
    expect(pisteAudioValide(piste(), U)).not.toBeNull();
    expect(pisteAudioValide(piste({ nom: '   ' }), U)).toBeNull();
    expect(pisteAudioValide(piste({ dureeMs: 500 }), U)).toBeNull();
    expect(pisteAudioValide(piste({ dureeMs: DUREE_AUDIO_MAX_MS + 1 }), U)).toBeNull();
    expect(pisteAudioValide(piste({ empreinte: 'a b c' }), U)).toBeNull();
    expect(pisteAudioValide(piste({ droitsConfirmesLe: 'hier' }), U)).toBeNull();
    expect(pisteAudioValide(piste(), 'autre')).toBeNull();
  });

  it('1.5 les listes sont bornées, et les doublons s’effondrent', () => {
    expect(PISTES_AUDIO_MAX).toBe(200);
    expect(MOODS_PAR_PISTE_MAX).toBe(3);
    expect(moodsValides(['energique', 'energique', 'calme', 'sport', 'urbain']))
      .toEqual(['energique', 'calme', 'sport']);
    expect(moodsValides(['inconnu', 'calme'])).toEqual(['calme']);
    const trop = Array.from({ length: 250 }, (_, i) => piste({
      cle: `${U}/m/${i}.mp3`,
    }));
    expect(banqueAudioValide({ pistes: trop }, U).pistes.length).toBe(PISTES_AUDIO_MAX);
  });

  it('1.6 un nom vide, à rallonge, ou avec des retours à la ligne', () => {
    expect(nomPisteValide('   ')).toBeNull();
    expect(nomPisteValide('a'.repeat(200))!.length).toBe(NOM_PISTE_MAX);
    expect(nomPisteValide('Mon\nmorceau')).toBe('Mon morceau');
  });

  it('1.7 ⚠️ SANS `userId`, LA BANQUE EST VIDE — jamais devinée', () => {
    const b = bibliothequeValide({ audio: { pistes: [piste()] } });
    expect(b.audio.pistes).toEqual([]);
    expect(bibliothequeValide({ audio: { pistes: [piste()] } }, U).audio.pistes.length).toBe(1);
  });

  it('1.8 le module est PUR', () => {
    expect(sansProse(CONTRAT)).not.toMatch(/node:fs|supabase|fetch\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La persistance', () => {
  it('2.1 elle survit à un aller-retour, avec le compte', () => {
    const style = sanitizeDesignStyle(
      { bibliothequeCreative: { audio: { pistes: [piste()] } } }, U,
    );
    expect(style.bibliothequeCreative?.audio.pistes[0].nom).toBe('Mon morceau');
  });

  it('2.2 ⚠️ SANS LE COMPTE, LA FUSION NE VIDE PAS LA BANQUE PAR ACCIDENT', () => {
    // Le repli lire-modifier-écrire relit `design_style` : sans `userId`, il
    // réécrirait une banque vide par-dessus une banque pleine.
    const compte = sansProse(lire('src/lib/autopilot/analyse/profil-compte.ts'));
    expect(compte).toContain('sanitizeDesignStyle({ ...existant, ...patch }, userId)');
    expect(compte).toContain('sanitizeDesignStyle(ligne?.design_style, userId)');
    expect(compte).toContain('bibliothequeValide(style.bibliothequeCreative, userId)');
  });

  it('2.3 une banque vide n’alourdit aucun document', () => {
    expect(banqueAudioVide(BANQUE_AUDIO_VIDE)).toBe(true);
    expect(sanitizeDesignStyle(
      { bibliothequeCreative: { audio: { pistes: [] } } }, U,
    ).bibliothequeCreative).toBeUndefined();
  });

  it('2.4 les musiques sont la septième famille de la bibliothèque', () => {
    expect([...FAMILLES_BIBLIOTHEQUE]).toContain('audio');
    expect(LIBELLES_FAMILLE.audio).toBe('Musiques');
    expect(BIBLIOTHEQUE_VIDE.favoris.audio).toEqual([]);
  });

  it('2.5 ⚠️ UN FAVORI AUDIO N’EST PAS CHERCHÉ DANS UN CATALOGUE', () => {
    // Leur identifiant est une CLÉ du compte : le comparer à une liste
    // partagée les refuserait toutes.
    expect(favorisValides([`${U}/m/a.mp3`], 'audio')).toEqual([`${U}/m/a.mp3`]);
    // La forme reste vérifiée.
    expect(favorisValides(['../evasion.mp3', 'http://x/a.mp3'], 'audio')).toEqual([]);
  });

  it('2.6 les récents audio viennent des rendus réussis', () => {
    expect(CLE_USAGE_PAR_FAMILLE.audio).toBe('musicTrackId');
    const r = recentsDepuisUsages([
      { creatif: { musicTrackId: `${U}/m/b.mp3` } },
      { creatif: { musicTrackId: `${U}/m/a.mp3` } },
      { creatif: { musicTrackId: `${U}/m/b.mp3` } },
    ]);
    expect(r.audio).toEqual([`${U}/m/b.mp3`, `${U}/m/a.mp3`]);
    expect(sansProse(MOTEUR)).toContain('musicTrackId:');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. L’analyse — on ne croit pas le navigateur', () => {
  it('3.1 ⚠️ LA PISTE AUDIO EST CHERCHÉE PAR `codec_type`, pas par position', () => {
    // Un fichier peut porter une pochette : `streams[0]` serait une image.
    const avecPochette = JSON.stringify({
      format: { duration: '185.2' },
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg' },
        { codec_type: 'audio', codec_name: 'mp3', channels: 2, sample_rate: '44100' },
      ],
    });
    const s = lireSondeAudio(avecPochette)!;
    expect(s.codec).toBe('mp3');
    expect(s.dureeMs).toBe(185_200);
    expect(s.canaux).toBe(2);
  });

  it('3.2 un fichier sans piste audio est refusé', () => {
    expect(lireSondeAudio(JSON.stringify({
      format: { duration: '10' }, streams: [{ codec_type: 'video' }],
    }))).toBeNull();
    expect(lireSondeAudio('pas du json')).toBeNull();
    expect(lireSondeAudio(JSON.stringify({ streams: [{ codec_type: 'audio' }] }))).toBeNull();
  });

  it('3.3 les durées hors bornes sont refusées', () => {
    expect(dureeAudioAcceptable(DUREE_AUDIO_MIN_MS)).toBe(true);
    expect(dureeAudioAcceptable(DUREE_AUDIO_MAX_MS)).toBe(true);
    expect(dureeAudioAcceptable(DUREE_AUDIO_MIN_MS - 1)).toBe(false);
    expect(dureeAudioAcceptable(DUREE_AUDIO_MAX_MS + 1)).toBe(false);
    expect(DUREE_AUDIO_MAX_MS).toBe(15 * 60 * 1000);
  });

  it('3.4 ⚠️ LA FORME D’ONDE VIENT DU SIGNAL, EN VALEUR EFFICACE', () => {
    // 64 points, normalisés, déterministes — et un silence se voit.
    const pcm = Buffer.alloc(POINTS_FORME_ONDE * 200 * 2);
    // Première moitié muette, seconde à pleine amplitude.
    for (let i = POINTS_FORME_ONDE * 100; i < POINTS_FORME_ONDE * 200; i += 1) {
      pcm.writeInt16LE(i % 2 === 0 ? 20000 : -20000, i * 2);
    }
    const onde = formeOndeDepuisPcm(pcm);
    expect(onde.length).toBe(POINTS_FORME_ONDE);
    expect(onde.slice(0, 30).every((v) => v === 0)).toBe(true);
    expect(onde.slice(34).every((v) => v > 200)).toBe(true);
    expect(Math.max(...onde)).toBe(255);
  });

  it('3.5 déterministe, et distincte pour deux signaux', () => {
    const a = Buffer.alloc(POINTS_FORME_ONDE * 100 * 2);
    const b = Buffer.alloc(POINTS_FORME_ONDE * 100 * 2);
    for (let i = 0; i < POINTS_FORME_ONDE * 100; i += 1) {
      a.writeInt16LE(Math.round(10000 * Math.sin(i / 7)), i * 2);
      b.writeInt16LE(Math.round(10000 * Math.sin(i / 400)), i * 2);
    }
    expect(formeOndeDepuisPcm(a)).toEqual(formeOndeDepuisPcm(a));
    expect(formeOndeDepuisPcm(a)).not.toEqual(formeOndeDepuisPcm(b));
  });

  it('3.6 un fichier trop court pour 64 points ne fabrique pas d’onde', () => {
    expect(formeOndeDepuisPcm(Buffer.alloc(10))).toEqual([]);
    expect(decoderFormeOnde(undefined)).toEqual([]);
  });

  it('3.7 l’aller-retour base64 conserve les valeurs — 88 caractères mesurés', () => {
    const points = Array.from({ length: POINTS_FORME_ONDE }, (_, i) => (i * 4) % 256);
    const b64 = encoderFormeOnde(points);
    expect(b64.length).toBe(88);
    expect(decoderFormeOnde(b64)).toEqual(points);
  });

  it('3.8 ⚠️ L’EMPREINTE PORTE LES OCTETS, PAS LE NOM', () => {
    // Deux fichiers différents sous la même clé doivent différer.
    expect(empreinteAsset(1000, '"abc"')).toBe('1000-abc');
    expect(empreinteAsset(1000, '"abc"')).not.toBe(empreinteAsset(2000, '"abc"'));
    expect(empreinteAsset(1000, '"abc"')).not.toBe(empreinteAsset(1000, '"def"'));
    expect(empreinteAsset(1000, null)).toBe('1000');
  });

  it('3.9 la sonde et le décodage ne prennent aucun argument du navigateur', () => {
    const i = sansProse(IMPORT);
    expect(i).not.toMatch(/node:fs|supabase|fetch\(/);
    expect(argumentsSondeAudio('/tmp/a').includes('-of')).toBe(true);
    expect(argumentsFormeOnde('/tmp/a')).toContain('s16le');
    expect(OCTETS_AUDIO_MAX).toBe(40 * 1024 * 1024);
  });

  it('3.10 chaque refus a un message lisible', () => {
    for (const m of MOTIFS_IMPORT_AUDIO) {
      expect(MESSAGES_IMPORT_AUDIO[m].length).toBeGreaterThan(10);
      expect(MESSAGES_IMPORT_AUDIO[m]).not.toMatch(/ffmpeg|ffprobe|minio|bucket/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le fix du silence initial est SACRÉ', () => {
  it('4.1 les trois constantes historiques n’ont pas bougé', () => {
    expect(SEUIL_SILENCE_MUSIQUE_DB).toBe(-50);
    expect(SILENCE_INITIAL_MIN_MS).toBe(300);
    expect(MUSIQUE_TRIM_PREROLL_MS).toBe(50);
  });

  it('4.2 la mesure lit une seule piste audio, et n’écrit rien', () => {
    const a = [...argumentsMesureSilence('/tmp/m.mp3')];
    expect(a).toContain('-map');
    expect(a).toContain('0:a:0');
    expect(a.join(' ')).toContain('silencedetect=n=-50dB:d=0.3');
    expect(a.slice(-3)).toEqual(['-f', 'null', '-']);
  });

  it('4.3 ⚠️ LA COUPE PASSE PAR `atrim`, JAMAIS PAR `-ss`', () => {
    const a = [...argumentsCoupeSilence('/tmp/a.mp3', '/tmp/b.wav', 0.75)];
    expect(a.join(' ')).toContain('atrim=start=0.750,asetpts=PTS-STARTPTS');
    expect(a).not.toContain('-ss');
  });

  it('4.4 ⚠️ 800 ms EST DÉTECTÉ, 200 ms NE L’EST PAS', () => {
    // Mesuré : `silence_start: 0` / `silence_end: 0.800023` sur la piste à
    // 800 ms, et RIEN sur celle à 200 ms.
    const huitCents = '[silencedetect @ 0x1] silence_start: 0\n'
      + '[silencedetect @ 0x1] silence_end: 0.800023 | silence_duration: 0.800023\n';
    expect(silenceInitialSecondes(huitCents)).toBeCloseTo(0.75, 3);
    expect(silenceInitialSecondes('')).toBe(0);
    // Un silence qui ne commence pas à zéro n'est pas un blanc de départ.
    expect(silenceInitialSecondes(
      '[silencedetect @ 0x1] silence_start: 4.2\n'
      + '[silencedetect @ 0x1] silence_end: 5.0 | silence_duration: 0.8\n',
    )).toBe(0);
  });

  it('4.5 ⚠️ LE PREROLL RECULE LA COUPE — on ne rogne pas la première note', () => {
    // 0,800 mesuré → 0,750 coupé : les 50 ms de garde du fix historique.
    const s = silenceInitialSecondes(
      '[silencedetect @ 0x1] silence_start: 0\n'
      + '[silencedetect @ 0x1] silence_end: 0.800023 | silence_duration: 0.800023\n',
    );
    expect(s).toBeCloseTo(0.800023 - MUSIQUE_TRIM_PREROLL_MS / 1000, 3);
  });

  it('4.6 ⚠️ ET LE BLANC NE REVIENT PAS À CHAQUE TOUR DE BOUCLE', () => {
    /* Mesuré sur 14 s de boucle d'une piste de 5 s :
       — avec la coupe préalable : AUCUN silence ;
       — sans elle : silence_start à 0, 5,8 et 11,6 s.
       C'est exactement le bug que `-ss` + `-stream_loop` produirait, et c'est
       pourquoi la coupe écrit un VRAI fichier avant la boucle. */
    const moteur = sansProse(lire('src/lib/autopilot/analyse/rendu-ffmpeg.ts'));
    expect(moteur).toContain("'-stream_loop', '-1'");
    /* Le fichier bouclé est celui qui a DÉJÀ été coupé : la coupe écrit un
       VRAI fichier, et c'est lui que `-stream_loop` rejoue. */
    expect(moteur).toContain('argumentsCoupeSilence');
    const iCoupe = moteur.indexOf('argumentsCoupeSilence');
    const iBoucle = moteur.indexOf("'-stream_loop', '-1'");
    expect(iCoupe).toBeLessThan(iBoucle);
  });

  it('4.7 le blanc mesuré à l’import est mémorisé pour l’écran', () => {
    expect(sansProse(ROUTE)).toContain('silenceInitialSecondes');
    expect(pisteAudioValide(piste({ silenceInitialMs: 800 }), U)!.silenceInitialMs).toBe(800);
    // Et le rendu, lui, continue de le mesurer : c'est lui qui décide.
    expect(sansProse(lire('src/lib/autopilot/analyse/rendu-ffmpeg.ts')))
      .toContain('argumentsMesureSilence');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. La route', () => {
  it('5.1 ⚠️ AJOUTER N’EST PAS TÉLÉVERSER : aucun octet n’est dupliqué', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('lecteurMinio().getObject(BUCKET_MUSIQUE, cle)');
    expect(r).not.toMatch(/putObject|upload/i);
  });

  it('5.2 ⚠️ LA PROPRIÉTÉ AVANT LE STOCKAGE', () => {
    const r = sansProse(ROUTE);
    const iCle = r.indexOf('cleAudioValide(cle, userId)');
    const iStat = r.indexOf('statObject');
    expect(iCle).toBeGreaterThan(-1);
    expect(iCle).toBeLessThan(iStat);
  });

  it('5.3 les droits sont DÉCLARÉS, et la date est gardée', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('corps.droitsConfirmes !== true');
    expect(r).toContain('droitsConfirmesLe');
  });

  it('5.4 ⚠️ RETIRER DU CATALOGUE NE DÉTRUIT RIEN', () => {
    const r = sansProse(ROUTE);
    expect(r).not.toMatch(/removeObject|deleteObject/i);
    /* ⚠️ LE NETTOYAGE A DÉMÉNAGÉ, IL N'A PAS DISPARU. Il se faisait ici, en
       réécrivant la bibliothèque entière depuis une lecture antérieure — ce qui
       effaçait la piste qu'un import voisin venait d'ajouter. Il vit désormais
       DANS la transaction, où favoris et autorisations sont nettoyés sous le
       même verrou que le retrait. L'exigence est inchangée ; seul l'endroit qui
       la tient a changé, et le test suit. */
    const sql = lire('migrations/2026-09-09-autopilot-banque-audio-atomique.sql');
    expect(r).toContain('muterPisteBanqueAudio');
    expect(sql).toContain("jsonb_set(v_biblio, '{favoris}', v_favoris, true)");
    expect(sql).toContain("jsonb_set(v_autom, '{autorises}', v_autoris, true)");
    // Et retirer une fiche ne détruit toujours aucun octet dans le stockage.
    expect(sql).not.toMatch(/removeObject|deleteObject/i);
  });

  it('5.5 la banque est bornée à l’ajout, pas seulement à la relecture', () => {
    expect(sansProse(ROUTE)).toContain('>= PISTES_AUDIO_MAX');
  });

  it('5.6 le dossier temporaire est nettoyé dans tous les cas', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('finally');
    expect(r).toContain('rm(dossier, { recursive: true, force: true })');
  });

  it('5.7 aucun message ne peut porter un chemin', () => {
    const r = sansProse(ROUTE);
    expect(r).not.toMatch(/error:\s*String\(|e\.message/);
  });

  it('5.8 aucun argument ffmpeg ne vient du navigateur', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('argumentsSondeAudio(local)');
    expect(r).toContain('argumentsFormeOnde(local)');
    expect(r).not.toMatch(/sh\s+-c|shell:\s*true/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. La banque à l’usage', () => {
  const banque = {
    pistes: [
      piste({ cle: `${U}/m/a.mp3`, nom: 'Montée douce', moods: ['calme', 'emotionnel'] }),
      piste({ cle: `${U}/m/b.mp3`, nom: 'Sprint', moods: ['sport', 'energique'] }),
      piste({ cle: `${U}/m/c.mp3`, nom: 'Générique', moods: [] }),
    ],
  };

  it('6.1 la recherche porte sur le nom, le mood et son libellé', () => {
    expect(chercherPistes(banque.pistes, 'sprint').map((p) => p.nom)).toEqual(['Sprint']);
    expect(chercherPistes(banque.pistes, 'sport').map((p) => p.nom)).toEqual(['Sprint']);
    // Sans accent, et ça marche quand même.
    expect(chercherPistes(banque.pistes, 'emotionnel').map((p) => p.nom))
      .toEqual(['Montée douce']);
    expect(chercherPistes(banque.pistes, '').length).toBe(3);
    expect(chercherPistes(banque.pistes, 'zzz').length).toBe(0);
  });

  it('6.2 les rayons ne montrent que les ambiances RÉELLEMENT présentes', () => {
    expect([...moodsPresents(banque.pistes)])
      .toEqual(['energique', 'emotionnel', 'calme', 'sport']);
    expect(moodsPresents([])).toEqual([]);
  });

  it('6.3 une piste se retrouve par sa clé', () => {
    expect(pisteParCle(banque, `${U}/m/b.mp3`)!.nom).toBe('Sprint');
    expect(pisteParCle(banque, 'inconnue')).toBeNull();
  });

  it('6.4 la durée se lit comme une durée', () => {
    expect(dureeLisible(185_000)).toBe('3:05');
    expect(dureeLisible(0)).toBe('0:00');
    expect(dureeLisible(59_400)).toBe('0:59');
  });

  it('6.5 une piste se cherche comme une entrée créative', () => {
    const e = entreePiste(banque.pistes[1]);
    expect(e.famille).toBe('audio');
    expect(e.id).toBe(`${U}/m/b.mp3`);
    expect(e.nom).toBe('Sprint');
    expect(e.description).toContain('3:05');
    expect(e.description).toContain('Sport');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’identité du rendu', () => {
  it('7.1 la recette désigne toujours un couple, jamais une URL', () => {
    expect(recetteCanonique(RECETTE_AUDIO_DEFAUT)).toContain('musique=aucune');
    expect(recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, musique: { bucket: 'audio', cle: `${U}/m/a.mp3` },
    })).toContain(`musique=audio:${U}/m/a.mp3`);
  });

  it('7.2 ⚠️ DEUX MUSIQUES = DEUX IDENTITÉS', () => {
    const a = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, musique: { bucket: 'audio', cle: `${U}/m/a.mp3` },
    });
    const b = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, musique: { bucket: 'audio', cle: `${U}/m/b.mp3` },
    });
    expect(a).not.toBe(b);
  });

  it('7.3 aucune migration : `design_style` et `usage` sont déjà du `jsonb`', () => {
    expect(sansProse(CONTRAT)).not.toContain('alter table');
    expect(sansProse(ROUTE)).not.toContain('alter table');
    expect(VERSION_BANQUE_AUDIO).toBe('audio-banque-v1');
  });
});
