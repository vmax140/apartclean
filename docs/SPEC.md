# ApartClean AI — Tehnička specifikacija

Verzija 1.0 · 2026-11-01 · Izvor istine za razvoj. Poslovna analiza i istraživanje tržišta su u zasebnom dokumentu i nisu potrebni za pisanje koda.

---

## 1. Proizvod ukratko

Platforma koja povezuje vlasnike apartmana na Kopaoniku i Zlatiboru sa verifikovanim spremačima. Vlasnik zakazuje čišćenje (ručno ili automatski iz Booking/Airbnb iCal kalendara), spremač dolazi, radi po checklisti, slika sobe u aplikaciji, a AI (Claude Vision) proverava slike pre nego što apartman dobije status „spreman za goste“.

**Uloge:** vlasnik (owner), spremač (cleaner), admin. Jedna osoba može imati više uloga.

**Jezici:** srpski latinica (podrazumevano) i engleski.

**Odluke koje važe za MVP**

- Pilot bez online plaćanja: vlasnik plaća spremača direktno, aplikacija samo beleži cenu i oznaku „plaćeno“.
- Pretplata vlasnika se u pilotu vodi ručno u admin panelu (tabela `subscriptions`), bez naplate.
- Spremači: otvorena prijava uz verifikaciju (lični dokument + selfi, ručno odobrava admin).
- Klijenti: web (Next.js) + mobilna aplikacija (Expo, iOS i Android). Objava u prodavnicama je u Fazi 4.
- Prijava: email + lozinka i magic link. Bez Google/Apple prijave u MVP-u.
- Bez SMS verifikacije u MVP-u (admin proverava telefon pozivom pri odobravanju).

---

## 2. Arhitektura

| Sloj | Tehnologija | Napomena |
| --- | --- | --- |
| Web: vlasnik, admin, javne stranice | Next.js (App Router, TypeScript strict), Tailwind CSS, shadcn/ui | Hosting: Netlify (besplatan plan dozvoljava komercijalnu upotrebu) |
| Mobilna: vlasnik i spremač | Expo (React Native), Expo Router, TypeScript, NativeWind | Jedan kod za iOS i Android; build preko EAS |
| Backend | Supabase: Postgres + RLS, Auth, Storage, Edge Functions (Deno), Realtime, pg_cron | Supabase Free u razvoju i pilotu |
| AI | Claude API (`claude-haiku-5-5`, eskalacija na `claude-sonnet-5-5`) | Poziva se samo iz Edge Function; ključ u Supabase secrets |
| Push | Expo Push (expo-notifications) | Push testirati na development build-u, ne u Expo Go |
| Email | Resend | Besplatni nivo |
| Greške i analitika | Sentry, PostHog | Faza 4 |

### Struktura repozitorijuma

```
apartclean/
├── CLAUDE.md
├── docs/SPEC.md
├── apps/
│   ├── web/            # Next.js
│   └── mobile/         # Expo
├── packages/
│   └── shared/         # tipovi iz Supabase-a, zod šeme, i18n, konstante statusa, dizajn tokeni
└── supabase/
    ├── migrations/
    ├── functions/      # Edge Functions
    └── seed.sql
```

### Tehnička pravila

- RLS uključen na svakoj tabeli.
- Prelazi statusa zadatka idu isključivo kroz RPC funkcije u bazi (ili Edge Function sa service role ključem). Klijent nikad ne radi direktan UPDATE kolone `status`.
- Slike spremača: samo kamera u aplikaciji (bez galerije), smanjenje na 1.600 px duže ivice, JPEG 80%, SHA-256 heš, vreme snimanja i GPS uz sliku, lokalni red za slanje sa ponavljanjem kad se vrati signal.
- U pilotu (Supabase Free, 1 GB za fajlove): slike zadataka starije od 30 dana briše dnevni cron posao.
- Supabase Free pauzira projekat posle 7 dana neaktivnosti: dnevni cron „ping“ održava ga aktivnim.
- UI tekstovi samo kroz i18n ključeve.
- Tamni režim od prvog dana; dodirni elementi najmanje 44 px.

---

## 3. Šema baze (polazna migracija)

Claude Code ovaj SQL pretvara u `supabase/migrations/0001_init.sql` (tabele) i `0002_rls.sql` (politike, funkcije).

