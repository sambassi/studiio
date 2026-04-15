import 'next-auth';
declare module 'next-auth' {
  interface User { plan?: string | null }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      plan?: string | null;
    }
  }
}
