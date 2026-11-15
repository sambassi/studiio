'use client';

import { useTranslations } from '@/i18n/client';

/**
 * Pied de page légal de toutes les pages. Il était écrit en anglais en dur (« Terms of Service »,
 * « Privacy Policy ») dans la mise en page racine, donc identique dans TOUTES les langues, français
 * compris. Il passe maintenant par le catalogue ; il doit vivre DANS le fournisseur de langue.
 */
export function LiensLegaux() {
  const t = useTranslations('liensLegaux');
  return (
    <footer className="text-center text-xs text-gray-500 py-4 space-x-4">
      <a href="/terms" className="hover:text-gray-300">{t('terms')}</a>
      <span>|</span>
      <a href="/privacy" className="hover:text-gray-300">{t('privacy')}</a>
    </footer>
  );
}