```sql
-- ===== ENUM TIPOVI =====
create type app_role as enum ('owner','cleaner','admin');
create type account_status as enum ('pending','active','suspended','deleted');
create type verification_status as enum ('unverified','pending','verified','rejected');
create type task_status as enum ('draft','open','offered','accepted','in_progress','submitted','needs_fixes','ready','completed','disputed','cancelled','expired');
create type task_type as enum ('turnover','deep_clean','linen_only','inspection');
create type offer_status as enum ('offered','accepted','declined','expired','withdrawn');
create type photo_kind as enum ('after','damage','fix');
create type room_type as enum ('bedroom','bathroom','kitchen','living_room','hallway','balcony','other');
create type ai_verdict as enum ('pass','minor_issues','fail','unclear');
create type review_direction as enum ('owner_to_cleaner','cleaner_to_owner');
create type legal_doc_kind as enum ('terms','privacy','cleaner_rules','owner_rules','cancellation');
create type payment_status as enum ('unpaid','paid_offline','paid_online','refunded');
create type report_category as enum ('damage','missing_item','maintenance','supplies_low');

-- ===== KORISNICI I ULOGE =====
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  phone text,
  phone_verified_at timestamptz,
  avatar_url text,
  locale text not null default 'sr-Latn',
  status account_status not null default 'pending',
  rating_avg numeric(3,2),
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles (
  user_id uuid references profiles on delete cascade,
  role app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table regions (
  id serial primary key,
  slug text unique not null,            -- 'kopaonik', 'zlatibor'
  name text not null,
  center_lat double precision,
  center_lng double precision
);

create table cleaner_profiles (
  user_id uuid primary key references profiles on delete cascade,
  bio text,
  languages text[] not null default '{sr}',
  base_price_rsd int,
  has_car boolean not null default false,
  brings_supplies boolean not null default false,
  max_jobs_per_day int not null default 3,
  verification verification_status not null default 'unverified',
  verified_at timestamptz,
  verified_by uuid references profiles,
  completed_jobs int not null default 0,
  reliability_pct numeric(5,2)          -- % zadataka bez otkazivanja i kašnjenja
);

create table cleaner_regions (
  cleaner_id uuid references cleaner_profiles(user_id) on delete cascade,
  region_id int references regions on delete cascade,
  primary key (cleaner_id, region_id)
);

create table verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  document_type text not null,          -- 'licna_karta' | 'pasos'
  doc_front_path text,                  -- privatni bucket; briše se posle odluke
  selfie_path text,
  status verification_status not null default 'pending',
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  rejection_reason text,
  files_deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== PRAVILA I PRISTANAK =====
create table legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind legal_doc_kind not null,
  version int not null,
  title text not null,
  content_md text not null,
  content_sha256 text not null,
  applies_to app_role[],                -- null = svi korisnici
  published_at timestamptz,
  is_active boolean not null default false,
  unique (kind, version)
);

create table legal_acceptances (        -- samo INSERT; bez UPDATE i DELETE
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles,
  document_id uuid not null references legal_documents,
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  app_version text,
  unique (user_id, document_id)
);

-- ===== APARTMANI =====
create table properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles,
  region_id int not null references regions,
  name text not null,
  address text not null,
  complex_name text,
  lat double precision not null,
  lng double precision not null,
  geofence_m int not null default 150,
  size_m2 int, bedrooms int, bathrooms int, beds int, max_guests int,
  checkout_time time not null default '10:00',
  checkin_time time not null default '14:00',
  est_duration_min int not null default 120,
  default_price_rsd int,
  cleaning_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table property_access (          -- čita se samo kroz RPC get_access_info(task_id)
  property_id uuid primary key references properties on delete cascade,
  key_instructions text,
  lockbox_code_encrypted text,
  wifi_name text,
  wifi_password_encrypted text,
  updated_at timestamptz not null default now()
);

create table property_rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  type room_type not null,
  name text not null,                   -- 'Kupatilo 1', 'Spavaća soba'
  sort_order int not null default 0
);

create table reference_photos (         -- „zlatni standard“ vlasnika
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  room_id uuid not null references property_rooms on delete cascade,
  storage_path text not null,
  angle_label text,                     -- 'krevet spreda', 'umivaonik'
  notes text,                           -- 'jastuci uspravno, prekrivač preko'
  created_at timestamptz not null default now()
);

create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties on delete cascade,  -- null = podrazumevani
  name text not null
);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates on delete cascade,
  room_type room_type,
  label text not null,
  requires_photo boolean not null default false,
  sort_order int not null default 0
);

-- ===== KALENDAR =====
create table property_calendars (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  source text not null,                 -- 'booking' | 'airbnb' | 'other'
  ical_url text not null,
  last_synced_at timestamptz,
  last_error text
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  calendar_id uuid references property_calendars on delete set null,
  external_uid text not null,
  check_in date not null,
  check_out date not null,
  is_cancelled boolean not null default false,
  unique (calendar_id, external_uid)
);

-- ===== ZADACI =====
create table preferred_cleaners (
  owner_id uuid references profiles on delete cascade,
  cleaner_id uuid references profiles on delete cascade,
  priority int not null default 1,      -- 1 = glavni, 2+ = rezervni
  primary key (owner_id, cleaner_id)
);

create table cleaning_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties,
  owner_id uuid not null references profiles,
  cleaner_id uuid references profiles,
  reservation_id uuid references reservations on delete set null,
  type task_type not null default 'turnover',
  status task_status not null default 'draft',
  window_start timestamptz not null,
  window_end timestamptz not null,
  price_rsd int,
  extras jsonb not null default '{}',   -- {"posteljina": true, "ves": false}
  owner_notes text,
  checklist_template_id uuid references checklist_templates,
  accepted_at timestamptz,
  arrived_at timestamptz,
  arrival_lat double precision,
  arrival_lng double precision,
  arrival_distance_m int,
  submitted_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references profiles,
  cancel_reason text,
  payment_status payment_status not null default 'unpaid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end > window_start)
);
create index on cleaning_tasks (cleaner_id, window_start);
create index on cleaning_tasks (property_id, window_start);
create index on cleaning_tasks (status);

create table task_offers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  cleaner_id uuid not null references profiles,
  status offer_status not null default 'offered',
  proposed_price_rsd int,
  message text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (task_id, cleaner_id)
);

create table task_checklist (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  checklist_item_id uuid references checklist_items on delete set null,
  room_id uuid references property_rooms,
  label text not null,                  -- kopija teksta u trenutku kreiranja
  requires_photo boolean not null default false,
  is_done boolean not null default false,
  done_at timestamptz,
  note text
);

-- ===== GALERIJA I AI =====
create table task_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  room_id uuid references property_rooms,
  checklist_row_id uuid references task_checklist on delete set null,
  kind photo_kind not null default 'after',
  storage_path text not null,
  width int,
  height int,
  sha256 text not null,                 -- isti fajl dva puta = sumnja
  phash text,                           -- sličnost sa slikama iz ranijih zadataka
  captured_at timestamptz not null,     -- vreme snimanja na uređaju
  uploaded_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  replaces_photo_id uuid references task_photos,
  created_by uuid not null references profiles
);

create table ai_inspections (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  model text not null,
  prompt_version text not null,
  status text not null default 'queued', -- queued | running | done | error
  verdict ai_verdict,
  overall_score int check (overall_score between 0 and 100),
  summary_for_owner text,
  summary_for_cleaner text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,5),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table ai_photo_results (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references ai_inspections on delete cascade,
  photo_id uuid not null references task_photos on delete cascade,
  model text not null,
  verdict ai_verdict not null,
  score int,
  confidence numeric(3,2),
  issues jsonb not null default '[]',
  checklist jsonb not null default '[]',
  fraud_flags jsonb not null default '[]',
  retake_request text
);

-- ===== RECENZIJE, PORUKE, ŠTETA, SPOROVI =====
create table reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  reviewer_id uuid not null references profiles,
  reviewee_id uuid not null references profiles,
  direction review_direction not null,
  rating int not null check (rating between 1 and 5),
  quality int check (quality between 1 and 5),
  punctuality int check (punctuality between 1 and 5),
  communication int check (communication between 1 and 5),
  comment text,
  published_at timestamptz,             -- objava kad obe strane oceni ili posle 7 dana
  created_at timestamptz not null default now(),
  unique (task_id, reviewer_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  sender_id uuid not null references profiles,
  body text not null,
  attachment_path text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table property_reports (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references cleaning_tasks on delete set null,
  property_id uuid not null references properties on delete cascade,
  reported_by uuid not null references profiles,
  category report_category not null,
  description text not null,
  photo_ids uuid[] not null default '{}',
  status text not null default 'open',  -- open | acknowledged | resolved
  created_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  opened_by uuid not null references profiles,
  reason text not null,
  status text not null default 'open',  -- open | resolved_owner | resolved_cleaner | split
  resolution_note text,
  resolved_by uuid references profiles,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== SISTEM =====
create table push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  expo_push_token text not null unique,
  platform text not null,               -- ios | android | web
  last_seen_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  type text not null,                   -- task_offered, task_ready, ai_needs_fixes...
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles on delete cascade,
  plan text not null default 'pilot',   -- pilot | basic | pro
  status text not null default 'active',
  properties_limit int,
  current_period_end date,
  provider text,                        -- manual_invoice | monri | bank
  provider_ref text,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles,
  action text not null,
  entity text not null,
  entity_id uuid,
  data jsonb,
  created_at timestamptz not null default now()
);
```

