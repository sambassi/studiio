// Intégrité de la conversion « texte en dur → t('clé') » : une clé appelée existe toujours,
// et un libellé de constante a bien son entrée. Garde-fou contre les collisions et les oublis.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import fr from '../../messages/fr.json';
import { empreinteLibelle } from '@/i18n/messages';

const RACINE = path.resolve(__dirname, '..');
function fichiers(d: string, sortie: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) fichiers(p, sortie);
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name)) sortie.push(p);
  }
  return sortie;
}
const lire = (chemin: string): string | undefined => {
  let cur: unknown = fr;
  for (const p of chemin.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
};

describe('intégrité de la conversion i18n', () => {
  const sources = fichiers(RACINE).map((f) => ({ f, s: fs.readFileSync(f, 'utf8') })).filter(({ s }) => /const tUi = useTranslations\('ui\./.test(s));

  it('des centaines de fichiers sont convertis (le test n\'est pas vide)', () => {
    expect(sources.length).toBeGreaterThan(60);
  });

  it('chaque tUi(\'clé\') appelé existe dans messages/fr.json, sous le namespace de SON fichier', () => {
    const manquantes: string[] = [];
    for (const { f, s } of sources) {
      const ns = /const tUi = useTranslations\('(ui\.[A-Za-z0-9.]+)'\)/.exec(s)![1];
      for (const m of s.matchAll(/\btUi\('([^']+)'/g)) {
        if (lire(`${ns}.${m[1]}`) === undefined) manquantes.push(`${path.relative(RACINE, f)} → ${ns}.${m[1]}`);
      }
    }
    expect(manquantes).toEqual([]);
  });

  it('chaque fichier convertit vers UN seul namespace (pas de mélange)', () => {
    for (const { f, s } of sources) {
      const ns = new Set([...s.matchAll(/const tUi = useTranslations\('(ui\.[A-Za-z0-9.]+)'\)/g)].map((m) => m[1]));
      expect(ns.size, path.relative(RACINE, f)).toBe(1);
    }
  });

  it('les libellés de constantes : la clé est l\'empreinte de leur texte (jamais deux textes sous une clé)', () => {
    const libelles = (fr as { ui: { libelles: Record<string, string> } }).ui.libelles;
    expect(Object.keys(libelles).length).toBeGreaterThan(100);
    for (const [cle, texte] of Object.entries(libelles)) expect(cle).toBe(empreinteLibelle(texte));
  });

  it('empreinteLibelle est identique à scripts/i18n/hash.cjs (clé partagée codemod / exécution)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { empreinte } = require('../../scripts/i18n/hash.cjs');
    for (const t of ['Bonjour', '  Crédits   disponibles ', '150 crédits/mois (~15 vidéos)', 'Éducatif', '', 'é']) {
      expect(empreinteLibelle(t)).toBe(empreinte(t));
    }
  });

  it('t.fr : traduit un libellé connu, et RENVOIE L\'ORIGINAL pour tout autre texte (contenu utilisateur intact)', async () => {
    const { render } = await import('@testing-library/react');
    const React = await import('react');
    const { useTranslations, I18nContext } = await import('@/i18n/client');
    const [libelle] = Object.values((fr as { ui: { libelles: Record<string, string> } }).ui.libelles);
    function Sonde() { const t = useTranslations('ui.x'); return React.createElement('p', null, [t.fr(libelle), '|', t.fr('Mon texte à moi'), '|', t.fr(42 as unknown as string)].join('')); }
    const en = { ui: { libelles: { [empreinteLibelle(libelle)]: 'TRANSLATED' } } };
    const { container } = render(React.createElement(I18nContext.Provider, { value: { locale: 'en', messages: en, setLocale: () => {} } }, React.createElement(Sonde)));
    expect(container.textContent).toBe('TRANSLATED|Mon texte à moi|42');
  });
});
