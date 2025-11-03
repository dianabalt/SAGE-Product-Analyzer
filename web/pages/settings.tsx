import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../lib/supabaseClient';

// No longer using static list - will fetch from API with dynamic suggestions

export default function Settings() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [avoidedIngredients, setAvoidedIngredients] = useState<string[]>([]);
  const [preferredIngredients, setPreferredIngredients] = useState<string[]>([]);
  const [avoidInput, setAvoidInput] = useState('');
  const [preferInput, setPreferInput] = useState('');
  const [avoidSuggestions, setAvoidSuggestions] = useState<string[]>([]);
  const [preferSuggestions, setPreferSuggestions] = useState<string[]>([]);
  const [suggestionDebounceTimer, setSuggestionDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return router.replace('/login');

    setEmail(user.email ?? '');
    const metadata = user.user_metadata || {};
    const fullNameFromMeta = metadata.full_name || metadata.name || '';
    setFullName(fullNameFromMeta);
    setUserName(fullNameFromMeta.split(' ')[0] || user.email?.split('@')[0] || 'User');

    // Load avoided ingredients and preferred ingredients from user metadata
    const avoided = metadata.avoided_ingredients || [];
    const preferred = metadata.preferred_ingredients || [];
    setAvoidedIngredients(avoided);
    setPreferredIngredients(preferred);
  };

  const updateProfile = async () => {
    if (!fullName.trim()) return alert('Name cannot be empty');

    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName }
    });
    setLoading(false);

    if (error) return alert(error.message);
    alert('Profile updated successfully!');
    loadUserData();
  };

  const updatePassword = async () => {
    if (!newPassword) return alert('Please enter a new password');
    if (newPassword !== confirmPassword) return alert('Passwords do not match');
    if (newPassword.length < 6) return alert('Password must be at least 6 characters');

    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });
    setLoading(false);

    if (error) return alert(error.message);
    alert('Password updated successfully!');
    setNewPassword('');
    setConfirmPassword('');
  };

  // Fetch suggestions from API with debouncing
  const fetchSuggestions = async (value: string, type: 'avoid' | 'prefer') => {
    if (value.length < 2) {
      if (type === 'avoid') setAvoidSuggestions([]);
      else setPreferSuggestions([]);
      return;
    }

    try {
      const response = await fetch(`/api/ingredient-suggestions?search=${encodeURIComponent(value)}&limit=8`, {
        credentials: 'include' // Include cookies for authentication
      });

      if (!response.ok) {
        console.error('API error:', response.status, response.statusText);
        return;
      }

      const data = await response.json();

      if (data.error) {
        console.error('API returned error:', data.error);
        return;
      }

      if (data.suggestions && Array.isArray(data.suggestions)) {
        // Filter out already added ingredients
        const existingList = type === 'avoid' ? avoidedIngredients : preferredIngredients;
        const filtered = data.suggestions.filter(
          (ing: string) => !existingList.some(existing => existing.toLowerCase() === ing.toLowerCase())
        );

        console.log(`Fetched ${filtered.length} suggestions for "${value}" (type: ${type})`);
        if (type === 'avoid') setAvoidSuggestions(filtered);
        else setPreferSuggestions(filtered);
      }
    } catch (error) {
      console.error('Failed to fetch ingredient suggestions:', error);
    }
  };

  const handleAvoidInput = (value: string) => {
    setAvoidInput(value);

    // Debounce API call
    if (suggestionDebounceTimer) clearTimeout(suggestionDebounceTimer);

    const timer = setTimeout(() => {
      fetchSuggestions(value, 'avoid');
    }, 300);

    setSuggestionDebounceTimer(timer);
  };

  const handlePreferInput = (value: string) => {
    setPreferInput(value);

    // Debounce API call
    if (suggestionDebounceTimer) clearTimeout(suggestionDebounceTimer);

    const timer = setTimeout(() => {
      fetchSuggestions(value, 'prefer');
    }, 300);

    setSuggestionDebounceTimer(timer);
  };

  const addAvoidedIngredient = async (ingredient: string) => {
    if (!ingredient.trim()) return;
    if (avoidedIngredients.some(ing => ing.toLowerCase() === ingredient.toLowerCase())) return;

    const newList = [...avoidedIngredients, ingredient];
    setAvoidedIngredients(newList);

    // Save to user metadata
    await supabase.auth.updateUser({
      data: { avoided_ingredients: newList }
    });

    setAvoidInput('');
    setAvoidSuggestions([]);
  };

  const removeAvoidedIngredient = async (ingredient: string) => {
    const newList = avoidedIngredients.filter(i => i !== ingredient);
    setAvoidedIngredients(newList);

    // Save to user metadata
    await supabase.auth.updateUser({
      data: { avoided_ingredients: newList }
    });
  };

  const addPreferredIngredient = async (ingredient: string) => {
    if (!ingredient.trim()) return;
    if (preferredIngredients.some(ing => ing.toLowerCase() === ingredient.toLowerCase())) return;

    const newList = [...preferredIngredients, ingredient];
    setPreferredIngredients(newList);

    // Save to user metadata
    await supabase.auth.updateUser({
      data: { preferred_ingredients: newList }
    });

    setPreferInput('');
    setPreferSuggestions([]);
  };

  const removePreferredIngredient = async (ingredient: string) => {
    const newList = preferredIngredients.filter(i => i !== ingredient);
    setPreferredIngredients(newList);

    // Save to user metadata
    await supabase.auth.updateUser({
      data: { preferred_ingredients: newList }
    });
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen bg-sage-bg">
      {/* Header */}
      <header className="bg-gradient-to-r from-sage-500 to-sage-600 shadow-lg">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center space-x-2 text-white hover:text-sage-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Back to Dashboard</span>
            </button>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <div className="w-24"></div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Account Settings */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6 border border-sage-200">
          <h2 className="text-xl font-bold text-sage-800 mb-4">Account Settings</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500"
                placeholder="Your full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full border border-sage-200 rounded-lg px-4 py-2.5 bg-sage-50 text-sage-600 cursor-not-allowed"
              />
              <p className="text-xs text-sage-500 mt-1">Email cannot be changed</p>
            </div>

            <button
              onClick={updateProfile}
              disabled={loading}
              className="bg-sage-500 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-sage-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>

        {/* Password Settings */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6 border border-sage-200">
          <h2 className="text-xl font-bold text-sage-800 mb-4">Change Password</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500"
                placeholder="Enter new password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500"
                placeholder="Confirm new password"
              />
            </div>

            <button
              onClick={updatePassword}
              disabled={loading}
              className="bg-sage-500 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-sage-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </div>

        {/* Ingredients to Avoid */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6 border border-sage-200">
          <h2 className="text-xl font-bold text-sage-800 mb-2">Ingredients I Want to Avoid</h2>
          <p className="text-sm text-sage-600 mb-4">
            Add ingredients you want highlighted in product scans (allergies, preferences, etc.)
          </p>

          <div className="relative mb-4">
            <input
              type="text"
              value={avoidInput}
              onChange={(e) => handleAvoidInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && avoidInput.trim()) {
                  addAvoidedIngredient(avoidInput.trim());
                }
              }}
              className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500"
              placeholder="Type to search ingredients..."
            />

            {avoidSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-sage-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {avoidSuggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => addAvoidedIngredient(suggestion)}
                    className="w-full text-left px-4 py-2.5 hover:bg-sage-50 transition-colors border-b border-sage-100 last:border-0"
                  >
                    <span className="font-medium text-sage-800">{suggestion}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {avoidedIngredients.length === 0 ? (
            <div className="text-center py-8 text-sage-500">
              <svg className="w-12 h-12 mx-auto mb-2 text-sage-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm">No ingredients added yet</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {avoidedIngredients.map((ingredient, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-full text-sm font-medium"
                >
                  <span>{ingredient}</span>
                  <button
                    onClick={() => removeAvoidedIngredient(ingredient)}
                    className="hover:bg-red-100 rounded-full p-0.5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-sage-500 mt-4">
            These ingredients will be highlighted in dark red when found in scanned products
          </p>
        </div>

        {/* Ingredients I Like */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-sage-200">
          <h2 className="text-xl font-bold text-sage-800 mb-2">Ingredients I Like</h2>
          <p className="text-sm text-sage-600 mb-4">
            Add ingredients you prefer to see in products (beneficial ingredients, favorites, etc.)
          </p>

          <div className="relative mb-4">
            <input
              type="text"
              value={preferInput}
              onChange={(e) => handlePreferInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && preferInput.trim()) {
                  addPreferredIngredient(preferInput.trim());
                }
              }}
              className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500"
              placeholder="Type to search ingredients..."
            />

            {preferSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-sage-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {preferSuggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => addPreferredIngredient(suggestion)}
                    className="w-full text-left px-4 py-2.5 hover:bg-sage-50 transition-colors border-b border-sage-100 last:border-0"
                  >
                    <span className="font-medium text-sage-800">{suggestion}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {preferredIngredients.length === 0 ? (
            <div className="text-center py-8 text-sage-500">
              <svg className="w-12 h-12 mx-auto mb-2 text-sage-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm">No preferred ingredients added yet</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {preferredIngredients.map((ingredient, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-3 py-1.5 rounded-full text-sm font-medium"
                >
                  <span>{ingredient}</span>
                  <button
                    onClick={() => removePreferredIngredient(ingredient)}
                    className="hover:bg-green-100 rounded-full p-0.5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-sage-500 mt-4">
            These ingredients will be highlighted in green when found in scanned products
          </p>
        </div>

        {/* Logout Button */}
        <div className="mt-6 text-center">
          <button
            onClick={logout}
            className="text-red-600 hover:text-red-800 font-medium underline"
          >
            Log Out
          </button>
        </div>
      </main>
    </div>
  );
}
