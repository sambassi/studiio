export const dynamic = 'force-dynamic';

import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-studiio-dark">
      <Sidebar />
      <Navbar />
      <main className="mt-16 lg:ml-64 p-4 lg:p-8 min-h-[calc(100vh-64px)]">
        {children}
      </main>
    </div>
  );
}