Dodatno u migraciji: trigger `updated_at` na tabelama koje ga imaju; trigger koji posle upisa u `auth.users` pravi red u `profiles`; funkcija `has_role(role app_role)`.

---

## 4. RLS pravila

- `has_role(role)` (security definer) proverava `user_roles`; admin vidi i menja sve.
- `profiles`: pun red vidi samo vlasnik naloga i admin. Ostali čitaju pogled `public_profiles` (ime, avatar, prosečna ocena, oznaka verifikacije).
- `properties`: vlasnik upravlja svojim. Spremač za otvorene zadatke vidi samo region i naziv kompleksa; tačnu adresu i koordinate tek kad je zadatak njemu dodeljen (accepted i dalje).
- `property_access`: bez direktnog SELECT-a za klijente. RPC `get_access_info(task_id)` vraća podatke samo dodeljenom spremaču, u statusu `accepted` ili `in_progress`, od 2 h pre `window_start` do 1 h posle `window_end`. Šifre se šifruju/dešifruju u Edge Function.
- `cleaning_tasks`: vlasnik vidi svoje; spremač vidi dodeljene i otvorene (`open`) u svojim regionima, i one za koje ima aktivnu ponudu. Status se menja samo kroz RPC (sekcija 5).
- `task_offers`: spremač vidi svoje ponude; vlasnik vidi ponude za svoje zadatke.
- `task_photos`: INSERT samo dodeljeni spremač dok je zadatak `in_progress` ili `needs_fixes`; SELECT vlasnik zadatka, dodeljeni spremač, admin.
- `reference_photos`, `property_rooms`, `checklist_*`: vlasnik upravlja; dodeljeni spremač čita za svoj zadatak.
- `legal_acceptances`: korisnik ubacuje i čita samo svoje; UPDATE i DELETE zabranjeni svima, uključujući admina.
- `reviews`: jednom po zadatku po učesniku, samo za `completed` zadatak; javno se vide samo redovi sa `published_at`.
- `messages`: čitaju i pišu samo vlasnik i dodeljeni spremač tog zadatka (i admin).
- `verification_requests`: korisnik pravi i čita svoj zahtev; odluku donosi samo admin.
- Storage: `task-photos`, `reference-photos`, `verification-docs` su privatni (potpisani linkovi; putanja `{task_id}/{photo_id}.jpg`); `verification-docs` čita samo admin; `avatars` je javni.

