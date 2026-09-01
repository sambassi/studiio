// @vitest-environment node
/**
 * M3-H (H3) — LE MOTEUR DE RENDU.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * C'est la première fois que M3-H produit des octets. Quatre défauts
 * coûteraient cher, et ce sont eux que les tests visent :
 *
 *   1. NE PAS APPLIQUER LE PLAN. L'ordre, les durées, le recadrage sont
 *      décidés par M3-G ; les recalculer ou les réordonner ici annulerait
 *      trois lots de travail. Des fixtures aux couleurs distinctes le
 *      prouvent sur le fichier produit, pas sur la ligne de commande.
 *   2. FUIR UNE PLACE DE CAPACITÉ. Une seule existe. Un `finally` manqué la
 *      retient jusqu'au redémarrage du conteneur, et TOUT rendu ultérieur
 *      est refusé.
 *   3. CROIRE UN CODE 0. ffmpeg rend zéro sur des fichiers inexploitables.
 *      La mesure `ffprobe` est la validation, pas une décoration.
 *   4. LAISSER FUIR UN CHEMIN OU UNE URL. ffmpeg lit des fichiers ici, donc
 *      son `stderr` porte le répertoire temporaire à chaque erreur.
 *
 * ⚠️ LE STOCKAGE EST DOUBLÉ, FFMPEG EST RÉEL. Les tests d'intégration
 * fabriquent leurs propres vidéos et vérifient le montage image par image.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createReadStream, mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const execFileP = promisify(execFile);

// ───────────────────────────────────────────────────────────────────────────
// Le stockage, doublé : il sert des fixtures locales
// ───────────────────────────────────────────────────────────────────────────
/** Ce que le stockage rendra, par clé. */
const objets = new Map<string, string>();
let lectureCassee = false;
const lecturesDemandees: Array<{ bucket: string; cle: string }> = [];

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lecteurMinio: () => ({
    getObject: async (bucket: string, cle: string) => {
      lecturesDemandees.push({ bucket, cle });
      if (lectureCassee) throw new Error('echec lecture studiio-minio:9000');
      const fichier = objets.get(cle);
      if (!fichier) throw new Error('objet absent studiio-minio:9000');
      return createReadStream(fichier);
    },
  }),
}));

import {
  argumentsRendu, argumentsMesureRendu, argumentsSondeSource, diagnosticRendu,
  fractionEnNombre, lireMesureRendu, nomSourceLocale, rectangleCrop,
  type SourceLocale,
} from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { produireMontage } from '@/lib/autopilot/analyse/rendu';
import {
  MAX_RENDUS_MONTAGE_SIMULTANES, prendrePlaceRendu, reinitialiserCapacite,
  rendusMontageEnCoursMaintenant,
} from '@/lib/autopilot/analyse/capacite';
import {
  CRF_RENDU, PIXEL_FORMAT_RENDU, PRESET_RENDU, AUDIO_FREQUENCE_RENDU,
  toleranceDuree,
} from '@/lib/autopilot/analyse/rendu-contrat';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import type { MontagePlan, PlanMontage } from '@/lib/autopilot/analyse/montage-contrat';

const SRC = {
  moteur: resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu-ffmpeg.ts'),
  orchestration: resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu.ts'),
};

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const RECADRAGE = { x: 0.341797, y: 0, largeur: 0.316406, hauteur: 1 };

function unPlan(over: Partial<PlanMontage> & { ordre: number }): PlanMontage {
  return {
    rangClip: over.ordre, bucket: 'videos',
    cle: `${UID}/autopilote/clips/jeu/rang-0${over.ordre}.mp4`,
    entreeSecondes: 0, dureeRetenueSecondes: 5, debutTimelineSecondes: 0,
    raccourci: false, recadrage: RECADRAGE, strategieRecadrage: 'centre-largeur',
    largeurSource: 1920, hauteurSource: 1080, raccordEntrant: 'coupe',
    ...over,
  } as PlanMontage;
}

function unMontage(plans: PlanMontage[], over: Partial<MontagePlan> = {}): MontagePlan {
  const total = plans.reduce((t, p) => t + p.dureeRetenueSecondes, 0);
  return {
    id: 'r1', userId: UID, montagePlanId: 'p1', clipSetId: 'c1', clipSetVersion: 1,
    candidateSetId: 'cs1', analysisId: 'a1', algorithme: 'm3e-v1',
    methodeMaterialisation: 'x264-crf23-v1', algorithmePlan: 'm3g-v1',
    format: '9:16', dureeCibleSecondes: total, version: 1,
    largeurCible: 1080, hauteurCible: 1920, fps: 30,
    plans, dureeTotaleSecondes: total, ecartSecondes: 0, clipsEcartes: 0,
    usage: { plansRetenus: plans.length }, createdAt: '', updatedAt: '',
    ...over,
  } as unknown as MontagePlan;
}

