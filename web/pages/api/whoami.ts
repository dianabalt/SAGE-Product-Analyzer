import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseServer(req, res);
  const { data: { user } } = await supabase.auth.getUser();
  return res.status(200).json({ user: user ? { id: user.id, email: user.email } : null });
}
