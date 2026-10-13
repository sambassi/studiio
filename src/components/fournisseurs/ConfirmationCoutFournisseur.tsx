'use client';

/**
 * « Coût fournisseur estimé » — la fenêtre que l'admin voit AVANT toute
 * opération payante chez HeyGen. Elle ne lance rien : elle rend un choix
 * (`continuer` / `annuler` / `existant`) à `avecConfirmationCout`, qui seul
 * rejoue la requête. Montée à la demande, hors de l'arbre de la page : un
 * écran de 13 000 lignes n'a pas d'état à ajouter pour l'utiliser.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { lignesDevis, libelleContinuer, type DevisFournisseur } from '@/lib/fournisseurs/devis-fournisseur';
import type { ChoixConfirmation, ContexteConfirmation } from '@/lib/fournisseurs/confirmation-client';

export function ConfirmationCoutFournisseur({ devis, contexte, onChoix }: {
  devis: DevisFournisseur;
  contexte: ContexteConfirmation;
  onChoix: (choix: ChoixConfirmation) => void;
}) {
  // Un seul choix : un double clic sur « Continuer » ne relance jamais deux fois.
  const [choisi, setChoisi] = useState(false);
  const choisir = (c: ChoixConfirmation) => { if (choisi) return; setChoisi(true); onChoix(c); };
  const existant = devis.operation === 'creation_avatar' ? contexte.avatarExistant ?? null : null;
  return (
    <Modal isOpen onClose={() => choisir('annuler')} title="Coût fournisseur estimé">
      <div data-confirmation-cout={devis.operation} className="space-y-4 text-sm">
        {existant && (
          <p data-avatar-existant className="rounded-md border border-gray-700 px-3 py-2 text-gray-200">
            Un avatar existant est déjà disponible{existant.nom ? ` : ${existant.nom}` : ''} (version {existant.version}).
          </p>
        )}
        <dl className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: 'auto 1fr' }}>
          {lignesDevis(devis).map((l) => (
            <div key={l.libelle} className="contents">
              <dt className="text-gray-400">{l.libelle}</dt>
              <dd className="text-white" data-ligne={l.libelle}>{l.valeur}</dd>
            </div>
          ))}
        </dl>
        {devis.avertissement && (
          <p data-avertissement className="flex gap-2 text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{devis.avertissement}</span>
          </p>
        )}
        <p className="text-gray-400">Cette opération est facturée directement sur le wallet HeyGen, même quand aucun crédit Studiio n’est débité.</p>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {existant ? (
            <Button variant="secondary" disabled={choisi} onClick={() => choisir('existant')} data-choix="existant">Utiliser l’existant</Button>
          ) : (
            <Button variant="secondary" disabled={choisi} onClick={() => choisir('annuler')} data-choix="annuler">Annuler</Button>
          )}
          <Button variant="primary" disabled={choisi} onClick={() => choisir('continuer')} data-choix="continuer">
            {libelleContinuer(devis, !!existant)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Monte la fenêtre, attend le choix, la démonte. */
export function demanderConfirmationCout(devis: DevisFournisseur, contexte: ContexteConfirmation): Promise<ChoixConfirmation> {
  return new Promise((resolve) => {
    const hote = document.createElement('div');
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    const fin = (c: ChoixConfirmation) => {
      resolve(c);
      setTimeout(() => { racine.unmount(); hote.remove(); }, 0);
    };
    racine.render(<ConfirmationCoutFournisseur devis={devis} contexte={contexte} onChoix={fin} />);
  });
}
