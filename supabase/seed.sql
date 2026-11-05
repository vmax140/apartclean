-- Faza 1A: početni podaci za lokalni razvoj (SPEC sekcija 10, kriterijum 1A).
--
-- Ovo se učitava samo u lokalnu bazu kroz `pnpm db:reset`. Lozinka svih naloga je
-- 'Lozinka123!' i važi isključivo za lokalni Docker; na pravom projektu ovaj fajl
-- se ne pokreće.
--
-- Fiksni UUID-evi su namerni: testovi se oslanjaju na njih.

-- ===== REGIONI =====
insert into public.regions (id, slug, name, center_lat, center_lng) values
  (1, 'kopaonik', 'Kopaonik', 43.2847, 20.8103),
  (2, 'zlatibor', 'Zlatibor', 43.7294, 19.7036)
on conflict (id) do nothing;

select setval('public.regions_id_seq', (select max(id) from public.regions));

-- ===== KORISNICI =====
-- Red u public.profiles pravi trigger on_auth_user_created.
do $$
declare
  seeded record;
begin
  for seeded in
    select *
    from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@apartclean.test',    'Milica Administrator'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'vlasnik.a@apartclean.test','Nikola Vlasnik'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'vlasnik.b@apartclean.test','Jelena Vlasnik'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'spremacica1@apartclean.test','Ana Spremačica'),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'spremacica2@apartclean.test','Dragana Spremačica'),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'spremacica3@apartclean.test','Sanja Spremačica')
    ) as v(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      seeded.id,
      'authenticated',
      'authenticated',
      seeded.email,
      extensions.crypt('Lozinka123!', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', seeded.full_name),
      now(),
      now()
    )
    on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      seeded.id,
      seeded.id::text,
      jsonb_build_object('sub', seeded.id::text, 'email', seeded.email, 'email_verified', true),
      'email',
      now(),
      now(),
      now()
    )
    on conflict do nothing;
  end loop;
end;
$$;

-- Seedovani nalozi su odmah upotrebljivi, pa preskaču 'pending'
-- (docs/DECISIONS.md, odluka 1 — u aplikaciji to radi accept-legal).
update public.profiles
set status = 'active', phone = '+381600000' || right(id::text, 3)
where id in (
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-4000-a000-000000000006'
);

-- ===== ULOGE =====
-- admin se dodeljuje samo ovde ili ručno kroz SQL (docs/DECISIONS.md, odluka 3).
insert into public.user_roles (user_id, role) values
  ('00000000-0000-4000-a000-000000000001', 'admin'),
  ('00000000-0000-4000-a000-000000000002', 'owner'),
  ('00000000-0000-4000-a000-000000000003', 'owner'),
  ('00000000-0000-4000-a000-000000000004', 'cleaner'),
  ('00000000-0000-4000-a000-000000000005', 'cleaner'),
  ('00000000-0000-4000-a000-000000000006', 'cleaner')
on conflict do nothing;

-- ===== PROFILI SPREMAČICA =====
-- Dve verifikovane, jedna na čekanju — da se verifikacija može testirati u 1D.
insert into public.cleaner_profiles
  (user_id, bio, languages, base_price_rsd, has_car, brings_supplies, verification, verified_at, verified_by, completed_jobs, reliability_pct)
values
  ('00000000-0000-4000-a000-000000000004', 'Osam godina na Kopaoniku, radim i velike apartmane.',
   '{sr,en}', 3500, true, true, 'verified', now(), '00000000-0000-4000-a000-000000000001', 124, 98.40),
  ('00000000-0000-4000-a000-000000000005', 'Brza priprema između gostiju, donosim svoj pribor.',
   '{sr}', 3000, false, true, 'verified', now(), '00000000-0000-4000-a000-000000000001', 47, 95.70),
  ('00000000-0000-4000-a000-000000000006', 'Nova na platformi, čekam verifikaciju.',
   '{sr}', 2800, false, false, 'pending', null, null, 0, null)
on conflict (user_id) do nothing;

insert into public.cleaner_regions (cleaner_id, region_id) values
  ('00000000-0000-4000-a000-000000000004', 1),
  ('00000000-0000-4000-a000-000000000005', 1),
  ('00000000-0000-4000-a000-000000000005', 2),
  ('00000000-0000-4000-a000-000000000006', 2)
on conflict do nothing;

-- ===== PODRAZUMEVANA CHECKLISTA =====
-- property_id je null: šablon važi za sve apartmane dok vlasnik ne napravi svoj.
-- Stavke su grupisane po tipu sobe, po standardima iz SPEC sekcije 8.
insert into public.checklist_templates (id, property_id, name)
values ('00000000-0000-4000-b000-000000000001', null, 'Podrazumevana checklista')
on conflict (id) do nothing;

