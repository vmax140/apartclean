// Boje, radijusi i font dolaze iz packages/shared — isti izvor kao na webu.
const sharedPreset = require('@apartclean/shared/tailwind-preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/shared/src/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset'), sharedPreset],
};
