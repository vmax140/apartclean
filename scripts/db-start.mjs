// `supabase start` na ovoj verziji CLI-ja ostavi edge runtime kontejner ugašen
// (prijavi ga pod „Stopped services", status Exited 255). Posledica je da svaki
// poziv Edge Function-a vrati 503 „name resolution failed", što izgleda kao greška
// u funkciji iako je stack inače zdrav. Zato ga posle podizanja izričito startujemo.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];

if (!projectId) {
  console.error('Ne mogu da pročitam project_id iz supabase/config.toml');
  process.exit(1);
}

// Jedna komandna linija, bez shell+args — tako nema upozorenja o eskejpovanju.
execSync('pnpm exec supabase start', { stdio: 'inherit' });

const container = `supabase_edge_runtime_${projectId}`;
try {
  execFileSync('docker', ['start', container], { stdio: 'ignore' });
  console.log(`Edge runtime pokrenut (${container}).`);
} catch {
  console.warn(`Upozorenje: ${container} nije pokrenut — Edge Functions neće odgovarati.`);
}
