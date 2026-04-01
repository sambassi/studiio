'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
      <AdminSidebar />
      <main className="ml-64 p-8 min-h-screen">
        {children}
      </main>
    </div>
  );
}
