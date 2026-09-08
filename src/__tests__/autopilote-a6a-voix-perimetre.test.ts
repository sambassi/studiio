/**
 * A_6a/A_6b — LA VOIX CLONÉE ENTRE DANS LE MOTEUR M3.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LA FAILLE TROUVÉE À L'AUDIT
 * ---------------------------------------------------------------------------
 *
 * `GET /api/tts/elevenlabs` sépare correctement les deux mondes : les voix du
 * compte viennent de `user_voices`, et le catalogue partagé écarte les
 * catégories `cloned` et `professional`. Personne ne VOIT la voix clonée d'un
 * autre.
 *
 * `POST`, lui, vérifiait la FORME de l'identifiant — `[A-Za-z0-9_-]{8,64}` —
 * et rien d'autre. Un identifiant obtenu autrement suffisait donc à faire
 * parler la voix de quelqu'un d'autre. Ne pas AFFICHER une voix n'est pas la
 * même chose que REFUSER de la faire parler.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI A ÉTÉ MESURÉ POUR LE DUCKING
 * ---------------------------------------------------------------------------
 *
 * Musique seule contre musique + voix, en valeur efficace :
 *
 *   sans ducking : 2895 → 4095 → 2895   (la musique s'ajoute et couvre)
 *   avec ducking : 2895 → 3026 → 2895   (elle s'efface, puis revient)
 *
 * Le niveau HORS voix est identique au centième près : la musique n'est
 * touchée que quand quelqu'un parle.
 *
 * Sur un montage complet (son original + musique + voix) : 2855 avec ducking
 * contre 2987 sans — l'écart est plus faible parce que le son des rushes,
 * lui, n'est PAS atténué. C'est délibéré : baisser le son du tournage sous une
 * voix-off changerait le mixage déjà validé de tous les montages sonores.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MOTIFS_VOIX, MESSAGES_VOIX, FORME_VOICE_ID, resoudreVoixElevenLabs,
} from '@/lib/voice/perimetre';
import {
  RECETTE_AUDIO_DEFAUT, recetteCanonique, normaliserRecette,
  estRecetteHistorique, lireRecetteAudio, recettePourUsage,
  VOLUME_MUSIQUE_SOUS_VOIX, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';
import {
  argumentsRendu, rendraDeLAudio, type SourceLocale, type CibleRendu,
} from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { methodeRendu } from '@/lib/autopilot/analyse/rendu-contrat';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const PERIMETRE = lire('src/lib/voice/perimetre.ts');
const ROUTE_TTS = lire('src/app/api/tts/elevenlabs/route.ts');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu.ts');
const GRAPHE = lire('src/lib/autopilot/analyse/rendu-ffmpeg.ts');

const CIBLE: CibleRendu = { largeur: 1080, hauteur: 1920, fps: 30 };
const src = (i: number, aAudio = true): SourceLocale => ({
  ordre: i, chemin: `/tmp/s-${i}.mp4`, entreeSecondes: 0, dureeRetenueSecondes: 4,
  crop: { largeur: 1080, hauteur: 1920, x: 0, y: 0 }, aAudio,
});

const VOIX = { bucket: 'audio', cle: 'u/voix/1.mp3' };
const MUS = { bucket: 'audio', cle: 'u/musiques/1.mp3' };

const graphe = (recette: RecetteAudio, avecMusique: boolean, avecVoix: boolean) => {
  const args = argumentsRendu([src(0), src(1)], CIBLE, '/tmp/o.mp4', {
    recette,
    musique: avecMusique ? { chemin: '/tmp/m.mp3' } : null,
    voix: avecVoix ? { chemin: '/tmp/v.mp3' } : null,
    dureeSecondes: 8,
  }, null);
  return { args, filtre: args[args.indexOf('-filter_complex') + 1] };
};

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Une voix clonée appartient à quelqu’un', () => {
  const catalogue = async () => [{ id: 'elevenlabs-CATALOGUE1234' }];
  const store = (voix: Record<string, unknown>[]) => vi.fn();

  it('1.1 la forme seule ne dit rien de la propriété', () => {
    expect(FORME_VOICE_ID.test('ABCdef12345678')).toBe(true);
    expect(FORME_VOICE_ID.test('../../evasion')).toBe(false);
    expect(FORME_VOICE_ID.test('court')).toBe(false);
    // Et c'est bien la garde de forme qui protège le CHEMIN de l'URL.
    expect(sansProse(PERIMETRE)).toContain('FORME_VOICE_ID.test(identifiantNu)');
  });

  it('1.2 ⚠️ « PAS À TOI » ET « N’EXISTE PAS » DISENT LA MÊME CHOSE', () => {
    // Les distinguer ferait de cette route un révélateur d'identifiants.
    expect(MESSAGES_VOIX.voix_absente).toBe(MESSAGES_VOIX.voix_hors_perimetre);
    for (const m of MOTIFS_VOIX) {
      expect(MESSAGES_VOIX[m].length).toBeGreaterThan(10);
      expect(MESSAGES_VOIX[m]).not.toMatch(/elevenlabs|user_voices|sql/i);
    }
  });

  it('1.3 un compte vide ne peut employer que le catalogue', async () => {
    const r = await resoudreVoixElevenLabs('u1', 'CATALOGUE1234', catalogue);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clonee).toBe(false);
    const autre = await resoudreVoixElevenLabs('u1', 'INCONNUE12345', catalogue);
    expect(autre.ok).toBe(false);
    if (!autre.ok) expect(autre.motif).toBe('voix_hors_perimetre');
  });

  it('1.4 sans compte, rien ne passe', async () => {
    const r = await resoudreVoixElevenLabs('', 'CATALOGUE1234', catalogue);
    expect(r.ok).toBe(false);
    expect(store).toBeDefined();
  });

  it('1.5 ⚠️ LA ROUTE VÉRIFIE AVANT D’APPELER, ET UTILISE L’ID RÉSOLU', () => {
    const code = sansProse(ROUTE_TTS);
    const iGarde = code.indexOf('resoudreVoixElevenLabs(');
    const iAppel = code.indexOf('/v1/text-to-speech/');
    expect(iGarde).toBeGreaterThan(-1);
    expect(iGarde).toBeLessThan(iAppel);
    // Réutiliser la valeur reçue ferait que la vérification n'aurait garanti
    // que la forme.
    expect(code).toContain('${perimetre.providerVoiceId}');
    expect(code).not.toContain('text-to-speech/${voiceId}');
  });

  it('1.6 le catalogue partagé écarte toujours les voix clonées', () => {
    expect(ROUTE_TTS).toContain(
      "const SHARED_CATEGORIES = new Set(['premade', 'default', 'famous', 'high_quality']);",
    );
  });

  it('1.7 ⚠️ LE CONSENTEMENT EST RELU À CHAQUE SYNTHÈSE', () => {
    // Le vérifier seulement à la création laisserait une ligne écrite par une
    // version future faire parler une voix sans preuve datée.
    expect(sansProse(PERIMETRE)).toContain("consent_at");
    expect(sansProse(PERIMETRE)).toContain("motif: 'voix_sans_consentement'");
  });

  it('1.8 le module ne fabrique aucune URL et ne journalise rien', () => {
    const p = sansProse(PERIMETRE);
    expect(p).not.toMatch(/https?:\/\/|console\./);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le contrat de recette', () => {
  it('2.1 ⚠️ AUCUNE VOIX PAR DÉFAUT', () => {
    // Une voix enregistrée ne veut pas dire que toutes les vidéos en portent.
    expect(RECETTE_AUDIO_DEFAUT.voix).toBeNull();
    expect(estRecetteHistorique(RECETTE_AUDIO_DEFAUT)).toBe(true);
  });

  it('2.2 ⚠️ SANS VOIX, LA CHAÎNE CANONIQUE EST CELLE D’AVANT A_6', () => {
    // Écrire les champs même à vide changerait l'empreinte de TOUTES les
    // recettes existantes : les rendus audio déjà réussis deviendraient
    // introuvables, et chaque compte réencoderait sans qu'on entende rien.
    const avecMusique = { ...RECETTE_AUDIO_DEFAUT, musique: MUS };
    expect(recetteCanonique(avecMusique)).not.toContain('voix=');
    expect(recetteCanonique(avecMusique)).not.toContain('duckingVoix=');
  });

  it('2.3 avec une voix, les trois champs entrent dans l’identité', () => {
    const c = recetteCanonique({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX });
    expect(c).toContain(`voix=audio:${VOIX.cle}`);
    expect(c).toContain('volumeVoix=');
    expect(c).toContain('duckingVoix=oui');
  });

  it('2.4 ⚠️ UNE VOIX SUFFIT À SORTIR DU CHEMIN HISTORIQUE', () => {
    // Le graphe émis n'est alors plus celui d'avant : le rendu ne doit pas se
    // réutiliser.
    expect(estRecetteHistorique({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX })).toBe(false);
    expect(methodeRendu({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX }))
      .not.toBe(methodeRendu(RECETTE_AUDIO_DEFAUT));
  });

  it('2.5 deux voix différentes = deux identités ; deux versions aussi', () => {
    const a = recetteCanonique({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX });
    const b = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, voix: { ...VOIX, cle: 'u/voix/2.mp3' },
    });
    const v = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, voix: { ...VOIX, version: '1000-aaa' },
    });
    expect(new Set([a, b, v]).size).toBe(3);
  });

  it('2.6 sans voix, ses deux réglages retombent au défaut', () => {
    const n = normaliserRecette({
      ...RECETTE_AUDIO_DEFAUT, voix: null, volumeVoix: 0.2, duckingVoix: false,
    });
    expect(n.volumeVoix).toBe(RECETTE_AUDIO_DEFAUT.volumeVoix);
    expect(n.duckingVoix).toBe(RECETTE_AUDIO_DEFAUT.duckingVoix);
  });

  it('2.7 le schéma reste FERMÉ, et la voix vient du bon compartiment', () => {
    expect(lireRecetteAudio({ voix: { bucket: 'audio', cle: 'u/v.mp3' } }).ok).toBe(true);
    expect(lireRecetteAudio({ voix: { bucket: 'media', cle: 'u/v.mp3' } }).ok).toBe(false);
    expect(lireRecetteAudio({ voix: { bucket: 'audio', cle: '../evasion' } }).ok).toBe(false);
    expect(lireRecetteAudio({ voix: { bucket: 'audio', cle: 'u/v.mp3', url: 'x' } }).ok)
      .toBe(false);
    expect(lireRecetteAudio({ voixOff: true }).ok).toBe(false);
    expect(lireRecetteAudio({ volumeVoix: 2 }).ok).toBe(false);
    expect(lireRecetteAudio({ duckingVoix: 'oui' }).ok).toBe(false);
  });

  it('2.8 ⚠️ LA TRACE PORTE LA CLÉ, JAMAIS LE TEXTE PRONONCÉ', () => {
    const u = recettePourUsage({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX });
    expect(u.voix).toBe(VOIX.cle);
    expect(JSON.stringify(u)).not.toMatch(/https?:\/\//);
    expect(sansProse(MOTEUR)).toContain('voiceTrackId:');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le graphe audio', () => {
  it('3.1 sans voix, le graphe est celui d’avant — deux bus au plus', () => {
    const { filtre } = graphe({ ...RECETTE_AUDIO_DEFAUT, musique: MUS }, true, false);
    expect(filtre).toContain('amix=inputs=2');
    expect(filtre).not.toContain('avoix');
    expect(filtre).not.toContain('sidechaincompress');
  });

  it('3.2 avec voix, trois bus se mêlent', () => {
    const { filtre } = graphe(
      { ...RECETTE_AUDIO_DEFAUT, musique: MUS, voix: VOIX }, true, true,
    );
    expect(filtre).toContain('amix=inputs=3');
    expect(filtre).toContain('[avoix]');
  });

  it('3.3 ⚠️ LA VOIX NE BOUCLE JAMAIS', () => {
    // Une musique trop courte se répète ; une voix qui se répéterait redirait
    // les mêmes phrases.
    const { args } = graphe(
      { ...RECETTE_AUDIO_DEFAUT, musique: MUS, voix: VOIX }, true, true,
    );
    // Un seul `-stream_loop`, et c'est celui de la musique.
    expect(args.filter((a) => a === '-stream_loop').length).toBe(1);
  });

  it('3.4 ⚠️ ELLE EST BORNÉE ET COMPLÉTÉE À LA DURÉE DU MONTAGE', () => {
    // `apad` garantit que le bus dure exactement le montage : `duration=first`
    // reste juste quel que soit l'ordre des bus.
    const { filtre } = graphe({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX }, false, true);
    expect(filtre).toContain('atrim=duration=8');
    expect(filtre).toContain('apad=whole_dur=8');
  });

  it('3.5 ⚠️ LE DUCKING EST RÉEL, ET IL DÉDOUBLE LE SIGNAL', () => {
    const { filtre } = graphe(
      { ...RECETTE_AUDIO_DEFAUT, musique: MUS, voix: VOIX, duckingVoix: true }, true, true,
    );
    expect(filtre).toContain('asplit=2[avoix][avsc]');
    expect(filtre).toContain('[amus][avsc]sidechaincompress=');
    expect(filtre).toContain('[amusduck]');
    // La musique atténuée remplace la musique brute dans le mélange.
    expect(filtre).not.toMatch(/\[aorig\]\[amus\]\[avoix\]amix/);
  });

  it('3.6 le ducking se coupe, et sans voix il n’existe pas', () => {
    const sans = graphe(
      { ...RECETTE_AUDIO_DEFAUT, musique: MUS, voix: VOIX, duckingVoix: false }, true, true,
    ).filtre;
    expect(sans).not.toContain('sidechaincompress');
    expect(sans).toContain('[avoix0]anull[avoix]');
    // Une voix sans musique n'a rien à atténuer.
    const seule = graphe({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX }, false, true).filtre;
    expect(seule).not.toContain('sidechaincompress');
  });

  it('3.7 ⚠️ LE SON DES RUSHES N’EST PAS ATTÉNUÉ, ET C’EST DÉLIBÉRÉ', () => {
    // Le baisser sous une voix-off changerait le mixage déjà validé de tous
    // les montages sonores. Mesuré : 2855 contre 2987 sur un montage complet,
    // contre 3026 contre 4095 sur musique + voix seules.
    const { filtre } = graphe(
      { ...RECETTE_AUDIO_DEFAUT, musique: MUS, voix: VOIX }, true, true,
    );
    expect(filtre).toContain('[aconcat]volume=');
    expect(filtre).not.toMatch(/\[aorig\]\[avsc\]sidechaincompress/);
  });

  it('3.8 ⚠️ L’INDICE DES ENTRÉES DE STYLE COMPTE LA VOIX', () => {
    // Un indice qui l'oublierait ferait pointer les entrées du style sur la
    // voix — un logo qui deviendrait une piste audio.
    expect(sansProse(MOTEUR))
      .toContain('+ (musique !== null ? 1 : 0) + (voix !== null ? 1 : 0)');
  });

  it('3.9 une voix seule suffit à produire une piste audio', () => {
    expect(rendraDeLAudio([src(0, false)], RECETTE_AUDIO_DEFAUT, false, false)).toBe(false);
    expect(rendraDeLAudio([src(0, false)], RECETTE_AUDIO_DEFAUT, false, true)).toBe(true);
    const { args } = graphe({ ...RECETTE_AUDIO_DEFAUT, voix: VOIX }, false, true);
    expect(args).toContain('[aout]');
  });

  it('3.10 la voix suit la durée RÉELLE, recouvrements compris', () => {
    expect(sansProse(GRAPHE)).toContain('const dureeReelleSecondes = Math.max(0');
    expect(sansProse(GRAPHE)).toContain('duree(dureeReelleSecondes)');
  });

  it('3.11 ⚠️ SON BLANC DE DÉPART N’EST PAS COUPÉ', () => {
    /* Une musique commence quand on veut ; une voix commence quand elle a été
       écrite pour commencer, et le silence initial d'une voix-off est souvent
       voulu — le temps qu'un plan s'installe. La couper déplacerait la parole
       par rapport aux sous-titres, datés sur le fichier tel qu'il est. */
    const m = sansProse(MOTEUR);
    const iVoix = m.indexOf('let voix: MusiqueLocale | null = null');
    const bloc = m.slice(iVoix, iVoix + 900);
    expect(bloc).not.toContain('couperSilenceInitialMusique');
    // La musique, elle, garde sa coupe.
    expect(m).toContain('couperSilenceInitialMusique');
  });

  it('3.12 les réglages du ducking sont nommés, pas éparpillés', () => {
    expect(sansProse(GRAPHE))
      .toContain("const PARAMETRES_DUCKING = 'threshold=0.03:ratio=8:attack=20:release=400'");
    expect(VOLUME_MUSIQUE_SOUS_VOIX).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Aucune régression', () => {
  it('4.1 le chemin historique est intact, au caractère près', () => {
    const avant = argumentsRendu([src(0), src(1)], CIBLE, '/tmp/o.mp4');
    const apres = argumentsRendu([src(0), src(1)], CIBLE, '/tmp/o.mp4', {
      recette: RECETTE_AUDIO_DEFAUT, musique: null, voix: null, dureeSecondes: 8,
    }, null);
    expect(apres).toEqual(avant);
  });

  it('4.2 le fix du silence musique n’a pas bougé', () => {
    const s = sansProse(lire('src/lib/autopilot/analyse/musique-silence.ts'));
    expect(s).toContain('SEUIL_SILENCE_MUSIQUE_DB = -50');
    expect(s).toContain('SILENCE_INITIAL_MIN_MS = 300');
    expect(s).toContain('MUSIQUE_TRIM_PREROLL_MS = 50');
  });

  it('4.3 aucune migration', () => {
    expect(sansProse(PERIMETRE)).not.toContain('alter table');
    expect(sansProse(GRAPHE)).not.toContain('alter table');
  });
});
