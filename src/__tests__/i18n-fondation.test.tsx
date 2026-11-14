// Traduction de Studiio — la fondation : neuf langues, repli français, sélecteur.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { locales, localeNames, localeBadges, localeStatus, intlLocales, normalizeLocale } from '@/i18n/config';
import { fusionner, aplatir, couverture } from '@/i18n/messages';
import { chargerMessages, I18nProvider } from '@/i18n/provider';
import { LanguageSelector } from '@/components/LanguageSelector';
import { useTranslations } from '@/i18n/client';
import fr from '../../messages/fr.json';

describe('les neuf langues', () => {
  it('codes techniques stables', () => {
    expect([...locales]).toEqual(['fr', 'en', 'de', 'ln', 'wo', 'sw', 'bm', 'bas', 'ht']);
  });
  it('sigle visible : BA pour le bàsàa, CR pour le créole', () => {
    expect(localeBadges.bas).toBe('BA');
    expect(localeBadges.ht).toBe('CR');
  });
  it('chaque langue : nom complet, statut, locale Intl, fichier de catalogue', () => {
    for (const l of locales) {
      expect(localeNames[l].length).toBeGreaterThan(2);
      expect(localeStatus[l]).toBeTruthy();
      expect(intlLocales[l]).toBeTruthy();
    }
  });
  it('les langues à faibles ressources ne se disent JAMAIS complètes', () => {
    for (const l of ['ln', 'wo', 'bm', 'bas'] as const) expect(localeStatus[l]).toBe('partial');
    for (const l of ['sw', 'ht'] as const) expect(localeStatus[l]).toBe('draft');
  });
  it('une langue partielle garde les dates françaises (pas de date mélangée)', () => {
    for (const l of ['ln', 'wo', 'bm', 'bas'] as const) expect(intlLocales[l]).toBe('fr-FR');
  });
  it.each([['EN', 'en'], ['BA', 'bas'], ['cr', 'ht'], ['de-CH', 'de'], ['fr_CH', 'fr'], ['klingon', 'fr'], ['', 'fr'], [null, 'fr'], [42, 'fr']])(
    'normalizeLocale(%p) = %s', (v, att) => expect(normalizeLocale(v)).toBe(att));
});

describe('fusion : le français est la base', () => {
  const base = { a: 'Bonjour', b: { c: 'Salut', d: 'Au revoir' } };
  it('une clé absente retombe en français', () => {
    expect(fusionner(base, { a: 'Hello' })).toEqual({ a: 'Hello', b: { c: 'Salut', d: 'Au revoir' } });
  });
  it('une chaîne vide ne masque pas le français', () => {
    expect(fusionner(base, { a: '  ', b: { c: '' } })).toEqual(base);
  });
  it("une clé superflue de la langue n'ajoute rien", () => {
    expect(fusionner(base, { zzz: 'x' })).toEqual(base);
  });
  it('ne mute pas la base', () => {
    const copie = JSON.parse(JSON.stringify(base));
    fusionner(base, { a: 'Hello' });
    expect(base).toEqual(copie);
  });
  it('couverture : part des clés réellement différentes du français', () => {
    expect(couverture(base, { a: 'Hello' })).toBeCloseTo(1 / 3);
    expect(couverture(base, { a: 'Bonjour' })).toBe(0);
    expect(couverture(base, null)).toBe(0);
  });
});

describe('catalogues réels', () => {
  const clesFr = Object.keys(aplatir(fr as Record<string, unknown>));
  it.each(locales.filter((l) => l !== 'fr'))('%s : chaque langue se charge et contient toutes les clés du français', async (l) => {
    const m = aplatir(await chargerMessages(l));
    expect(Object.keys(m).sort()).toEqual([...clesFr].sort());
    for (const k of clesFr) expect(m[k].trim()).not.toBe('');
  });
  it('en et de : l\'immense majorité des clés diffère du français (les clés identiques sont des marques, nombres, sigles)', async () => {
    const { default: en } = await import('../../messages/en.json');
    const { default: de } = await import('../../messages/de.json');
    expect(couverture(fr as Record<string, unknown>, en as Record<string, unknown>)).toBeGreaterThan(0.8);
    expect(couverture(fr as Record<string, unknown>, de as Record<string, unknown>)).toBeGreaterThan(0.8);
  });
});

describe('sélecteur de langue', () => {
  function Sonde() { const t = useTranslations('languageSelector'); return <p data-testid="sonde">{t('label')}</p>; }

  it('affiche le globe, le sigle actif et ouvre un menu de neuf langues aux noms complets', async () => {
    render(<I18nProvider><LanguageSelector variant="navbar" /><Sonde /></I18nProvider>);
    const btn = await screen.findByTestId('lang-selector-btn');
    expect(screen.getByTestId('lang-active-badge').textContent).toBe('FR');
    expect(btn.querySelector('svg')).toBeTruthy();
    fireEvent.click(btn);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(9);
    for (const l of locales) expect(screen.getByTestId(`lang-${l}`).textContent).toContain(localeNames[l]);
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByTestId('lang-ln').textContent).toMatch(/partiel/);
    expect(screen.getByTestId('lang-sw').textContent).toMatch(/bêta/);
    expect(screen.getByTestId('lang-en').textContent).not.toMatch(/bêta|partiel/);
  });

  it('choisir une langue change les textes, le sigle, <html lang> et le cookie', async () => {
    render(<I18nProvider><LanguageSelector variant="navbar" /><Sonde /></I18nProvider>);
    fireEvent.click(await screen.findByTestId('lang-selector-btn'));
    await act(async () => { fireEvent.click(await screen.findByTestId('lang-en')); });
    await screen.findByText('Language');
    expect(screen.getByTestId('lang-active-badge').textContent).toBe('EN');
    expect(document.documentElement.lang).toBe('en');
    expect(document.cookie).toMatch(/locale=en/);
  });

  it('une langue partielle affiche le français pour tout ce qui manque (jamais une clé brute)', async () => {
    render(<I18nProvider><LanguageSelector variant="navbar" /><Sonde /></I18nProvider>);
    fireEvent.click(await screen.findByTestId('lang-selector-btn'));
    await act(async () => { fireEvent.click(await screen.findByTestId('lang-wo')); });
    await screen.findByText('BA', { exact: false }).catch(() => null);
    expect(screen.getByTestId('lang-active-badge').textContent).toBe('WO');
    expect(screen.getByTestId('sonde').textContent).not.toMatch(/languageSelector/);
    expect(screen.getByTestId('sonde').textContent!.length).toBeGreaterThan(2);
  });

  it('Échap ferme le menu', async () => {
    render(<I18nProvider><LanguageSelector variant="navbar" /></I18nProvider>);
    fireEvent.click(await screen.findByTestId('lang-selector-btn'));
    expect(await screen.findByTestId('lang-menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('lang-menu')).toBeNull();
  });
});
