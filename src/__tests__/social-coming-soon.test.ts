import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * YouTube et TikTok en attente.
 *
 * L'exigence tient en une phrase : c'est un **masquage d'interface
 * réversible**. Rien ne doit être supprimé — ni clé d'API, ni jeton, ni
 * compte déjà connecté — et retirer une entrée d'un ensemble doit suffire à
 * rouvrir la plateforme. Ces tests gardent surtout ce qui pourrait être
 * cassé sans qu'on s'en aperçoive : Facebook et Instagram restent
 * connectables, et un serveur muet ne fait disparaître aucun bouton.
 */

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');
const route = src('app/api/social/status/route.ts');
const page = src('app/dashboard/social/page.tsx');

const messages = (locale: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../messages', `${locale}.json`), 'utf-8'));

describe('La mise en attente est décidée par le serveur', () => {
  it('ne met en attente que YouTube et TikTok', () => {
    expect(route).toMatch(/const ON_HOLD = new Set\(\['youtube', 'tiktok'\]\)/);
  });

  it('les quatre plateformes annoncent leur disponibilité', () => {
    for (const p of ['instagram', 'facebook', 'tiktok', 'youtube']) {
      expect(route, p).toContain(`available: !ON_HOLD.has('${p}')`);
    }
  });

  it('Facebook et Instagram restent connectables', () => {
    // La régression la plus coûteuse serait de les emporter avec.
    const onHold = /new Set\(\[([^\]]*)\]\)/.exec(route)![1];
    expect(onHold).not.toMatch(/instagram/);
    expect(onHold).not.toMatch(/facebook/);
  });

  it('ne supprime ni compte, ni jeton, ni clé', () => {
    // Les plateformes en attente continuent d'exposer leur état de
    // connexion : la mise en attente n'efface rien, elle masque.
    for (const p of ['tiktok', 'youtube']) {
      const bloc = route.slice(route.indexOf(`      ${p}: {`), route.indexOf('},', route.indexOf(`      ${p}: {`)));
      expect(bloc, p).toContain(`connected: !!dbMap.${p}`);
      expect(bloc, p).toContain('username:');
      expect(bloc, p).toContain('oauthAvailable:');
    }
    // Et aucune suppression n'a été introduite dans cette route.
    expect(route).not.toMatch(/\.delete\(|DELETE|removeItem/);
  });

  it('suit le motif déjà en place pour afroboost.com', () => {
    expect(route).toMatch(/'afroboost\.com': \{ available: false \}/);
  });
});

describe('L’interface ne masque jamais par accident', () => {
  it('sans information du serveur, la plateforme reste connectable', () => {
    // Un serveur plus ancien, ou une réponse partielle, ne doit pas faire
    // disparaître les boutons de connexion.
    expect(page).toMatch(/availableMap\[platform\] = info\.available \?\? true;/);
    expect(page).toMatch(/const comingSoon = !\(availability\[platform\.id\] \?\? true\);/);
  });

  it('remplace le bouton de connexion par le message d’attente', () => {
    expect(page).toMatch(/\{comingSoon \? \(/);
    expect(page).toMatch(/t\('comingSoonHint', \{ platform: platform\.name \}\)/);
  });

  it('laisse la déconnexion à qui est déjà connecté', () => {
    // Mettre une plateforme en attente ne doit pas piéger un utilisateur
    // qui l'avait connectée : rien n'est retiré dans son dos.
    // Borne prise APRES le bloc : `</CardContent>` apparaît plus haut dans
    // le fichier, une borne naïve rendait une tranche vide — et le test
    // passait alors sans rien vérifier.
    const from = page.indexOf('{isConnected && (');
    expect(from).toBeGreaterThan(-1);
    const bloc = page.slice(from, page.indexOf('</CardContent>', from));
    expect(bloc.length).toBeGreaterThan(0);
    expect(bloc).toContain("t('actions.disconnect')");
    expect(bloc).not.toContain('comingSoon');
  });

  it('n’affiche plus les avertissements devenus hors sujet', () => {
    // « OAuth non configuré » ou l'avis TikTok n'ont aucun sens sur une
    // plateforme qu'on ne propose plus.
    expect(page).toMatch(/\{!comingSoon && 'notice' in platform/);
    expect(page).toMatch(/\{!comingSoon && !hasOAuth && !isConnected/);
  });

  it('utilise une icône lucide, pas un emoji', () => {
    expect(page).toMatch(/^ {2}Clock,$/m);
    const bloc = page.slice(page.indexOf('comingSoon ? ('), page.indexOf('platformDescription'));
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bloc)).toBe(false);
  });
});

describe('Traductions', () => {
  it.each(['fr', 'en', 'de'])('%s porte les deux libellés', (locale) => {
    const m = messages(locale);
    expect(typeof m.social.status.comingSoon).toBe('string');
    expect(m.social.status.comingSoon.length).toBeGreaterThan(0);
    expect(typeof m.social.comingSoonHint).toBe('string');
    // L'interpolation du nom de plateforme doit survivre à la traduction.
    expect(m.social.comingSoonHint).toContain('{platform}');
  });

  it('n’a pas cassé les libellés existants', () => {
    for (const locale of ['fr', 'en', 'de']) {
      const s = messages(locale).social.status;
      expect(typeof s.connected).toBe('string');
      expect(typeof s.ready).toBe('string');
      expect(typeof s.oauthNotConfigured).toBe('string');
    }
  });
});

describe('Réversible', () => {
  it('rouvrir une plateforme tient en une entrée retirée', () => {
    // Toute la mise en attente passe par cet ensemble : il n'existe aucun
    // autre endroit à défaire.
    const occurrences = page.match(/comingSoon/g) || [];
    expect(occurrences.length).toBeGreaterThan(0);
    // Côté serveur, une seule déclaration décide.
    expect(route.match(/ON_HOLD = new Set/g)).toHaveLength(1);
    // Et le client ne code en dur aucun nom de plateforme.
    expect(page).not.toMatch(/comingSoon.*'youtube'|'youtube'.*comingSoon/);
    expect(page).not.toMatch(/comingSoon.*'tiktok'|'tiktok'.*comingSoon/);
  });
});
