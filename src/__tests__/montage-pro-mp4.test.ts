import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  listeMontageJumeau, mediasExclusDuPlan, messageMediasExclus, planDetaille, planRenduDepuis,
  poserVideoAvatar, ID_CRENEAU_JUMEAU_AUTO, type MediaVideo,
} from '@/lib/creer/medias-video';
import { calageProportionnel, etatApres } from '@/lib/creer/synchro-cartes';
import { echelleZoomCartes, rectZoomeCentre, ZOOM_CARTES_FIN } from '@/lib/creer/ken-burns';
import {
  cleMp4DuRendu, idRenduDeCle, estContenuMp4, decisionStockageMp4,
  patchPostAvecMp4, patchPostEchecMp4,
} from '@/lib/rendus/mp4-durable';
import { renduAttendUnMp4 } from '@/lib/rendus/mp4-durable-client';
import { decisionExportBureau } from '@/lib/rendus/export-bureau';

const rush = (i: number, extra: Partial<MediaVideo> = {}): MediaVideo => ({
  id: `r${i}`, source: 'rush', type: 'video', url: `https://s.test/u1/rush/${i}.mp4`, duree: 4, ...extra,
});

describe('Jumeau : la vidéo de l’avatar prend SA place, les autres médias restent', () => {
  it('rushes ordinaires + jumeau : créneau en tête, tous les rushes gardés dans l’ordre', () => {
    const liste = listeMontageJumeau(null, [rush(1), rush(2), rush(3)], true)!;
    expect(liste.map((m) => m.id)).toEqual([ID_CRENEAU_JUMEAU_AUTO, 'r1', 'r2', 'r3']);
    expect(liste[0]).toMatchObject({ source: 'avatar', type: 'video' });
    expect(liste[0].url).toBeUndefined();
  });

  it('un ancien « Mon jumeau » posé en rush est remplacé à SA place', () => {
    const ancien = rush(2, { meta: { jumeau: true } });
    const liste = listeMontageJumeau(null, [rush(1), ancien, rush(3)], true)!;
    expect(liste.map((m) => m.id)).toEqual(['r1', ID_CRENEAU_JUMEAU_AUTO, 'r3']);
  });

  it('liste enrichie (avatar placé par l’utilisateur) : rendue telle quelle', () => {
    const enrichie: MediaVideo[] = [rush(1), { id: 'a', source: 'avatar', type: 'video' }, rush(2)];
    expect(listeMontageJumeau(enrichie, [rush(9)], true)!.map((m) => m.id)).toEqual(['r1', 'a', 'r2']);
  });

  it('jumeau non demandé, ou aucun rush : null (parcours d’avant, rien ne peut disparaître)', () => {
    expect(listeMontageJumeau(null, [rush(1)], false)).toBeNull();
    expect(listeMontageJumeau(null, [], true)).toBeNull();
  });

  it('après production : le plan rendu contient l’avatar ET chaque rush, dans l’ordre', () => {
    const liste = poserVideoAvatar(listeMontageJumeau(null, [rush(1), rush(2)], true)!, 'https://s.test/u1/avatar/g.mp4', 20);
    const res = planRenduDepuis(planDetaille(liste, { dureeParole: 20, source: 'reelle' }));
    expect(res.depassement).toBe(0);
    expect(res.ignores).toBe(0);
    expect(res.plan.map((s) => s.url)).toEqual([
      'https://s.test/u1/avatar/g.mp4', 'https://s.test/u1/rush/1.mp4', 'https://s.test/u1/rush/2.mp4',
    ]);
    expect(res.plan[0]).toMatchObject({ kind: 'avatar', depuis: res.plan[0].debut });
    expect(res.duree).toBe(20);
  });
});