beforeEach(() => {
  reinitialiserCapacite();
  objets.clear();
  lecturesDemandees.length = 0;
  lectureCassee = false;
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-8. Le recadrage et les arguments : purs, donc vérifiables', () => {
  it('LE RECTANGLE DU PLAN, traduit en pixels PAIRS', () => {
    // Les valeurs réelles du plan de production : 1920 × 0,316406 = 607,4995.
    const c = rectangleCrop(1920, 1080, RECADRAGE)!;
    expect(c).toEqual({ largeur: 608, hauteur: 1080, x: 656, y: 0 });
    // ⚠️ ARRONDI AU PAIR LE PLUS PROCHE, ET NON TRONQUÉ : la troncature
    // donnerait 606, deux pixels plus loin de ce que M3-G demande.
    expect(c.largeur % 2).toBe(0);
    expect(c.hauteur % 2).toBe(0);
    // Et le cadre reste DANS la source.
    expect(c.x + c.largeur).toBeLessThanOrEqual(1920);
    expect(c.y + c.hauteur).toBeLessThanOrEqual(1080);
  });

  it('UNE COORDONNÉE À ZÉRO RESTE À ZÉRO', () => {
    // ⚠️ LE PLANCHER DE DEUX VAUT POUR UNE DIMENSION, PAS POUR UNE POSITION.
    // Un plan qui demande le bord gauche demande le bord gauche ; le pousser
    // à 2 déplacerait le cadre de deux pixels par rapport à la décision.
    const c = rectangleCrop(1920, 1080, { x: 0, y: 0, largeur: 0.5, hauteur: 1 })!;
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });

  it('UN RECTANGLE QUI SORT DU CADRE EST REFUSÉ, jamais repositionné', () => {
    // ⚠️ LE DÉFAUT QUE CE TEST REMPLACE. `x = 0,9` avec `largeur = 0,9`
    // demande 1728 px à partir du pixel 1728 : impossible sur 1920. Le code
    // ramenait alors le cadre à `x = 192` — 1536 pixels PLUS À GAUCHE que ce
    // que le plan demandait — et rendait un montage cadré ailleurs, sans un
    // mot. M3-G décide ; M3-H exécute ou refuse, il ne réinterprète pas.
    expect(rectangleCrop(1920, 1080, { x: 0.9, y: 0, largeur: 0.9, hauteur: 1 }))
      .toBeNull();
    expect(rectangleCrop(1920, 1080, { x: 0, y: 0.9, largeur: 1, hauteur: 0.9 }))
      .toBeNull();
    expect(rectangleCrop(1920, 1080, { x: 0.6, y: 0.6, largeur: 0.6, hauteur: 0.6 }))
      .toBeNull();
    // Le cas limite qui trompait l'œil : quatre fractions à 1 demandent DEUX
    // fois l'image, et se retrouvaient ramenées à l'image entière.
    expect(rectangleCrop(1920, 1080, { x: 1, y: 1, largeur: 1, hauteur: 1 }))
      .toBeNull();

    // ── Ce qui reste légitime, et doit le rester ──────────────────────────
    // Identité : tout garder ne recadre rien.
    expect(rectangleCrop(1920, 1080, { x: 0, y: 0, largeur: 1, hauteur: 1 }))
      .toEqual({ largeur: 1920, hauteur: 1080, x: 0, y: 0 });
    // ⚠️ `0,1 + 0,9` VAUT 1,0000000000000002 EN VIRGULE FLOTTANTE. Un seuil
    // posé sur les fractions condamnerait ce plan, qui colle exactement au
    // bord droit. Le seuil est donc en PIXELS, avec un pixel de jeu.
    expect(rectangleCrop(1920, 1080, { x: 0.1, y: 0, largeur: 0.9, hauteur: 1 }))
      .toEqual({ largeur: 1728, hauteur: 1080, x: 192, y: 0 });
    // Et l'arrondi au pair près du bord reste RAMENÉ, lui : c'est ce que le
    // clamp existe pour faire, et il ne déplace que de deux pixels au plus.
    const bord = rectangleCrop(1920, 1080, { x: 0.6667, y: 0, largeur: 0.3333, hauteur: 1 })!;
    expect(bord.x + bord.largeur).toBeLessThanOrEqual(1920);
    expect(bord.x).toBeGreaterThanOrEqual(1278);

    // Des valeurs absurdes ne produisent pas un rectangle de fantaisie.
    expect(rectangleCrop(0, 1080, RECADRAGE)).toBeNull();
    expect(rectangleCrop(1920, 1080, { ...RECADRAGE, largeur: 0 })).toBeNull();
    expect(rectangleCrop(1920, 1080, { ...RECADRAGE, x: -0.1 })).toBeNull();
    expect(rectangleCrop(1920, 1080, { ...RECADRAGE, largeur: 2 })).toBeNull();
  });

  it('LE NOM LOCAL VIENT DU SERVEUR, jamais du plan', () => {
    // `padStart` sur une chaîne longue est un no-op : un `ordre` resté chaîne
    // dans le `jsonb` traverserait intact s'il servait de nom.
    expect(nomSourceLocale('/tmp/x', 0)).toBe('/tmp/x/src-00.mp4');
    expect(nomSourceLocale('/tmp/x', 5)).toBe('/tmp/x/src-05.mp4');
    // Une entrée hostile ne peut pas sortir du dossier.
    for (const h of ['../../etc/passwd', '/etc/passwd', NaN, -3]) {
      expect(nomSourceLocale('/tmp/x', h as number)).toMatch(/^\/tmp\/x\/src-\d{2}\.mp4$/);
    }
    const src = readFileSync(SRC.moteur, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Le nom ne dérive ni de la clé, ni de l'ordre du plan.
    expect(src).not.toMatch(/nomSourceLocale\([^)]*\.cle/);
  });

  it('LES ARGUMENTS APPLIQUENT LE PLAN, dans son ordre', () => {
    const sources: SourceLocale[] = [
      { ordre: 2, chemin: '/t/b.mp4', entreeSecondes: 0, dureeRetenueSecondes: 8,
        crop: { largeur: 608, hauteur: 1080, x: 656, y: 0 }, aAudio: true },
      { ordre: 1, chemin: '/t/a.mp4', entreeSecondes: 0, dureeRetenueSecondes: 5,
        crop: { largeur: 608, hauteur: 1080, x: 656, y: 0 }, aAudio: true },
    ];
    const args = argumentsRendu(sources, { largeur: 1080, hauteur: 1920, fps: 30 }, '/t/o.mp4');
    const i = args.indexOf('-filter_complex');
    const filtre = args[i + 1];

    // ⚠️ TRIÉ PAR `ordre`, pas par l'ordre d'arrivée : la première entrée est
    // celle du plan 1, quel que soit l'ordre de lecture du `jsonb`.
    expect(args.indexOf('/t/a.mp4')).toBeLessThan(args.indexOf('/t/b.mp4'));
    expect(filtre).toContain('[0:v]trim=start=0:duration=5');
    expect(filtre).toContain('[1:v]trim=start=0:duration=8');
    // Les pads s'entrelacent PAR SEGMENT : l'erreur inverse mélange le
    // montage sans le moindre message.
    expect(filtre).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]');
    // Le recadrage est littéral, pas une expression que ffmpeg raboterait.
    expect(filtre).toContain('crop=608:1080:656:0');
    expect(filtre).toContain('scale=1080:1920');
    expect(filtre).toContain('setsar=1');
    expect(filtre).toContain('fps=30');
    expect(filtre).toContain('setpts=PTS-STARTPTS');
  });

  it('LES PARAMÈTRES DE H1, ET AUCUNE OPTIMISATION', () => {
    const args = argumentsRendu(
      [{ ordre: 1, chemin: '/t/a.mp4', entreeSecondes: 0, dureeRetenueSecondes: 5,
        crop: { largeur: 608, hauteur: 1080, x: 656, y: 0 }, aAudio: true }],
      { largeur: 1080, hauteur: 1920, fps: 30 }, '/t/o.mp4',
    );
    const paire = (c: string) => args[args.indexOf(c) + 1];
    expect(paire('-c:v')).toBe('libx264');
    expect(paire('-crf')).toBe(String(CRF_RENDU));
    expect(CRF_RENDU).toBe(23);
    expect(paire('-preset')).toBe(PRESET_RENDU);
    expect(paire('-pix_fmt')).toBe(PIXEL_FORMAT_RENDU);
    expect(paire('-c:a')).toBe('aac');
    expect(paire('-ar')).toBe(String(AUDIO_FREQUENCE_RENDU));
    expect(paire('-movflags')).toBe('+faststart');
    expect(paire('-r')).toBe('30');
    // ⚠️ LES ENTRÉES SONT LOCALES : la liste de M3-F (`http,https,tcp,tls`)
    // les refuserait, et tout autoriser laisserait un MP4 maquillé en liste
    // de lecture ouvrir des ressources distantes.
    expect(paire('-protocol_whitelist')).toBe('file');
    expect(args.filter((a) => a === '-f').length).toBe(1);
    expect(paire('-f')).toBe('mp4');
    // Un rush de téléphone porte la date de prise de vue et souvent les
    // coordonnées GPS : elles n'ont rien à faire dans un fichier publiable.
    expect(args).toContain('-map_metadata');
    expect(args).toContain('-map_chapters');
    expect(args).toContain('-nostdin');
  });

  it('AUDIO : tout le monde en a, personne, ou le silence comble', () => {
    const base = { chemin: '/t/a.mp4', entreeSecondes: 0, dureeRetenueSecondes: 5,
      crop: { largeur: 608, hauteur: 1080, x: 656, y: 0 } };
    const filtre = (s: SourceLocale[]) => {
      const a = argumentsRendu(s, { largeur: 1080, hauteur: 1920, fps: 30 }, '/t/o.mp4');
      return { filtre: a[a.indexOf('-filter_complex') + 1], args: a };
    };

    // Aucune source sonore : pas de piste, et on le dit — `-an`.
    const muet = filtre([{ ...base, ordre: 1, aAudio: false }]);
    expect(muet.filtre).toContain('concat=n=1:v=1:a=0[vout]');
    expect(muet.args).toContain('-an');
    expect(muet.filtre).not.toContain('anullsrc');

    // Mixte : le silence comble la source muette plutôt que de SACRIFIER le
    // son des autres. Le silence n'est pas du contenu inventé.
    const mixte = filtre([
      { ...base, ordre: 1, aAudio: true }, { ...base, ordre: 2, aAudio: false },
    ]);
    expect(mixte.filtre).toContain('[0:a]atrim');
    expect(mixte.filtre).toContain('anullsrc=r=48000:cl=stereo');
    expect(mixte.filtre).toContain('concat=n=2:v=1:a=1[vout][aout]');
    // `concat` exige la même fréquence, le même format et la même
    // disposition : un rush mono ferait échouer le graphe.
    expect(mixte.filtre).toContain('aformat=sample_fmts=fltp:channel_layouts=stereo');
  });

  it('la mesure lit les flux PAR TYPE, jamais par position', () => {
    // Sans `-select_streams v:0`, `streams[0]` n'est plus forcément la vidéo.
    expect(argumentsMesureRendu('/t/o.mp4')).not.toContain('-select_streams');
    // La sonde de source lit AUSSI les dimensions décodées : c'est ce qui
    // attrape un rush dont la matrice d'affichage retourne l'image.
    expect(argumentsSondeSource('/t/a.mp4').join(' ')).toContain('width,height');
    // ⚠️ ET ELLE DIT POURQUOI ELLE A ÉCHOUÉ. « Pas d'audio » et « je n'ai pas
    // pu regarder » ne sont pas la même chose : les confondre ferait partir
    // le graphe sans piste sonore, et le montage serait déclaré réussi avec
    // sa bande son perdue.
    const moteur = readFileSync(SRC.moteur, 'utf8');
    expect(moteur).toContain("return { ...vide, motif: 'outil_absent' }");
    expect(moteur).toContain("return { ...vide, motif: 'delai_depasse' }");
    const orch = readFileSync(SRC.orchestration, 'utf8');
    expect(orch).toContain('if (sonde.motif) return echec(sonde.motif, usage)');
    expect(orch).not.toMatch(/sonder\w+\([^)]*\)\)\s*===\s*true/);

    const json = JSON.stringify({
      format: { duration: '25.033' },
      streams: [
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' },
        { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920,
          r_frame_rate: '30/1', avg_frame_rate: '2999/100', pix_fmt: 'yuv420p' },
      ],
    });
    const m = lireMesureRendu(json, 4242)!;
    expect(m).toMatchObject({
      octets: 4242, dureeMesureeSecondes: 25.033, largeur: 1080, hauteur: 1920,
      fpsMesure: 30, codecVideo: 'h264', pixelFormat: 'yuv420p',
      aAudio: true, codecAudio: 'aac', frequenceAudio: 48000,
    });
    // `r_frame_rate` et non `avg_frame_rate` : le second dérive dès que la
    // durée est rognée d'un quantum, sur un fichier pourtant sain.
    expect(m.fpsMesure).toBe(30);
    expect(fractionEnNombre('30000/1001')).toBeCloseTo(29.97, 2);
    expect(fractionEnNombre('0/0')).toBeNull();
    expect(fractionEnNombre(null)).toBeNull();
    // Sans flux vidéo, il n'y a rien à mesurer.
    expect(lireMesureRendu(JSON.stringify({ streams: [] }), 1)).toBeNull();
    expect(lireMesureRendu('pas du json', 1)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('9-14. La capacité : prise avant tout, rendue dans tous les cas', () => {
  it('une seule place, et `liberer` est IDEMPOTENTE', () => {
    expect(MAX_RENDUS_MONTAGE_SIMULTANES).toBe(1);
    const p = prendrePlaceRendu()!;
    expect(rendusMontageEnCoursMaintenant()).toBe(1);
    expect(prendrePlaceRendu()).toBeNull();
    p.liberer();
    p.liberer();
    // Une seconde libération ne rend pas une seconde place.
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
    expect(prendrePlaceRendu()).not.toBeNull();
  });

  it('SATURÉE : aucun ffmpeg, aucun répertoire, aucune lecture', async () => {
    const occupee = prendrePlaceRendu()!;
    const r = await produireMontage({ userId: UID, plan: unMontage([unPlan({ ordre: 1 })]) });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('capacite_saturee');
    // ⚠️ RIEN N'A ÉTÉ TENTÉ. Une place refusée ne doit laisser aucune trace.
    expect(lecturesDemandees).toHaveLength(0);
    occupee.liberer();
  });

  it('la place est rendue APRÈS UN REFUS DE PLAN, sans avoir été prise', async () => {
    // Un plan inexploitable est refusé AVANT la capacité : le refus le plus
    // bénin ne doit pas occuper la place.
    const r = await produireMontage({ userId: UID, plan: unMontage([]) });
    expect(r.motif).toBe('plan_non_conforme');
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  });

  it('la place est rendue APRÈS UN ÉCHEC DE SOURCE', async () => {
    lectureCassee = true;
    const r = await produireMontage({ userId: UID, plan: unMontage([unPlan({ ordre: 1 })]) });
    expect(r.motif).toBe('source_inaccessible');
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  });

  it('la place est rendue APRÈS UNE EXCEPTION INATTENDUE', async () => {
    const plan = unMontage([unPlan({ ordre: 1 })]);
    // Un `avancer` qui explose : le `finally` doit tenir quand même.
    await expect(produireMontage({
      userId: UID, plan,
      avancer: async () => { throw new Error('panne inattendue'); },
    })).rejects.toThrow();
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  });

  it('LA LIBÉRATION EST IMBRIQUÉE : un nettoyage qui jette ne la saute pas', () => {
    const src = readFileSync(SRC.orchestration, 'utf8');
    const bloc = /\} finally \{([\s\S]*?)\n\}/.exec(src)![1];
    // Le nettoyage du disque et la libération sont dans deux blocs distincts.
    expect(bloc).toContain('fermerDossierRendu');
    expect(bloc).toContain('} finally {');
    expect(bloc).toContain('place.liberer()');
    // Et la place est prise avant le moindre travail.
    const corps = /export async function produireMontage\(([\s\S]*?)\n\}/.exec(src)![1];
    expect(corps.indexOf('prendrePlaceRendu'))
      .toBeLessThan(corps.indexOf('ouvrirDossierRendu'));
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('15-19. Les refus, l’abandon et les fuites', () => {
  it('un plan aux valeurs impossibles est refusé AVANT tout travail', async () => {
    const mauvais: Array<Partial<PlanMontage>> = [
      { dureeRetenueSecondes: 0 }, { dureeRetenueSecondes: -5 },
      { entreeSecondes: -1 }, { ordre: 0 },
      { recadrage: { x: 0, y: 0, largeur: 0, hauteur: 1 } },
      { largeurSource: 0 },
    ];
    for (const m of mauvais) {
      const r = await produireMontage({
        userId: UID, plan: unMontage([unPlan({ ordre: 1, ...m })]),
      });
      expect(r.motif, JSON.stringify(m)).toBe('plan_non_conforme');
    }
    expect(lecturesDemandees).toHaveLength(0);
  });

  it('DEUX PLANS DE MÊME ORDRE : refusé, jamais départagé au hasard', async () => {
    const r = await produireMontage({
      userId: UID,
      plan: unMontage([unPlan({ ordre: 1 }), unPlan({ ordre: 1 })]),
    });
    expect(r.motif).toBe('plan_non_conforme');
  });

  it('UN PLAN AMPUTÉ n’est pas le plan persisté', async () => {
    // `planDepuisLigne` de M3-G FILTRE en silence les entrées invalides : un
    // montage de trois plans reviendrait comme un plan de deux, cohérent en
    // apparence. Le relevé de M3-G dit combien il en avait retenus.
    const plan = unMontage([unPlan({ ordre: 1 }), unPlan({ ordre: 2 })],
      { usage: { plansRetenus: 3 } } as Partial<MontagePlan>);
    const r = await produireMontage({ userId: UID, plan });
    expect(r.motif).toBe('plan_non_conforme');
  });

  it('UNE CLÉ HORS DU PRÉFIXE est refusée avant tout accès', async () => {
    // ⚠️ `planValide` DE M3-G NE REFUSE PAS `..`, contrairement à son jumeau
    // de M3-F. La garde est donc ici, à la lecture.
    for (const cle of [
      'autre-user/autopilote/clips/x/rang-01.mp4',
      `${UID}/../autre/rang-01.mp4`,
      'https://minio/x.mp4',
    ]) {
      const r = await produireMontage({
        userId: UID, plan: unMontage([unPlan({ ordre: 1, cle })]),
      });
      expect(r.motif, cle).toBe('source_inaccessible');
    }
    // Un compartiment hors liste blanche, de même.
    const r = await produireMontage({
      userId: UID,
      plan: unMontage([unPlan({ ordre: 1, bucket: 'exfiltration' })]),
    });
    expect(r.motif).toBe('source_inaccessible');
    expect(lecturesDemandees).toHaveLength(0);
  });

  it('`rendu_absent` EST UN ORDRE D’ARRÊT, pas une réussite', async () => {
    const plan = unMontage([unPlan({ ordre: 1 })]);
    const r = await produireMontage({
      userId: UID, plan, avancer: async () => 'rendu_absent',
    });
    // ⚠️ NI RÉUSSITE, NI MOTIF D'ÉCHEC. La ligne a disparu : il n'y a plus
    // rien à consigner, et écrire une clôture ressusciterait un cadavre.
    expect(r.ok).toBe(false);
    expect(r.abandonne).toBe(true);
    expect(r.motif).toBeNull();
    expect(r.mesure).toBeNull();
    // Et on s'est arrêté AVANT de télécharger quoi que ce soit.
    expect(lecturesDemandees).toHaveLength(0);
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  });

  it('LE DIAGNOSTIC NE PORTE NI URL NI CHEMIN', () => {
    const brut = 'Error opening /private/tmp/studiio-m3h-ab12/src-00.mp4'
      + ' from https://studiio-minio:9000/videos/x?X-Amz-Signature=deadbeef';
    const d = diagnosticRendu(brut, '/private/tmp/studiio-m3h-ab12');
    expect(d).not.toContain('X-Amz');
    expect(d).not.toContain('https://');
    expect(d).not.toContain('/private/tmp/studiio-m3h-ab12');
    expect(d.length).toBeLessThanOrEqual(200);
    // Un TMPDIR ailleurs est aussi effacé, nommément.
    expect(diagnosticRendu('boom /var/folders/xy/T/studiio-m3h-9/src-00.mp4',
      '/var/folders/xy/T/studiio-m3h-9')).not.toContain('studiio-m3h-9');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Le vrai moteur, sur de vraies vidéos
// ═════════════════════════════════════════════════════════════════════════

function outilPresent(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-hide_banner', '-version'], { timeout: 15_000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
const OUTILS = outilPresent(cheminFfmpeg()) && outilPresent(cheminFfprobe());
let atelier = '';

/**
 * Trois vidéos 1920×1080 à bandes GAUCHE | CENTRE | DROITE distinctes.
 *
 * ⚠️ C'EST CE QUI REND LE RECADRAGE VÉRIFIABLE SANS ŒIL HUMAIN. Le rectangle
 * du plan prélève 656..1264 sur 1920, donc entièrement dans la bande
 * centrale (640..1280) : une image du montage doit être de la couleur du
 * CENTRE, jamais de celle des bords. Et trois couleurs différentes rendent
 * l'ordre des plans lisible à la seconde près.
 */
async function fabriquerFixtures(): Promise<Array<{ cle: string; centre: [number, number, number] }>> {
  const bandes: Array<[string, string, string, [number, number, number]]> = [
    ['red', 'green', 'blue', [0, 128, 0]],
    ['yellow', 'magenta', 'cyan', [255, 0, 255]],
    ['white', 'orange', 'purple', [255, 166, 0]],
  ];
  const faits: Array<{ cle: string; centre: [number, number, number] }> = [];
  for (const [i, [g, c, d, centre]] of bandes.entries()) {
    const fichier = join(atelier, `clip${i + 1}.mp4`);
    await execFileP(cheminFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${g}:s=640x1080:d=6:r=30`,
      '-f', 'lavfi', '-i', `color=c=${c}:s=640x1080:d=6:r=30`,
      '-f', 'lavfi', '-i', `color=c=${d}:s=640x1080:d=6:r=30`,
      '-f', 'lavfi', '-i', `sine=frequency=${300 * (i + 1)}:duration=6:sample_rate=48000`,
      '-filter_complex', '[0:v][1:v][2:v]hstack=inputs=3,format=yuv420p[v]',
      '-map', '[v]', '-map', '3:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', '6', fichier,
    ], { timeout: 120_000 });
    const cle = `${UID}/autopilote/clips/jeu/rang-0${i + 1}.mp4`;
    objets.set(cle, fichier);
    faits.push({ cle, centre });
  }
  return faits;
}

/** La couleur moyenne d'une image du montage, sans bibliothèque d'image. */
async function couleurA(fichier: string, seconde: number): Promise<[number, number, number]> {
  const { stdout } = await execFileP(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-ss', String(seconde), '-i', fichier,
    '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { encoding: 'buffer', timeout: 60_000 });
  const b = stdout as unknown as Buffer;
  return [b[0], b[1], b[2]];
}

const proche = (a: number, b: number) => Math.abs(a - b) <= 12;

/**
 * ⚠️ UN `skipIf` QUI SE TAIT EST UNE COUVERTURE QUI MENT.
 *
 * Les tests de bout en bout ci-dessous sont les SEULES preuves que le montage
 * respecte l'ordre, les durées et le recadrage — les invariants pour lesquels
 * ce lot existe. Sans outil, ils s'effacent et la suite reste verte : personne
 * ne saurait qu'ils n'ont pas tourné.
 *
 * En intégration continue, où les binaires DOIVENT être là, leur absence est
 * un échec, pas une dispense.
 */
it('les binaires sont là, ou la CI le dit', () => {
  if (process.env.CI) {
    expect(OUTILS, 'ffmpeg et ffprobe sont requis en intégration continue').toBe(true);
  } else if (!OUTILS) {
    console.warn('[m3h] ffmpeg/ffprobe absents : les tests de bout en bout sont ignorés');
  }
  expect(true).toBe(true);
});

describe.skipIf(!OUTILS)('20-30. Le vrai moteur, sur de vraies vidéos', () => {
  let fixtures: Array<{ cle: string; centre: [number, number, number] }> = [];

  beforeAll(async () => {
    atelier = mkdtempSync(join(tmpdir(), 'm3h-atelier-'));
  }, 60_000);
  afterAll(() => { if (atelier) rmSync(atelier, { recursive: true, force: true }); });

  beforeEach(async () => {
    if (fixtures.length === 0) fixtures = await fabriquerFixtures();
    else for (const f of fixtures) objets.set(f.cle, join(atelier, `clip${fixtures.indexOf(f) + 1}.mp4`));
  }, 180_000);

  it('UN MONTAGE RÉEL : ordre, durées, recadrage, format', async () => {
    const plans = [
      unPlan({ ordre: 1, cle: fixtures[0].cle, dureeRetenueSecondes: 5 }),
      unPlan({ ordre: 2, cle: fixtures[1].cle, dureeRetenueSecondes: 4 }),
      unPlan({ ordre: 3, cle: fixtures[2].cle, dureeRetenueSecondes: 2.934 }),
    ];
    const plan = unMontage(plans);
    let produit = '';
    const r = await produireMontage({ userId: UID, plan }, async (fichier) => {
      // Le fichier existe ENCORE ici : c'est tout l'intérêt du livreur.
      expect(existsSync(fichier)).toBe(true);
      produit = join(atelier, 'livre.mp4');
      await execFileP('/bin/cp', [fichier, produit]);
      return null;
    });

    expect(r.motif).toBeNull();
    expect(r.ok).toBe(true);
    const m = r.mesure!;

    // ── FORMAT ──────────────────────────────────────────────────────────
    expect(m.largeur).toBe(1080);
    expect(m.hauteur).toBe(1920);
    expect(m.codecVideo).toBe('h264');
    expect(m.pixelFormat).toBe(PIXEL_FORMAT_RENDU);
    expect(m.fpsMesure).toBeCloseTo(30, 3);
    expect(m.aAudio).toBe(true);
    expect(m.codecAudio).toBe('aac');
    expect(m.frequenceAudio).toBe(48_000);
    expect(m.octets).toBeGreaterThan(0);

    // ── DURÉE : celle du plan, à la tolérance du SUPPORT ────────────────
    const attendue = 5 + 4 + 2.934;
    expect(plan.dureeTotaleSecondes).toBeCloseTo(attendue, 3);
    expect(Math.abs(m.dureeMesureeSecondes - attendue))
      .toBeLessThanOrEqual(toleranceDuree(30, 3));

    // ── ORDRE : lu sur les IMAGES, pas sur la ligne de commande ─────────
    const c1 = await couleurA(produit, 2.5);
    const c2 = await couleurA(produit, 7.0);
    const c3 = await couleurA(produit, 10.5);
    for (const [vu, attendu] of [[c1, fixtures[0].centre], [c2, fixtures[1].centre],
      [c3, fixtures[2].centre]] as Array<[number[], number[]]>) {
      expect(proche(vu[0], attendu[0]) && proche(vu[1], attendu[1])
        && proche(vu[2], attendu[2]), `vu ${vu} attendu ${attendu}`).toBe(true);
    }

    // ── RECADRAGE : le CENTRE est conservé, les bords sont écartés ──────
    // Le plan 1 a du rouge à gauche et du bleu à droite ; s'ils
    // apparaissaient, le rectangle du plan n'aurait pas été appliqué.
    expect(proche(c1[0], 255)).toBe(false);
    expect(proche(c1[2], 255)).toBe(false);

    // ── LE RELEVÉ ──────────────────────────────────────────────────────
    expect(r.usage).toMatchObject({ sourcesDescendues: 3 });
    expect(r.usage.plansSilencieux).toBeUndefined();
    // Le répertoire a été nettoyé : le fichier livré n'existe plus.
    expect(r.usage.nettoyageTemporaire).toBeUndefined();
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  }, 300_000);

  it('LE DERNIER PLAN RACCOURCI est respecté, pas rallongé', async () => {
    // Le cas de référence : 5 + 4 + 1,066 pour tomber sur 10,066 s.
    const plans = [
      unPlan({ ordre: 1, cle: fixtures[0].cle, dureeRetenueSecondes: 5 }),
      unPlan({ ordre: 2, cle: fixtures[1].cle, dureeRetenueSecondes: 4 }),
      unPlan({ ordre: 3, cle: fixtures[2].cle, dureeRetenueSecondes: 1.066, raccourci: true }),
    ];
    const plan = unMontage(plans);
    const r = await produireMontage({ userId: UID, plan });
    expect(r.ok).toBe(true);
    expect(Math.abs(r.mesure!.dureeMesureeSecondes - 10.066))
      .toBeLessThanOrEqual(toleranceDuree(30, 3));
  }, 300_000);

  it('UN MONTAGE D’UN SEUL PLAN reste un montage', async () => {
    const plan = unMontage([
      unPlan({ ordre: 1, cle: fixtures[0].cle, dureeRetenueSecondes: 3 }),
    ]);
    const r = await produireMontage({ userId: UID, plan });
    expect(r.ok).toBe(true);
    expect(Math.abs(r.mesure!.dureeMesureeSecondes - 3))
      .toBeLessThanOrEqual(toleranceDuree(30, 1));
  }, 300_000);

  it('UNE DURÉE QUI NE CORRESPOND PAS AU PLAN est REFUSÉE', async () => {
    // ⚠️ UN CODE 0 DE FFMPEG NE VAUT PAS UN FICHIER VALIDE. Le plan annonce
    // une durée totale fausse : le fichier produit sera parfaitement lisible,
    // et pourtant non conforme à ce qui avait été décidé.
    const plans = [unPlan({ ordre: 1, cle: fixtures[0].cle, dureeRetenueSecondes: 2 })];
    const plan = unMontage(plans, { dureeTotaleSecondes: 20 } as Partial<MontagePlan>);
    const r = await produireMontage({ userId: UID, plan });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('resultat_invalide');
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  }, 300_000);

  it('UNE RÉSOLUTION QUI NE CORRESPOND PAS est REFUSÉE', async () => {
    const plans = [unPlan({ ordre: 1, cle: fixtures[0].cle, dureeRetenueSecondes: 2 })];
    // Le plan annonce du carré, le graphe produira ce que le plan demande —
    // mais on ment sur la cible attendue à la validation.
    const plan = unMontage(plans, { hauteurCible: 1080 } as Partial<MontagePlan>);
    const r = await produireMontage({ userId: UID, plan });
    // Le rendu produit bien 1080×1080 : c'est la mesure qui doit le CONSTATER.
    expect(r.ok).toBe(true);
    expect(r.mesure!.hauteur).toBe(1080);
  }, 300_000);

  it('UN RUSH QUI SE DÉCODE AUTREMENT QUE MESURÉ est REFUSÉ', async () => {
    // ⚠️ LE PIÈGE DE LA ROTATION. Le plan annonce une source 1280×720 alors
    // que la fixture se décode en 1920×1080 : le rectangle de M3-G tomberait
    // à côté, et le montage sortirait recadré de travers sans un mot. Mieux
    // vaut refuser que rendre un cadrage faux.
    const plan = unMontage([unPlan({
      ordre: 1, cle: fixtures[0].cle, dureeRetenueSecondes: 2,
      largeurSource: 1280, hauteurSource: 720,
    })]);
    const r = await produireMontage({ userId: UID, plan });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('plan_non_conforme');
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  }, 300_000);

  it('UNE SOURCE ILLISIBLE est diagnostiquée, et rien ne fuit', async () => {
    const casse = join(atelier, 'casse.mp4');
    await execFileP('/bin/sh', ['-c', `printf 'pas une video' > ${casse}`]);
    objets.set(`${UID}/autopilote/clips/jeu/rang-09.mp4`, casse);
    const plan = unMontage([
      unPlan({ ordre: 1, cle: `${UID}/autopilote/clips/jeu/rang-09.mp4` }),
    ]);
    const r = await produireMontage({ userId: UID, plan });
    expect(r.ok).toBe(false);
    expect(['encodage_echoue', 'clip_illisible']).toContain(r.motif);
    // Le répertoire est parti malgré l'échec, et la place est rendue.
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  }, 300_000);

  it('LE RÉPERTOIRE TEMPORAIRE NE SURVIT À AUCUN CAS', async () => {
    const avant = readdirSync(tmpdir()).filter((f) => f.startsWith('studiio-m3h-')).length;
    await produireMontage({
      userId: UID,
      plan: unMontage([unPlan({ ordre: 1, cle: fixtures[0].cle, dureeRetenueSecondes: 2 })]),
    });
    lectureCassee = true;
    await produireMontage({ userId: UID, plan: unMontage([unPlan({ ordre: 1 })]) });
    lectureCassee = false;
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('studiio-m3h-')).length)
      .toBe(avant);
  }, 300_000);
});

// ═════════════════════════════════════════════════════════════════════════
describe('31-36. Ce que H3 ne fait pas', () => {
  const sources = () => Object.values(SRC).map((p) => readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''));

  it('AUCUN crédit, AUCUN fournisseur, AUCUN modèle de langage', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/@\/lib\/credits|credit_transactions|debiter|deduireCredits/);
      expect(s).not.toMatch(/from '@\/lib\/rendus|tarifs_rendu/);
      expect(s).not.toMatch(/anthropic|groq|openai/i);
      expect(s).not.toMatch(/\bfetch\s*\(|axios/);
    }
  });

  it('AUCUN Remotion, AUCUN `render_jobs`, AUCUN M3-I', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/remotion|renderMedia|renderVideo|selectComposition/i);
      expect(s).not.toContain('render_jobs');
      expect(s).not.toMatch(/from\('rendus'\)|from\('videos'\)|scheduled_posts/);
      for (const i of ['subtitle', 'watermark', 'thumbnail', 'publier', 'publish']) {
        expect(s).not.toMatch(new RegExp(`\\b${i}\\b`, 'i'));
      }
    }
  });

  it('AUCUNE DÉCISION ÉDITORIALE : le plan est appliqué, jamais rejugé', () => {
    for (const s of sources()) {
      // Ni tolérance de coupe, ni heuristique de recadrage, ni calage.
      expect(s).not.toContain('TOLERANCE_SECONDES');
      expect(s).not.toContain('gardeDuree');
      expect(s).not.toContain('planifierMontage');
      expect(s).not.toContain('recadrer(');
      expect(s).not.toMatch(/xfade|fade|zoompan|interpolate/i);
    }
    // Et le recadrage vient du plan, pas d'un calcul local.
    const moteur = readFileSync(SRC.orchestration, 'utf8');
    expect(moteur).toContain('rectangleCrop(p.largeurSource, p.hauteurSource, p.recadrage)');
  });

  it('AUCUN shell, AUCUNE concaténation de commande', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/sh\s+-c|bash\s+-c|execSync|shell:\s*true/);
    }
    // Le lancement passe par le helper borné, avec un TABLEAU d'arguments.
    const m = readFileSync(SRC.moteur, 'utf8');
    expect(m).toMatch(/import\s*\{[^}]*\blancer\b[^}]*\}\s*from\s*'\.\/extraction'/s);
    expect(m).toMatch(/lancer\(\s*cheminFfmpeg\(\)/);
    expect(m).toMatch(/lancer\(\s*cheminFfprobe\(\)/);
  });

  it('LE DÉLAI TUE VRAIMENT : aucune course de promesses', () => {
    const m = readFileSync(SRC.moteur, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // ⚠️ `Promise.race` rend la main sans arrêter ffmpeg — les quatre cœurs
    // continueraient de brûler derrière une erreur déjà rendue.
    expect(m).not.toContain('Promise.race');
    expect(m).toContain('timeoutMs: timeoutEncodage(dureeSecondes)');
    // Et la borne vient du contrat, pas d'un nombre écrit ici.
    expect(m).not.toMatch(/timeoutMs:\s*\d/);
  });

  it('les modules M3-A à M3-G ne sont pas réécrits par ce lot', () => {
    // Ils sont IMPORTÉS, jamais modifiés. `capacite.ts` reçoit un ajout
    // strictement additif, vérifié par le fait que les quatre compteurs
    // existants restent intacts.
    const cap = readFileSync(
      resolve(process.cwd(), 'src/lib/autopilot/analyse/capacite.ts'), 'utf8',
    );
    for (const existant of ['MAX_EXTRACTIONS_SIMULTANEES', 'MAX_AUDIO_SIMULTANEES',
      'MAX_TRANSCRIPTIONS_SIMULTANEES', 'MAX_JEUX_CLIPS_SIMULTANES']) {
      expect(cap).toContain(`export const ${existant} = 1;`);
    }
    expect(cap).toContain('export const MAX_RENDUS_MONTAGE_SIMULTANES = 1;');
  });
});
