import { openWebApp } from '../../lib/api';

interface SignupPromptProps {
  onShowLogin: () => void;
}

export default function SignupPrompt({ onShowLogin }: SignupPromptProps) {
  const handleCreateAccount = () => {
    openWebApp('/onboarding?ref=extension');
  };

  return (
    <div className="animate-fade-in text-center">
      {/* Sage badge */}
      <div className="w-20 h-20 bg-gradient-to-br from-sage-500 to-sage-600 rounded-full mx-auto mb-6 flex items-center justify-center animate-pulse-slow shadow-lg">
        {/* Sage leaf icon (outline + midrib + side veins + stem) */}
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

      <h1 className="text-2xl font-bold text-sage-800 mb-2">Welcome to SAGE</h1>
      <p className="text-sage-600 mb-6 px-4">
        Scan products and analyze ingredients for safety with AI-powered grading
      </p>

      <div className="space-y-3">
        <button
          onClick={handleCreateAccount}
          className="w-full bg-gradient-to-r from-sage-500 to-sage-600 text-white py-3 rounded-lg font-medium hover:from-sage-600 hover:to-sage-700 transition-all shadow-md hover:shadow-lg"
        >
          Create Account
        </button>

        <p className="text-sm text-sage-600">
          Already have an account?{' '}
          <button
            onClick={onShowLogin}
            className="text-sage-700 font-medium hover:text-sage-800 underline"
          >
            Sign In
          </button>
        </p>
      </div>

      <div className="mt-8 pt-6 border-t border-sage-200">
        <p className="text-xs text-sage-500">
          Free to use • Secure • Privacy-focused
        </p>
      </div>
    </div>
  );
}
