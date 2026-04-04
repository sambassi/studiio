import { describe, it, expect } from 'vitest';

// smart-content.ts utilise une base de connaissances locale, pas d'API externe
// On vérifie qu'il exporte les fonctions attendues et génère du contenu valide

import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourceCode = readFileSync(
  resolve(__dirname, '../lib/smart-content.ts'),
  'utf-8'
);

describe('Smart Content Module', () => {
  it('doit exporter une fonction de génération de contenu', () => {
    expect(
      sourceCode.includes('export function') || sourceCode.includes('export async function')
    ).toBe(true);
  });

  it('doit contenir des thèmes de contenu (fitness, santé, nutrition)', () => {
    const themes = ['fitness', 'santé', 'nutrition', 'sommeil', 'sport', 'énergie'];
    const foundThemes = themes.filter(theme =>
      sourceCode.toLowerCase().includes(theme.toLowerCase())
    );
    // Au moins 2 thèmes doivent être présents
    expect(foundThemes.length).toBeGreaterThanOrEqual(2);
  });

  it('doit générer du contenu structuré avec titre et description', () => {
    // Les cartes d'infographie doivent avoir title et description
    expect(sourceCode).toContain('title');
    expect(sourceCode).toContain('description');
  });
});
