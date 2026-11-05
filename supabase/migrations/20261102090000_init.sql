-- Faza 1A: tabele, enum tipovi, trigeri i pomoćne funkcije.
-- Izvor: docs/SPEC.md, sekcija 3. Odstupanja su zabeležena u docs/DECISIONS.md.

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
  slug text unique not null,
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
  reliability_pct numeric(5,2)
);

create table cleaner_regions (
  cleaner_id uuid references cleaner_profiles(user_id) on delete cascade,
  region_id int references regions on delete cascade,
  primary key (cleaner_id, region_id)
);

create table verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  document_type text not null,
  doc_front_path text,
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
  applies_to app_role[],
  published_at timestamptz,
  is_active boolean not null default false,
  unique (kind, version)
);

create table legal_acceptances (
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
  size_m2 int,
  bedrooms int,
  bathrooms int,
  beds int,
  max_guests int,
  checkout_time time not null default '10:00',
  checkin_time time not null default '14:00',
  est_duration_min int not null default 120,
  default_price_rsd int,
  cleaning_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index properties_owner_idx on properties (owner_id);
create index properties_region_idx on properties (region_id);

create table property_access (
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
  name text not null,
  sort_order int not null default 0
);
create index property_rooms_property_idx on property_rooms (property_id);

create table reference_photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  room_id uuid not null references property_rooms on delete cascade,
  storage_path text not null,
  angle_label text,
  notes text,
  created_at timestamptz not null default now()
);
create index reference_photos_room_idx on reference_photos (room_id);

create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties on delete cascade,
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
create index checklist_items_template_idx on checklist_items (template_id);

-- ===== KALENDAR =====
create table property_calendars (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  source text not null,
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
create index reservations_property_idx on reservations (property_id, check_out);

-- ===== ZADACI =====
create table preferred_cleaners (
  owner_id uuid references profiles on delete cascade,
  cleaner_id uuid references profiles on delete cascade,
  priority int not null default 1,
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
  extras jsonb not null default '{}',
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
create index cleaning_tasks_cleaner_window_idx on cleaning_tasks (cleaner_id, window_start);
create index cleaning_tasks_property_window_idx on cleaning_tasks (property_id, window_start);
create index cleaning_tasks_status_idx on cleaning_tasks (status);

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
create index task_offers_cleaner_idx on task_offers (cleaner_id, status);

create table task_checklist (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  checklist_item_id uuid references checklist_items on delete set null,
  room_id uuid references property_rooms,
  label text not null,
  requires_photo boolean not null default false,
  is_done boolean not null default false,
  done_at timestamptz,
  note text
);
create index task_checklist_task_idx on task_checklist (task_id);

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
  sha256 text not null,
  phash text,
  captured_at timestamptz not null,
  uploaded_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  replaces_photo_id uuid references task_photos,
  created_by uuid not null references profiles
);
create index task_photos_task_idx on task_photos (task_id);
-- Bez unique ograničenja na sha256 (docs/DECISIONS.md, odluka 16): isti fajl u dva
-- različita apartmana može biti legitiman; sumnju procenjuje ai-inspect u Fazi 3A.
create index task_photos_sha256_idx on task_photos (sha256);

create table ai_inspections (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  model text not null,
  prompt_version text not null,
  status text not null default 'queued',
  verdict ai_verdict,
  overall_score int check (overall_score between 0 and 100),
  summary_for_owner text,
  summary_for_cleaner text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,5),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- docs/DECISIONS.md: tekstualne status kolone dobijaju CHECK, sema se inace ne menja.
  constraint ai_inspections_status_check check (status in ('queued','running','done','error'))
);
create index ai_inspections_task_idx on ai_inspections (task_id, created_at desc);

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
create index ai_photo_results_inspection_idx on ai_photo_results (inspection_id);

-- ===== RECENZIJE, PORUKE, STETA, SPOROVI =====
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
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, reviewer_id)
);
create index reviews_reviewee_idx on reviews (reviewee_id, published_at);

create table messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  sender_id uuid not null references profiles,
  body text not null,
  attachment_path text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_task_idx on messages (task_id, created_at);

create table property_reports (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references cleaning_tasks on delete set null,
  property_id uuid not null references properties on delete cascade,
  reported_by uuid not null references profiles,
  category report_category not null,
  description text not null,
  photo_ids uuid[] not null default '{}',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint property_reports_status_check check (status in ('open','acknowledged','resolved'))
);
create index property_reports_property_idx on property_reports (property_id, status);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references cleaning_tasks on delete cascade,
  opened_by uuid not null references profiles,
  reason text not null,
  status text not null default 'open',
  resolution_note text,
  resolved_by uuid references profiles,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint disputes_status_check check (status in ('open','resolved_owner','resolved_cleaner','split'))
);

-- ===== SISTEM =====
create table push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  last_seen_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles on delete cascade,
  plan text not null default 'pilot',
  status text not null default 'active',
  properties_limit int,
  current_period_end date,
  provider text,
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
create index audit_log_entity_idx on audit_log (entity, entity_id);

-- ===== FUNKCIJE I TRIGERI =====

-- Provera uloge. SECURITY DEFINER jer se poziva iz RLS politika nad user_roles;
-- prazan search_path je obavezan da se funkcija ne da preusmeriti.
create function public.has_role(target_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = target_role
  );
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function public.set_updated_at();

create trigger property_access_set_updated_at
  before update on property_access
  for each row execute function public.set_updated_at();

create trigger cleaning_tasks_set_updated_at
  before update on cleaning_tasks
  for each row execute function public.set_updated_at();

-- Posle upisa u auth.users pravi se red u profiles. Nalog kreće kao 'pending';
-- u 'active' ga prebacuje Edge Function accept-legal (docs/DECISIONS.md, odluka 1).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, locale)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'sr-Latn')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
