import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';

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
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

/** Le corps du rendu, isolé de la fin du fichier. */
const rendu = wizard.slice(
  wizard.indexOf('const runRender = async (destination:'),
  wizard.indexOf('const reset = ()'),
);

describe('Un seul chemin pour les deux destinations', () => {
  it('le rendu est paramétré, pas dupliqué', () => {
    // La destination « apercu » s'est ajoutee : le chemin reste unique.
    expect(wizard).toContain("const runRender = async (destination: 'calendrier' | 'bureau' | 'apercu') => {");
    // Une seule construction d'options : c'est elle qui garantit que les deux
    // vidéos sont identiques.
    expect(wizard.split('const optionsRendu: ComposerOptions = {').length - 1).toBe(1);
  });

  it('les trois destinations composent sur le MÊME objet d options', () => {
    expect(rendu).toContain('await composeVideo(optionsRendu)');
    expect(rendu).toContain("composerEtFacturer('calendrier', renderFormat, optionsRendu)");
  });

  it('le bouton du Calendrier passe par ce chemin', () => {
    expect(wizard).toContain("onClick={() => runRender('calendrier')}");
    expect(wizard).toContain("onClick={() => runRender('bureau')}");
  });

  it('« bureau » téléverse lui aussi, mais vers LA clé du serveur', () => {
    // Il ne téléversait nulle part, et c'était le probleme inverse de celui
    // du Calendrier : sans objet dans le stockage, le serveur n'a rien a
    // regarder, donc rien a confirmer. Les trois destinations envoient
    // desormais le montage a la cle attribuee, et nulle part ailleurs.
    expect(rendu).toContain("} else if (destination === 'calendrier') {");
    expect(rendu).toContain("composed = await composerEtFacturer('calendrier', renderFormat, optionsRendu);");
    expect(rendu).toContain('const rendu = await composeVideo(optionsRendu);');
    // Le chemin non prouve a disparu de l'ecran.
    expect(rendu).not.toMatch(/composeAndUpload\s*\(/);
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
  it('le débit est factorisé — un seul socle pour les trois destinations', () => {
    // Il ne l'etait pas : le Calendrier debitait apres coup par
    // `/api/credits/deduct`, apercu et bureau par le socle. Deux contrats,
    // et c'est celui qui ne prouvait rien qui servait au parcours principal.
    expect(wizard).not.toMatch(/debiterRendu\s*\(/);
    expect(wizard).not.toMatch(/fetch\('\/api\/credits\/deduct'/);
    expect((rendu.match(/rendreEtFacturer\(\{/g) || [])).toHaveLength(1);
    expect(rendu).toContain("operation: destination === 'apercu' ? 'apercu' : 'bureau',");
    expect((rendu.match(/composerEtFacturer\(/g) || [])).toHaveLength(1);
  });

  it('le téléchargement est TOUJOURS facturé, mais contre une preuve serveur', () => {
    // Il l'était contre un montant choisi par le navigateur. Il l'est
    // désormais contre une tentative ouverte par le serveur, un objet
    // téléversé vers LA clé attribuée, et une vérification de cet objet.
    const i = rendu.indexOf("if (destination === 'bureau') {");
    const bloc = rendu.slice(i, i + 900);
    expect(bloc).toContain('continue;');
    // Plus aucun débit ici : il a déjà eu lieu à la confirmation, en amont.
    expect(bloc).not.toContain('debiterRendu(');
    expect(rendu).toContain("format: renderFormat,");
  });

  it('rien n est livré si le serveur ne confirme pas', () => {
    // La garde est AVANT que le blob n'atteigne `blobsBureau` : un montage
    // non confirmé n'est jamais téléchargé.
    const garde = rendu.indexOf('if (!livraison.ok || !livraison.blob) {');
    const livre = rendu.indexOf('blobsBureau.push(');
    expect(garde).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(livre);
  });

  it('rien n est débité si la composition échoue', () => {
    // La composition vit DANS la tentative : `rendreEtFacturer` l'entoure
    // d'un try/catch qui abandonne la tentative et rend `ok: false`. Une
    // tentative abandonnee n'a jamais ete confirmee, donc jamais debitee.
    const client = readFileSync(join(process.cwd(), 'src/lib/rendus/client.ts'), 'utf-8');
    const compose = client.indexOf('blob = await composer();');
    const abandon = client.indexOf("return { ok: false, motif: 'composition'");
    const confirme = client.indexOf('/confirm`');
    expect(compose).toBeGreaterThan(-1);
    expect(abandon).toBeGreaterThan(compose);
    expect(abandon).toBeLessThan(confirme);
  });

  it('le solde est vérifié pour le lot ENTIER avant de commencer', () => {
    expect(rendu).toContain('const coutTotal = batchCost(cost, total);');
    expect(rendu).toContain('balance < coutTotal');
  });

  it('un débit refusé ne livre RIEN — c est l inverse d avant', () => {
    // Avant : « le fichier est deja rendu, le refuser apres coup ne le
    // deferait pas » — donc on livrait quand meme. Le montage n'est
    // desormais livre qu'apres confirmation, et le refus arrete tout.
    expect(wizard).not.toContain('— montage conservé');
    expect(rendu).toContain('if (!livraison.ok || !livraison.blob) {');
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
    // Le verrou synchrone s'ajoute au drapeau d'affichage : `sending` grise
    // au rendu suivant, `actif(VERROU.serie)` bloque dans le tour courant.
    expect(bloc.slice(0, 400)).toContain('disabled={sending || actif(VERROU.serie)}');
  });

  it('il dit qu aucun post n est créé', () => {
    expect(wizard).toContain('sans créer de post');
  });

  it('une icône lucide, jamais un emoji', () => {
    expect(wizard).toContain('<Download className="w-3.5 h-3.5" />');
  });
});

describe('Le Calendrier n a pas bougé', () => {
  it('il réserve, compose, téléverse, fait confirmer — puis crée le post', () => {
    const socle = rendu.indexOf("composerEtFacturer('calendrier'");
    const post = rendu.indexOf("await fetch('/api/posts'");
    expect(socle).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(socle);
    // Et plus rien apres le post : le debit n'y est plus.
    expect(rendu.slice(post)).not.toMatch(/debiterRendu|credits\/deduct/);
  });

  it('il garde sa vérification d URL et son message', () => {
    expect(rendu).toContain('Le montage a été rendu mais son envoi a échoué. Réessayez.');
  });

  it('il marque toujours l envoi comme abouti', () => {
    expect(rendu).toContain('setSent(true);');
  });
});
