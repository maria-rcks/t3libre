/**
 * @file Tailwind CSS configuration for the management panel.
 * Defines custom brand colors and dark mode settings.
 */

const { } = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  mode: 'jit',
  purge: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#6C5CE7',
          'primary-dark': '#5A46CD',
          secondary: '#EC4899',
          accent: '#22D3EE',
        },
      },
    },
  },
  variants: {
    extend: {},
  },
};
