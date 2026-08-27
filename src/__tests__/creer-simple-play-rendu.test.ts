import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderSignature, signatureMatches, VOLATILE_KEYS } from '@/lib/creer/renderSignature';

/**
 * Bouton Play — voir le VRAI rendu avant de l'envoyer.
 *
 * L'onglet « Tout » est une image figée : ni animations de texte, ni
 * transitions. Play compose la vidéo pour de bon, la joue, **et la garde** —
 * l'export la réutilise tant que rien n'a bougé, pour ne débiter qu'une fois.
 *
 * Tout repose sur la signature. Une liste de champs écrite à la main serait
 * fausse au premier réglage ajouté sans y penser, et **son échec est
 * silencieux** : l'export livrerait un montage périmé, et l'utilisateur
 * recevrait une vidéo qui ne correspond plus à son écran. D'où une signature
 * dérivée des options réellement envoyées au compositeur.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);
const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

const rendu = wizard.slice(
  wizard.indexOf('const runRender = async (destination:'),
  wizard.indexOf('const reset = ()'),
);

describe('La signature couvre TOUT ce qui part au compositeur', () => {
  it('deux options identiques donnent la même signature', () => {
    const a = { title: 'x', durations: { intro: 4 }, design: { transition: 'slide' } };
    const b = { title: 'x', durations: { intro: 4 }, design: { transition: 'slide' } };
    expect(renderSignature(a)).toBe(renderSignature(b));
  });

  it('l ORDRE des clés ne change rien — sinon le cache raterait sans raison', () => {
    expect(renderSignature({ a: 1, b: 2 })).toBe(renderSignature({ b: 2, a: 1 }));
  });

  it('un réglage IMBRIQUÉ qui change, la change', () => {
    // C'est le cas qu'une liste manuelle rate : le champ existe, mais on ne
    // pensait pas à descendre dedans.
    const base = { design: { transition: 'crossfade', textAnimation: 'none' } };
    const autre = { design: { transition: 'crossfade', textAnimation: 'fade' } };
    expect(renderSignature(base)).not.toBe(renderSignature(autre));
  });

  it('un champ AJOUTÉ plus tard entre tout seul dans la signature', () => {
    // La garantie qui rend le dispositif durable.
    const avant = { a: 1 };
    const apres = { a: 1, reglageInvente: 'oui' };
    expect(renderSignature(avant)).not.toBe(renderSignature(apres));
  });

  it('un tableau réordonné change la signature — l ordre des séquences compte', () => {
    expect(renderSignature({ o: ['intro', 'cta'] })).not.toBe(renderSignature({ o: ['cta', 'intro'] }));
  });
});

describe('Ce que la signature ignore, et pourquoi', () => {
  it('la photo des cartes — elle est neuve à chaque capture', () => {
    // L'inclure rendrait toute signature unique, donc le cache inutile. Ce
    // qui la détermine — cartes et design — est déjà dans les options.
    expect(VOLATILE_KEYS.has('cardsSnapshot')).toBe(true);
    expect(VOLATILE_KEYS.has('cardsSnapshotRect')).toBe(true);
    const a = renderSignature({ x: 1, cardsSnapshot: { src: 'blob:1' } });
    const b = renderSignature({ x: 1, cardsSnapshot: { src: 'blob:2' } });
    expect(a).toBe(b);
  });

  it('les éléments rasterisés — images neuves à chaque envoi', () => {
    expect(VOLATILE_KEYS.has('elements')).toBe(true);
  });

  it('les fonctions', () => {
    expect(renderSignature({ x: 1, onProgress: () => {} })).toBe(renderSignature({ x: 1 }));
  });

  it('mais PAS les valeurs qui décrivent vraiment le montage', () => {
    for (const cle of ['durations', 'design', 'title', 'cards', 'transition', 'sequenceVoiceUrls']) {
      expect(VOLATILE_KEYS.has(cle), cle).toBe(false);
    }
  });
});

describe('La signature ne fait jamais tomber l écran', () => {
  it('une structure cyclique rend une valeur plutôt qu une exception', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.moi = a;
    expect(() => renderSignature(a)).not.toThrow();
  });

  it('en cas d échec, la valeur est UNIQUE — donc jamais réutilisée', () => {
    // Recomposer coûte ; livrer un montage périmé coûte plus cher.
    expect(renderSignature).toBeDefined();
    const bizarre = { get x() { throw new Error('boom'); } };
    const s1 = renderSignature(bizarre);
    const s2 = renderSignature(bizarre);
    expect(s1).not.toBe(s2);
  });

  it('NaN et Infinity ne cassent pas la comparaison', () => {
    expect(() => renderSignature({ a: Number.NaN, b: Number.POSITIVE_INFINITY })).not.toThrow();
  });
});

describe('signatureMatches', () => {
  it('exige une signature en cache ET identique', () => {
    expect(signatureMatches('abc', 'abc')).toBe(true);
    expect(signatureMatches('abc', 'def')).toBe(false);
    expect(signatureMatches(null, 'abc')).toBe(false);
    expect(signatureMatches(undefined, 'abc')).toBe(false);
    // Deux absences ne font pas une correspondance.
    expect(signatureMatches('', '')).toBe(false);
  });
});

describe('Le Play passe par le MÊME chemin que l export', () => {
  it('c est une destination de plus, pas un second rendu', () => {
    // Un chemin séparé aurait divergé des options de l'export, et la vidéo
    // prévisualisée n'aurait plus été celle envoyée.
    expect(wizard).toContain("const runRender = async (destination: 'calendrier' | 'bureau' | 'apercu') => {");
    // ⚠️ ON VERIFIE L'APPEL, PAS SA MISE EN PAGE. Le bouton porte desormais
    // trois etats (voir / revoir / recomposer) et l'appel vit dans l'un
    // d'eux : comparer la ligne entiere faisait tomber ce test a chaque
    // remaniement de l'ecran, alors qu'aucun chemin de rendu n'avait bouge.
    expect(wizard).toContain("runRender('apercu')");
  });

  it('il compose sans téléverser et ne crée AUCUN post', () => {
    const i = rendu.indexOf("if (destination === 'apercu') {");
    const j = rendu.indexOf("await fetch('/api/posts'");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(rendu.slice(i, j)).toContain('return;');
  });

  it('il ne rend QU UNE vidéo, même en lot', () => {
    // En jouer cinq n'apprendrait rien de plus et coûterait cinq rendus.
    expect(rendu).toContain("const total = destination === 'apercu' ? 1 : clampBatchCount(batchCount);");
  });

  it('il débite, comme un export — contre une preuve serveur', () => {
    // L'aperçu ouvre une tentative, téléverse vers la clé attribuée, et
    // n'est joué qu'une fois le serveur ayant vu l'objet.
    expect(rendu).toContain("operation: destination === 'apercu' ? 'apercu' : 'bureau',");
    const confirme = rendu.indexOf('if (!livraison.ok || !livraison.blob) {');
    const joue = rendu.indexOf('setPreviewRender(composed.blob, signature, vignetteApercu);');
    expect(confirme).toBeGreaterThan(-1);
    expect(confirme).toBeLessThan(joue);
  });
});

describe('Un seul débit pour un seul rendu', () => {
  it('l export réutilise le montage quand la signature colle', () => {
    expect(rendu).toContain('const signature = renderSignature(optionsRendu);');
    expect(rendu).toContain('signatureMatches(previewSignatureRef.current, signature)');
  });

  it('et ne redébite PAS ce qui a déjà été payé', () => {
    // Le montage réutilisé ne repasse pas par une tentative : la branche
    // `reutilisable` court-circuite `rendreEtFacturer`, donc rien n'est
    // facturé une seconde fois.
    expect(rendu).toContain('if (reutilisable) {');
    expect(rendu).toContain('if (!reutilisable) await debiterRendu(json.post.id);');
    const reutil = rendu.indexOf('if (reutilisable) {');
    const facture = rendu.indexOf('rendreEtFacturer({');
    expect(reutil).toBeLessThan(facture);
  });

  it('le LOT ne réutilise jamais — ses vidéos ont un contenu varié', () => {
    // Réutiliser le montage de l'aperçu pour les vidéos 2..N livrerait N fois
    // la même, ce que le lot existe précisément pour éviter.
    expect(rendu).toContain('total === 1');
    expect(rendu).toContain("&& destination !== 'apercu'");
  });

  it('le Calendrier téléverse le montage gardé au lieu de recomposer', () => {
    expect(rendu).toContain('await uploadRendu(dejaFait, previewThumbRef.current, optionsRendu)');
  });

  it('la vignette est gardée avec le montage', () => {
    // Sans elle, un montage réutilisé arriverait au Calendrier sans miniature.
    expect(rendu).toContain("if (destination === 'apercu') vignetteApercu = rendu.thumbnail;");
    expect(wizard).toContain('previewThumbRef.current = thumbnail;');
  });
});

describe('Le téléversement a été EXTRAIT, pas recopié', () => {
  it('`composeAndUpload` et `uploadRendu` partagent le même corps', () => {
    // Réécrire la stratégie d'URL signée et ses replis dans l'écran aurait
    // divergé au premier changement.
    expect(composer).toContain('export async function uploadRendu(');
    expect(composer).toContain('async function composeAndUploadInterne(');
    expect(composer.split('return composeAndUploadInterne(blob, thumbnailBlob, options);').length - 1).toBe(2);
  });
});

describe('Le lecteur', () => {
  it('joue le montage, avec les commandes', () => {
    expect(wizard).toContain('data-play-lecteur');
    // `previewUrl!` depuis que le lecteur vit dans un calque construit hors
    // du JSX, ou TypeScript ne peut plus deduire le retrecissement.
    expect(wizard).toMatch(/src=\{previewUrl!?\}/);
    expect(wizard).toContain('controls');
  });

  it('le bouton « Fermer » qui JETAIT un rendu payé a disparu', () => {
    // ⚠️ IL APPELAIT `setPreviewRender(null, null)`, ce qui effaçait le blob
    // ET sa signature : le montage déjà débité était perdu, et l'envoi au
    // calendrier en recomposait — donc en redébitait — un second. Revenir à
    // l'édition ne change plus que d'onglet.
    expect(wizard).toContain('data-play-retour-edition');
    expect(wizard).toContain("onClick={() => setPreviewFocus('intro')}");
  });

  it('l URL du blob est libérée quand on la remplace', () => {
    // Chaque rendu garde sinon une vidéo entière en mémoire.
    expect(wizard).toContain('if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);');
  });

  it('et au démontage', () => {
    expect(wizard).toContain('useEffect(() => () => {\n    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);\n  }, []);');
  });

  it('le bouton dit ce qu il fait, et se désarme pendant le rendu', () => {
    expect(wizard).toContain('data-play-rendu');
    expect(wizard).toContain('disabled={sending}');
    expect(wizard).toContain('Rendu…');
    expect(wizard).toContain('Voir le rendu');
  });

  it('une icône lucide, jamais un emoji', () => {
    expect(wizard).toContain('<Play className="w-3.5 h-3.5" />');
  });
});
