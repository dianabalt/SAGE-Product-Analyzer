// web/lib/supabaseServer.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { serialize } from 'cookie';

// Helper to append Set-Cookie without clobbering existing ones
function setCookie(res: NextApiResponse, name: string, value: string, options: CookieOptions = {}) {
  const cookie = serialize(name, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    ...options,
  });

  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, cookie]);
  } else {
    res.setHeader('Set-Cookie', [prev.toString(), cookie]);
  }
}

export function getSupabaseServer(req: NextApiRequest, res: NextApiResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // anon key is correct; auth comes from cookies
    {
      cookies: {
        get(name: string) {
          return req.cookies?.[name];
        },
        set(name: string, value: string, options: CookieOptions) {
          setCookie(res, name, value, options);
        },
        remove(name: string, options: CookieOptions) {
          // remove by setting an expired cookie
          setCookie(res, name, '', { ...options, maxAge: 0 });
        },
      },
    }
  );
}
