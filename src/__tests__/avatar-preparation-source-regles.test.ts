// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  AMELIORATION_NEUTRE, BORNES_AMELIORATION, TAILLE_MAX_OCTETS, ameliorationAutomatique, analyserSortieFfprobe, argumentsFfmpeg,
  bornerParametres, debitVideoMaxBps, filtreCssApercu, geometrieSortie, libelleCadrage, niveauQualite, normaliserRotation,
  parametresParDefaut, preflightSource, recadrageDepuisReglages, statistiquesImage, zoomMinimal,
  type InfosVideo, type ParametresTraitement,
} from '@/lib/avatar/preparation-source-regles';

/**
 * PRÉPARER LA VIDÉO SOURCE — les règles pures : la sonde lue, le contrôle
 * AVANT fournisseur, les bornes, la commande ffmpeg, l'amélioration
 * automatique. Aucun binaire, aucun réseau.
 */

const infos = (p: Partial<InfosVideo> = {}): InfosVideo => ({
  conteneur: 'mov,mp4,m4a,3gp,3g2,mj2', codecVideo: 'h264', codecAudio: 'aac',
  largeur: 1920, hauteur: 1080, rotation: 0, largeurEffective: 1920, hauteurEffective: 1080,
  dureeS: 120, fps: 30, debitBps: 4_000_000, tailleOctets: 20 * 1024 * 1024, ...p,
});

const params = (p: Partial<ParametresTraitement> = {}): ParametresTraitement => ({
  ...parametresParDefaut(120), ...p,
});

