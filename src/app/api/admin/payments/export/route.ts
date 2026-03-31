import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/admin/payments/export - Export payments as CSV
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { data, error: dbError } = await supabase
      .from('credit_transactions')
      .select('*, users!inner(name, email)')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (dbError) throw dbError;

    const headers = 'Date,Utilisateur,Email,Montant,Type,Description,Statut\n';
    const rows = (data || []).map((t: any) => {
      const date = new Date(t.created_at).toLocaleDateString('fr-FR');
      const name = (t.users?.name || '').replace(/,/g, ' ');
      const email = t.users?.email || '';
      return `${date},${name},${email},${t.amount},${t.type},${(t.description || '').replace(/,/g, ' ')},${t.status || 'completed'}`;
    }).join('\n');

    const csv = headers + rows;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="paiements-studiio-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ success: false, error: 'Export failed' }, { status: 500 });
  }
}
