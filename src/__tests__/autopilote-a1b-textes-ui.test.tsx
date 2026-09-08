/**
 * A_1b — LES TEXTES DEVIENNENT SAISISSABLES.
 *
 * ---------------------------------------------------------------------------
 * LE DÉFAUT QUE CE LOT FERME
 * ---------------------------------------------------------------------------
 *
 * A_1 a appris au moteur à dessiner l'accroche, le texte secondaire, le texte
 * de fin, le CTA et le lien. Mais AUCUN écran ne permettait de les saisir :
 * `texte.titre` était persisté et inatteignable, et `appelAction.texte`
 * n'avait de surface d'édition nulle part dans l'application. Une
 * fonctionnalité qu'on ne peut pas atteindre n'existe pas.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : que l'écran et le moteur ne
 * puissent pas diverger. L'aperçu appelle `preparerCouches`, la fonction que
 * le rendu utilise — pas une copie de ses règles. Un aperçu qui recopierait
 * les règles finirait par montrer un texte que le rendu ne produit plus, et
 * personne ne s'en apercevrait avant d'ouvrir le MP4.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PROFIL_CREATIF_DEFAUT, type ProfilCreatifAutopilote,
} from '@/lib/autopilot/analyse/profil-creatif';
import { LONGUEURS_MAX } from '@/lib/autopilot/analyse/rendu-texte';
import { STYLES_TEXTE } from '@/lib/creatif/styles-texte';

const MonStylePanel = (await import('@/components/creer/MonStylePanel')).default;
const ApercuStyleTexte = (await import('@/components/creer/ApercuStyleTexte')).default;

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const PANEL = lire('src/components/creer/MonStylePanel.tsx');
const APERCU = lire('src/components/creer/ApercuStyleTexte.tsx');

const profil = (over: Partial<ProfilCreatifAutopilote> = {}): ProfilCreatifAutopilote => ({
  ...PROFIL_CREATIF_DEFAUT, ...over,
} as ProfilCreatifAutopilote);

function monter(props: Record<string, unknown> = {}) {
  const enregistrer = vi.fn(async () => true);
  const enregistrerAppel = vi.fn(async () => true);
  const vue = render(
    <MonStylePanel
      profilEnregistre={profil()}
      chargement={false}
      onEnregistrer={enregistrer}
      onEnregistrerAppelAction={enregistrerAppel}
      appelActionEnregistre={{ texte: null, destination: null }}
      {...props}
    />,
  );
  return { vue, enregistrer, enregistrerAppel };
}

const ouvrirPanneau = () => fireEvent.click(document.querySelector('[data-mon-style-toggle]')!);
const ouvrirTextes = () => fireEvent.click(document.querySelector('[data-mon-style-textes-toggle]')!);
const champ = (m: string) => document.querySelector(`[data-mon-style-champ="${m}"]`) as HTMLInputElement;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La section existe et se replie', () => {
  it('1.1 « Textes & appel à l’action » est visible dans Style', () => {
    monter();
    ouvrirPanneau();
    expect(document.querySelector('[data-mon-style-textes]')).not.toBeNull();
    expect(document.body.textContent).toContain('Textes & appel à l’action');
  });

  it('1.2 elle est repliée par défaut — le panneau ne devient pas interminable', () => {
    monter();
    ouvrirPanneau();
    expect(champ('accroche')).toBeNull();
    expect(document.querySelector('[data-mon-style-textes-toggle]')
      ?.getAttribute('aria-expanded')).toBe('false');
  });

  it('1.3 dépliée, les trois champs de texte apparaissent', () => {
    monter();
    ouvrirPanneau();
    ouvrirTextes();
    for (const m of ['accroche', 'secondaire', 'fin']) {
      expect(champ(m), m).not.toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les champs écrivent dans le profil existant', () => {
  it('2.1 l’accroche est éditable et part dans `texte.titre`', async () => {
    const { enregistrer } = monter();
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.change(champ('accroche'), { target: { value: 'Bouge. Danse.' } });
    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    await waitFor(() => expect(enregistrer).toHaveBeenCalled());
    expect(enregistrer.mock.calls[0][0].texte.titre).toBe('Bouge. Danse.');
  });

  it('2.2 écrire un texte ACTIVE le bloc', () => {
    /* ⚠️ SANS CELA, ON TAPE UN TEXTE QUI NE S'AFFICHE PAS. Demander en plus
       de cocher une case ferait chercher pourquoi la vidéo sort muette. */
    const { enregistrer } = monter();
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.change(champ('accroche'), { target: { value: 'Salut' } });
    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    expect(enregistrer.mock.calls[0][0].texte.actif).toBe(true);
  });

  it('2.3 un champ vidé redevient `null`, jamais une chaîne vide', () => {
    const { enregistrer } = monter({
      profilEnregistre: profil({
        texte: { ...PROFIL_CREATIF_DEFAUT.texte, actif: true, titre: 'Ancien' },
      }),
    });
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.change(champ('accroche'), { target: { value: '' } });
    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    expect(enregistrer.mock.calls[0][0].texte.titre).toBeNull();
  });

  it('2.4 aucun second contrat n’a été inventé', () => {
    // Les champs écrivent dans `texte`, `typographie`, `couleurs` — ceux qui
    // existaient déjà et que le moteur lit.
    for (const interdit of ['textSettings', 'ctaSettingsNew', 'brandingV2']) {
      expect(PANEL, interdit).not.toContain(interdit);
    }
    expect(PANEL).toContain('...brouillon.texte');
    expect(PANEL).toContain('...brouillon.typographie');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les bornes préviennent avant le rendu', () => {
  it('3.1 la saisie est bornée à la limite du serveur', () => {
    /* Le serveur TRONQUE silencieusement : sans borne ici, la coupe se
       découvrirait dans le MP4 fini. */
    monter();
    ouvrirPanneau();
    ouvrirTextes();
    expect(champ('accroche').maxLength).toBe(LONGUEURS_MAX.hook);
    expect(champ('fin').maxLength).toBe(LONGUEURS_MAX.fin);
  });

  it('3.2 un compteur montre où on en est', () => {
    monter();
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.change(champ('accroche'), { target: { value: 'abc' } });
    expect(document.body.textContent).toContain(`3 / ${LONGUEURS_MAX.hook}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le CTA : sa forme ici, son message dans l’objectif', () => {
  const avecCta = () => monter({
    profilEnregistre: profil({
      ctaVisuel: { ...PROFIL_CREATIF_DEFAUT.ctaVisuel, actif: true },
    }),
  });

  it('4.1 CTA inactif → aucun champ de message', () => {
    monter();
    ouvrirPanneau();
    ouvrirTextes();
    expect(champ('cta-texte')).toBeNull();
    expect(champ('cta-lien')).toBeNull();
  });

  it('4.2 CTA actif → texte et lien saisissables', () => {
    avecCta();
    ouvrirPanneau();
    ouvrirTextes();
    expect(champ('cta-texte')).not.toBeNull();
    expect(champ('cta-lien')).not.toBeNull();
  });

  it('4.3 le message est enregistré dans l’OBJECTIF, pas dans le profil', async () => {
    /* ⚠️ LA FRONTIÈRE QUE LE DÉPÔT TIENT DEPUIS TOUJOURS : changer « Réserve
       ta place » ne doit pas rejouer un style, et changer une couleur ne doit
       pas rejouer un montage. Le champ se règle ici, il s'écrit là-bas. */
    const { enregistrer, enregistrerAppel } = avecCta();
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.change(champ('cta-texte'), { target: { value: 'Réserve ton cours' } });
    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    // ⚠️ LA SAUVEGARDE EST ASYNCHRONE : le profil part d'abord, l'objectif
    // ensuite. Mesurer sans attendre lisait l'état d'avant le second appel.
    await waitFor(() => expect(enregistrerAppel).toHaveBeenCalled());
    expect(enregistrerAppel).toHaveBeenCalledWith(
      expect.objectContaining({ texte: 'Réserve ton cours' }),
    );
    expect(JSON.stringify(enregistrer.mock.calls[0][0])).not.toContain('Réserve ton cours');
  });

  it('4.4 un seul geste enregistre les deux', async () => {
    const { enregistrer, enregistrerAppel } = avecCta();
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.change(champ('cta-lien'), { target: { value: 'afroboost.com' } });
    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    await waitFor(() => expect(enregistrerAppel).toHaveBeenCalledTimes(1));
    expect(enregistrer).toHaveBeenCalledTimes(1);
  });

  it('4.5 sans changement de message, l’objectif n’est PAS réécrit', () => {
    // Réécrire l'objectif à chaque sauvegarde de style ferait bouger sa date
    // de mise à jour sans raison, et rejouerait son identité pour rien.
    const { enregistrerAppel } = avecCta();
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    expect(enregistrerAppel).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Des choix contrôlés, jamais libres', () => {
  it('5.1 la typographie se choisit par STYLE, plus par réglages séparés', () => {
    /* ⚠️ CE TEST A CHANGÉ DE SUJET AU LOT A_3b, ET C'EST LE POINT.
       Il tenait « trois polices et deux graisses, dans des boutons ». Choisir
       une police, puis une graisse, puis une taille, puis une ombre, c'est
       reconstruire un style à chaque vidéo — et laisser deux réglages
       contradictoires cohabiter à l'écran. La bibliothèque les porte
       ensemble ; le choix reste tout aussi CONTRÔLÉ, il est juste devenu
       utile. */
    monter();
    ouvrirPanneau();
    ouvrirTextes();
    expect(document.querySelector('[data-bibliotheque-styles]')).not.toBeNull();
    expect(document.querySelector('[data-mon-style-police="serif"]')).toBeNull();
    expect(document.querySelector('[data-mon-style-graisse="grasse"]')).toBeNull();
  });

  it('5.2 choisir un style écrit un identifiant du catalogue', () => {
    const { enregistrer } = monter();
    ouvrirPanneau();
    ouvrirTextes();
    fireEvent.click(document.querySelector('[data-styles-rayon="tout"]')!);
    fireEvent.click(document.querySelector('[data-style-carte="editorial"]')!);
    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    expect(enregistrer.mock.calls[0][0].typographie.styleTexteId).toBe('editorial');
  });

  it('5.2bis chaque style ne porte que des valeurs que le moteur rend', () => {
    // Police parmi les trois familles serveur, graisse parmi les deux que
    // `drawtext` sait ouvrir : le catalogue ne peut pas inventer.
    for (const st of STYLES_TEXTE) {
      expect(['sans', 'serif', 'mono'], st.id).toContain(st.police);
      expect(['normale', 'grasse'], st.id).toContain(st.graisse);
    }
  });

  it('5.3 trois positions seulement — celles du contrat', () => {
    monter();
    ouvrirPanneau();
    ouvrirTextes();
    const positions = document.querySelectorAll('[data-mon-style-texte-position]');
    expect(positions).toHaveLength(3);
    expect(document.querySelector('[data-mon-style-texte-position="haut-gauche"]')).toBeNull();
  });

  it('5.4 la graisse vit dans le style, et reste bornée', () => {
    // Elle n'est plus un bouton à part : elle fait partie du preset, et
    // n'accepte toujours que ce que le moteur sait ouvrir.
    const graisses = new Set(STYLES_TEXTE.map((st) => st.graisse));
    expect([...graisses].sort()).toEqual(['grasse', 'normale']);
  });

  it('5.5 le timing est en secondes, borné par des curseurs', () => {
    monter();
    ouvrirPanneau();
    ouvrirTextes();
    const debut = document.querySelector('[data-mon-style-texte-debut]') as HTMLInputElement;
    const duree = document.querySelector('[data-mon-style-texte-duree]') as HTMLInputElement;
    expect(debut.type).toBe('range');
    expect(Number(debut.min)).toBe(0);
    expect(Number(duree.min)).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. L’aperçu ne peut pas diverger du moteur', () => {
  it('6.1 il APPELLE `preparerCouches`, il ne la recopie pas', () => {
    /* ⚠️ LA GARANTIE STRUCTURELLE DU LOT. Si le moteur cesse de dessiner une
       couche, elle disparaît ici aussi, sans qu'une ligne de l'aperçu ait à
       le savoir. */
    expect(APERCU).toContain("from '@/lib/autopilot/analyse/rendu-texte'");
    expect(APERCU).toContain('preparerCouches({');
    expect(APERCU).toContain('positionY(');
  });

  it('6.2 il montre l’accroche saisie', () => {
    render(
      <ApercuStyleTexte
        profil={profil({
          texte: { ...PROFIL_CREATIF_DEFAUT.texte, actif: true, titre: 'Bouge. Danse.' },
        })}
        appelAction={null}
        format="9:16"
        marges={{ hautPct: 5, basPct: 8, gauchePct: 5, droitePct: 5 }}
        dureeSecondes={30}
      />,
    );
    expect(document.querySelector('[data-apercu-couche="hook"]')?.textContent)
      .toBe('Bouge. Danse.');
  });

  it('6.3 il montre le CTA et son lien quand ils existent', () => {
    render(
      <ApercuStyleTexte
        profil={profil({
          ctaVisuel: { ...PROFIL_CREATIF_DEFAUT.ctaVisuel, actif: true },
        })}
        appelAction={{ texte: 'Réserve', destination: 'afroboost.com' }}
        format="9:16"
        marges={{ hautPct: 5, basPct: 8, gauchePct: 5, droitePct: 5 }}
        dureeSecondes={30}
      />,
    );
    expect(document.querySelector('[data-apercu-couche="cta"]')?.textContent).toBe('Réserve');
    expect(document.querySelector('[data-apercu-couche="lien"]')?.textContent)
      .toBe('afroboost.com');
    expect(document.querySelector('[data-apercu-bandeau]')).not.toBeNull();
  });

  it('6.4 rien de configuré → il le dit, il n’invente pas', () => {
    render(
      <ApercuStyleTexte
        profil={profil()} appelAction={null} format="9:16"
        marges={{ hautPct: 0, basPct: 0, gauchePct: 0, droitePct: 0 }}
        dureeSecondes={30}
      />,
    );
    expect(document.querySelector('[data-apercu-vide]')).not.toBeNull();
    expect(document.querySelector('[data-apercu-couche]')).toBeNull();
  });

  it('6.5 les trois formats changent la géométrie', () => {
    for (const f of ['9:16', '1:1', '16:9']) {
      cleanup();
      render(
        <ApercuStyleTexte
          profil={profil({
            texte: { ...PROFIL_CREATIF_DEFAUT.texte, actif: true, titre: 'X' },
          })}
          appelAction={null} format={f}
          marges={{ hautPct: 5, basPct: 8, gauchePct: 5, droitePct: 5 }}
          dureeSecondes={30}
        />,
      );
      const cadre = document.querySelector('[data-apercu-style]') as HTMLElement;
      expect(cadre.getAttribute('data-apercu-format'), f).toBe(f);
      expect(cadre.style.aspectRatio, f).not.toBe('');
    }
  });

  it('6.6 le texte reste dans les marges sûres', () => {
    render(
      <ApercuStyleTexte
        profil={profil({
          texte: {
            ...PROFIL_CREATIF_DEFAUT.texte, actif: true, titre: 'Bas', position: 'bas',
          },
        })}
        appelAction={null} format="9:16"
        marges={{ hautPct: 10, basPct: 20, gauchePct: 5, droitePct: 5 }}
        dureeSecondes={30}
      />,
    );
    const t = document.querySelector('[data-apercu-couche="hook"]') as HTMLElement;
    const top = Number.parseFloat(t.style.top);
    expect(top).toBeGreaterThanOrEqual(10);
    expect(top).toBeLessThanOrEqual(80);
  });

  it('6.7 il ne promet PAS le rendu final', () => {
    /* Une fausse promesse coûte plus cher qu'une absence : chaque écart
       passerait pour un bug. */
    render(
      <ApercuStyleTexte
        profil={profil()} appelAction={null} format="9:16"
        marges={{ hautPct: 0, basPct: 0, gauchePct: 0, droitePct: 0 }}
        dureeSecondes={30}
      />,
    );
    expect(document.body.textContent).toContain('Aperçu du style');
    expect(document.body.textContent).not.toContain('Rendu final');
    expect(document.body.textContent).toContain('animations n’y sont pas encore');
  });

  it('6.8 il n’annonce ni animation, ni LUT, ni sous-titres', () => {
    for (const interdit of ['fade', 'typewriter', 'lut3d', 'sous-titres automatiques']) {
      expect(APERCU.toLowerCase(), interdit).not.toContain(interdit.toLowerCase());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Le contrat écran ↔ moteur', () => {
  it('7.1 l’écran écrit ce que le moteur lit — mêmes chemins', () => {
    const moteur = lire('src/lib/autopilot/analyse/rendu-texte.ts');
    for (const chemin of ['texte.titre', 'texte.sousTitre', 'texte.libre']) {
      const [bloc, champLu] = chemin.split('.');
      expect(moteur, chemin).toContain(`p.${bloc}.${champLu}`);
      expect(PANEL, chemin).toContain(`${champLu}:`);
    }
  });

  it('7.2 l’automatique lit exactement le même profil', () => {
    const auto = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
    expect(auto).toContain('lireProfilCreatifUtilisateur');
    expect(auto).toContain('objectif.appelAction');
  });

  it('7.3 A_1 reste intact', () => {
    const rendu = lire('src/lib/autopilot/analyse/rendu.ts');
    expect(rendu).toContain('preparerCouches({');
    expect(lire('src/lib/autopilot/analyse/rendu-style.ts')).toContain('filtreDrawtext({');
  });
});