---

## 5. Statusi zadatka i prelazi

Glavni put: `draft → offered → accepted → in_progress → submitted → ready → completed`.

| Iz | U | Ko pokreće | RPC / mehanizam | Uslov |
| --- | --- | --- | --- | --- |
| draft | offered | vlasnik ili sistem | `offer_task` | Vlasnik ima glavnog spremača (`preferred_cleaners.priority = 1`); pravi se `task_offers` red, rok 2 h |
| draft | open | vlasnik ili sistem | `offer_task` | Nema tima |
| offered | offered | sistem | `decline_offer` / cron isteka | Glavni odbio ili rok istekao, postoji sledeći rezervni → nova ponuda |
| offered | open | sistem | `decline_offer` / cron isteka | Nema više rezervnih |
| offered | accepted | spremač | `accept_offer` | Ponuda važeća i nije istekla |
| open | accepted | spremač | `accept_offer` | Verifikovan, region odgovara; prvi koji prihvati (zaključavanje reda) |
| open | expired | cron | — | `window_start` prošao, niko nije prihvatio |
| accepted | open | spremač | `withdraw_task` | Spremač odustaje pre dolaska; pad `reliability_pct`; obavesti vlasnika |
| draft / offered / open / accepted | cancelled | vlasnik | `cancel_task` | Pre dolaska; razlog obavezan |
| accepted | in_progress | spremač | `check_in` | Od 2 h pre `window_start`; upis GPS-a i udaljenosti; van kruga traži razlog |
| in_progress | submitted | spremač | `submit_task` | Sve obavezne stavke i slike su poslate; pravi `ai_inspections` (queued) i pokreće `ai-inspect` |
| submitted | ready | sistem ili vlasnik | `mark_ready` | AI presuda `pass`, ili vlasnik prihvati kod `unclear` |
| submitted | needs_fixes | sistem ili vlasnik | `request_fixes` | AI `minor_issues` / `fail`, ili vlasnik kod `unclear` |
| needs_fixes | submitted | spremač | `submit_task` | Nove slike za sobe sa primedbama |
| ready | completed | vlasnik ili cron | `complete_task` | Vlasnik odobri, ili 12 h posle `ready`, a najkasnije u vreme prijave gosta |
| ready / completed | disputed | vlasnik ili spremač | `open_dispute` | U roku od 24 h od `ready_at` |
| disputed | completed / cancelled | admin | `resolve_dispute` | Odluka admina sa obrazloženjem |

Svaki RPC: proverava ulogu i trenutni status, upisuje vremensku kolonu, upisuje `audit_log`, šalje obaveštenja. Nedozvoljen prelaz vraća jasnu grešku (kod + poruka na srpskom).

### Cron poslovi (pg_cron)

