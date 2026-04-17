'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { Target, CreditCard, Palette, User, LogOut } from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { ObjectivesContent } from '@/components/settings/ObjectivesContent';
import { BillingContent } from '@/components/settings/BillingContent';
import BrandingPanel from '@/components/BrandingPanel';
import { useBranding } from '@/lib/hooks/useBranding';

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
  const { branding, setBranding } = useBranding();

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
          <div className="max-w-lg space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Branding</h2>
              <p className="text-sm text-gray-400">Logo, couleurs, watermark et CTA par défaut. Ces réglages sont mémorisés automatiquement.</p>
            </div>
            <BrandingPanel branding={branding} onChange={setBranding} />
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
