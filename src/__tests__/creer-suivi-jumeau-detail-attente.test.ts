import { describe, it, expect } from 'vitest';
import { detailSuiviJumeau, DETAIL_PHASE_JUMEAU, MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR } from '@/lib/creer/jumeau';

/**
 * Le suivi recevait bien `enAttente: 'fournisseur'` (B3) et posait le message
 * d'attente dans l'étape courante — mais le bloc de progression affichait
 * toujours le texte fixe de la phase « Traitement » : « en cours (5 à 20 min) »
 * pendant une attente qui peut durer 6 h. Constaté sur la pile locale de
 * preuve « Créer avec avatar » (solde fournisseur simulé épuisé).
 */
describe('Suivi du jumeau — le détail affiché', () => {
  it('⚠️ attente fournisseur pendant « Traitement » → le message d’attente, pas « 5 à 20 min »', () => {
    expect(detailSuiviJumeau('traitement', MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR)).toBe(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR);
  });

  it('connexion instable pendant « Traitement » → dite telle quelle', () => {
    const m = 'Connexion instable — nouvelle tentative de lecture du statut…';
    expect(detailSuiviJumeau('traitement', m)).toBe(m);
  });

  it('autre étape posée (texte de lancement, étape périmée) → le texte de la phase, comme avant', () => {
    expect(detailSuiviJumeau('traitement', 'Génération de votre jumeau…')).toBe(DETAIL_PHASE_JUMEAU.traitement);
    expect(detailSuiviJumeau('traitement', null)).toBe(DETAIL_PHASE_JUMEAU.traitement);
    expect(detailSuiviJumeau('envoi', MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR)).toBe(DETAIL_PHASE_JUMEAU.envoi);
  });

  it('« Rendu » → l’étape réelle du montage si elle existe (inchangé)', () => {
    expect(detailSuiviJumeau('rendu', 'Composition du montage… 40 %')).toBe('Composition du montage… 40 %');
    expect(detailSuiviJumeau('rendu', '')).toBe(DETAIL_PHASE_JUMEAU.rendu);
  });
});
