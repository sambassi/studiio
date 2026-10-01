/**
 * SMART MONTAGE V2 — moteur partagé Créer + Autopilote.
 * 3 rushes : unicité des plages sources, pas de plans quasi identiques,
 * part maximale par rush, pertinence selon le thème, exclusion entre vidéos
 * d'un cycle, raison lisible, et son RÉEL du fichier final (ffmpeg).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  planMontage, plagesDuPlan, profilDuContexte, cleSource, dureePlan,
  type AnalyseRush, type EchantillonRush,
} from '@/lib/creer/smart-montage';
import { lireVolumedetect, mesurerAudioFichier } from '@/lib/render/audio-fichier';
import { avertissementsMontage } from '@/lib/autopilot/produire';

/** Rush synthétique : une empreinte distincte par tranche de 5 s (scènes différentes). */
function rush(url: string, duree: number, profil: (t: number) => Partial<EchantillonRush>): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 0.5) {
    const scene = Math.floor(t / 5) + [...url].reduce((n, c) => n + c.charCodeAt(0), 0);
    echantillons.push({
      t, mouvement: 0.1, luminosite: 0.5, nettete: 0.1, audio: 0.3,
      empreinte: Array.from({ length: 64 }, (_, i) => ((scene * 37 + i * 11) % 100) / 100),
      ...profil(t),
    });
  }
  return { url, duree, echantillons };
}

const plages = (plan: ReturnType<typeof planMontage>) =>
  (plan ?? []).map((s) => ({ cle: cleSource(s.url), a: s.depuis ?? 0, b: s.jusqua ?? (s.depuis ?? 0) + s.fin - s.debut }));

describe('3 rushes : un vrai montage, sans doublon', () => {
  const A = rush('/storage/v1/object/public/media/u/library/a.mp4', 40, (t) => ({ mouvement: 0.1 + (t % 6) / 30 }));
  const B = rush('/storage/v1/object/public/media/u/library/b.mp4', 30, (t) => ({ mouvement: 0.12 + (t % 4) / 25 }));
  const C = rush('/storage/v1/object/public/media/u/library/c.mp4', 8, () => ({ mouvement: 0.3 }));
  const plan = planMontage([A, B, C], 30)!;

  it('plusieurs rushes, plusieurs cuts, durée cible respectée', () => {
    expect(new Set(plan.map((s) => s.url)).size).toBe(3);
    expect(plan.length).toBeGreaterThanOrEqual(6);
    expect(dureePlan(plan)).toBeLessThanOrEqual(30 + 1e-6);
    expect(dureePlan(plan)).toBeGreaterThanOrEqual(26);
  });

  it('aucune plage source utilisée deux fois, marge respectée', () => {
    const p = plages(plan);
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        if (p[i].cle !== p[j].cle) continue;
        const ecart = Math.max(p[j].a - p[i].b, p[i].a - p[j].b);
        expect(ecart).toBeGreaterThanOrEqual(1 - 1e-6);
      }
    }
  });

  it('aucun rush ne domine quand les autres ont de la matière', () => {
    const parRush = new Map<string, number>();
    plan.forEach((s) => parRush.set(s.url, (parRush.get(s.url) ?? 0) + s.fin - s.debut));
    for (const d of parRush.values()) expect(d).toBeLessThanOrEqual(30 * 0.5 + 4);
  });

  it('chaque extrait dit pourquoi il a été retenu', () => {
    plan.forEach((s) => {
      expect(typeof s.qualite).toBe('number');
      expect(s.raison).toMatch(/qualité/);
    });
  });

  it('le même fichier sous deux URL (relative / absolue) n est monté qu une fois', () => {
    const Abs = { ...A, url: `https://staging.studiio.pro${A.url}` };
    const p = planMontage([A, Abs, B], 20)!;
    expect(new Set(p.map((s) => cleSource(s.url))).size).toBe(2);
  });

  it('deux plans visuellement quasi identiques ne sont jamais tous deux montés', () => {
    const meme = Array.from({ length: 64 }, () => 0.4);
    const X = rush('x.mp4', 30, () => ({ empreinte: meme }));
    const Y = rush('y.mp4', 30, (t) => ({ mouvement: 0.2 + (t % 3) / 20 }));
    const p = planMontage([X, Y], 20)!;
    expect(p.filter((s) => s.url === 'x.mp4').length).toBe(1);
  });
});

