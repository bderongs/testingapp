// This file configures PostCSS plugins for Tailwind CSS in the Sparkier UI.
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

const config = {
  plugins: [tailwindcss, autoprefixer],
};

export default config;
