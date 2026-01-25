/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: 'tw-',
  content: ['./src/**/*.{ts,tsx}'],
  important: true,
  corePlugins: {
    preflight: false, // Disable Tailwind's reset styles to avoid breaking host page
  },
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        foreground: '#e4e4e7',
        card: '#12131a',
        primary: '#3b82f6',
        secondary: '#22d3ee',
        muted: '#a1a1aa',
        border: '#2a2b3d',
        accent: '#1a1b26',
        success: '#22c55e',
        danger: '#ef4444',
      },
    },
  },
  plugins: [],
};
