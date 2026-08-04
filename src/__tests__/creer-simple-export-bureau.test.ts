import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Export « bureau » — télécharger le montage sur l'ordinateur.
 *
 * L'exigence structurante : **la vidéo téléchargée doit être la même que
 * celle du Calendrier**. D'où un seul chemin de rendu, paramétré par sa
 * destination, plutôt que deux copies — deux copies auraient divergé dès la
 * première option ajoutée d'un seul côté, et le fichier téléchargé n'aurait
 * plus ressemblé au post.
 *
 * Deux différences seulement, toutes deux à la fin de chaque tour de boucle :
 * le Calendrier téléverse puis crée un post ; le bureau garde le blob et ne
 * crée **rien**.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

/** Le corps du rendu, isolé de la fin du fichier. */
const rendu = wizard.slice(
  wizard.indexOf("const runRender = async (destination: 'calendrier' | 'bureau')"),
  wizard.indexOf('const reset = ()'),
);

describe('Un seul chemin pour les deux destinations', () => {
  it('le rendu est paramétré, pas dupliqué', () => {
    expect(wizard).toContain("const runRender = async (destination: 'calendrier' | 'bureau') => {");
    // Une seule construction d'options : c'est elle qui garantit que les deux
    // vidéos sont identiques.
    expect(wizard.split('const optionsRendu: ComposerOptions = {').length - 1).toBe(1);
  });

  it('les deux destinations composent sur le MÊME objet d options', () => {
    expect(rendu).toContain('(await composeVideo(optionsRendu)).video');
    expect(rendu).toContain('await composeAndUpload(optionsRendu)');
  });

  it('le bouton du Calendrier passe par ce chemin', () => {
    expect(wizard).toContain("onClick={() => runRender('calendrier')}");
    expect(wizard).toContain("onClick={() => runRender('bureau')}");
  });

  it('« bureau » compose SANS téléverser', () => {
    // `composeAndUpload` enverrait le fichier au stockage : un téléchargement
    // local n'a aucune raison d'y passer. C'est l'ORDRE des deux branches du
    // ternaire qui le décide — `composeVideo` du côté « bureau ».
    const ternaire = rendu.slice(
      rendu.indexOf("destination === 'bureau'\n            ? {"),
      rendu.indexOf('// ── Destination'),
    );
    expect(ternaire.indexOf('composeVideo(optionsRendu)'))
      .toBeLessThan(ternaire.indexOf('composeAndUpload(optionsRendu)'));
    expect(ternaire).toContain(': await composeAndUpload(optionsRendu);');
  });
});

describe('Le bureau ne crée AUCUN post', () => {
  it('il sort de la boucle avant la création du post', () => {
    const i = rendu.indexOf("if (destination === 'bureau') {");
    const j = rendu.indexOf("await fetch('/api/posts'");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    // `continue` : on est dans la boucle du lot, le tour suivant enchaîne.
    expect(rendu.slice(i, j)).toContain('continue;');
  });

  it('la vérification d URL téléversée ne le concerne pas', () => {
    // `composed.url` est nul par construction en destination bureau.
    const i = rendu.indexOf("if (destination === 'bureau') {");
    const j = rendu.indexOf('if (!composed.url) {');
    expect(j).toBeGreaterThan(i);
  });
});

describe('Les crédits', () => {
  it('le débit est factorisé — un seul code pour les deux destinations', () => {
    expect(wizard).toContain('const debiterRendu = async (cost: number, renderFormat:');
    expect(rendu).toContain('await debiterRendu(cost, renderFormat);');
    expect(rendu).toContain('await debiterRendu(cost, renderFormat, json.post.id);');
  });

  it('il est débité PAR VIDÉO, dans la boucle', () => {
    // Un lot de trois coûte trois rendus, comme au Calendrier.
    const i = rendu.indexOf("if (destination === 'bureau') {");
    const bloc = rendu.slice(i, i + 400);
    expect(bloc).toContain('await debiterRendu(cost, renderFormat);');
    expect(bloc).toContain('continue;');
  });

  it('rien n est débité si la composition échoue', () => {
    // Le débit vient APRÈS la composition : une exception sort de la boucle
    // par le `catch` sans jamais l'atteindre.
    const compose = rendu.indexOf('await composeVideo(optionsRendu)');
    const debit = rendu.indexOf('await debiterRendu(cost, renderFormat);');
    expect(debit).toBeGreaterThan(compose);
  });

  it('le solde est vérifié pour le lot ENTIER avant de commencer', () => {
    expect(rendu).toContain('const coutTotal = batchCost(cost, total);');
    expect(rendu).toContain('balance < coutTotal');
  });

  it('un débit refusé ne fait pas perdre le montage', () => {
    // Le fichier est déjà rendu : le refuser après coup ne le déferait pas.
    expect(wizard).toContain('— montage conservé');
  });
});

