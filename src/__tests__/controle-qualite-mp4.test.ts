/**
 * Contrôle qualité du MP4 final (commun Autopilote / Créer).
 * Partie PURE (mesures fabriquées) + partie RÉELLE : de vrais MP4 produits par
 * ffmpeg à partir de la vidéo de démonstration `public/styles-video/sport.mp4`
 * (aucune donnée utilisateur, aucun fournisseur, aucun crédit).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  evaluerControleMp4, controlerMp4, mesurerMp4, messagesControle, noirAnormalS,
  lireEntete, lireNoirs, lireNetteteImages, lireContrastes, dernierTemps, type MesuresMp4,
} from '@/lib/render/controle-qualite-mp4';

const sain = (sur: Partial<MesuresMp4> = {}): MesuresMp4 => ({
  erreur: null, dureeS: 30, dureeVideoS: 30, dureeAudioS: 30,
  video: { codec: 'h264', largeur: 1080, hauteur: 1920, fps: 30, debitKbps: 5000 },
  audio: { codec: 'aac', hz: 44100 },
  noirs: [], netteteImages: Array.from({ length: 60 }, () => 24),
  son: { piste: true, moyenDb: -20, maxDb: -3, silencieux: false },
  ...sur,
});
const codes = (m: MesuresMp4, a = {}) => evaluerControleMp4(m, a).problemes.map((p) => p.code);

describe('lecture des journaux ffmpeg', () => {
  it('en-tête : durée, codecs, résolution, fps, débit', () => {
    const j = `Duration: 00:00:06.00, start: 0.000000, bitrate: 1234 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], 3000 kb/s, 30 fps, 30 tbr
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s`;
    const e = lireEntete(j);
    expect(e.dureeS).toBe(6);
    expect(e.video).toEqual({ codec: 'h264', largeur: 1080, hauteur: 1920, fps: 30, debitKbps: 3000 });
    expect(e.audio).toEqual({ codec: 'aac', hz: 44100 });
  });
  it('noirs, temps décodé, netteté hors intervalles noirs', () => {
    expect(lireNoirs('[Parsed_blackdetect_2 @ 0x1] black_start:2 black_end:4 black_duration:2')).toEqual([[2, 4]]);
    expect(dernierTemps('frame= 1 time=00:00:01.00 \rframe= 9 time=00:00:05.50 bitrate=')).toBe(5.5);
    const sortie = 'frame:0 pts:0 pts_time:0\nlavfi.signalstats.YAVG=20\nframe:1 pts:1 pts_time:3\nlavfi.signalstats.YAVG=0\nframe:2 pts:2 pts_time:5\nlavfi.signalstats.YAVG=22\n';
    expect(lireNetteteImages(sortie, [[2, 4]])).toEqual([20, 22]);
  });
  it('régression C3 — images plates écartées du jugement de netteté ; contrastes non alignés : rien jugé', () => {
    const sortie = 'frame:0 pts:0 pts_time:0\nlavfi.signalstats.YAVG=1\nframe:1 pts:1 pts_time:0.5\nlavfi.signalstats.YAVG=3\n';
    const journal = '[m] lavfi.signalstats.YHIGH=40\n[m] lavfi.signalstats.YLOW=40\n[m] lavfi.signalstats.YHIGH=120\n[m] lavfi.signalstats.YLOW=60\n';
    expect(lireContrastes(journal)).toEqual([0, 60]);
    expect(lireNetteteImages(sortie, [], lireContrastes(journal))).toEqual([3]);
    expect(lireNetteteImages(sortie, [], [10])).toEqual([]);
  });
});

describe('évaluation (pure)', () => {
  it('MP4 sain : aucun problème', () => {
    const r = evaluerControleMp4(sain(), { dureeS: 30, son: 'attendu', format: 'reel' });
    expect(r.niveau).toBe('ok');
    expect(r.problemes).toEqual([]);
    expect(messagesControle(r)).toEqual([]);
  });
  it('fichier illisible, sans vidéo ou vide : inutilisable', () => {
    expect(evaluerControleMp4(sain({ erreur: 'fichier illisible' })).niveau).toBe('inutilisable');
    expect(codes(sain({ video: null }))).toEqual(['pas_de_video']);
    expect(codes(sain({ dureeS: 0.2, dureeVideoS: 0.2 }))).toEqual(['trop_court']);
  });
  it('régression C1 — presque tout noir : AVERTISSEMENT, jamais blocage (scène de nuit réelle)', () => {
    const r = evaluerControleMp4(sain({ noirs: [[0, 29]] }));
    expect(r.niveau).toBe('avertissement');
    expect(r.problemes.map((p) => p.code)).toEqual(['image_noire']);
  });
  it('son attendu mais absent ou muet : avertissement ; volontairement absent : rien', () => {
    expect(codes(sain({ audio: null, son: null }), { son: 'attendu' })).toEqual(['son_absent']);
    expect(codes(sain({ son: { piste: true, moyenDb: -91, maxDb: -91, silencieux: true } }), { son: 'attendu' })).toEqual(['son_muet']);
    expect(codes(sain({ audio: null, son: null }), { son: 'absent' })).toEqual([]);
    expect(codes(sain({ audio: null, son: null }), { son: 'inconnu' })).toEqual([]);
  });
  it('durée très différente du plan : avertissement ; dans la tolérance : rien', () => {
    expect(codes(sain(), { dureeS: 45 })).toEqual(['duree_ecart']);
    expect(codes(sain(), { dureeS: 30.8 })).toEqual([]);
  });
  it('fondus volontaires d’entrée et de sortie ignorés, noir au milieu signalé', () => {
    expect(noirAnormalS([0, 0.5], 30)).toBe(0);
    expect(noirAnormalS([29.5, 30], 30)).toBe(0);
    expect(codes(sain({ noirs: [[0, 0.5], [29.5, 30]] }))).toEqual([]);
    expect(codes(sain({ noirs: [[10, 12]] }))).toEqual(['images_noires']);
  });
  it('netteté : majorité d’images floues signalée, quelques-unes non', () => {
    expect(codes(sain({ netteteImages: Array.from({ length: 60 }, () => 3.5) }))).toEqual(['image_floue']);
    expect(codes(sain({ netteteImages: [...Array.from({ length: 10 }, () => 3), ...Array.from({ length: 50 }, () => 24)] }))).toEqual([]);
    expect(codes(sain({ netteteImages: [3, 3, 3] }))).toEqual([]);
  });
  it('écart de durée audio/vidéo, codec, résolution, orientation', () => {
    expect(codes(sain({ dureeAudioS: 20 }))).toEqual(['ecart_audio_video']);
    expect(codes(sain({ video: { codec: 'vp9', largeur: 1080, hauteur: 1920, fps: 30, debitKbps: null } }))).toEqual(['codec_video']);
    expect(codes(sain({ video: { codec: 'h264', largeur: 270, hauteur: 480, fps: 30, debitKbps: null } }))).toEqual(['resolution_basse']);
    expect(codes(sain(), { format: 'tv' })).toEqual(['orientation']);
  });
});

// ── Vrais MP4 ─────────────────────────────────────────────────────────────
const ffmpegDispo = spawnSync('ffmpeg', ['-version']).status === 0;
const SOURCE = resolve(__dirname, '../../public/styles-video/sport.mp4');

describe.skipIf(!ffmpegDispo)('contrôle de vrais MP4 (ffmpeg)', () => {
  let dossier = '';
  const f = (nom: string) => join(dossier, nom);
  const ff = (args: string[]) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  const VIDEO = ['-i', SOURCE];
  const SINE = (d: number) => ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${d}`];
  const ENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  const ECHELLE = 'scale=540:960';

  beforeAll(() => {
    dossier = mkdtempSync(join(tmpdir(), 'studiio-cq-'));
    ff([...VIDEO, ...SINE(6), ...ENC, '-vf', ECHELLE, '-c:a', 'aac', '-shortest', f('sain.mp4')]);
    ff([...VIDEO, ...ENC, '-vf', ECHELLE, '-an', f('sans_son.mp4')]);
    ff([...VIDEO, ...SINE(6), ...ENC, '-vf', `boxblur=12:3,${ECHELLE}`, '-c:a', 'aac', '-shortest', f('flou.mp4')]);
    ff([...VIDEO, ...SINE(6), ...ENC, '-vf', `${ECHELLE},drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,2,4)'`, '-c:a', 'aac', '-shortest', f('noirs.mp4')]);
    ff([...VIDEO, ...SINE(6), ...ENC, '-vf', `${ECHELLE},fade=t=in:st=0:d=0.4,fade=t=out:st=5.5:d=0.4`, '-c:a', 'aac', '-shortest', f('fondus.mp4')]);
    ff([...VIDEO, ...SINE(3), ...ENC, '-vf', ECHELLE, '-c:a', 'aac', f('ecart_av.mp4')]);
    ff([...VIDEO, ...SINE(6), ...ENC, '-vf', `${ECHELLE},eq=brightness=-0.35:contrast=0.9`, '-c:a', 'aac', '-shortest', f('sombre.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x1a1a2e:s=540x960:d=6:r=30', ...SINE(6), ...ENC, '-vf', 'drawbox=x=70:y=450:w=400:h=45:color=white:t=fill,drawbox=x=120:y=510:w=300:h=30:color=white:t=fill', '-c:a', 'aac', '-shortest', f('carte_texte.mp4')]);
    ff(['-f', 'lavfi', '-i', 'gradients=s=540x960:d=6:r=30:c0=0x7C3AED:c1=0xEC4899:speed=0.01', ...SINE(6), ...ENC, '-c:a', 'aac', '-shortest', f('degrade.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=black:s=540x960:d=6:r=30', ...SINE(6), ...ENC, '-c:a', 'aac', '-shortest', f('tout_noir.mp4')]);
    ff([...VIDEO, ...SINE(6), ...ENC, '-vf', 'scale=720:720', '-c:a', 'aac', '-shortest', f('carre.mp4')]);
    writeFileSync(f('corrompu.mp4'), readFileSync(f('sain.mp4')).subarray(0, 4000));
    writeFileSync(f('texte.mp4'), 'ceci n’est pas une vidéo');
  }, 120_000);

  afterAll(() => {
    for (const n of readdirSync(dossier)) unlinkSync(join(dossier, n));
    rmdirSync(dossier);
  });

  const controle = (nom: string, attentes = {}) => controlerMp4(f(nom), { dureeS: 6, son: 'attendu', ...attentes });

  it('MP4 sain : aucun problème', async () => {
    const r = await controle('sain.mp4');
    expect(r?.problemes).toEqual([]);
    expect(r?.niveau).toBe('ok');
    expect(r?.resume.resolution).toBe('540x960');
    expect(r?.resume.codecVideo).toBe('h264');
    expect(r?.resume.codecAudio).toBe('aac');
  }, 60_000);

  it('sans son alors qu’un son est attendu : avertissement', async () => {
    expect((await controle('sans_son.mp4'))?.problemes.map((p) => p.code)).toEqual(['son_absent']);
  }, 60_000);

  it('volontairement sans son : aucun avertissement', async () => {
    const r = await controle('sans_son.mp4', { son: 'absent' });
    expect(r?.niveau).toBe('ok');
  }, 60_000);

  it('vidéo floue : avertissement netteté', async () => {
    expect((await controle('flou.mp4'))?.problemes.map((p) => p.code)).toEqual(['image_floue']);
  }, 60_000);

  it('images noires au milieu : avertissement ; fondus d’entrée et de sortie : rien', async () => {
    expect((await controle('noirs.mp4'))?.problemes.map((p) => p.code)).toEqual(['images_noires']);
    expect((await controle('fondus.mp4'))?.problemes).toEqual([]);
  }, 60_000);

  it('durée incorrecte par rapport au plan : avertissement', async () => {
    expect((await controle('sain.mp4', { dureeS: 20 }))?.problemes.map((p) => p.code)).toEqual(['duree_ecart']);
  }, 60_000);

  it('piste audio plus courte que la vidéo : écart signalé', async () => {
    expect((await controle('ecart_av.mp4'))?.problemes.map((p) => p.code)).toContain('ecart_audio_video');
  }, 60_000);

  it('fichier corrompu ou qui n’est pas une vidéo : inutilisable', async () => {
    expect((await controle('corrompu.mp4'))?.niveau).toBe('inutilisable');
    expect((await controle('texte.mp4'))?.niveau).toBe('inutilisable');
  }, 60_000);

  it('régression C3 — carte de texte sur fond uni, dégradé, scène sombre : pas « floue »', async () => {
    for (const nom of ['carte_texte.mp4', 'degrade.mp4', 'sombre.mp4']) {
      const r = await controle(nom);
      expect(r?.problemes.map((p) => p.code)).not.toContain('image_floue');
      expect(r?.niveau).not.toBe('inutilisable');
    }
  }, 60_000);

  it('régression C1 — scène sombre et vidéo noire : jamais inutilisable (pas de rendu jeté)', async () => {
    expect((await controle('sombre.mp4'))?.niveau).not.toBe('inutilisable');
    const noir = await controle('tout_noir.mp4');
    expect(noir?.niveau).toBe('avertissement');
    expect(noir?.problemes.map((p) => p.code)).toContain('image_noire');
  }, 60_000);

  it('régression C2 — vidéo carrée attendue carrée : aucun avertissement d’orientation', async () => {
    const r = await controle('carre.mp4', attentesDuPost({ videoFormat: '1:1', format: 'tv', sequences: { total: 6 }, hasAudio: true }));
    expect(r?.problemes).toEqual([]);
  }, 60_000);

  it('ffmpeg introuvable : pas de contrôle, pas d’erreur', async () => {
    expect(await mesurerMp4(f('sain.mp4'), '/chemin/inexistant/ffmpeg')).toBeNull();
  });
});

// ── Intégration (sans base ni stockage) ───────────────────────────────────
import { attentesDuPost } from '@/lib/rendus/mp4-durable-serveur';
import { patchPostAvecMp4 } from '@/lib/rendus/mp4-durable';
import { avertissementsMontage } from '@/lib/autopilot/produire';

describe('Créer : attentes lues sur le post, rien d’inventé', () => {
  it('durée réelle (`sequences.total`), son prévu et format quand le post les porte', () => {
    expect(attentesDuPost({ sequences: { total: 22, order: ['intro'] }, hasAudio: true, videoFormat: '9:16', format: 'reel' }))
      .toEqual({ dureeS: 22, son: 'attendu', format: 'reel' });
  });
  it('régression — sans `total`, la somme des séquences n’est PAS une durée (surimpressions) : inconnue', () => {
    expect(attentesDuPost({ sequences: { intro: 3, cards: 8, video: 10, cta: 4, order: ['intro', 'cards', 'video', 'cta'] } }).dureeS).toBeNull();
  });
  it('régression C2 — format lu dans `videoFormat`, jamais dans `format` (facturation : carré = « tv »)', () => {
    expect(attentesDuPost({ videoFormat: '1:1', format: 'tv' }).format).toBe('carre');
    expect(attentesDuPost({ videoFormat: '16:9', format: 'tv' }).format).toBe('tv');
    expect(attentesDuPost({ format: 'tv' }).format).toBeNull();
  });
  it('post muet ou incomplet : inconnu, jamais « attendu »', () => {
    expect(attentesDuPost({})).toEqual({ dureeS: null, son: 'inconnu', format: null });
    expect(attentesDuPost({ hasAudio: false }).son).toBe('inconnu');
  });
});

describe('Créer : le patch du post garde son comportement et ajoute le contrôle', () => {
  const post = { media_url: 'a.webm', metadata: { renderedVideoUrl: 'a.webm', avertissements: ['déjà là'] } };
  const urls = { webmUrl: 'a.webm', mp4Url: 'a.mp4' };
  it('sans contrôle : strictement le patch d’avant', () => {
    expect(patchPostAvecMp4(post, urls)?.metadata.controleQualiteMp4).toBeUndefined();
    expect(patchPostAvecMp4(post, urls)?.metadata.avertissements).toEqual(['déjà là']);
  });
  it('avec contrôle : écrit le résultat et ajoute les avertissements sans doublon', () => {
    const r = patchPostAvecMp4(post, urls, { resultat: { niveau: 'avertissement' }, avertissements: ['déjà là', 'Les images semblent floues.'] });
    expect(r?.metadata.controleQualiteMp4).toEqual({ niveau: 'avertissement' });
    expect(r?.metadata.avertissements).toEqual(['déjà là', 'Les images semblent floues.']);
  });
});

describe('Autopilote : avertissements du montage', () => {
  const base = { musiqueIntrouvable: false, audioSilencieux: false, voixRepliEdge: false, montageSimple: false };
  it('sans contrôle : liste inchangée', () => {
    expect(avertissementsMontage(base)).toEqual([]);
  });
  it('avec contrôle : ses messages sont ajoutés, après le son muet déjà signalé', () => {
    expect(avertissementsMontage({ ...base, audioSilencieux: true, controleMp4: ['Les images semblent floues.'] }))
      .toEqual(['Le fichier final ne contient aucun son audible (ni musique, ni voix, ni son des rushes).', 'Les images semblent floues.']);
  });
});

describe('ordre des étapes (garde de source — le rendu complet exige Remotion, base et stockage)', () => {
  const lire = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  it('Autopilote : le contrôle précède la vignette et le téléversement, et échoue avant tout dépôt', () => {
    const r = lire('src/lib/autopilot/render.ts');
    const iControle = r.indexOf("controlerMp4(outputPath");
    const iThrow = r.indexOf('Montage final inutilisable');
    const iVignette = r.indexOf('await extraireVignette(outputPath');
    const iDepot = r.indexOf('const videoUrl = await uploadToStorage');
    expect(iControle).toBeGreaterThan(0);
    expect(iControle).toBeLessThan(iThrow);
    expect(iThrow).toBeLessThan(iVignette);
    expect(iVignette).toBeLessThan(iDepot);
  });
  it('Créer : le contrôle suit la conversion et précède le dépôt du MP4, échec = « sortie_invalide »', () => {
    const r = lire('src/lib/rendus/mp4-durable-serveur.ts');
    const iConv = r.indexOf('await transcodeWebmToMp4WithLadder');
    const iControle = r.indexOf('await controlerMp4(sortie');
    const iDepot = r.indexOf('if (!(await deposer(');
    expect(iConv).toBeLessThan(iControle);
    expect(iControle).toBeLessThan(iDepot);
    expect(r).toContain("marquerEchec(userId, postId, post, webmUrl, 'sortie_invalide')");
  });
  it('l’encodage n’est pas modifié par ce lot', () => {
    const t = lire('src/lib/ffmpeg/transcode-to-mp4.ts');
    expect(t).toContain("'-preset', 'ultrafast'");
    expect(t).toContain("crf: 28");
  });
});
