import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
// Skale boja, radijusi i font dolaze iz packages/shared — ne upisuj ih ovde.
import preset from '@apartclean/shared/tailwind-preset';
import tokens from '@apartclean/shared/tokens.json';

/**
 * Semantičke boje (bg-background, bg-primary…) čitaju CSS promenljive iz app/globals.css,
 * pa rade i u svetlom i u tamnom režimu. Skale iz tokena ostaju dostupne kao bg-primary-600.
 */
const config: Config = {
  darkMode: 'class',
  presets: [preset as Config],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/shared/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
        primary: {
          ...tokens.color.primary,
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        accent: {
          ...tokens.color.accent,
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
