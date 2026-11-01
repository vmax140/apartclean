// Zajednički Tailwind preset za apps/web i apps/mobile.
// Jedini izvor vrednosti je src/tokens.json — ne upisuj boje direktno u konfiguracije aplikacija.
const tokens = require('./src/tokens.json');

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: tokens.color.primary,
        accent: tokens.color.accent,
        neutral: tokens.color.neutral,
        ready: tokens.color.ready,
        pending: tokens.color.pending,
        problem: tokens.color.problem,
      },
      borderRadius: tokens.radius,
      fontFamily: {
        sans: [tokens.font.sans, 'system-ui', 'sans-serif'],
      },
      minHeight: {
        touch: tokens.size.touch,
      },
      minWidth: {
        touch: tokens.size.touch,
      },
    },
  },
};
