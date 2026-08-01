import { auth, DEV_AUTH_BYPASS } from '@/lib/auth/config';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Contournement de developpement local — voir `isDevAuthBypassEnabled` dans
  // `lib/auth/config.ts`. La constante est figee au chargement du module a
  // partir des SEULES variables d'environnement du serveur : elle vaut
  // `false` en production, et aucune requete ne peut la faire basculer.
  if (DEV_AUTH_BYPASS) {
    return NextResponse.next();
  }

  // Public routes — always allow
  if (
    pathname === '/' ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/stripe/webhook')
  ) {
    return NextResponse.next();
  }

  // Protected routes — require login
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/user') ||
    pathname.startsWith('/api/credits') ||
    pathname.startsWith('/api/admin')
  ) {
    if (!req.auth) {
      return NextResponse.redirect(new URL('/auth/login', req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/api/user/:path*', '/api/credits/:path*', '/api/admin/:path*'],
};
