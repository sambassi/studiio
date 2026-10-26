/**
 * Cinema IA — l'interrupteur de la PAGE. Composant serveur : la decision est prise
 * avant qu'une ligne de la page ne parte au navigateur. Eteint par defaut
 * (`CINEMA_ACTIVE`, voir `lib/cinema/garde.ts`) : 404. Allume, tout utilisateur
 * authentifie y accede.
 */
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth/config';
import { accesCinemaAutorise } from '@/lib/cinema/garde';

export const dynamic = 'force-dynamic';

export default async function CinemaLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!accesCinemaAutorise(session?.user)) notFound();
  return <>{children}</>;
}
