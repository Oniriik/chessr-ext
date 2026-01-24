/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: 'tw-',
  content: ['./src/**/*.{ts,tsx}'],
  important: true,
  theme: {
    extend: {
      colors: {
        background: '#1a1a2e',
        foreground: '#eee',
        card: '#252540',
        primary: '#ffd700',
        secondary: '#4a4a80',
        muted: '#888',
        success: '#28a745',
        danger: '#dc3545',
      },
    },
  },
  plugins: [],
};
