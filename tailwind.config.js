/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // Brand ramp, keyed to the lab's actual mark: deep navy through to the
        // blue edge of its rainbow sphere. Not a generic teal SaaS accent.
        pearl: {
          50: '#eef4ff',
          100: '#dce8ff',
          200: '#b8d1ff',
          300: '#8ab3ff',
          400: '#5b90fa',
          500: '#3b73f0',
          600: '#2457d6',
          700: '#1c44ab',
          800: '#1a3a89',
          900: '#182f68',
          950: '#0b1830',
        },
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae3',
          300: '#b0bacb',
          400: '#8595ae',
          500: '#657794',
          600: '#505f7a',
          700: '#424e63',
          800: '#394353',
          900: '#333a47',
          950: '#12151c',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
        pop: '0 10px 30px -10px rgba(16,24,40,.25)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        'slide-up': 'slide-up .25s cubic-bezier(.16,1,.3,1)',
        'slide-in-right': 'slide-in-right .28s cubic-bezier(.16,1,.3,1)',
      },
    },
  },
  plugins: [],
}
