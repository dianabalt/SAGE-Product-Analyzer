/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        sage: {
          50: '#e8f0ed',    // Very light sage
          100: '#BFCFBB',   // Sage hint/mint (lightest)
          200: '#a8bfa4',   // Light sage
          300: '#9db099',   //
          400: '#8EA58C',   // Sage (medium-light)
          500: '#7e9a7c',   // Primary sage
          600: '#738A6E',   // Moss (medium)
          700: '#5d7158',   // Darker moss
          800: '#344C3D',   // Evergreen (dark)
          900: '#283a2f',   // Darkest evergreen
        },
        'sage-light': '#8EA58C',
        'sage-dark': '#344C3D',
        'sage-success': '#7e9a7c',
        'sage-warning': '#E8D5A3',
        'sage-bg': '#d4dfd1', // Lighter sage background
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in',
        'slide-up': 'slideUp 0.4s ease-out',
        'flip': 'flip 0.6s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        flip: {
          '0%': { transform: 'rotateY(0deg)' },
          '50%': { transform: 'rotateY(90deg)' },
          '100%': { transform: 'rotateY(0deg)' },
        },
      },
    },
  },
  plugins: [],
}