| Posao | Učestalost |
| --- | --- |
| `ical-sync` (Edge Function) | svakih 30 min |
| Istek ponuda (`task_offers.expires_at`) | svakih 5 min |
| Alarm za nedolazak (30 min posle `window_start`, nema `check_in`) + ponuda rezervnom | svakih 5 min |
| Automatsko zatvaranje `ready → completed` | svakih 15 min |
| `open → expired` | svakih 15 min |
| Objava recenzija posle 7 dana | jednom dnevno |
| Brisanje slika zadataka starijih od 30 dana (pilot) | jednom dnevno |
| Ping da Supabase Free ne pauzira | jednom dnevno |

---

## 6. Korisnički tokovi

### Glavni tok

1. **Kreiranje zadatka.** Automatski iz iCal-a: nova rezervacija pravi zadatak za dan odjave, prozor od `checkout_time` do `checkin_time` apartmana. Ručno: vlasnik bira apartman, datum, prozor, tip, dodatke, cenu, napomenu.
2. **Dodela.** Glavni spremač (rok 2 h) → rezervni → svi verifikovani u regionu; prvi koji prihvati dobija posao.
3. **Notifikacija spremaču.** Push + obaveštenje u aplikaciji: region, kompleks, datum, prozor, cena, dodaci. Tačna adresa i šifra tek posle prihvatanja.
4. **Prihvatanje.** Vlasnik dobija push. Spremač dobija podsetnik veče pre i 1 h pre početka.
5. **Dolazak.** „Stigla sam“: GPS i provera kruga (`geofence_m`, podrazumevano 150 m). Van kruga: obavezan razlog, vidljiv vlasniku. Otkrivaju se pristupni podaci.
6. **Rad po checklisti** po sobama. Prijava štete, nestale stvari ili kvara u bilo kom trenutku (slika + opis) → vlasnik odmah dobija push.
7. **Slikanje.** Obavezne slike po sobi, samo kamera, providna referentna slika preko kadra; slanje u pozadini.
8. **Predaja** → `submitted` → AI provera.
9. **AI rezultat.** `pass` → `ready`, vlasnik dobija „Apartman spreman“. `minor_issues` / `fail` → `needs_fixes`, spremač dobija listu ispravki dok je u objektu i ponovo slika samo te sobe. `unclear` → odlučuje vlasnik.
10. **Zatvaranje.** Vlasnik odobri (ili automatski) → `completed`; oznaka plaćanja; ocene u oba smera, dvostruko slepe.
11. **Spor** u roku od 24 h; odlučuje admin.

### Uključivanje vlasnika

Registracija → izbor uloge → prihvatanje uslova → prvi apartman (osnovno, lokacija, sobe, pristup, iCal, referentne slike, checklista) → poziv svog spremača linkom ili pretraga verifikovanih.

### Uključivanje spremača

Registracija → prihvatanje uslova i pravila za spremače → profil (regioni, jezici, iskustvo, auto, pribor) → verifikacija (lična karta + selfi kamerom) → admin odobrava. Spremača kog je vlasnik lično pozvao, vlasnik može angažovati i pre verifikacije, uz oznaku „Nije verifikovan“; ponude iz tržišta dobija tek posle verifikacije.

### Izuzeci

- **Nedolazak:** 30 min posle početka bez dolaska → alarm vlasniku i automatska ponuda rezervnom.
- **Otkazivanje vlasnika:** manje od 24 h pre početka se beleži (pravilo naknade kad se uvede plaćanje).
- **Otkazana rezervacija u iCal-u:** zadatak se sam otkazuje ako niko nije prihvatio; ako jeste, vlasnik potvrđuje.
- **Nema signala:** dolazak, checklista i slike rade offline; predaja čeka da stignu sve slike.

---

## 7. Ekrani

### Vlasnik (web i mobilna)

| Ekran | Ruta (web) | Sadržaj |
| --- | --- | --- |
| Pregled | /app | Današnja i sutrašnja čišćenja sa statusom uživo, upozorenja, brze akcije |
| Kalendar | /app/kalendar | Mesečni prikaz rezervacija i čišćenja po apartmanu |
| Apartmani | /app/apartmani | Kartice sa slikom, regionom, sledećim čišćenjem |
| Novi apartman | /app/apartmani/novi | Čarobnjak: osnovno → lokacija → sobe → pristup → iCal → referentne slike → checklista |
| Detalji apartmana | /app/apartmani/[id] | Tabovi: detalji, sobe i referentne slike, checklista, kalendar, istorija, prijave štete |
| Zadaci | /app/zadaci | Lista sa filterima po statusu, apartmanu, datumu |
| Novi zadatak | /app/zadaci/novi | Apartman, datum, prozor, tip, dodaci, cena, izbor spremača |
| Detalji zadatka | /app/zadaci/[id] | Vremenska linija, spremač, referenca i nova slika jedna pored druge, AI izveštaj, checklista, poruke, Odobri / Traži ispravku / Spor, ocena |
| Spremači | /app/spremaci | Moj tim (glavni, rezervni), pretraga verifikovanih, profil sa ocenama, link za poziv |
| Poruke, obaveštenja | /app/poruke, /app/obavestenja | Razgovori po zadatku, lista obaveštenja |
| Podešavanja | /app/podesavanja | Profil, notifikacije, pretplata (pregled), pravni dokumenti, brisanje naloga |

