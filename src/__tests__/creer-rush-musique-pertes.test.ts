/**
 * Pertes silencieuses constatées sur staging (2026-09-29) :
 *  - un post supprimé emportait la musique/voix de BIBLIOTHÈQUE encore utilisée
 *    par le brouillon Créer → rendu suivant sans musique, sans message ;
 *  - un rush choisi disparaissait du montage quand la séquence « Vidéo » était
 *    masquée ou à 0 s ;
 *  - une musique dont l'envoi (PUT) échouait était quand même posée ;
 *  - fermer la médiathèque ouverte par « Ajouter un rush » laissait l'intention
 *    « ajouter » armée pour le choix suivant.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { estMediaDeBibliotheque } from '@/lib/storage/bibliotheque';
import { mediasIntrouvables } from '@/lib/creer/medias-introuvables';

const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');
const U = '4a2f958c-65fa-4853-8e10-5f840bbc20ff';

describe('Suppression d un post : la bibliothèque est conservée', () => {
  it('musique, voix et rushes importés sont des médias de bibliothèque', () => {
    expect(estMediaDeBibliotheque(`audio/${U}/music/1-saute.mp3`)).toBe(true);
    expect(estMediaDeBibliotheque(`audio/${U}/voice/2-tts.mp3`)).toBe(true);
    expect(estMediaDeBibliotheque(`media/${U}/library/3-rush.mp4`)).toBe(true);
  });

  it('les produits du post restent supprimables', () => {
    expect(estMediaDeBibliotheque(`media/${U}/rendus/x.webm`)).toBe(false);
    expect(estMediaDeBibliotheque(`media/${U}/thumbnail/v.jpg`)).toBe(false);
    expect(estMediaDeBibliotheque(`media/${U}/image/cartes.png`)).toBe(false);
    expect(estMediaDeBibliotheque(`videos/autopilote-x.mp4`)).toBe(false);
  });

  it('la route DELETE épargne la bibliothèque', () => {
    const r = src('src/app/api/posts/route.ts');
    expect(r).toContain("import { estMediaDeBibliotheque } from '@/lib/storage/bibliotheque'");
    expect(r).toContain('if (k && estMediaDeBibliotheque(k))');
  });
});

describe('Avant le rendu : aucun média manquant en silence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signale les fichiers en 404/410, ignore blob:/data: et les erreurs réseau', async () => {
    const fetchMock = vi.fn(async (u: string) => {
      if (u.includes('absent')) return { status: 404 } as Response;
      if (u.includes('parti')) return { status: 410 } as Response;
      if (u.includes('reseau')) throw new Error('offline');
      return { status: 200 } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await mediasIntrouvables([
      '/storage/v1/object/public/audio/u/music/absent.mp3',
      '/storage/v1/object/public/audio/u/voice/parti.mp3',
      '/storage/v1/object/public/media/u/library/ok.mp4',
      '/storage/v1/object/public/media/u/library/reseau.mp4',
      'blob:https://x/1', 'data:audio/mp3;base64,AA', null, undefined, '',
      '/storage/v1/object/public/audio/u/music/absent.mp3', // doublon : un seul appel
    ]);
    expect(r.sort()).toEqual(['absent.mp3', 'parti.mp3']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rien d absent : liste vide', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 }) as Response));
    expect(await mediasIntrouvables(['/a.mp3', '/b.mp4'])).toEqual([]);
  });
});

describe('Créer : le rush ne disparaît plus en silence', () => {
  const w = src('src/app/dashboard/creer/AssistantWizard.tsx');

  it('envoi refusé si un rush est choisi mais la séquence Vidéo est inactive ou à 0 s', () => {
    expect(w).toContain("if (jumeauMode !== 'avatar' && plateau.rushUrl && (!videoActive || plateau.videoDuration <= 0)) {");
    // Placé AVANT la génération (payante) du jumeau et avant la boucle de rendu.
    expect(w.indexOf('const introuvables = await urlsIntrouvables(')).toBeLessThan(w.lastIndexOf('const video = await genererEtAttendreVideoJumeau('));
  });

  it('médias vérifiés avant envoi : voix ou rush introuvables bloquent ; musique retirée et dite (P0 2026-10-06)', () => {
    expect(w).toContain('const introuvables = await urlsIntrouvables(aVerifier.map((m) => m.url));');
    expect(w).toContain("...(musicUrl ? [{ role: 'musique' as const, url: musicUrl }] : []),");
    expect(w).toContain('[voiceUrl, ...Object.values(sequenceVoiceUrls ?? {})]');
    expect(w).toContain('[plateau.rushUrl, ...rushSuivants.map((r) => r.url)]');
    expect(w).toContain('setError(messageMediasBloquants(bloquants));');
  });

  it('la durée Vidéo ne descend jamais à 0 s quand un rush est posé', () => {
    expect(w).toContain('onVideoDurationChange={(v) => setVideoDuration(rushUrl ? Math.max(1, v || 0) : v)}');
  });

  it("fermer la médiathèque annule l'intention « Ajouter un rush »", () => {
    expect(w).toContain('onClose={() => { rushAjoutRef.current = false; setRushLibOpen(false); }}');
  });
});

describe('Audio : une musique non stockée n est jamais posée', () => {
  it('le résultat du PUT est vérifié avant onMusicChange', () => {
    const a = src('src/components/creer/AudioStudioPanel.tsx');
    const i = a.indexOf("const putRes = await fetch(data.signedUrl");
    const garde = a.indexOf('if (!putRes.ok) {', i);
    const pose = a.indexOf("if (target === 'music') onMusicChange(data.publicUrl", i);
    expect(i).toBeGreaterThan(0);
    expect(garde).toBeGreaterThan(i);
    expect(pose).toBeGreaterThan(garde);
  });
});
