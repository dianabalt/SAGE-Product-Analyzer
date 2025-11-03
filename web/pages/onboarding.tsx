import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import  supabase from '../lib/supabaseClient';

export default function Onboarding() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) console.error('getUser error:', error);

      if (!user) return router.replace('/login');

      setEmail(user.email ?? '');

      // Check user metadata first
      const metadataName = user.user_metadata?.full_name || user.user_metadata?.name;

      // Also check profiles table
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      const existingName = data?.full_name || metadataName;

      if (existingName) {
        // User already has a name, redirect to dashboard
        router.replace('/dashboard');
        return;
      }

      setFullName(existingName || '');
    })();
  }, [router]);

  const save = async () => {
    if (!fullName.trim()) return alert('Please enter your name');

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Update user metadata
    await supabase.auth.updateUser({
      data: { full_name: fullName }
    });

    // Try to update profiles table - use upsert without eq
    const { error } = await supabase
      .from('profiles')
      .upsert(
        { id: user.id, full_name: fullName },
        { onConflict: 'id' }
      );

    setLoading(false);

    // Ignore RLS errors - metadata is already updated
    if (error && !error.message.includes('row-level security')) {
      console.error('Profile update error:', error);
    }

    router.replace('/dashboard');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
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
          <h1 className="text-3xl font-bold text-sage-800 mb-2">
            {hasProfile ? 'Welcome Back!' : 'Welcome to SAGE!'}
          </h1>
          <p className="text-sage-600">
            {hasProfile ? 'Update your profile' : 'Let&apos;s get you set up'}
          </p>
        </div>

        {/* Onboarding Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-sage-200">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-sage-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-sage-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-sage-800">Your Profile</h2>
                <p className="text-sm text-sage-600">{email}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Full Name
              </label>
              <input
                className="w-full border border-sage-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter your full name"
              />
              <p className="text-xs text-sage-500 mt-1">
                This helps us personalize your experience
              </p>
            </div>

            <button
              disabled={loading}
              className="w-full bg-sage-500 text-white py-3 rounded-lg font-semibold hover:bg-sage-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-md mt-6"
              onClick={save}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Saving...</span>
                </span>
              ) : (
                hasProfile ? 'Continue to Dashboard' : 'Save & Continue'
              )}
            </button>
          </div>

          {!hasProfile && (
            <div className="mt-6 p-4 bg-sage-50 rounded-lg border border-sage-200">
              <h3 className="text-sm font-semibold text-sage-800 mb-2">What&apos;s next?</h3>
              <ul className="text-xs text-sage-600 space-y-1">
                <li className="flex items-center gap-2">
                  <span className="text-sage-500">✓</span>
                  <span>Add products to analyze ingredients</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-sage-500">✓</span>
                  <span>Get A-F safety grades instantly</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-sage-500">✓</span>
                  <span>Install the Chrome extension for image scanning</span>
                </li>
              </ul>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-sage-500 mt-6">
          Already have your profile set up?{' '}
          <button onClick={() => router.push('/dashboard')} className="text-sage-600 font-semibold hover:text-sage-800 underline">
            Go to Dashboard
          </button>
        </p>
      </div>
    </div>
  );
}
