import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Facebook from 'next-auth/providers/facebook';
import { supabaseAdmin } from '@/lib/db/supabase';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_SECRET!,
    }),
    Facebook({
      clientId: process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_ID!,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET || process.env.FACEBOOK_SECRET!,
    }),
  ],
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (user && account) {
        // Sync user to Supabase on first login
        try {
          const { data: existingUser } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('email', user.email!)
            .single();

          if (existingUser) {
            token.id = existingUser.id;
            // Update name/avatar if changed
            await supabaseAdmin
              .from('users')
              .update({
                name: user.name || '',
                avatar_url: user.image || '',
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingUser.id);
          } else {
            // Create new user with 10 free credits
            const { data: newUser } = await supabaseAdmin
              .from('users')
              .insert({
                email: user.email!,
                name: user.name || '',
                avatar_url: user.image || '',
                credits: 10,
                plan: 'free',
              })
              .select('id')
              .single();

            if (newUser) {
              token.id = newUser.id;
            }
          }
        } catch (error) {
          console.error('Error syncing user to Supabase:', error);
          // Fallback: use the NextAuth-generated ID
          token.id = user.id;
        }

        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/login',
  },
});