describe('Médias exclus : nommés, avec la raison, avant toute génération', () => {
  it('rien d’exclu quand tout tient dans la narration', () => {
    const liste = listeMontageJumeau(null, [rush(1), rush(2)], true)!;
    const plan = planDetaille(liste, { dureeParole: 20, source: 'estimee' });
    expect(mediasExclusDuPlan(plan)).toEqual([]);
    expect(messageMediasExclus(plan)).toBeNull();
  });

  it('narration trop courte : les médias qui débordent sont listés dans l’ordre', () => {
    const liste = listeMontageJumeau(null, [rush(1), rush(2), rush(3)], true)!;
    // 10 s de parole, 1,5 s minimum d'avatar → 8,5 s pour 12 s de rushes.
    const plan = planDetaille(liste, { dureeParole: 10, source: 'estimee' });
    const exclus = mediasExclusDuPlan(plan);
    expect(exclus.map((e) => e.id)).toEqual(['r3']);
    expect(exclus[0].raison).toContain('narration estimée');
    expect(exclus[0].raison).toContain('10 s');
    const msg = messageMediasExclus(plan)!;
    expect(msg).toContain(exclus[0].libelle);
    expect(msg).toContain('rien n’a été généré ni débité');
  });

  it('sans avatar : jamais d’exclusion', () => {
    expect(mediasExclusDuPlan(planDetaille([rush(1), rush(2)]))).toEqual([]);
  });
});

describe('Cartes : apparition estimée quand aucun calage exact n’existe', () => {
  const CARTES = [
    { title: 'Eau', description: 'Boire deux litres', value: '2 L' },
    { title: 'Sommeil', description: 'Dormir huit heures chaque nuit sans écran', value: '8 h' },
    { title: 'Marche', description: 'Dix mille pas', value: '10k' },
  ];

  it('chaque carte apparaît à son tour, au prorata du texte, sur la durée de la séquence', () => {
    const calage = calageProportionnel(CARTES, 30)!;
    expect(calage.source).toBe('estimation');
    const cartes = calage.etapes.filter((e) => e.element === 'carte');
    expect(cartes.map((e) => e.carte)).toEqual([0, 1, 2]);
    expect(cartes[0].debut).toBe(0);
    // Croissant, et dans la séquence.
    for (let i = 1; i < cartes.length; i++) expect(cartes[i].debut).toBeGreaterThan(cartes[i - 1].debut);
    expect(cartes[2].debut).toBeLessThan(30);
    // Proportionnel : la carte 1 (texte long) occupe plus de temps que la carte 0.
    expect(cartes[2].debut - cartes[1].debut).toBeGreaterThan(cartes[1].debut - cartes[0].debut);
    // Au départ seule la première carte est visible ; à la fin, toutes.
    expect([...etatApres(calage, 1).cartes]).toEqual([0]);
    expect(etatApres(calage, calage.etapes.length).cartes.size).toBe(3);
  });

  it('pas de révélation sous deux cartes, ni sans durée', () => {
    expect(calageProportionnel(CARTES.slice(0, 1), 10)).toBeNull();
    expect(calageProportionnel(CARTES, 0)).toBeNull();
  });

  it('zoom lent 1,00 → 1,06, centré, sans déformation', () => {
    expect(echelleZoomCartes(0)).toBe(1);
    expect(echelleZoomCartes(1)).toBe(ZOOM_CARTES_FIN);
    expect(echelleZoomCartes(2)).toBe(ZOOM_CARTES_FIN);
    const r = { x: 100, y: 200, w: 800, h: 400 };
    const z = rectZoomeCentre(r, echelleZoomCartes(0.5));
    expect(z.w / z.h).toBeCloseTo(r.w / r.h, 10);
    expect(z.x + z.w / 2).toBeCloseTo(r.x + r.w / 2, 10);
    expect(z.y + z.h / 2).toBeCloseTo(r.y + r.h / 2, 10);
  });
});

