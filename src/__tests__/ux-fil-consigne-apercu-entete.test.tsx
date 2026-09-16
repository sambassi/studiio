import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { Sparkles } from 'lucide-react';
import FilEtapes, { type Etape } from '@/components/ux/FilEtapes';
import Consigne from '@/components/ux/Consigne';
import ZoneApercu from '@/components/ux/ZoneApercu';
import EnteteSection from '@/components/ux/EnteteSection';

afterEach(cleanup);

const ETAPES: Etape[] = [
  { cle: 'source', libelle: 'Source', etat: 'terminee' },
  { cle: 'consentement', libelle: 'Consentement', etat: 'terminee' },
  { cle: 'entrainement', libelle: 'Entraînement', etat: 'active' },
  { cle: 'apercu', libelle: 'Aperçu', etat: 'a_venir' },
  { cle: 'validation', libelle: 'Validation', etat: 'a_venir' },
];

describe('FilEtapes', () => {
  it('⚠️ quatre états rendus et DITS ; l’active porte aria-current ; ligne compacte « Étape 3 sur 5 · … — Prochaine : … »', () => {
    render(<FilEtapes etapes={ETAPES} />);
    const etats = [...document.querySelectorAll('[data-etape]')].map((e) => e.getAttribute('data-etape-etat'));
    expect(etats).toEqual(['terminee', 'terminee', 'active', 'a_venir', 'a_venir']);
    expect(document.querySelector('[data-etape="entrainement"]')!.getAttribute('aria-current')).toBe('step');
    expect(document.querySelector('[data-etape="source"]')!.hasAttribute('aria-current')).toBe(false);
    expect(document.querySelector('[data-etape="source"]')!.textContent).toContain('Source, terminée');
    expect(document.querySelector('[data-etape="apercu"]')!.textContent).toContain('Aperçu, à venir');
    expect(document.querySelector('[data-fil-etapes-compact]')!.textContent).toBe('Étape 3 sur 5 · Entraînement — Prochaine : Aperçu');
    expect(screen.getByRole('navigation', { name: 'Étapes' })).toBeTruthy();
  });

  it('⚠️ « correction nécessaire » : icône d’alerte, aria-current, dit « à corriger »', () => {
    const avecCorrection = ETAPES.map((e) => (e.cle === 'entrainement' ? { ...e, etat: 'correction' as const } : e));
    render(<FilEtapes etapes={avecCorrection} />);
    const e = document.querySelector('[data-etape="entrainement"]')!;
    expect(e.getAttribute('data-etape-etat')).toBe('correction');
    expect(e.getAttribute('aria-current')).toBe('step');
    expect(e.textContent).toContain('correction nécessaire');
    expect(document.querySelector('[data-fil-etapes-compact]')!.textContent).toContain('à corriger');
  });

  it('⚠️ cliquable SEULEMENT si atteignable et onAller fourni ; jamais l’étape active ; clavier Entrée/Espace', () => {
    const aller = vi.fn();
    render(<FilEtapes etapes={ETAPES} atteignables={['source', 'consentement', 'entrainement']} onAller={aller} />);
    fireEvent.click(document.querySelector('[data-etape="source"]')!);
    fireEvent.click(document.querySelector('[data-etape="apercu"]')!);      // pas atteignable
    fireEvent.click(document.querySelector('[data-etape="entrainement"]')!); // active
    fireEvent.keyDown(document.querySelector('[data-etape="consentement"]')!, { key: 'Enter' });
    fireEvent.keyDown(document.querySelector('[data-etape="consentement"]')!, { key: ' ' });
    expect(aller.mock.calls.map((c) => c[0])).toEqual(['source', 'consentement', 'consentement']);
    expect(document.querySelector('[data-etape="source"]')!.getAttribute('role')).toBe('button');
    expect(document.querySelector('[data-etape="apercu"]')!.hasAttribute('role')).toBe(false);
    cleanup();
    render(<FilEtapes etapes={ETAPES} atteignables={['source']} />); // sans onAller : rien
    expect(document.querySelector('[data-etape="source"]')!.hasAttribute('role')).toBe(false);
  });

  it('les noms sont masqués sur mobile (classe sm) et la ligne compacte prend le relais ; `sansNoms` la montre partout', () => {
    render(<FilEtapes etapes={ETAPES} />);
    const nom = document.querySelector('[data-etape="source"] .hidden.sm\\:inline');
    expect(nom).not.toBeNull();
    expect(document.querySelector('[data-fil-etapes-compact]')!.className).toContain('sm:hidden');
    cleanup();
    render(<FilEtapes etapes={ETAPES} sansNoms />);
    expect(document.querySelector('[data-etape="source"] .sm\\:inline')).toBeNull();
    expect(document.querySelector('[data-fil-etapes-compact]')!.className).not.toContain('sm:hidden');
  });
});

