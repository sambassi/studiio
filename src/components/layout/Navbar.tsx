'use client';

import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Bell, User, LogOut, Shield } from 'lucide-react';

const ADMIN_EMAILS = ['contact.artboost@gmail.com'];

export function Navbar() {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email?.toLowerCase() || '');

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
  };

  return (
    <nav className="fixed top-0 right-0 left-64 h-16 bg-gray-900 border-b border-gray-800 z-40">
      <div className="h-full px-6 flex justify-between items-center">
        <div className="text-gray-400">Dashboard</div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button
              onClick={() => router.push('/admin')}
              className="text-yellow-400 hover:text-yellow-300 transition"
              title="Admin"
            >
              <Shield size={20} />
            </button>
          )}
          <button className="text-gray-400 hover:text-white transition relative">
            <Bell size={20} />
            <span className="absolute top-0 right-0 w-2 h-2 bg-studiio-accent rounded-full"></span>
          </button>
          <button
            onClick={() => router.push('/dashboard/settings')}
            className="text-gray-400 hover:text-white transition"
            title="Profil"
          >
            <User size={20} />
          </button>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-red-400 transition"
            title="Se déconnecter"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </nav>
  );
}
