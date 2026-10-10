import { describe, it, expect } from 'vitest';
import { analyserPromptImage, construirePromptImage } from '@/lib/ai/prompt-image';

/**
 * Prompt image FIDELE — ce que l'utilisateur ecrit doit TOUT arriver au
 * modele, en anglais, en tete du prompt ; l'enrichissement n'ajoute que de la
 * qualite. Fonction pure : aucun fournisseur n'est appele ici.
 */

const FEMME = 'femme noire transpirante avec casque audio sans fil danse';
const HOMME = 'homme asiatique court sous la pluie avec parapluie rouge';

/** Mots interdits quand un sujet ou une action est present. */
const INJECTIONS_INTERDITES = ['portrait', 'looking at camera', 'static', 'professional background', 'aspect ratio'];

describe('les elements explicites de l utilisateur survivent tous', () => {
  it('« femme noire transpirante avec casque audio sans fil danse »', () => {
    const { structure, promptFinal } = construirePromptImage(FEMME);
    expect(structure.sujet).toEqual(['black woman']);
    expect(structure.action).toEqual(['dancing']);
    expect(structure.objets).toEqual(['wireless headphones']);
    expect(structure.apparence).toContain('sweating');
    expect(structure.contraintes).toContain('no cable visible');

    const p = promptFinal.toLowerCase();
    for (const attendu of ['black woman', 'dancing', 'sweating', 'wireless headphones', 'no cable visible']) {
      expect(p, attendu).toContain(attendu);
    }
  });

  it('« homme asiatique court sous la pluie avec parapluie rouge » (court = il court)', () => {
    const { structure, promptFinal } = construirePromptImage(HOMME);
    expect(structure.sujet).toEqual(['asian man']);
    expect(structure.action).toEqual(['running']);
    expect(structure.objets).toEqual(['red umbrella']);
    expect(structure.decor).toEqual(['in the rain']);

    const p = promptFinal.toLowerCase();
    for (const attendu of ['asian man', 'running', 'rain', 'red umbrella']) {
      expect(p, attendu).toContain(attendu);
    }
    expect(p).not.toContain('short');
  });

  it.each([FEMME, HOMME])('le texte original est recopie mot pour mot : %s', (texte) => {
    expect(construirePromptImage(texte).promptFinal).toContain(`Original request (French): « ${texte} »`);
  });

  it('un mot inconnu du lexique n est jamais perdu (texte original)', () => {
    const texte = 'femme qui jongle avec des oranges fluorescentes';
    expect(construirePromptImage(texte).promptFinal).toContain(texte);
  });

  it.each([FEMME, HOMME])('aucune injection portrait/statique/fond pro : %s', (texte) => {
    const p = construirePromptImage(texte).promptFinal.toLowerCase();
    for (const mot of INJECTIONS_INTERDITES) expect(p, mot).not.toContain(mot);
  });
});

describe('regles de la langue', () => {
  it('adjectif postpose → avant le nom anglais', () => {
    expect(analyserPromptImage('parapluie rouge').objets).toEqual(['red umbrella']);
    expect(analyserPromptImage('casque audio sans fil').objets).toEqual(['wireless headphones']);
  });

  it('« sans X » → contrainte « no X », X n est pas ajoute aux objets', () => {
    const s = analyserPromptImage('femme qui court sans lunettes');
    expect(s.contraintes).toContain('no glasses');
    expect(s.objets).toEqual([]);
  });

  it('« cheveux courts » reste une apparence, pas une course', () => {
    const s = analyserPromptImage('danseuse aux cheveux courts');
    expect(s.apparence).toContain('short hair');
    expect(s.action).toEqual([]);
  });

  it('accents et majuscules sont neutralises', () => {
    expect(analyserPromptImage('Homme ASIATIQUE avec Haltères').sujet).toEqual(['asian man']);
  });
});

