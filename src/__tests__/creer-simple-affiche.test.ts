import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * « Télécharger l'affiche » — Mode simple.
 *
 * Un enregistrement LOCAL de l'aperçu : aucun crédit débité, aucun post créé.
 * C'est ce qui le distingue de « Composer et envoyer », et ce que ces tests
 * verrouillent en premier.
 *
 * Le piège technique est le même que celui déjà rencontré pour la photo des
 * cartes : le plateau porte un `transform: scale(displayScale)`, et
 * `resolveBoundingBox` de modern-screenshot lit `getBoundingClientRect()` —
 * c'est-à-dire la boîte APRÈS réduction. Sans dimensions explicites, l'affiche
 * sortirait à ~270 px de large au lieu de 1080.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

/** Le corps de la fonction de téléchargement, isolé. */
const action = wizard.slice(
  wizard.indexOf('const downloadPoster'),
  wizard.indexOf('const deleteElement'),
);

describe('C est un téléchargement local, rien d autre', () => {
  it("ne passe ni par le compositeur, ni par l'API des posts, ni par les crédits", () => {
    for (const interdit of ['composeAndUpload', '/api/posts', '/api/credits', 'COST.']) {
      expect(action, interdit).not.toContain(interdit);
    }
  });

  it('produit un blob et le remet au navigateur via un lien de téléchargement', () => {
    expect(action).toContain('canvas.toBlob(resolve, mime');
    expect(action).toContain("document.createElement('a')");
    expect(action).toContain('a.download =');
    expect(action).toContain('a.click();');
  });

  it("libère l'URL du blob, mais en différé", () => {
    // Safari lit le blob APRÈS le clic : révoquer tout de suite annulerait le
    // téléchargement.
    expect(action).toContain('setTimeout(() => URL.revokeObjectURL(url), 5000)');
  });

  it('nomme le fichier d après le titre, assaini', () => {
    expect(action).toContain("(generated.title || 'studiio').replace(/[^a-zA-Z0-9-_]+/g, '_')");
    expect(action).toContain('-affiche.${fmt');
  });

  it('propose PNG et JPG, la qualité JPG étant explicite', () => {
    expect(action).toContain("fmt === 'png' ? 'image/png' : 'image/jpeg'");
    expect(action).toContain("fmt === 'jpeg' ? 0.92 : undefined");
    expect(wizard).toContain("downloadPoster('png')");
    expect(wizard).toContain("downloadPoster('jpeg')");
  });
});

describe('La capture sort à la résolution NATIVE', () => {
  it('les dimensions sont passées explicitement à modern-screenshot', () => {
    // Sans elles, `getBoundingClientRect()` rend la boîte réduite par le
    // `transform: scale` du plateau et l'affiche fait ~270 px de large.
    expect(action).toContain('width: stage.offsetWidth');
    expect(action).toContain('height: stage.offsetHeight');
    expect(action).toContain('scale: 1');
  });

  it("la réduction d'affichage du plateau est neutralisée sur le clone", () => {
    // Les dimensions seules ne suffisent pas : le plateau porte lui-même un
    // `scale(displayScale)`, que modern-screenshot applique au clone.
    // L'affiche sortait alors en 1080x1920 avec le contenu réduit au quart au
    // milieu, le reste transparent.
    expect(action).toContain("style: { transform: 'none', transformOrigin: 'top left' }");
  });

  it('capture le plateau, pas le conteneur des cartes', () => {
    expect(action).toContain('const stage = previewRef.current;');
    expect(action).not.toContain('cardsRef');
  });

  it('attend les polices avant de photographier', () => {
    // Sinon la capture sérialise une police de repli et l'affiche ne
    // ressemble pas à l'aperçu.
    expect(action).toContain('fonts?.ready');
  });

  it('attend une frame de peinture, avec un délai de garde', () => {
    // `requestAnimationFrame` est gelé dans un onglet en arrière-plan : sans
    // borne, la promesse resterait pendante et le bouton désactivé.
    expect(action).toContain('requestAnimationFrame(() => requestAnimationFrame(done))');
    expect(action).toContain('setTimeout(r, 300)');
  });
});

describe('Les aides d édition ne sont pas gravées dans l affiche', () => {
  it('le drapeau de capture est levé avant, et retombe dans le finally', () => {
    const debut = action.indexOf('flushSync(() => setCapturing(true))');
    const capture = action.indexOf('await domToCanvas(');
    const fin = action.indexOf('setCapturing(false)');
    expect(debut).toBeGreaterThan(0);
    expect(debut).toBeLessThan(capture);
    expect(action.slice(action.indexOf('} finally {'))).toContain('setCapturing(false)');
    expect(fin).toBeGreaterThan(capture);
  });

  it('il est levé avec flushSync — la capture part dans la même tâche', () => {
    expect(action).toContain('flushSync(() => setCapturing(true));');
  });
});

describe('Le bouton', () => {
  it("n'apparaît que lorsqu'il y a quelque chose à télécharger", () => {
    expect(wizard).toContain('{generated && (');
  });

  it('se désarme pendant la capture, et le dit', () => {
    // Deux clics enchaînés lanceraient deux captures concurrentes.
    expect(wizard).toContain('disabled={posterExporting}');
    expect(wizard).toContain("posterExporting ? 'Capture…' : 'Télécharger l’affiche'");
    expect(action).toContain('if (!stage || !generated || posterExporting) return;');
  });

  it('utilise des icônes lucide, jamais un emoji', () => {
    expect(wizard).toContain('<ImageDown className="w-3.5 h-3.5" />');
    expect(wizard).toContain('<Loader2 className="w-3.5 h-3.5 animate-spin" />');
  });

  it('un échec est dit à l utilisateur, pas seulement à la console', () => {
    expect(action).toContain('Téléchargement de l’affiche impossible');
  });
});
