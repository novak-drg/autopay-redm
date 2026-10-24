import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // True dark charcoal — NOT navy/blue
        surface: {
          950: '#070709',
          900: '#0f0f17',   // page background
          850: '#121220',
          800: '#161624',   // card background
          750: '#1c1c2e',   // card hover / inner sections
          700: '#222236',   // table header bg
          600: '#2e2e48',   // borders / dividers
          500: '#3a3a55',   // muted background
          400: '#52526e',   // muted text bg
        },
        // Violet accent — used ONLY for active states, primary buttons, charts
        brand: {
          50:  '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',   // primary
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};

export default config;
