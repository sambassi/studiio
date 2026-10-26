/**
 * Cinema IA — le verrou de la PAGE. Composant serveur : la decision est prise
 * avant qu'une ligne de la page ne parte au navigateur. Fermé par défaut
 * (`CINEMA_COMPTE_AUTORISE`, voir `lib/cinema/garde.ts`) ; un compte non
 * autorise voit une 404, sans indice sur le module.
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