describe('ffprobe : la sortie lue', () => {
  it('format, codecs, dimensions, durée, cadence, débit, taille', () => {
    const i = analyserSortieFfprobe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '62.5', bit_rate: '3000000', size: '2048' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30000/1001' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    }, 99)!;
    expect(i).toMatchObject({
      codecVideo: 'h264', codecAudio: 'aac', largeur: 1280, hauteur: 720, rotation: 0,
      largeurEffective: 1280, hauteurEffective: 720, dureeS: 62.5, fps: 29.97, debitBps: 3_000_000, tailleOctets: 2048,
    });
  });

  it('⚠️ rotation (side_data −90 d’un téléphone) : dimensions effectives PERMUTÉES', () => {
    const i = analyserSortieFfprobe({
      format: { format_name: 'mov,mp4', duration: '30' },
      streams: [{ codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
    }, 10)!;
    expect(i.rotation).toBe(270);
    expect([i.largeurEffective, i.hauteurEffective]).toEqual([1080, 1920]);
    expect(i.codecAudio).toBeNull();
    expect(i.tailleOctets).toBe(10);
  });

  it('rotation par l’étiquette historique `rotate`', () => {
    const i = analyserSortieFfprobe({ format: {}, streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 480, tags: { rotate: '90' } }] }, 1)!;
    expect(i.rotation).toBe(90);
    expect(i.largeurEffective).toBe(480);
  });

  it('une vignette (mjpeg) n’est pas le flux vidéo ; rien d’exploitable → null', () => {
    const i = analyserSortieFfprobe({ format: { format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', codec_name: 'mjpeg', width: 300, height: 300 }] }, 1)!;
    expect(i.codecVideo).toBeNull();
    expect(analyserSortieFfprobe({}, 1)).toBeNull();
    expect(analyserSortieFfprobe(null, 1)).toBeNull();
  });

  it('normaliserRotation : quart de tour le plus proche, toujours 0/90/180/270', () => {
    expect([-90, 90, 180, -180, 270, 450, '90', 'x', 89].map(normaliserRotation)).toEqual([270, 90, 180, 180, 270, 90, 90, 0, 90]);
  });
});

describe('Contrôle AVANT fournisseur', () => {
  it('une bonne vidéo 1080p : ok, sans avertissement → « Bon »', () => {
    const p = preflightSource(infos());
    expect(p).toEqual({ ok: true, motifs: [], avertissements: [] });
    expect(niveauQualite(p)).toBe('bon');
  });

  it('⚠️ durée : < 15 s refusée ; > 600 s refusée en sortie, corrigible à l’import', () => {
    expect(preflightSource(infos({ dureeS: 9 })).motifs[0]).toMatch(/15 secondes minimum/);
    expect(preflightSource(infos({ dureeS: 9 }), { etape: 'original' }).ok).toBe(false);
    expect(preflightSource(infos({ dureeS: 700 })).motifs[0]).toMatch(/10 minutes maximum/);
    const orig = preflightSource(infos({ dureeS: 700 }), { etape: 'original' });
    expect(orig.ok).toBe(true);
    expect(orig.avertissements[0]).toMatch(/Couper/);
  });

  it('⚠️ résolution : < 640 refusée ; < 1080 avertie (« Acceptable ») ; > 4096 corrigible à l’import seulement', () => {
    const petite = preflightSource(infos({ largeurEffective: 480, hauteurEffective: 360 }));
    expect(petite.ok).toBe(false);
    expect(petite.motifs[0]).toMatch(/640 px minimum/);
    const moyenne = preflightSource(infos({ largeurEffective: 960, hauteurEffective: 540 }));
    expect(moyenne.ok).toBe(true);
    expect(niveauQualite(moyenne)).toBe('acceptable');
    expect(preflightSource(infos({ largeurEffective: 5120, hauteurEffective: 2880 })).ok).toBe(false);
    expect(preflightSource(infos({ largeurEffective: 5120, hauteurEffective: 2880 }), { etape: 'original' }).ok).toBe(true);
  });

  it('⚠️ rotation : c’est la dimension EFFECTIVE qui compte', () => {
    // 600 × 1000 codée, tournée : 1000 de grand côté → acceptée.
    expect(preflightSource(infos({ largeur: 1000, hauteur: 600, largeurEffective: 600, hauteurEffective: 1000, rotation: 90 })).ok).toBe(true);
  });

  it('⚠️ son obligatoire, flux vidéo obligatoire', () => {
    expect(preflightSource(infos({ codecAudio: null })).motifs[0]).toMatch(/pas de son/);
    const sansImage = preflightSource(infos({ codecVideo: null }));
    expect(sansImage.ok).toBe(false);
    expect(sansImage.motifs).toEqual(['Aucune image vidéo n’a été trouvée dans ce fichier.']);
  });

  it('⚠️ conteneur et codec : mp4/mov/webm, h264/hevc/vp8/vp9', () => {
    expect(preflightSource(infos({ conteneur: 'matroska,webm', codecVideo: 'vp9', codecAudio: 'opus' })).ok).toBe(true);
    expect(preflightSource(infos({ conteneur: 'avi' })).motifs[0]).toMatch(/MP4, MOV ou WebM/);
    expect(preflightSource(infos({ codecVideo: 'mpeg4' })).motifs[0]).toMatch(/mpeg4/);
  });

  it('⚠️ taille : > 32 Mo refusée en sortie, corrigible à l’import', () => {
    expect(preflightSource(infos({ tailleOctets: TAILLE_MAX_OCTETS + 1 })).motifs[0]).toMatch(/32 Mo maximum/);
    expect(preflightSource(infos({ tailleOctets: TAILLE_MAX_OCTETS + 1 }), { etape: 'original' }).ok).toBe(true);
  });

  it('cadence faible : avertissement seulement', () => {
    const p = preflightSource(infos({ fps: 12 }));
    expect(p.ok).toBe(true);
    expect(p.avertissements[0]).toMatch(/saccadée/);
    expect(niveauQualite({ ok: false, motifs: ['x'], avertissements: [] })).toBe('insuffisant');
  });
});

describe('Bornes — rien du navigateur n’atteint ffmpeg tel quel', () => {
  it('⚠️ corrections ramenées aux plages naturelles', () => {
    const p = bornerParametres({ amelioration: { active: true, luminosite: 5, contraste: 9, saturation: -3, nettete: 12, debruitage: true } }, 60);
    expect(p.amelioration).toEqual({
      active: true, luminosite: BORNES_AMELIORATION.luminosite[1], contraste: 1.15, saturation: 0.9, nettete: 0.6, debruitage: true,
    });
    const n = bornerParametres({ amelioration: { luminosite: NaN, active: 'oui' } as never }, 60);
    expect(n.amelioration).toEqual(AMELIORATION_NEUTRE);
  });

  it('⚠️ coupe : dans la durée, 15 s minimum, 600 s maximum', () => {
    expect(bornerParametres({ debutS: -5, finS: 999 }, 120)).toMatchObject({ debutS: 0, finS: 120 });
    expect(bornerParametres({ debutS: 50, finS: 55 }, 120)).toMatchObject({ debutS: 50, finS: 65 });
    expect(bornerParametres({ debutS: 115, finS: 118 }, 120)).toMatchObject({ debutS: 105, finS: 120 });
    expect(bornerParametres({ debutS: 10, finS: 900 }, 1000)).toMatchObject({ debutS: 10, finS: 610 });
    expect(bornerParametres({ debutS: 80, finS: 20 }, 120)).toMatchObject({ debutS: 20, finS: 80 });
    // Une vidéo trop courte reste entière : le contrôle la refusera.
    expect(bornerParametres({ debutS: 2, finS: 5 }, 10)).toMatchObject({ debutS: 0, finS: 10 });
    expect(bornerParametres(null, 30)).toMatchObject({ debutS: 0, finS: 30, rotation: 0, recadrage: null });
  });

  it('rotation au quart de tour, sinon 0', () => {
    expect(bornerParametres({ rotation: 90 }, 60).rotation).toBe(90);
    expect(bornerParametres({ rotation: 45 as never }, 60).rotation).toBe(0);
  });

  it('⚠️ recadrage : dans l’image, et jamais sous 640 px de grand côté', () => {
    const p = bornerParametres({ recadrage: { x: 0.9, y: -1, largeur: 0.2, hauteur: 0.2 } }, 60, { largeur: 1920, hauteur: 1080 });
    const c = p.recadrage!;
    expect(Math.max(c.largeur * 1920, c.hauteur * 1080)).toBeGreaterThanOrEqual(639.99);
    expect(c.x + c.largeur).toBeLessThanOrEqual(1);
    expect(c.y).toBe(0);
    // Image entière = pas de recadrage.
    expect(bornerParametres({ recadrage: { x: 0, y: 0, largeur: 1, hauteur: 1 } }, 60).recadrage).toBeNull();
    // Source trop petite : le recadrage s'efface.
    expect(bornerParametres({ recadrage: { x: 0, y: 0, largeur: 0.5, hauteur: 0.5 } }, 60, { largeur: 640, hauteur: 360 }).recadrage).toBeNull();
  });
});

describe('Commande ffmpeg — fonction pure', () => {
  const val = (args: string[], opt: string) => args[args.indexOf(opt) + 1];

  it('⚠️ sans retouche : coupe, H.264 + AAC, faststart, rotation remise à zéro, métadonnées retirées', () => {
    const a = argumentsFfmpeg('/t/in.webm', '/t/out.mp4', params({ debutS: 5, finS: 65 }), infos());
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'));
    expect(val(a, '-ss')).toBe('5');
    expect(val(a, '-i')).toBe('/t/in.webm');
    expect(val(a, '-t')).toBe('60');
    expect(val(a, '-c:v')).toBe('libx264');
    expect(val(a, '-preset')).toBe('veryfast');
    expect(val(a, '-crf')).toBe('20');
    expect(val(a, '-pix_fmt')).toBe('yuv420p');
    expect(val(a, '-c:a')).toBe('aac');
    expect(val(a, '-b:a')).toBe('128k');
    expect(val(a, '-movflags')).toBe('+faststart');
    expect(val(a, '-metadata:s:v')).toBe('rotate=0');
    expect(val(a, '-map_metadata')).toBe('-1');
    expect(a.at(-1)).toBe('/t/out.mp4');
    expect(val(a, '-vf')).toBe('format=yuv420p');
  });

  it('⚠️ amélioration inactive : AUCUN eq/unsharp/hqdn3d, même avec des valeurs', () => {
    const a = argumentsFfmpeg('i', 'o', params({ amelioration: { active: false, luminosite: 0.05, contraste: 1.1, saturation: 1.1, nettete: 0.4, debruitage: true } }), infos());
    expect(val(a, '-vf')).not.toMatch(/eq=|unsharp|hqdn3d/);
  });

  it('amélioration active : débruitage AVANT correction, netteté légère en dernier', () => {
    const vf = val(argumentsFfmpeg('i', 'o', params({ amelioration: { active: true, luminosite: 0.04, contraste: 1.08, saturation: 1.04, nettete: 0.3, debruitage: true } }), infos()), '-vf');
    expect(vf).toBe('hqdn3d=1.5:1.5:6:6,eq=brightness=0.04:contrast=1.08:saturation=1.04,unsharp=5:5:0.3:5:5:0,format=yuv420p');
    const sansDebruit = val(argumentsFfmpeg('i', 'o', params({ amelioration: { active: true, luminosite: 0, contraste: 1, saturation: 1, nettete: 0, debruitage: false } }), infos()), '-vf');
    expect(sansDebruit).toBe('format=yuv420p');
  });

  it('⚠️ rotation : transpose, et le recadrage se lit sur l’image TOURNÉE', () => {
    const vf90 = val(argumentsFfmpeg('i', 'o', params({ rotation: 90, recadrage: { x: 0, y: 0.25, largeur: 1, hauteur: 0.5 } }), infos()), '-vf');
    // 1920×1080 tourné = 1080×1920 ; moitié de hauteur = 960, décalage 480.
    expect(vf90).toBe('transpose=1,crop=1080:960:0:480,format=yuv420p');
    expect(val(argumentsFfmpeg('i', 'o', params({ rotation: 270 }), infos()), '-vf')).toBe('transpose=2,format=yuv420p');
    expect(val(argumentsFfmpeg('i', 'o', params({ rotation: 180 }), infos()), '-vf')).toBe('hflip,vflip,format=yuv420p');
  });

  it('⚠️ dimensions PAIRES, et réduction au-delà de 1920', () => {
    const vf = val(argumentsFfmpeg('i', 'o', params({ recadrage: { x: 0.1, y: 0.1, largeur: 0.5003, hauteur: 0.7001 } }), infos({ largeurEffective: 1281, hauteurEffective: 721 })), '-vf');
    const [l, h, x, y] = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(vf)!.slice(1).map(Number);
    for (const n of [l, h, x, y]) expect(n % 2).toBe(0);
    const g = geometrieSortie(params(), { largeurEffective: 3840, hauteurEffective: 2160 });
    expect([g.largeur, g.hauteur]).toEqual([1920, 1080]);
    expect(val(argumentsFfmpeg('i', 'o', params(), infos({ largeurEffective: 3840, hauteurEffective: 2160 })), '-vf')).toBe('scale=1920:1080:flags=lanczos,format=yuv420p');
    // Impaire sans recadrage : ramenée au pair.
    expect(val(argumentsFfmpeg('i', 'o', params(), infos({ largeurEffective: 1281, hauteurEffective: 721 })), '-vf')).toBe('scale=1280:720:flags=lanczos,format=yuv420p');
  });

  it('débit plafonné pour tenir sous 32 Mo', () => {
    for (const d of [15, 120, 600]) {
      const octets = ((debitVideoMaxBps(d) + 128_000) * d) / 8;
      expect(octets).toBeLessThan(TAILLE_MAX_OCTETS);
    }
    const a = argumentsFfmpeg('i', 'o', params({ debutS: 0, finS: 600 }), infos({ dureeS: 600 }));
    expect(Number(val(a, '-maxrate'))).toBe(debitVideoMaxBps(600));
    expect(Number(val(a, '-bufsize'))).toBe(debitVideoMaxBps(600) * 2);
  });
});

describe('Amélioration automatique', () => {
  const dansLesBornes = (a: ReturnType<typeof ameliorationAutomatique>) => {
    expect(a.luminosite).toBeGreaterThanOrEqual(-0.08); expect(a.luminosite).toBeLessThanOrEqual(0.08);
    expect(a.contraste).toBeGreaterThanOrEqual(0.9); expect(a.contraste).toBeLessThanOrEqual(1.15);
    expect(a.saturation).toBeGreaterThanOrEqual(0.9); expect(a.saturation).toBeLessThanOrEqual(1.15);
    expect(a.nettete).toBeGreaterThanOrEqual(0); expect(a.nettete).toBeLessThanOrEqual(0.6);
  };

  it('⚠️ image déjà correcte : quasi neutre', () => {
    const a = ameliorationAutomatique({ luminanceMoyenne: 128, ecartType: 55 });
    expect(a).toMatchObject({ active: true, luminosite: 0, contraste: 1, saturation: 1, nettete: 0, debruitage: false });
  });

  it('sombre → éclaircie, débruitée ; terne → contraste relevé ; très claire → assombrie', () => {
    const sombre = ameliorationAutomatique({ luminanceMoyenne: 40, ecartType: 50 });
    expect(sombre.luminosite).toBeGreaterThan(0);
    expect(sombre.debruitage).toBe(true);
    const terne = ameliorationAutomatique({ luminanceMoyenne: 128, ecartType: 10 });
    expect(terne.contraste).toBeGreaterThan(1);
    const claire = ameliorationAutomatique({ luminanceMoyenne: 230, ecartType: 50 });
    expect(claire.luminosite).toBeLessThan(0);
    for (const a of [sombre, terne, claire]) dansLesBornes(a);
  });

  it('⚠️ toujours dans les bornes, même sur des extrêmes ou des valeurs absurdes', () => {
    for (const lum of [-50, 0, 10, 255, 9999, NaN]) for (const e of [-1, 0, 128, 500, NaN]) {
      dansLesBornes(ameliorationAutomatique({ luminanceMoyenne: lum, ecartType: e }));
    }
  });

  it('statistiques d’une image RGBA', () => {
    const noir = new Uint8ClampedArray(4 * 16).fill(0);
    expect(statistiquesImage(noir)).toEqual({ luminanceMoyenne: 0, ecartType: 0 });
    const moitie = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const s = statistiquesImage(moitie);
    expect(s.luminanceMoyenne).toBeCloseTo(127.5, 0);
    expect(s.ecartType).toBeCloseTo(127.5, 0);
    expect(statistiquesImage([])).toEqual({ luminanceMoyenne: 128, ecartType: 50 });
  });

  it('aperçu CSS : neutre si inactif, sinon brightness/contrast/saturate', () => {
    expect(filtreCssApercu(AMELIORATION_NEUTRE)).toBe('none');
    expect(filtreCssApercu({ ...AMELIORATION_NEUTRE, active: true, luminosite: 0.05, contraste: 1.1, saturation: 1.04 }))
      .toBe('brightness(1.1) contrast(1.1) saturate(1.04)');
  });
});

describe('Cadre de l’éditeur → recadrage', () => {
  const dims = { largeur: 1920, hauteur: 1080 };
  it('original sans zoom : aucun recadrage', () => {
    expect(recadrageDepuisReglages(dims, { rotation: 0, ratio: 'original', zoom: 1, centre: { x: 0.5, y: 0.5 } })).toBeNull();
  });
  it('9:16 dans une image 16:9 : pleine hauteur, centré', () => {
    const r = recadrageDepuisReglages(dims, { rotation: 0, ratio: '9:16', zoom: 1, centre: { x: 0.5, y: 0.5 } })!;
    expect(r.hauteur).toBe(1);
    expect(r.largeur * 1920).toBeCloseTo(607.5, 0);
    expect(r.x).toBeCloseTo((1 - r.largeur) / 2, 3);
  });
  it('⚠️ zoom borné : le grand côté du cadre reste ≥ 640 px ; centre poussé hors de l’image → ramené au bord', () => {
    const zmin = zoomMinimal(dims, 0, 'original');
    expect(zmin).toBeCloseTo(640 / 1920, 3);
    const r = recadrageDepuisReglages(dims, { rotation: 0, ratio: 'original', zoom: 0.01, centre: { x: 2, y: -1 } })!;
    expect(r.largeur * 1920).toBeGreaterThanOrEqual(639.9);
    expect(r.x + r.largeur).toBeCloseTo(1, 3);
    expect(r.y).toBe(0);
  });
  it('libellé de cadrage', () => {
    expect([libelleCadrage(1080, 1920), libelleCadrage(1920, 1080), libelleCadrage(1080, 1080), libelleCadrage(0, 0)]).toEqual(['Portrait', 'Paysage', 'Carré', '—']);
  });
});
