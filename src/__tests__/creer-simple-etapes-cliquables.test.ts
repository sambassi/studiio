import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Puces d'étapes cliquables — Mode simple.
 *
 * Le fil d'étapes n'était qu'un indicateur : revenir sur « Sujet » depuis
 * « Contenu » demandait trois clics sur « Retour ».
 *
 * Deux règles commandent l'implémentation, et toutes deux échouent en
 * silence si on les oublie :
 *
 * 1. **On ne saute pas vers une étape jamais atteinte.** Passer de « Sujet »
 *    à « Contenu » court-circuiterait `ensureGenerated()` : l'écran
 *    s'afficherait vide, sans contenu ni génération en cours.
 * 2. **Le repère est l'étape la plus AVANCÉE atteinte, pas l'étape
 *    courante.** Avec `i <= step`, revenir sur « Sujet » ramènerait `step` à
 *    0 et interdirait de repartir vers « Contenu » — soit exactement la
 *    navigation que ces puces existent pour offrir.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

/** Le corps de la règle d'accessibilité, isolé. */
const regle = wizard.slice(
  wizard.indexOf('const stepReachable = (i: number): boolean => {'),
  wizard.indexOf('const stepReachable = (i: number): boolean => {') + 260,
);

describe('Le repère est l étape la plus AVANCÉE, pas la courante', () => {
  it('un repère dédié existe, et ne redescend jamais', () => {
    expect(wizard).toContain('const [maxStepReached, setMaxStepReached] = useState(0);');
    expect(wizard).toContain('setMaxStepReached((m) => (step > m ? step : m));');
  });

  it('la règle se lit sur ce repère, pas sur `step`', () => {
    // `i <= step` interdirait de repartir en avant après un retour arrière.
    expect(regle).toContain('if (i > maxStepReached) return false;');
    expect(regle).not.toContain('i > step');
  });

  it('il repart de zéro avec un nouveau montage', () => {
    const debut = wizard.indexOf('const reset = ()');
    const reset = wizard.slice(debut, wizard.indexOf('\n  };', debut));
    expect(reset).toContain('setMaxStepReached(0);');
  });
});

describe('« Envoi » suit la même règle que le bouton qui y mène', () => {
  it('elle exige un contenu généré et aucune génération en cours', () => {
    // Sinon les puces ouvriraient une porte que le bouton tient fermée.
    expect(regle).toContain('if (i === S.envoi) return !!generated && !generating;');
  });

  it('le bouton « Continuer » porte bien la même condition', () => {
    expect(wizard).toContain('disabled={generating || !generated}');
  });
});

describe('L étape courante n est pas un bouton', () => {
  it('y aller ne ferait rien : on ne l annonce pas comme cliquable', () => {
    expect(wizard).toContain('const cliquable = atteignable && i !== step;');
  });

  it('le saut est refusé si l étape ne l est pas', () => {
    // Double garde : le handler ne fait pas confiance au seul rendu.
    expect(wizard).toContain('const aller = () => { if (cliquable) setStep(i); };');
  });
});

describe('L interactivité', () => {
  it('la puce entière est cliquable — pastille ET libellé', () => {
    const bloc = wizard.slice(wizard.indexOf('{STEPS.map((label, i) => {'), wizard.indexOf('data-step={i}'));
    expect(bloc).toContain('onClick: aller,');
    expect(bloc).toContain("role: 'button',");
  });

  it('elle est atteignable au clavier', () => {
    expect(wizard).toContain('tabIndex: 0,');
    expect(wizard).toContain("if (e.key === 'Enter' || e.key === ' ') {");
  });

  it('l espace ne fait pas défiler la page', () => {
    const bloc = wizard.slice(wizard.indexOf("if (e.key === 'Enter' || e.key === ' ') {"));
    expect(bloc.slice(0, 220)).toContain('e.preventDefault();');
  });

  it('une étape hors d atteinte n a NI rôle NI gestionnaire', () => {
    // Un `role="button"` sur un élément inerte annoncerait un bouton mort
    // aux lecteurs d'écran.
    expect(wizard).toContain(": { 'aria-disabled': true })}");
  });

  it('le curseur dit ce qui est possible', () => {
    expect(wizard).toContain("'cursor-pointer hover:brightness-125");
    expect(wizard).toContain(": 'cursor-not-allowed'");
  });

  it('le focus est visible', () => {
    expect(wizard).toContain('focus-visible:ring-2 focus-visible:ring-purple-400');
  });

  it('chaque puce est nommée pour les lecteurs d écran', () => {
    expect(wizard).toContain("'aria-label': `Aller à l’étape ${label}`,");
  });
});

describe('L apparence ne change pas', () => {
  it('la pastille garde son style accent / gris', () => {
    expect(wizard).toContain(`i <= step
                          ? { backgroundColor: accent, color: '#fff' }
                          : { backgroundColor: '#1F2937', color: '#6B7280' }`);
  });

  it('les étapes passées gardent leur coche', () => {
    expect(wizard).toContain('{i < step ? <Check className="w-3 h-3" /> : i + 1}');
  });

  it('le libellé de l étape courante reste blanc', () => {
    expect(wizard).toContain(
      "`text-[11px] truncate ${i === step ? 'text-white font-medium' : 'text-gray-500'}`",
    );
  });

  it('le trait de liaison est inchangé', () => {
    expect(wizard).toContain("style={{ backgroundColor: i < step ? accent : '#1F2937' }}");
  });
});

describe('Les boutons Retour / Suivant ne bougent pas', () => {
  it('ils appellent toujours setStep directement', () => {
    for (const appel of [
      'onClick={() => setStep(S.sujet)}',
      'onClick={() => setStep(S.style)}',
      'onClick={() => setStep(S.audio)}',
      'onClick={() => setStep(S.contenu)}',
      'onClick={() => setStep(S.envoi)}',
    ]) {
      expect(wizard, appel).toContain(appel);
    }
  });
});
