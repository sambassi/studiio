/**
 * PAGE TEMPORAIRE DE VERIFICATION — supprimee avant le commit.
 *
 * Sert a photographier le nouveau style de bouton et a verifier qu'une page
 * dense (tableau admin, cartes de tarifs) n'est pas cassee. Les pages reelles
 * sont derriere l'authentification, donc inatteignables en headless.
 */
'use client';

import { Button } from '@/components/ui/Button';
import { UserTable } from '@/components/admin/UserTable';
import { PricingCards } from '@/components/billing/PricingCards';

export default function ButtonsPreview() {
  return (
    <div className="min-h-screen bg-studiio-dark p-8 space-y-10">
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-gray-500">Variantes</h2>
        <div id="variants" className="flex flex-wrap items-center gap-3">
          <Button id="btn-primary" variant="primary">Enregistrer</Button>
          <Button id="btn-secondary" variant="secondary">Annuler</Button>
          <Button id="btn-ghost" variant="ghost">Ignorer</Button>
          <Button id="btn-accent" variant="accent">Passer au Pro</Button>
          <Button id="btn-disabled" variant="primary" disabled>Indisponible</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-gray-500">Tailles</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button id="btn-sm" size="sm" variant="secondary">Petit</Button>
          <Button id="btn-md" size="md" variant="secondary">Moyen</Button>
          <Button id="btn-lg" size="lg" variant="secondary">Grand</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-gray-500">
          Motifs d&apos;appel existants (non-regression)
        </h2>
        <div className="flex gap-3 max-w-md">
          <Button className="flex-1" variant="secondary">flex-1</Button>
          <Button className="flex-1" variant="primary">flex-1</Button>
        </div>
        <div className="max-w-md">
          <Button className="w-full" variant="primary">w-full</Button>
        </div>
        <div className="max-w-md">
          <Button id="btn-override" className="flex-1 bg-purple-600 hover:bg-purple-700 text-white">
            Couleur imposee par l&apos;appelant
          </Button>
        </div>
        <div>
          <Button variant="secondary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            Avec icone
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {['Tout', 'Brouillons', 'Planifies', 'Publies', 'Echecs', 'Archives'].map((f) => (
            <Button key={f} size="sm" variant="ghost">{f}</Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-gray-500">Classes CSS sans le composant</h2>
        <div className="flex flex-wrap items-center gap-3">
          <a id="link-primary" href="#" className="button-primary text-center">Lien .button-primary</a>
          <a href="#" className="button-primary px-4 py-2 text-sm">Avec padding impose</a>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-gray-500">Page dense — tableau admin</h2>
        <UserTable />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-gray-500">Page dense — cartes de tarifs</h2>
        <PricingCards />
      </section>
    </div>
  );
}