insert into public.checklist_items (template_id, room_type, label, requires_photo, sort_order) values
  -- Spavaća soba
  ('00000000-0000-4000-b000-000000000001', 'bedroom', 'Krevet namešten čistom posteljinom', true, 1),
  ('00000000-0000-4000-b000-000000000001', 'bedroom', 'Posteljina bez fleka i dlaka', false, 2),
  ('00000000-0000-4000-b000-000000000001', 'bedroom', 'Jastuci složeni kao na referenci', false, 3),
  ('00000000-0000-4000-b000-000000000001', 'bedroom', 'Nema stvari prethodnih gostiju', false, 4),
  ('00000000-0000-4000-b000-000000000001', 'bedroom', 'Pod usisan, kanta prazna', false, 5),
  -- Kupatilo
  ('00000000-0000-4000-b000-000000000001', 'bathroom', 'WC šolja, daska i postolje čisti', true, 1),
  ('00000000-0000-4000-b000-000000000001', 'bathroom', 'Umivaonik i slavina bez kamenca i paste', true, 2),
  ('00000000-0000-4000-b000-000000000001', 'bathroom', 'Tuš ili kada bez dlaka i naslaga', false, 3),
  ('00000000-0000-4000-b000-000000000001', 'bathroom', 'Ogledalo bez tragova', false, 4),
  ('00000000-0000-4000-b000-000000000001', 'bathroom', 'Čisti peškiri složeni kao na referenci', true, 5),
  ('00000000-0000-4000-b000-000000000001', 'bathroom', 'Toalet papir dopunjen', false, 6),
  ('00000000-0000-4000-b000-000000000001', 'bathroom', 'Kanta prazna', false, 7),
  -- Kuhinja
  ('00000000-0000-4000-b000-000000000001', 'kitchen', 'Radne površine i sudopera čisti i prazni', true, 1),
  ('00000000-0000-4000-b000-000000000001', 'kitchen', 'Ploča za kuvanje očišćena', false, 2),
  ('00000000-0000-4000-b000-000000000001', 'kitchen', 'Nema prljavog posuđa ni hrane', false, 3),
  ('00000000-0000-4000-b000-000000000001', 'kitchen', 'Frižider prazan i obrisan', true, 4),
  ('00000000-0000-4000-b000-000000000001', 'kitchen', 'Kanta ispražnjena, nova kesa', false, 5),
  -- Dnevna soba
  ('00000000-0000-4000-b000-000000000001', 'living_room', 'Površine obrisane i prazne', true, 1),
  ('00000000-0000-4000-b000-000000000001', 'living_room', 'Jastuci i prekrivači složeni', false, 2),
  ('00000000-0000-4000-b000-000000000001', 'living_room', 'Pod usisan ili obrisan', false, 3),
  ('00000000-0000-4000-b000-000000000001', 'living_room', 'Nema flaša, smeća ni stvari gostiju', false, 4),
  -- Hodnik
  ('00000000-0000-4000-b000-000000000001', 'hallway', 'Pod obrisan', false, 1),
  ('00000000-0000-4000-b000-000000000001', 'hallway', 'Ostava za skije uredna', true, 2),
  ('00000000-0000-4000-b000-000000000001', 'hallway', 'Obuća i vešalice prazne', false, 3),
  -- Balkon
  ('00000000-0000-4000-b000-000000000001', 'balcony', 'Pod pometen', false, 1),
  ('00000000-0000-4000-b000-000000000001', 'balcony', 'Nameštaj obrisan i složen', true, 2),
  ('00000000-0000-4000-b000-000000000001', 'balcony', 'Nema opušaka ni flaša', false, 3),
  -- Opšte
  ('00000000-0000-4000-b000-000000000001', null, 'Prozori zatvoreni', false, 1),
  ('00000000-0000-4000-b000-000000000001', null, 'Grejanje na preporučenoj temperaturi', false, 2),
  ('00000000-0000-4000-b000-000000000001', null, 'Svetla ugašena, vrata zaključana', false, 3)
on conflict do nothing;

-- ===== PRAVNI DOKUMENTI =====
-- Tekstovi su privremeni; prave unosi admin (SPEC sekcija 9, poslednja stavka).
-- content_sha256 se računa iz sadržaja, kako traži SPEC.
insert into public.legal_documents (kind, version, title, content_md, content_sha256, applies_to, published_at, is_active)
select
  d.kind::public.legal_doc_kind,
  1,
  d.title,
  d.body,
  encode(extensions.digest(d.body, 'sha256'), 'hex'),
  d.applies_to,
  now(),
  true
from (values
  ('terms', 'Opšti uslovi korišćenja',
   E'# Opšti uslovi korišćenja\n\nPRIVREMEN TEKST. Zameniti pravim pre pilota.\n\nApartClean povezuje vlasnike apartmana i spremače. Platforma nije strana u ugovoru o čišćenju.\n\nKorisnik mora biti punoletan.',
   null::public.app_role[]),
  ('privacy', 'Politika privatnosti',
   E'# Politika privatnosti\n\nPRIVREMEN TEKST. Zameniti pravim pre pilota.\n\nObrađujemo ime, telefon, e-poštu, lokaciju pri dolasku i fotografije zadataka.\n\nSlike dokumenata za verifikaciju brišu se odmah po odluci administratora. Broj dokumenta se ne čuva.\n\nFotografije zadataka čuvaju se 30 dana u pilotu.',
   null::public.app_role[]),
  ('cleaner_rules', 'Pravila za spremače',
   E'# Pravila za spremače\n\nPRIVREMEN TEKST. Zameniti pravim pre pilota.\n\nDolazak u dogovorenom terminu. Fotografije se snimaju isključivo kamerom u aplikaciji.\n\nOtkazivanje posle prihvatanja utiče na pouzdanost profila.',
   array['cleaner']::public.app_role[]),
  ('owner_rules', 'Pravila za vlasnike',
   E'# Pravila za vlasnike\n\nPRIVREMEN TEKST. Zameniti pravim pre pilota.\n\nTačni podaci o apartmanu i pristupu. Cena se dogovara unapred i plaća direktno spremaču.',
   array['owner']::public.app_role[]),
  ('cancellation', 'Pravila otkazivanja',
   E'# Pravila otkazivanja\n\nPRIVREMEN TEKST. Zameniti pravim pre pilota.\n\nOtkazivanje manje od 24 h pre početka se evidentira.',
   null::public.app_role[])
) as d(kind, title, body, applies_to)
on conflict (kind, version) do nothing;
