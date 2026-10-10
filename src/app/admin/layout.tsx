'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { AdminSidebar } from '@/components/layout/AdminSidebar';

// Client-safe admin check — do NOT import from @/lib/admin (it pulls in supabaseAdmin server module)
const ADMIN_EMAILS = ['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'];
function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.includes(email?.toLowerCase() || '');
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  // Mobile (< md) : la barre latérale s'ouvre en superposition.
  const [menuOuvert, setMenuOuvert] = useState(false);

  useEffect(() => {
    // Check if user is authenticated and is admin
    if (status === 'loading') return;

    if (!session?.user?.email || !isAdminEmail(session.user.email)) {
      // Redirect to home if not admin
      router.push('/');
      return;
    }

    setIsAuthorized(true);
  }, [session, status, router]);

  // Show nothing while checking authorization
  if (status === 'loading' || !isAuthorized) {
    return (
      <div className="min-h-screen bg-studiio-dark flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Vérification...</h1>
          <p className="text-gray-400">Vérification de vos droits d'accès...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-studiio-dark">
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between border-b border-orange-900/50 bg-gray-900 px-4 py-3">
        <span className="text-lg font-bold text-orange-500">Studiio Admin</span>
        <button
          type="button"
          onClick={() => setMenuOuvert((o) => !o)}
          aria-label={menuOuvert ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={menuOuvert}
          className="rounded-md p-1 text-gray-300 hover:text-white"
        >
          {menuOuvert ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {menuOuvert && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMenuOuvert(false)} aria-hidden="true" />
      )}
      <AdminSidebar ouvert={menuOuvert} onNaviguer={() => setMenuOuvert(false)} />
      <main className="md:ml-64 p-4 md:p-8 min-h-screen">
        {children}
      </main>
    </div>
  );
}