Lokacija apartmana: na webu mapa Leaflet + OpenStreetMap; na telefonu dugme „Koristi trenutnu lokaciju“ i unos adrese (bez Google Maps ključa).

### Spremač (mobilna; web kao rezerva)

| Ekran | Sadržaj |
| --- | --- |
| Danas | Sledeći zadatak sa jednim velikim dugmetom akcije (Navigacija, Stigla sam, Nastavi, Predaj), raspored dana |
| Ponude | Nove ponude sa rokom (Prihvati / Odbij), otvoreni poslovi u regionu |
| Raspored | Prihvaćeni zadaci po danima, dani kad ne radi |
| Zadatak: detalji | Kompleks, adresa i mapa posle prihvatanja, prozor, dodaci, napomene vlasnika, poruke |
| Zadatak: rad | Checklista po sobama, prijava štete, indikator slanja slika |
| Kamera | Providna referentna slika preko kadra, naziv sobe i ugla, ponovno slikanje |
| Predaja i AI rezultat | Pregled slika, rezultat provere, lista ispravki po sobi |
| Zarada | Odrađeni poslovi i iznosi, plaćeno ili ne |
| Profil | Status verifikacije, regioni, ocene, dokumenti, podešavanja, brisanje naloga |

### Admin (samo web)

| Ekran | Ruta | Sadržaj |
| --- | --- | --- |
| Pregled | /admin | Broj zadataka, kasneći i problematični, novi korisnici, trošak AI |
| Verifikacije | /admin/verifikacije | Red čekanja; dokument i selfi jedno pored drugog; Odobri / Odbij sa razlogom |
| Korisnici | /admin/korisnici | Pretraga, uloge, suspenzija, ručni unos pretplate |
| Zadaci | /admin/zadaci | Svi zadaci, filter po statusu |
| Sporovi | /admin/sporovi | Slike, AI izveštaj, poruke, odluka |
| AI nadzor | /admin/ai | Trošak po danu, stopa neslaganja AI i vlasnika, verzije prompta |
| Pravni dokumenti | /admin/dokumenti | Verzije, objava nove verzije |
| Audit log | /admin/log | Ko je šta uradio i kada |

### Javne stranice (web)

Početna za vlasnike, stranica za spremače, cene, uslovi korišćenja, politika privatnosti, prijava, registracija, zaboravljena lozinka.

### Zajedničke komponente

StatusBadge, TaskCard, TaskTimeline, PhotoGrid (lightbox), BeforeAfterCompare, AIReportCard, ChecklistRoom, CameraCapture (providni sloj), UploadQueueIndicator, RatingStars, ReviewForm, LegalAcceptModal, PropertyWizard, MapPicker, CalendarMonth, EmptyState, OfflineBanner, RoleSwitcher.

### Dizajn

- Mobilni prvo; dodirni elementi ≥ 44 px; jedna glavna akcija po ekranu za spremača.
- Status uvek bojom i rečju: zeleno spremno, žuto u toku / čeka, crveno problem.
- Minimum kucanja: izbor umesto unosa, podrazumevane vrednosti iz apartmana.
- Paleta: tamnoplava (planinska) kao primarna, sveža zelena kao akcent, mnogo bele. Jedan font (Inter) na webu i telefonu.
- Tamni režim od prvog dana.
- Dizajn tokeni su zajednički u `packages/shared`.

---

## 8. AI inspekcija

### Tok obrade

1. `submit_task` upisuje `ai_inspections` (queued) i poziva Edge Function `ai-inspect`.
2. Provere bez AI: `captured_at` unutar prozora zadatka; GPS u krugu apartmana; isti `sha256` dva puta; `phash` previše sličan slici iz ranijeg zadatka istog apartmana; premala ili pretamna slika. Rezultati idu u `fraud_flags`.
3. Jedan poziv po sobi: referentne slike + nove slike + checklista sobe + napomene vlasnika.
4. Model `claude-haiku-5-5`, temperatura 0, forsiran alat `submit_inspection` (tool_choice) sa JSON šemom; odgovor se validira zod-om.
5. Eskalacija: ako je presuda `fail` ili `unclear`, ili je bilo koja `confidence` < 0,7, isti poziv ide na `claude-sonnet-5-5` i važi njegov rezultat.
6. Upis u `ai_photo_results` (sa modelom); ukupna presuda = najlošija presuda sobe; ocena = prosek. Upis tokena i cene u `ai_inspections`.
7. Status: `pass` → `mark_ready`; `minor_issues` / `fail` → `request_fixes`; `unclear` → ostaje `submitted`, vlasnik odlučuje.
8. Push spremaču (lista ispravki) i vlasniku (sažetak).
9. Kalibracija: kad vlasnik odobri ono što je AI oborio ili otvori spor posle prolaza, beleži se neslaganje (prikaz u /admin/ai).

