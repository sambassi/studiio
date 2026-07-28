'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { Target, CreditCard, Palette, User, LogOut } from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { ObjectivesContent } from '@/components/settings/ObjectivesContent';
import { BillingContent } from '@/components/settings/BillingContent';
import BrandingPanel from '@/components/BrandingPanel';
import BrandingPreview from '@/components/BrandingPreview';
import { useBranding } from '@/lib/hooks/useBranding';
import { useCreatorPreferences } from '@/lib/hooks/useCreatorPreferences';

/** Champs du kit de marque sauvegardes cote serveur (CreatorPreferences). */
const BRANDING_KEYS = [
  'accentColor',
  'gradientColor1',
  'gradientColor2',
  'gradientOpacity',
  'ctaText',
  'ctaSubText',
  'watermarkText',
  'borderColor',
  'borderEnabled',
] as const;

const TABS = [
  { key: 'contenu', label: 'Contenu', Icon: Target },
  { key: 'abonnement', label: 'Abonnement', Icon: CreditCard },
  { key: 'branding', label: 'Branding', Icon: Palette },
  { key: 'compte', label: 'Compte', Icon: User },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get('tab') as TabKey) || 'contenu';
  const { data: session } = useSession();
  const { branding, setBranding, loaded: brandingLoaded } = useBranding();
  const { prefs, updatePrefs, loaded: prefsLoaded } = useCreatorPreferences();

  /**
   * Reconciliation localStorage <-> serveur pour le kit de marque.
   *
   * `useBranding` ne connait que le localStorage ; `/api/user/preferences` en
   * est la sauvegarde serveur. Regle retenue : le localStorage FAIT FOI (c'est
   * la source vivante), le serveur ne sert qu'a rehydrater un appareil qui n'a
   * rien en local — nouveau navigateur, cache vide. Sans cette regle, le
   * serveur ecraserait a chaque montage les reglages faits ailleurs.
   */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !brandingLoaded || !prefsLoaded) return;
    hydratedRef.current = true;
    let hadLocal = false;
    try {
      hadLocal = !!localStorage.getItem('studiio_branding');
    } catch {
      // Stockage indisponible : on ne rehydrate pas, faute de pouvoir trancher.
      return;
    }
    if (hadLocal) return;
    const fromServer: Partial<typeof branding> = {};
    for (const k of BRANDING_KEYS) {
      const v = (prefs as Record<string, unknown>)[k];
      if (v !== undefined && v !== null) (fromServer as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(fromServer).length > 0) setBranding(fromServer);
  }, [brandingLoaded, prefsLoaded, prefs, setBranding]);

  /** Ecrit dans le localStorage ET dans la sauvegarde serveur. */
  const handleBrandingChange = (updates: Partial<typeof branding>) => {
    setBranding(updates);
    const forServer: Record<string, unknown> = {};
    for (const k of BRANDING_KEYS) {
      if (k in updates) forServer[k] = (updates as Record<string, unknown>)[k];
    }
    if (Object.keys(forServer).length > 0) updatePrefs(forServer);
  };

  const setTab = (tab: TabKey) => {
    router.push(`/dashboard/settings?tab=${tab}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-1">Réglages</h1>
        <p className="text-gray-400 text-sm">Gérez votre contenu, abonnement, branding et compte.</p>
      </div>

      <div className="flex gap-1 border-b border-gray-800 pb-0">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === key
                ? 'bg-gray-800 text-white border-b-2 border-purple-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {activeTab === 'contenu' && <ObjectivesContent />}
        {activeTab === 'abonnement' && <BillingContent />}
        {activeTab === 'branding' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Branding</h2>
              <p className="text-sm text-gray-400">Logo, couleurs, watermark et CTA par défaut. Ces réglages sont mémorisés automatiquement.</p>
            </div>
            <div className="flex flex-col-reverse md:flex-row md:items-start gap-8">
              <div className="flex-1 max-w-lg">
                <BrandingPanel branding={branding} onChange={handleBrandingChange} />
              </div>
              <div className="flex-shrink-0 md:sticky md:top-4">
                <BrandingPreview branding={branding} />
              </div>
            </div>
          </div>
        )}
        {activeTab === 'compte' && (
          <div className="max-w-lg space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Compte</h2>
              <p className="text-sm text-gray-400">Informations de votre compte Studiio.</p>
            </div>
            <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Nom</label>
                <p className="text-white font-medium">{session?.user?.name || '—'}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Email</label>
                <p className="text-white font-medium">{session?.user?.email || '—'}</p>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex items-center gap-2 rounded-lg bg-red-600/10 border border-red-500/20 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-600/20 transition-colors"
            >
              <LogOut size={16} />
              Se déconnecter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Chargement...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
