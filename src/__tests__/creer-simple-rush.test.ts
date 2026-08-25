import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Chantier 2 — incrément 1 : import d'un rush vidéo dans « Créer (simple) ».
 *
 * Le montage se compose dans un navigateur (Canvas + MediaRecorder) : il n'est
 * pas exécutable ici. Ces tests vérifient donc le CÂBLAGE — c'est-à-dire
 * précisément ce qui a déjà été oublié plusieurs fois dans ce dépôt (une
 * fonctionnalité visible dans l'éditeur mais absente du fichier exporté, faute
 * d'avoir été passée au compositeur ou écrite dans les métadonnées).
 *
 * Ce qu'ils ne prouvent PAS : que le fichier produit contient bien l'image du
 * rush. Cette vérification-là reste manuelle, sur la preview.
 */

const wizardSource = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

const composerSource = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

describe('Créer (simple) — import d’un rush', () => {
  it('passe le rush au compositeur via `videoUrl`', () => {
    // Sans cette ligne, le rush est téléversé, listé dans l'UI… et absent du
    // montage. C'est le point de câblage le plus facile à oublier.
    // Conditionné à la séquence : un rush transmis alors que la séquence est
    // masquée force le rendu temps réel pour rien (`hasRushAudio`).
    expect(wizardSource).toMatch(
      /videoUrl:\s*seqDuration\('video'\) > 0 \? rushUrl \|\| undefined : undefined/,
    );
  });

  it('persiste le rush sous `rushUrls` — le champ que le Calendrier relit', () => {
    // `regenerateMontage` (calendar/page.tsx) lit `meta.rushUrls?.[0]`. Sans
    // ce champ, une régénération produirait le même montage sans sa séquence
    // vidéo. Même condition que `videoUrl`.
    expect(wizardSource).toMatch(/rushUrls:\s*\n?\s*seqDuration\('video'\) > 0 && persistableUrl\(rushUrl\)/);
  });

  it('déclare `hasAudio` quand le rush apporte sa propre piste', () => {
    // Le compositeur route et embarque l'audio du rush
    // (`hasRushAudio = !!videoEl`). Sans ce terme, le Calendrier proposait
    // « Ajouter du son » sur un montage qui en avait déjà.
    expect(wizardSource).toMatch(
      /hasAudio:\s*!!\(musicUrl \|\| voiceUrl \|\| \(rushUrl && seqDuration\('video'\) > 0\)\)/,
    );
  });

  it('active la séquence vidéo ET lui donne une durée non nulle à l’import', () => {
    const applyRush = wizardSource.slice(
      wizardSource.indexOf('const applyRush'),
      wizardSource.indexOf('const clearRush'),
    );
    expect(applyRush).not.toHaveLength(0);
    // Le compositeur exclut la séquence à durée nulle (`videoDuration > 0`) :
    // l'activer sans la cadencer ne suffirait pas.
    expect(applyRush).toMatch(/key === 'video'.*enabled: true/s);
    expect(applyRush).toMatch(/setVideoDuration\(seconds\)/);
  });

  it('remet la séquence vidéo à zéro quand le rush est retiré', () => {
    const clearRush = wizardSource.slice(
      wizardSource.indexOf('const clearRush'),
      wizardSource.indexOf('const theme = THEMES'),
    );
    expect(clearRush).toMatch(/setRushUrl\(null\)/);
    expect(clearRush).toMatch(/setVideoDuration\(0\)/);
    expect(clearRush).toMatch(/key === 'video'.*enabled: false/s);
  });

  it('borne la durée de la séquence vidéo entre 1 et 10 s', () => {
    // Un rush d'une minute ne doit pas transformer un reel de 14 s en montage
    // d'une minute.
    expect(wizardSource).toMatch(/RUSH_SECONDS\s*=\s*\{[^}]*min:\s*1[^}]*max:\s*10/s);
    expect(wizardSource).toMatch(
      /Math\.min\(Math\.max\(Math\.round\(probed\), RUSH_SECONDS\.min\), RUSH_SECONDS\.max\)/,
    );
  });

  it('ouvre la médiathèque filtrée sur les vidéos', () => {
    expect(wizardSource).toContain("import { MediaLibrary } from '@/components/shared/MediaLibrary'");
    expect(wizardSource).toMatch(/mediaType="video"/);
    expect(wizardSource).toMatch(/onSelect=\{\(url, name\) => \{ void applyRush\(url, name\); \}\}/);
  });

  it('déclare enfin un rush au panneau audio (durée de séquence réglable)', () => {
    expect(wizardSource).toMatch(/hasRush=\{!!rushUrl\}/);
    // L'ancien câblage en dur masquait le champ de durée quoi qu'il arrive.
    expect(wizardSource).not.toMatch(/hasRush=\{false\}/);
  });

  it('n’annonce plus « Aucun rush dans ce parcours »', () => {
    expect(wizardSource).not.toContain('Aucun rush dans ce parcours');
  });

  it('reste STRICTEMENT inchangé tant qu’aucun rush n’est importé', () => {
    // Rétro-compat : la séquence vidéo part masquée, à durée nulle, et
    // `videoUrl` vaut `undefined` — exactement l'état d'avant cet ajout.
    expect(wizardSource).toMatch(/video:\s*0,\s*cta/);
    expect(wizardSource).toMatch(/\{ key: 'video', enabled: false \}/);
    expect(wizardSource).toMatch(/const \[rushUrl, setRushUrl\] = useState<string \| null>\(null\)/);
  });
});

describe('Rush — le ratio de la source est préservé', () => {
  it('le compositeur cadre le rush en « cover », jamais en étirement', () => {
    // Une échelle UNIFORME appliquée aux deux dimensions : le rush est
    // recadré, jamais déformé. C'est la règle absolue du cahier des charges.
    expect(composerSource).toMatch(/const baseScale = Math\.max\(w \/ srcW, h \/ srcH\)/);
    expect(composerSource).toMatch(/const drawW = srcW \* drawScale/);
    expect(composerSource).toMatch(/const drawH = srcH \* drawScale/);
    // Le contre-exemple à ne jamais voir revenir : dessiner à la taille du
    // canvas sans tenir compte des dimensions de la source.
    expect(composerSource).not.toMatch(/drawImage\(\s*backgroundSource,\s*0,\s*0,\s*w,\s*h\s*\)/);
  });

  // Il y avait ici un test qui réimplémentait la formule « cover » puis
  // vérifiait sa propre réimplémentation : il ne touchait aucune ligne de
  // code de production. Retiré. Le cadrage de l'aperçu est vérifié pour de
  // bon sur le DOM produit, dans `creer-simple-clips.test.tsx`.
});