### System prompt (`prompt_version = inspector-v1`) — koristiti doslovno

```text
You are ApartClean Inspector, a strict but fair quality-control inspector for short-term rental apartments in Serbian mountain resorts (Kopaonik, Zlatibor). You review photos a cleaner took right after cleaning, before the next guests arrive.

## Your job
For each NEW photo, decide whether the visible area meets this apartment's standard. Judge ONLY what is visible. Never guess about areas outside the frame.

## Inputs
- room_type and room_name
- checklist: what the owner expects in this room
- owner_notes: apartment-specific standards (e.g. "two pillows upright, throw folded at the foot of the bed")
- REFERENCE photo(s): how the owner wants the room to look when ready (may be absent)
- NEW photo(s): taken now by the cleaner, each preceded by its photo_id

## How to judge
1. If a REFERENCE exists, compare: same items present, same arrangement, same level of order. Differences in light, angle or seasonal decor are NOT defects.
2. Check every checklist item visible in the photo. Items not visible get status "not_visible" and never cause a fail.
3. Room standards:
   - bedroom: bed made with clean, smooth linen; no stains or hairs; pillows arranged; no guest belongings; floor clear; bin empty.
   - bathroom: toilet bowl, seat and base clean; sink and faucet without water spots, toothpaste or hair; shower or tub without hair, soap scum or mould; mirror without streaks; fresh towels arranged as in the reference; toilet paper present; bin empty.
   - kitchen: counters, hob and sink clean and empty; no dirty dishes or food; appliances closed; bin emptied.
   - living_room, hallway, balcony: surfaces clear; cushions arranged; floor clean; no guest items, bottles or trash; ski storage tidy.
4. Severity:
   - high: a guest would complain or the room is not guest-ready (stain on linen, hair in shower, dirty toilet, trash left, bed not made, towels missing).
   - medium: noticeable but quick to fix (pillow misplaced, mirror streaks, towel folded differently from the reference).
   - low: cosmetic.
5. Verdict per photo: "pass" = no medium or high issues; "minor_issues" = only low or medium; "fail" = any high; "unclear" = too dark, blurry, wrong room or key area not visible (say exactly what to re-shoot).
6. Photo integrity: add to fraud_flags (do not judge cleanliness) if the photo looks like a screenshot, a photo of a screen or print, a stock or marketing photo, a different apartment than the reference, or shows people.

## Rules
- Be specific and actionable: what is wrong and where. Never vague.
- Do not invent problems to look thorough. If it is clean, the verdict is pass.
- Never describe people or personal documents.
- All human-readable fields (problem, location, fix_instruction, retake_request, summaries) MUST be in Serbian, Latin script, short and polite; fix_instruction uses the imperative.
- Respond only by calling the submit_inspection tool.
```

### Poruka po sobi (primer)

```text
room_type: bathroom
room_name: Kupatilo 1
checklist: ["WC šolja čista", "Umivaonik bez fleka", "Tuš bez dlaka", "2 peškira složena kao na referenci", "Toalet papir", "Kanta prazna"]
owner_notes: "Peškiri idu na policu iznad WC-a, ne na kadu."
REFERENCE ref_1: [slika]
NEW p_8f2a: [slika]
NEW p_91c0: [slika]
```

### JSON šema alata `submit_inspection`

```json
{
  "room_verdict": "pass | minor_issues | fail | unclear",
  "room_score": "integer 0-100",
  "photos": [{
    "photo_id": "string",
    "verdict": "pass | minor_issues | fail | unclear",
    "score": "integer 0-100",
    "confidence": "number 0.0-1.0",
    "checklist": [{"item": "string", "status": "ok | problem | not_visible"}],
    "issues": [{"problem": "string", "location": "string", "severity": "low | medium | high", "fix_instruction": "string"}],
    "fraud_flags": ["screenshot | photo_of_screen | stock_photo | different_apartment | people_visible | other"],
    "retake_request": "string | null"
  }],
  "summary_for_cleaner": "string, najviše 2 rečenice",
  "summary_for_owner": "string, najviše 2 rečenice"
}
```

### Skica Edge Function

```ts
// supabase/functions/ai-inspect/index.ts
import Anthropic from "npm:@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

for (const room of rooms) {
  const content = [
    { type: "text", text: roomContext(room) },          // tip, checklista, napomene
    ...room.references.flatMap((r) => [
      { type: "text", text: `REFERENCE ${r.id}` },
      { type: "image", source: { type: "url", url: r.signedUrl } },
    ]),
    ...room.photos.flatMap((p) => [
      { type: "text", text: `NEW ${p.id}` },
      { type: "image", source: { type: "url", url: p.signedUrl } },
    ]),
  ];
  let result = await inspect("claude-haiku-5-5", content);   // tool_choice: submit_inspection
  if (needsEscalation(result)) result = await inspect("claude-sonnet-5-5", content);
  await saveResults(room, result);                            // ai_photo_results + tokeni + cena
}
```

