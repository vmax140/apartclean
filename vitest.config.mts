import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'supabase/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.expo/**', '**/dist/**'],
    environment: 'node',
    // Integracioni testovi dele jednu lokalnu bazu i jedan storage bucket, pa se
    // paralelnim pokretanjem gaze: jedan obriše fajlove koje drugi upravo šalje.
    fileParallelism: false,
  },
});