describe('pertinence : le thème décide QUEL plan, pas seulement la qualité', () => {
  // Rush 1 : très net mais statique. Rush 2 : moins net, mais on y danse.
  const statiqueNet = rush('statique.mp4', 30, () => ({ mouvement: 0.02, nettete: 0.3, audio: 0.05 }));
  const danse = rush('danse.mp4', 30, (t) => ({ mouvement: 0.25 + (t % 2) / 20, nettete: 0.12, audio: 0.8 }));

  it('le profil est déduit des mots du thème, sinon null', () => {
    expect(profilDuContexte({ theme: 'Danser active plus de muscles que la plupart des sports' })?.nom).toBe('activite');
    expect(profilDuContexte({ theme: 'Interview : conseils de nutrition' })?.nom).toBe('parole');
    expect(profilDuContexte({ theme: 'xyz' })).toBeNull();
  });

  it('thème « danse » : les plans actifs sont préférés au plan net statique', () => {
    const p = planMontage([statiqueNet, danse], 12, { contexte: { theme: 'Danser active plus de muscles que la plupart des sports' } })!;
    const dureeDanse = p.filter((s) => s.url === 'danse.mp4').reduce((t, s) => t + s.fin - s.debut, 0);
    // L'accroche est 100 % active ; au total ≥ 45 % (l'anti-répétition
    // partagée laisse respirer la vidéo plutôt que de revenir sur la même scène).
    expect(p.filter((s) => s.phase === 'HOOK').every((s) => s.url === 'danse.mp4')).toBe(true);
    expect(dureeDanse).toBeGreaterThanOrEqual(dureePlan(p) * 0.45);
    expect(p.find((s) => s.url === 'danse.mp4')!.raison).toMatch(/profil « activite »/);
    expect(p[0].pertinence).not.toBeNull();
  });

  it('sans thème exploitable : pertinence null, et la raison le dit', () => {
    const p = planMontage([statiqueNet, danse], 12)!;
    expect(p.every((s) => s.pertinence === undefined || s.pertinence === null)).toBe(true);
    expect(p[0].raison).toMatch(/aucune information thématique/);
  });

  it('une description de plan (vision / transcription) prime quand elle existe', () => {
    const decrit = { ...statiqueNet, descriptions: [{ debut: 10, fin: 20, texte: 'groupe en train de danser' }] };
    const p = planMontage([decrit, danse], 12, { contexte: { theme: 'danser en groupe' } })!;
    const s = p.find((x) => x.url === 'statique.mp4' && (x.depuis ?? 0) >= 9.5);
    expect(s?.raison).toMatch(/description du plan/);
  });
});

describe('cycle Autopilote : extraits différents d une vidéo à l autre', () => {
  it('les plages de la vidéo 1 sont évitées par la vidéo 2', () => {
    const A = rush('a.mp4', 60, (t) => ({ mouvement: 0.1 + (t % 5) / 30 }));
    const B = rush('b.mp4', 60, (t) => ({ mouvement: 0.1 + (t % 7) / 40 }));
    const cycle = {};
    const v1 = planMontage([A, B], 16)!;
    plagesDuPlan(v1, cycle);
    const v2 = planMontage([A, B], 16, { plagesExclues: cycle })!;
    const cles = (p: typeof v1) => new Set(p.map((s) => `${s.url}@${s.depuis}`));
    const communs = [...cles(v2)].filter((k) => cles(v1).has(k));
    expect(communs.length).toBe(0);
  });
});

describe('son RÉEL du fichier final', () => {
  it('lit volumedetect : piste muette = silencieux', () => {
    const muet = 'Stream #0:1[0x2](und): Audio: aac (LC)\n[Parsed_volumedetect_0] mean_volume: -91.0 dB\n[Parsed_volumedetect_0] max_volume: -91.0 dB';
    expect(lireVolumedetect(muet)).toEqual({ piste: true, moyenDb: -91, maxDb: -91, silencieux: true });
    expect(lireVolumedetect('Stream #0:0: Video: h264').silencieux).toBe(true);
    const son = 'Stream #0:1: Audio: aac\nmean_volume: -20.5 dB\nmax_volume: -3.1 dB';
    expect(lireVolumedetect(son).silencieux).toBe(false);
  });

  let ffmpegOk = true;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpegOk = false; }

  it.skipIf(!ffmpegOk)('ffmpeg réel : un MP4 muet est détecté, un MP4 avec son ne l est pas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studiio-audio-'));
    const muet = join(dir, 'muet.mp4');
    const son = join(dir, 'son.mp4');
    const base = ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=2'];
    execFileSync('ffmpeg', [...base, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', muet]);
    execFileSync('ffmpeg', [...base, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', son]);
    const m = await mesurerAudioFichier(muet);
    const s = await mesurerAudioFichier(son);
    expect(m?.piste).toBe(true);
    expect(m?.silencieux).toBe(true);
    expect(s?.piste).toBe(true);
    expect(s?.silencieux).toBe(false);
  }, 60_000);

  it('les avertissements disent à l utilisateur ce qui manque', () => {
    const a = avertissementsMontage({ musiqueIntrouvable: true, audioSilencieux: true, voixRepliEdge: false, montageSimple: false });
    expect(a.join(' ')).toMatch(/Musique introuvable/);
    expect(a.join(' ')).toMatch(/aucun son audible/);
  });
});
