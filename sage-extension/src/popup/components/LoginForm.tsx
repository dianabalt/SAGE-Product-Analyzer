import { useState } from 'react';
import { signIn } from '../../lib/supabase';

interface LoginFormProps {
  onSuccess: () => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await signIn(email, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-6">
        {/* Sage badge */}
        <div className="w-20 h-20 bg-gradient-to-br from-sage-500 to-sage-600 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse-slow shadow-lg">
          {/* Sage leaf icon */}
          <svg
            className="w-12 h-12 text-white/90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* Leaf outline */}
            <path d="M12 2c-5 4-6.5 9-4.9 13.2 1.1 2.9 3.2 5 4.9 6.8 1.7-1.8 3.8-3.9 4.9-6.8C18.5 11 17 6 12 2z" />
            {/* Midrib */}
            <path d="M12 4v13" />
            {/* Side veins (left) */}
            <path d="M12 7c-2 .7-3.5 2-4.7 3.8" />
            <path d="M12 10c-1.7.6-3 1.7-3.9 3" />
            <path d="M12 13c-1 .5-1.8 1.2-2.5 2.2" />
            {/* Side veins (right) */}
            <path d="M12 7c2 .7 3.5 2 4.7 3.8" />
            <path d="M12 10c1.7.6 3 1.7 3.9 3" />
            <path d="M12 13c1 .5 1.8 1.2 2.5 2.2" />
            {/* Tail / stem */}
            <path d="M12 20v2.5" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-sage-800">Welcome to SAGE</h1>
        <p className="text-sage-600 text-sm mt-1">Sign in to analyze products</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-sage-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-sage-300 rounded-lg focus:ring-2 focus:ring-sage-500 focus:border-transparent"
            placeholder="your@email.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-sage-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-sage-300 rounded-lg focus:ring-2 focus:ring-sage-500 focus:border-transparent"
            placeholder="••••••••"
            required
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-sage-500 to-sage-600 text-white py-2.5 rounded-lg font-medium hover:from-sage-600 hover:to-sage-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
