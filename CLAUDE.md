# ApartClean AI

Platforma koja povezuje vlasnike apartmana na Kopaoniku i Zlatiboru sa verifikovanim spremačima.
Specifikacija: `docs/SPEC.md` je izvor istine. Ako nešto nije u specifikaciji, pitaj pre nego što izmisliš.
Radi samo fazu ili celinu koja je navedena u zadatku.

## Stack
- Monorepo: Turborepo + pnpm workspaces
- `apps/web`: Next.js (App Router, TypeScript strict), Tailwind CSS, shadcn/ui — vlasnik, admin, javne stranice; hosting Netlify
- `apps/mobile`: Expo (React Native, Expo Router, TypeScript), NativeWind — vlasnik i spremač
- `packages/shared`: generisani Supabase tipovi, zod šeme, i18n (sr-Latn, en), konstante statusa, dizajn tokeni
- `supabase/`: SQL migracije, seed.sql, RLS, Edge Functions (Deno), storage politike
- AI: Claude API samo iz Edge Functions (`ANTHROPIC_API_KEY` u Supabase secrets, nikad u klijentu)

## Pravila
- Prelazi statusa zadatka i poslovna pravila idu kroz Postgres RPC funkcije ili Edge Functions; klijent nikad direktno ne menja `status` (SPEC sekcija 5).
- Svaka tabela ima RLS. Tabela bez RLS politike je greška.
- Posle svake migracije: `pnpm db:types`.
- UI tekstovi samo kroz i18n ključeve; podrazumevani jezik sr-Latn.
- Mobilni prvo: dodirni elementi najmanje 44 px, jedna glavna akcija po ekranu za spremača; tamni režim.
- Slike spremača: samo kamera u aplikaciji, 1.600 px duža ivica, JPEG 80%, SHA-256, offline red za slanje.
- Ne dodaj biblioteke bez razloga; razlog napiši u commit poruci.
- Posle svake celine: `pnpm lint && pnpm typecheck && pnpm test`, pa commit sa jasnom porukom.
- Na kraju svake celine napiši kratak spisak: šta je urađeno, šta korisnik treba ručno da proveri, šta je ostalo otvoreno.

## Komande
- `pnpm dev` — web i mobile
- `pnpm db:reset` — lokalna baza iz migracija i seed-a (traži Docker)
- `pnpm db:types` — tipovi u packages/shared
- `pnpm test` — testovi, uključujući RLS

## Ne radi
- Ne čuvaj brojeve dokumenata ni slike ličnih karata posle verifikacije.
- Ne stavljaj tajne ključeve u kod ni u .env fajl koji ide u git.
- Ne implementiraj online plaćanje, SMS ni Google/Apple prijavu (van opsega MVP-a, SPEC sekcija 11).
- Ne menjaj `docs/SPEC.md` bez izričitog zahteva; predlog izmene napiši u odgovoru.