### Zaštita od prevare

- Samo kamera u aplikaciji; za spremača ne postoji izbor iz galerije.
- Vreme snimanja i GPS se čuvaju uz sliku i proveravaju na serveru.
- SHA-256 i perceptivni heš hvataju ponovljene i stare slike.
- Nasumična „živa“ provera: aplikacija povremeno traži dodatni ugao koji se ne zna unapred.
- AI označava snimke ekrana, fotografije ekrana i slike drugog apartmana.

### Očekivani trošak

Oko 2–3 centa po čišćenju (Haiku za sve sobe, Sonnet za oko 25% soba). Cena i tokeni se upisuju po inspekciji.

---

## 9. Pravni zahtevi (tehnička strana)

- Dokumenti: opšti uslovi, politika privatnosti, pravila za spremače, pravila za vlasnike, otkazivanje. Svaki ima verziju i SHA-256 sadržaja; aktivna je jedna verzija po vrsti.
- `LegalAcceptModal` blokira aplikaciju dok korisnik ne prihvati sve aktivne dokumente za svoju ulogu. Polje za potvrdu nikad nije unapred štiklirano; link vodi na pun tekst.
- Prihvatanje ide kroz Edge Function `accept-legal` (upisuje IP, user agent, verziju aplikacije). Redovi se nikad ne menjaju ni ne brišu.
- Brisanje naloga iz aplikacije: anonimizacija profila (`status = deleted`, brisanje imena, telefona, avatara); evidencija prihvatanja ostaje.
- Verifikacija: slike dokumenta i selfija se brišu odmah posle odluke admina (`files_deleted_at`); broj dokumenta se nikad ne čuva.
- Lokacija se beleži samo pri dolasku i uz slike, ne prati se stalno.
- Slike zadataka: u pilotu 30 dana, kasnije 12 meseci.
- Samo punoletni korisnici (potvrda pri registraciji).
- Tekstovi dokumenata u seed-u su privremeni; prave tekstove unosi admin.

---

## 10. Faze i kriterijumi završetka

| Faza | Sadržaj | Gotovo kada |
| --- | --- | --- |
| 0 | Monorepo, Supabase init, i18n, dizajn tokeni, skripte | `pnpm dev` pokreće web i Expo; lint i typecheck prolaze |
| 1A | Migracije, RLS, storage, seed, RLS testovi | `pnpm db:reset` i testovi prolaze; tipovi generisani |
| 1B | Prijava, uloge, prihvatanje uslova, brisanje naloga | Novi korisnik prođe registraciju na webu i telefonu; red u `legal_acceptances` |
| 1C | Apartmani vlasnika (čarobnjak, detalji) | Vlasnik doda apartman sa 3 sobe i 3 referentne slike; drugi vlasnik ga ne vidi |
| 1D | Onboarding i verifikacija spremača, admin verifikacije | Spremač verifikovan, fajlovi obrisani, vlasnik ga vidi kao „Verifikovan“ |
| 2A | RPC prelazi statusa, ekrani zadataka vlasnika | Test prolazi ceo put `draft → completed`; nedozvoljeni prelazi odbijeni |
| 2B | `ical-sync`, cron poslovi | Test iCal sa 3 rezervacije pravi 3 zadatka; uklanjanje jedne otkazuje zadatak |
| 2C | Dodela, ponude, push, email, obaveštenja | Spremač dobije push za < 30 s i prihvati; vlasnik dobije potvrdu |
| 2D | Rad na terenu: dolazak, checklista, kamera, offline red, predaja | U režimu aviona 8 slika; posle povratka mreže sve stigne, status `submitted` |
| 2E | Zatvaranje, ocene, poruke, prijava štete | Ocene se pojave tek kad obe strane pošalju |
| 3A | `ai-inspect`, eskalacija, skripta za tačnost | Izveštaj tačnosti i troška nad 30 test slika |
| 3B | AI izveštaj u UI, ispravke, /admin/ai, sporovi | Neuredno kupatilo → `needs_fixes` → ispravka → `ready` |
| 4 | EAS build, TestFlight, Google zatvoreni test, Sentry, PostHog, javne stranice | Aplikacija u TestFlight-u i zatvorenom testu sa 15+ testera |

---

## 11. Van opsega MVP-a

Online plaćanje i isplate (Monri), SMS verifikacija, Viber obaveštenja, Google/Apple prijava, AI prevod poruka, AI generisanje checkliste, timovi firmi za čišćenje, dinamičke cene.