describe('Le téléchargement', () => {
  it('il a lieu APRÈS la boucle, une seule fois', () => {
    // Un lot de cinq ouvrirait sinon cinq fenêtres d'enregistrement.
    expect(rendu).toContain('if (blobsBureau.length === 1) {');
    expect(rendu).toContain('const blobsBureau: Array<{ blob: Blob; titre: string }> = [];');
  });

  it('une seule vidéo part en fichier vidéo', () => {
    expect(rendu).toContain('await downloadBlob(');
    expect(rendu).toContain('`${slugTitre(blobsBureau[0].titre)}.webm`');
  });

  it('un lot part en UN dossier compressé', () => {
    expect(rendu).toContain("const JSZip = (await import('jszip')).default;");
    expect(rendu).toContain("zip.file(`${slugTitre(v.titre)}-${i + 1}.webm`, v.blob);");
    expect(rendu).toContain("zip.generateAsync({ type: 'blob' })");
    expect(rendu).toContain('-videos.zip`');
  });

  it('chaque vidéo du lot porte SON titre, pas celui de la première', () => {
    // Le lot fait varier le contenu : trois fichiers au même nom seraient
    // écrasés l'un par l'autre à l'ouverture du zip.
    expect(rendu).toContain('blobsBureau.push({ blob: composed.blob, titre: contenu.title });');
  });

  it('le nom de fichier est assaini', () => {
    expect(wizard).toContain("(titre || 'studiio').replace(/[^a-zA-Z0-9-_]+/g, '_')");
  });

  it('un titre vide ou entièrement exotique donne quand même un nom', () => {
    expect(wizard).toContain(".slice(0, 60) || 'studiio'");
  });

  it('l URL de l archive est révoquée, mais en différé', () => {
    // Safari lit le blob APRÈS le clic : révoquer tout de suite annulerait le
    // téléchargement.
    expect(rendu).toContain('setTimeout(() => { URL.revokeObjectURL(url);');
  });

  it('un lot vide le dit au lieu de télécharger du néant', () => {
    expect(rendu).toContain("setError('Aucun montage à télécharger.');");
  });

  it('la progression du téléchargement est remontée', () => {
    const bloc = rendu.slice(rendu.indexOf('if (blobsBureau.length === 1) {'));
    expect(bloc.slice(0, 500)).toContain('setRenderProgress');
  });
});

describe('Le bouton', () => {
  it('il annonce le nombre de vidéos et le format du lot', () => {
    expect(wizard).toContain('? `Télécharger les ${batchCount} vidéos (.zip)`');
    expect(wizard).toContain("'Télécharger la vidéo'");
  });

  it('il se désarme pendant le rendu', () => {
    const bloc = wizard.slice(wizard.indexOf("onClick={() => runRender('bureau')}"));
    expect(bloc.slice(0, 400)).toContain('disabled={sending}');
  });

  it('il dit qu aucun post n est créé', () => {
    expect(wizard).toContain('sans créer de post');
  });

  it('une icône lucide, jamais un emoji', () => {
    expect(wizard).toContain('<Download className="w-3.5 h-3.5" />');
  });
});

describe('Le Calendrier n a pas bougé', () => {
  it('il téléverse, crée le post, puis débite', () => {
    const post = rendu.indexOf("await fetch('/api/posts'");
    const debit = rendu.indexOf('await debiterRendu(cost, renderFormat, json.post.id);');
    expect(post).toBeGreaterThan(0);
    expect(debit).toBeGreaterThan(post);
  });

  it('il garde sa vérification d URL et son message', () => {
    expect(rendu).toContain('Le montage a été rendu mais son envoi a échoué. Réessayez.');
  });

  it('il marque toujours l envoi comme abouti', () => {
    expect(rendu).toContain('setSent(true);');
  });
});
