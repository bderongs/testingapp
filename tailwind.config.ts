// This file defines Tailwind CSS configuration for the Sparkier regression dashboard.
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}', './src/lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sparkier: {
          primary: '#4f46e5',
          secondary: '#38bdf8',
          accent: '#f97316',
        },
      },
      boxShadow: {
        card: '0 20px 25px -15px rgba(15, 23, 42, 0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
