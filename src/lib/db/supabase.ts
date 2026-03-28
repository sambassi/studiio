import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const supabaseServer = () => {
  return createClient(supabaseUrl, supabaseAnonKey);
};

export const getUser = async (userId: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) throw error;
  return data;
};

export const getUserCredits = async (userId: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('credits')
    .eq('id', userId)
    .single();
  
  if (error) throw error;
  return data?.credits || 0;
};

export const updateUserCredits = async (userId: string, amount: number) => {
  const { data, error } = await supabase
    .from('users')
    .update({ credits: amount })
    .eq('id', userId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};
