import { useRouter } from 'next/router';
import Link from 'next/link';
import { useState } from 'react';
import  supabase  from '../lib/supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const signIn = async () => {
    if (!email || !password) return alert('Please fill in all fields');

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) return alert(error.message);
    router.replace('/onboarding');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') signIn();
  };

  return (
    <div className="min-h-screen bg-sage-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-block bg-gradient-to-br from-sage-500 to-sage-600 p-4 rounded-2xl shadow-lg mb-4">
            <svg
              className="w-12 h-12 text-white/90"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2c-5 4-6.5 9-4.9 13.2 1.1 2.9 3.2 5 4.9 6.8 1.7-1.8 3.8-3.9 4.9-6.8C18.5 11 17 6 12 2z" />
              <path d="M12 4v13" />
              <path d="M12 7c-2 .7-3.5 2-4.7 3.8" />
              <path d="M12 10c-1.7.6-3 1.7-3.9 3" />
              <path d="M12 13c-1 .5-1.8 1.2-2.5 2.2" />
              <path d="M12 7c2 .7 3.5 2 4.7 3.8" />
              <path d="M12 10c1.7.6 3 1.7 3.9 3" />
              <path d="M12 13c1 .5 1.8 1.2 2.5 2.2" />
              <path d="M12 20v2.5" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-sage-800 mb-2">Welcome to SAGE</h1>
          <p className="text-sage-600">Safe product ingredient analysis</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-sage-200">
          <h2 className="text-2xl font-bold text-sage-800 mb-6">Log In</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                className="w-full border border-sage-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Password
              </label>
              <input
                type="password"
                className="w-full border border-sage-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>

            <button
              disabled={loading}
              className="w-full bg-sage-500 text-white py-3 rounded-lg font-semibold hover:bg-sage-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-md mt-6"
              onClick={signIn}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Signing in...</span>
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-sage-600">
              Don&apos;t have an account?{' '}
              <Link href="/onboarding" className="text-sage-600 font-semibold hover:text-sage-800 underline">
                Sign up
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-sage-500 mt-6">
          By signing in, you agree to analyze products safely
        </p>
      </div>
    </div>
  );
}