describe('Consigne', () => {
  it('⚠️ titre + texte ; les conseils et la checklist sont REPLIÉS par défaut et s’ouvrent au clic (aria-expanded)', () => {
    render(<Consigne titre="Enregistrez-vous en lisant exactement cette phrase." texte="Courte vidéo, face caméra, voix claire." conseils={['Fond calme']} checklist={[{ libelle: 'Visage bien visible' }, { libelle: 'Nom prononcé', ok: true }, { libelle: 'Lumière', ok: false }]} />);
    expect(document.querySelector('[data-consigne-titre]')!.textContent).toBe('Enregistrez-vous en lisant exactement cette phrase.');
    expect(document.querySelector('[data-consigne-texte]')!.textContent).toBe('Courte vidéo, face caméra, voix claire.');
    expect(document.querySelector('[data-consigne-contenu]')).toBeNull();
    const repli = document.querySelector('[data-consigne-repli]')!;
    expect(repli.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(repli);
    expect(repli.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-conseils]')!.textContent).toContain('Fond calme');
    const points = [...document.querySelectorAll('[data-checklist-point]')].map((p) => p.getAttribute('data-checklist-point'));
    expect(points).toEqual(['info', 'ok', 'ko']);
    expect(document.querySelector('[data-checklist-point="ok"]')!.textContent).toContain('fait');
    expect(document.querySelector('[data-checklist-point="ko"]')!.textContent).toContain('à faire');
    fireEvent.click(repli);
    expect(document.querySelector('[data-consigne-contenu]')).toBeNull();
  });

  it('non repliable ou ouvert par défaut : le contenu est visible d’emblée ; sans conseils ni checklist, aucun bouton', () => {
    render(<Consigne titre="a" checklist={[{ libelle: 'x' }]} repliable={false} />);
    expect(document.querySelector('[data-consigne-repli]')).toBeNull();
    expect(document.querySelector('[data-checklist]')).not.toBeNull();
    cleanup();
    render(<Consigne titre="a" conseils={['y']} ouvertParDefaut />);
    expect(document.querySelector('[data-consigne-repli]')!.getAttribute('aria-expanded')).toBe('true');
    cleanup();
    render(<Consigne titre="Plus rien à faire pour l’instant." texte="Plusieurs minutes." />);
    expect(document.querySelector('[data-consigne-repli]')).toBeNull();
    expect(document.querySelector('[data-consigne-contenu]')).toBeNull();
  });
});

describe('ZoneApercu', () => {
  it('⚠️ vide : le message dit pourquoi, l’action propose la suite ; aucun média', () => {
    const agir = vi.fn();
    render(<ZoneApercu titre="Aperçu" etat={{ statut: 'vide', message: 'Rien à montrer encore — importez votre vidéo.', action: { libelle: 'Importer ma vidéo', onClick: agir } }} />);
    expect(document.querySelector('[data-apercu]')!.getAttribute('data-apercu')).toBe('vide');
    expect(document.querySelector('[data-apercu-message]')!.textContent).toContain('importez votre vidéo');
    expect(document.querySelector('[data-apercu-media]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Importer ma vidéo' }));
    expect(agir).toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('chargement : message + détail, rôle status', () => {
    render(<ZoneApercu etat={{ statut: 'chargement', message: 'Votre aperçu se prépare.', detail: 'Environ une minute.' }} />);
    expect(document.querySelector('[data-apercu]')!.getAttribute('data-apercu')).toBe('chargement');
    expect(document.querySelector('[data-apercu-detail]')!.textContent).toBe('Environ une minute.');
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('⚠️ erreur : rôle alert, message, détail, action de sortie', () => {
    const relancer = vi.fn();
    render(<ZoneApercu etat={{ statut: 'erreur', message: 'L’aperçu n’a pas pu être généré.', detail: 'Vous pouvez le relancer sans frais.', action: { libelle: 'Relancer l’aperçu', onClick: relancer } }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Relancer l’aperçu' }));
    expect(relancer).toHaveBeenCalled();
  });

  it('⚠️ prêt : le média fourni est rendu, la légende et l’action suivante (principale) + secondaires', () => {
    const suivante = vi.fn(); const secondaire = vi.fn();
    render(
      <ZoneApercu etat={{ statut: 'pret', legende: 'Votre avatar, v2', actionSuivante: { libelle: 'Valider mon avatar', onClick: suivante }, actionsSecondaires: [{ libelle: 'Relancer', onClick: secondaire }] }}>
        <video data-testid="media" src="https://studiio.pro/x.mp4" />
      </ZoneApercu>,
    );
    expect(document.querySelector('[data-apercu-media] [data-testid="media"]')).not.toBeNull();
    expect(document.querySelector('[data-apercu-legende]')!.textContent).toBe('Votre avatar, v2');
    expect(screen.getByRole('button', { name: 'Valider mon avatar' }).className).toContain('button-primary');
    expect(screen.getByRole('button', { name: 'Relancer' }).className).toContain('button-ghost');
    fireEvent.click(screen.getByRole('button', { name: 'Valider mon avatar' }));
    expect(suivante).toHaveBeenCalled();
    expect(document.querySelector('[data-apercu-message]')).toBeNull();
  });

  it('le média n’est jamais rendu hors de l’état prêt', () => {
    render(<ZoneApercu etat={{ statut: 'vide', message: 'x' }}><video data-testid="media" /></ZoneApercu>);
    expect(document.querySelector('[data-testid="media"]')).toBeNull();
  });
});

describe('EnteteSection', () => {
  it('⚠️ titre h1, sous-titre, icône, statut (badge dit et typé), retour et actions', () => {
    const retour = vi.fn();
    render(
      <EnteteSection titre="Mon avatar" sousTitre="Votre double vidéo." icone={<Sparkles />} statut={{ libelle: 'À valider', niveau: 'avertissement' }} retour={{ libelle: 'Revenir au choix des modes', onClick: retour }} actions={<a href="#aide">Aide</a>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Mon avatar' })).toBeTruthy();
    expect(document.querySelector('[data-entete-sous-titre]')!.textContent).toBe('Votre double vidéo.');
    expect(document.querySelector('[data-entete-statut]')!.getAttribute('data-entete-statut')).toBe('avertissement');
    expect(document.querySelector('[data-entete-statut]')!.textContent).toBe('À valider');
    fireEvent.click(screen.getByRole('button', { name: /Revenir au choix des modes/ }));
    expect(retour).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Aide' })).toBeTruthy();
  });

  it('minimal : titre seul (h2 sur demande), ni actions ni statut', () => {
    render(<EnteteSection titre="Autopilote" niveauTitre={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Autopilote' })).toBeTruthy();
    expect(document.querySelector('[data-entete-actions]')).toBeNull();
    expect(document.querySelector('[data-entete-statut]')).toBeNull();
  });
});