describe('MP4 durable d’un rendu confirmé', () => {
  const UID = 'user-1';
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const CLE = `${UID}/rendus/${ID}.webm`;
  const mp4 = () => {
    const b = new Uint8Array(2048);
    b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70], 0);
    return b;
  };
  const webm = () => {
    const b = new Uint8Array(2048);
    b.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    return b;
  };

  it('la clé MP4 est à côté du WebM, sous le même compte, et seulement pour une clé de rendu', () => {
    expect(cleMp4DuRendu(CLE, UID)).toBe(`${UID}/rendus/${ID}.mp4`);
    expect(idRenduDeCle(CLE, UID)).toBe(ID);
    expect(cleMp4DuRendu(CLE, 'autre')).toBeNull();
    expect(cleMp4DuRendu(`${UID}/rendus/${ID}.mp4`, UID)).toBeNull();
    expect(cleMp4DuRendu(`${UID}/rush/${ID}.webm`, UID)).toBeNull();
    expect(cleMp4DuRendu(`${UID}/rendus/../x/${ID}.webm`, UID)).toBeNull();
  });

  it('jamais un WebM renommé : le contenu doit être un vrai MP4 (boîte ftyp)', () => {
    expect(estContenuMp4(mp4())).toBe(true);
    expect(estContenuMp4(webm())).toBe(false);
    expect(estContenuMp4(new Uint8Array(10))).toBe(false);
    expect(decisionStockageMp4({ cleWebm: CLE, userId: UID, sortie: webm() }))
      .toEqual({ stocker: false, motif: 'sortie_invalide' });
    expect(decisionStockageMp4({ cleWebm: CLE, userId: UID, sortie: mp4() }))
      .toEqual({ stocker: true, cleMp4: `${UID}/rendus/${ID}.mp4` });
  });

  const WEBM_URL = `https://studiio.test/storage/v1/object/public/media/${CLE}`;
  const MP4_URL = `https://studiio.test/storage/v1/object/public/media/${UID}/rendus/${ID}.mp4`;

  it('le post pointe sur le MP4, rendu serveur → l’export Bureau le télécharge tel quel', () => {
    const patch = patchPostAvecMp4(
      { media_url: WEBM_URL, metadata: { renderedVideoUrl: WEBM_URL, cards: [1] } },
      { webmUrl: WEBM_URL, mp4Url: MP4_URL },
    )!;
    expect(patch.media_url).toBe(MP4_URL);
    expect(patch.metadata).toMatchObject({
      renderedVideoUrl: MP4_URL, renderedWebmUrl: WEBM_URL, serverRendered: true, mp4Indisponible: false, cards: [1],
    });
    expect(decisionExportBureau(patch.metadata)).toBe('telecharger');
  });

  it('un post qui ne pointe plus sur ce WebM n’est jamais écrasé', () => {
    const autre = { media_url: 'x', metadata: { renderedVideoUrl: 'https://studiio.test/autre.webm' } };
    expect(patchPostAvecMp4(autre, { webmUrl: WEBM_URL, mp4Url: MP4_URL })).toBeNull();
    expect(patchPostEchecMp4(autre, WEBM_URL, 'conversion')).toBeNull();
  });

  it('échec : le WebM reste la vidéo, et c’est signalé', () => {
    const p = patchPostEchecMp4({ metadata: { renderedVideoUrl: WEBM_URL } }, WEBM_URL, 'conversion')!;
    expect(p.metadata).toMatchObject({ renderedVideoUrl: WEBM_URL, mp4Indisponible: true, mp4Motif: 'conversion' });
    expect(p.metadata.serverRendered).toBeUndefined();
  });

  it('le client ne demande un MP4 que pour un rendu WebM', () => {
    expect(renduAttendUnMp4(WEBM_URL)).toBe(true);
    expect(renduAttendUnMp4(MP4_URL)).toBe(false);
    expect(renduAttendUnMp4(null)).toBe(false);
  });
});

describe('Téléchargement : jamais le WebM brut', () => {
  const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
  const calendrier = readFileSync(resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8');

  it('le lecteur de l’aperçu n’offre pas le menu « Télécharger » natif, un bouton MP4 le remplace', () => {
    expect(wizard).toContain('controlsList="nodownload"');
    expect(wizard).toContain('data-play-telecharger-mp4');
    expect(wizard).toMatch(/telechargerApercuMp4[\s\S]{0,800}downloadBlob\(/);
  });

  it('le Calendrier ne propose plus le WebM brut en repli', () => {
    expect(calendrier).not.toContain('downloadWebmDirect');
    expect(calendrier).not.toContain('Télécharger le fichier WebM brut');
  });
});
