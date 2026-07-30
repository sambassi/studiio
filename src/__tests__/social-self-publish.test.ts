import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * « Télécharger pour publier » — présence sur les quatre réseaux, et surtout
 * NON-RÉGRESSION de la connexion automatique.
 *
 * Le risque de cette PR n'est pas d'oublier un bouton : c'est de remplacer,
 * par mégarde, la connexion Facebook/Instagram par ce chemin manuel. Les
 * assertions ci-dessous verrouillent la coexistence des deux.
 */

const root = resolve(__dirname, '../..');
const page = readFileSync(resolve(root, 'src/app/dashboard/social/page.tsx'), 'utf-8');
const locales = ['fr', 'en', 'de'] as const;

describe('Bloc « Publier vous-même » dans la page Réseaux', () => {
  it('est rendu dans la carte de chaque plateforme, donc pour les quatre réseaux', () => {
    // Les cartes sont produites par un seul `PLATFORMS.map` : un bloc placé
    // dedans vaut pour les quatre. On vérifie qu'il y est bien une seule fois,
    // et à l'intérieur du map.
    expect(page.split("t('selfPublish.cta')").length - 1).toBe(1);
    const iMap = page.indexOf('PLATFORMS.map');
    const iBloc = page.indexOf("t('selfPublish.title')");
    expect(iMap).toBeGreaterThan(-1);
    expect(iBloc).toBeGreaterThan(iMap);
  });

  it('affiche les trois étapes, dans l ordre', () => {
    const i1 = page.indexOf("selfPublish.step1");
    const i2 = page.indexOf("selfPublish.step2");
    const i3 = page.indexOf("selfPublish.step3");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it('mène au téléchargement existant, sans réinventer de route', () => {
    expect(page).toContain('href="/dashboard/library"');
  });

  it('NE REMPLACE PAS la connexion automatique', () => {
    // Les boutons de connexion / reconnexion / déconnexion doivent survivre :
    // Facebook et Instagram gardent leur chemin automatique pour le
    // propriétaire du compte.
    for (const key of ['actions.connect', 'actions.reconnect', 'actions.disconnect']) {
      expect(page, key).toContain(`t('${key}'`);
    }
    expect(page).toContain('handleConnect(platform.id)');
    expect(page).toContain('handleDisconnect(platform.id)');
  });

  it("s'affiche aussi pour une plateforme « bientôt disponible »", () => {
    // Le bloc est hors du ternaire `comingSoon ? … : …` — sinon YouTube et
    // TikTok, justement les deux en attente, ne l'auraient jamais vu.
    const iComingSoon = page.indexOf("t('comingSoonHint'");
    const iBloc = page.indexOf("t('selfPublish.title')");
    expect(iBloc).toBeGreaterThan(iComingSoon);
  });

  it('utilise une icône lucide, aucun emoji', () => {
    const bloc = page.slice(page.indexOf("t('selfPublish.title')") - 600, page.indexOf("t('selfPublish.cta')") + 200);
    expect(bloc).toContain('<Download');
    // Plage des emojis : rien de tel dans le bloc.
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bloc)).toBe(false);
  });
});

describe('Traductions', () => {
  it('les six clés existent dans les trois langues', () => {
    for (const loc of locales) {
      const messages = JSON.parse(readFileSync(resolve(root, `messages/${loc}.json`), 'utf-8'));
      const sp = messages.social?.selfPublish;
      expect(sp, loc).toBeTruthy();
      for (const key of ['title', 'intro', 'step1', 'step2', 'step3', 'cta']) {
        expect(typeof sp[key], `${loc}.${key}`).toBe('string');
        expect(sp[key].length, `${loc}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('les libellés qui citent le réseau portent bien le paramètre {platform}', () => {
    for (const loc of locales) {
      const messages = JSON.parse(readFileSync(resolve(root, `messages/${loc}.json`), 'utf-8'));
      const sp = messages.social.selfPublish;
      expect(sp.intro, loc).toContain('{platform}');
      expect(sp.step2, loc).toContain('{platform}');
    }
  });

  it('aucune traduction ne contient d emoji', () => {
    for (const loc of locales) {
      const messages = JSON.parse(readFileSync(resolve(root, `messages/${loc}.json`), 'utf-8'));
      const values = Object.values(messages.social.selfPublish) as string[];
      for (const v of values) {
        expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v), `${loc}: ${v}`).toBe(false);
      }
    }
  });
});