describe('enrichissement : ajouts seulement', () => {
  it('la description utilisateur est EN TETE, l enrichissement apres', () => {
    const { promptFinal } = construirePromptImage(FEMME);
    expect(promptFinal.startsWith('A black woman dancing, sweating, with wireless headphones, no cable visible,')).toBe(true);
    expect(promptFinal).toContain('dynamic pose');
    expect(promptFinal).toContain('motion visible');
    expect(promptFinal).toContain('photorealistic');
  });

  it('l enrichissement ne modifie ni sujet, ni action, ni objets', () => {
    // La structure (hors style) ne depend que du texte : on compare avec
    // une analyse du meme texte sans enrichissement possible a observer —
    // le style est la SEULE liste qui recoit des ajouts.
    for (const texte of [FEMME, HOMME]) {
      const s = analyserPromptImage(texte);
      const enrichis = new Set(s.style);
      for (const champ of [s.sujet, s.action, s.objets, s.apparence, s.decor, s.contraintes]) {
        for (const v of champ) expect(enrichis.has(v), v).toBe(false);
      }
    }
  });

  it('un style non photo demande n est pas contredit par « photorealistic »', () => {
    const s = analyserPromptImage('femme qui danse en dessin anime');
    expect(s.style).toContain('cartoon style');
    expect(s.style).not.toContain('photorealistic');
  });

  it('fond seul (ni sujet ni action) : garde « professional background »', () => {
    const p = construirePromptImage('salle de sport neon').promptFinal;
    expect(p.startsWith('Neon-lit gym,')).toBe(true);
    expect(p).toContain('professional background');
    expect(p).not.toContain('aspect ratio');
  });
});

describe('Regenerer : meme texte → meme structure, meme prompt', () => {
  it.each([FEMME, HOMME])('deterministe : %s', (texte) => {
    const a = construirePromptImage(texte);
    const b = construirePromptImage(texte);
    expect(b.structure).toEqual(a.structure);
    expect(b.promptFinal).toBe(a.promptFinal);
  });
});

describe('mode reference (Partir de ma photo)', () => {
  it('garde l identite ET applique toute la structure anglaise', () => {
    const p = construirePromptImage(FEMME, { mode: 'reference' }).promptFinal;
    expect(p).toContain('keep the same face and identity');
    for (const attendu of ['black woman', 'dancing', 'sweating', 'wireless headphones', 'no cable visible']) {
      expect(p, attendu).toContain(attendu);
    }
    expect(p).toContain(`« ${FEMME} »`);
  });
});

describe('« Partir de ma photo » — même personne, MÊMES VÊTEMENTS, pose et décor nouveaux', () => {
  // Photo source : un homme debout, T-shirt noir (la photo part au modèle comme `input_image`).
  const p = construirePromptImage('danse avec énergie sur une plage', { mode: 'reference' });

  it('⚠️ identité, visage, teint, coiffure : conservés', () => {
    for (const x of ['Same person as in the input image', 'same face and identity', 'same skin tone', 'same hairstyle']) expect(p.promptFinal).toContain(x);
  });

  it('⚠️ vêtements et leurs couleurs conservés (le T-shirt noir de la photo reste le même)', () => {
    for (const x of ['keep the same clothing as in the input image', 'same garments', 'same clothing colors', 'same T-shirt in the same color']) expect(p.promptFinal).toContain(x);
  });

  it('⚠️ action = danse, décor = plage, énergie ; la posture d’origine n’est PAS imposée', () => {
    expect(p.structure.action).toContain('dancing');
    expect(p.structure.decor).toContain('on a beach');
    expect(p.promptFinal).toContain('energetic movement');
    expect(p.promptFinal).toContain('change the pose freely to perform the requested action');
    expect(p.promptFinal).toContain('replace the original background');
    expect(p.promptFinal).not.toMatch(/keep the same pose|same posture/i);
  });

  it('le texte d’origine est recopié', () => {
    expect(p.promptFinal).toContain('« danse avec énergie sur une plage »');
  });
});
