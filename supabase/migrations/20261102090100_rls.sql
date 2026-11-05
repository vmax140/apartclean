-- Faza 1A: RLS na svakoj tabeli, pogledi i RPC funkcije.
-- Izvor: docs/SPEC.md, sekcija 4. Odstupanja su u docs/DECISIONS.md.
--
-- Pristup poverljivim podacima ogranicavaju RLS politike i RPC funkcije.

-- ===== POMOĆNE FUNKCIJE =====
-- Sve su SECURITY DEFINER sa praznim search_path: pozivaju se iz RLS politika,
-- pa moraju da zaobiđu RLS da ne bi ušle u beskonačnu rekurziju.

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin'::public.app_role);
$$;

-- Putanje u storage-u počinju UUID-em. Ako neko pošalje fajl u putanju koja to nije,
-- običan cast bi bacio grešku i vratio 500 umesto „zabranjeno". Ovo vraća null,
-- pa provera pristupa uredno padne na false.
create function public.safe_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

create function public.owns_property(target_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.properties
    where id = target_property and owner_id = (select auth.uid())
  );
$$;

-- Spremač kome je zadatak dodeljen, u statusima u kojima još radi na njemu.
create function public.is_assigned_cleaner(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cleaning_tasks
    where id = target_task and cleaner_id = (select auth.uid())
  );
$$;

create function public.owns_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cleaning_tasks
    where id = target_task and owner_id = (select auth.uid())
  );
$$;

-- Zadatak koji spremač sme da vidi: dodeljen njemu, otvoren u njegovom regionu,
-- ili takav da na njemu ima aktivnu ponudu (SPEC sekcija 4).
create function public.cleaner_can_see_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cleaning_tasks t
    join public.properties p on p.id = t.property_id
    where t.id = target_task
      and (
        t.cleaner_id = (select auth.uid())
        or (
          t.status = 'open'::public.task_status
          and exists (
            select 1 from public.cleaner_regions cr
            where cr.cleaner_id = (select auth.uid()) and cr.region_id = p.region_id
          )
        )
        or exists (
          select 1 from public.task_offers o
          where o.task_id = t.id
            and o.cleaner_id = (select auth.uid())
            and o.status = 'offered'::public.offer_status
        )
      )
  );
$$;

create function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'active'
  );
$$;

-- ===== UKLJUČIVANJE RLS NA SVIM TABELAMA =====
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    if t.tablename not in ('profiles', 'user_roles', 'legal_documents', 'legal_acceptances') then
      execute format(
        'create policy active_account_required on public.%I as restrictive for all to authenticated using ((select public.account_is_active())) with check ((select public.account_is_active()))',
        t.tablename
      );
    end if;
  end loop;
end;
$$;

-- ===== PROFILI I ULOGE =====
create policy profiles_select_self on profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

create policy profiles_admin_all on profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Korisnik sme da menja svoj profil, ali ne i polja koja odlučuju o njegovim pravima.
-- status prebacuje accept-legal (odluka 1), ocene računa Faza 2E, a telefon potvrđuje
-- administrator pozivom (SPEC sekcija 1).
create function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'STATUS_NALOGA_ZAKLJUCAN: status naloga menja sistem, ne korisnik'
      using errcode = '42501';
  end if;

  if new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count then
    raise exception 'OCENA_ZAKLJUCANA: prosečna ocena se računa iz recenzija'
      using errcode = '42501';
  end if;

  if new.phone_verified_at is distinct from old.phone_verified_at then
    raise exception 'TELEFON_ZAKLJUCAN: potvrdu telefona upisuje administrator'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_fields
  before update on profiles
  for each row execute function public.guard_profile_fields();

-- Pogled koji ostali vide umesto punog reda (SPEC sekcija 4).
create view public.public_profiles
with (security_invoker = false) as
  select
    p.id,
    p.full_name,
    p.avatar_url,
    p.rating_avg,
    p.rating_count,
    coalesce(cp.verification = 'verified'::public.verification_status, false) as is_verified
  from public.profiles p
  left join public.cleaner_profiles cp on cp.user_id = p.id
  where (select public.account_is_active()) and p.status <> 'deleted'::public.account_status;

grant select on public.public_profiles to authenticated;

-- Uloge: klijent ih NE upisuje (docs/DECISIONS.md, odluka 3). Samo čitanje svojih.
create policy user_roles_select_self on user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Jedini put kojim korisnik dobija ulogu pri registraciji. Prima samo owner i
-- cleaner, i radi samo dok korisnik nema nijednu ulogu. admin ide kroz seed ili SQL.
create function public.set_initial_roles(roles public.app_role[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  r public.app_role;
begin
  if caller is null then
    raise exception 'NIJE_PRIJAVLJEN: potrebna je prijava' using errcode = '28000';
  end if;

  if roles is null or array_length(roles, 1) is null then
    raise exception 'ULOGA_OBAVEZNA: izaberi bar jednu ulogu' using errcode = '22023';
  end if;

  foreach r in array roles loop
    if r is null or r not in ('owner'::public.app_role, 'cleaner'::public.app_role) then
      raise exception 'ULOGA_NIJE_DOZVOLJENA: admin se ne dodeljuje iz aplikacije'
        using errcode = '42501';
    end if;
  end loop;

  perform 1 from public.profiles where id = caller and status in ('pending', 'active') for update;
  if not found then
    raise exception 'NALOG_NIJE_DOSTUPAN' using errcode = '42501';
  end if;

  if exists (select 1 from public.user_roles where user_id = caller) then
    raise exception 'ULOGE_VEC_POSTAVLJENE: uloge se menjaju samo preko administratora'
      using errcode = '23505';
  end if;

  foreach r in array roles loop
    insert into public.user_roles (user_id, role) values (caller, r);
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (caller, 'set_initial_roles', 'user_roles', caller, to_jsonb(roles));
end;
$$;

revoke all on function public.set_initial_roles(public.app_role[]) from public, anon;
grant execute on function public.set_initial_roles(public.app_role[]) to authenticated;

-- ===== REGIONI =====
create policy regions_select_all on regions
  for select to authenticated, anon
  using (true);

create policy regions_admin_all on regions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== PROFIL SPREMAČA =====
create policy cleaner_profiles_select on cleaner_profiles
  for select to authenticated
  using (true);

create policy cleaner_profiles_write_self on cleaner_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and verification = 'unverified'
    and verified_at is null
    and verified_by is null
  );

-- Spremač menja svoj profil, ali kolonu verification menja samo verify-decision
-- kroz service role (docs/DECISIONS.md, odluka 2) — zato trigger ispod.
create policy cleaner_profiles_update_self on cleaner_profiles
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

create function public.guard_cleaner_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.verification is distinct from old.verification
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by)
     and (select auth.uid()) is not null then
    raise exception 'VERIFIKACIJA_ZAKLJUCANA: status verifikacije menja samo administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger cleaner_profiles_guard_verification
  before update on cleaner_profiles
  for each row execute function public.guard_cleaner_verification();

create policy cleaner_regions_select on cleaner_regions
  for select to authenticated
  using (true);

create policy cleaner_regions_write_self on cleaner_regions
  for all to authenticated
  using (cleaner_id = (select auth.uid()) or public.is_admin())
  with check (cleaner_id = (select auth.uid()) or public.is_admin());

-- ===== VERIFIKACIJA =====
create policy verification_requests_insert_self on verification_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and rejection_reason is null
    and files_deleted_at is null
  );

create policy verification_requests_select_self on verification_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Odluku donosi samo admin (SPEC sekcija 4).
create policy verification_requests_admin_update on verification_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== PRAVNI DOKUMENTI I PRISTANAK =====
create policy legal_documents_select_active on legal_documents
  for select to authenticated, anon
  using (is_active or public.is_admin());

create policy legal_documents_admin_all on legal_documents
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy legal_acceptances_insert_self on legal_acceptances
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy legal_acceptances_select_self on legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Bez UPDATE i DELETE politike. Politike bi zaustavile klijente, ali service role
-- zaobilazi RLS — zato trigger, da zabrana važi bukvalno svima (SPEC sekcija 4 i 9).
create function public.legal_acceptances_are_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'EVIDENCIJA_NEPROMENLJIVA: prihvatanje uslova se ne menja i ne briše'
    using errcode = '42501';
end;
$$;

create trigger legal_acceptances_no_update
  before update or delete on legal_acceptances
  for each row execute function public.legal_acceptances_are_immutable();

revoke update, delete on legal_acceptances from authenticated, anon;

-- ===== APARTMANI =====
-- Vlasnik upravlja svojim. Dodeljeni spremač vidi pun red tek kad je zadatak njegov;
-- za otvorene zadatke vidi samo region i kompleks, kroz pogled property_cards.
create policy properties_owner_all on properties
  for all to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin())
  with check (owner_id = (select auth.uid()) or public.is_admin());

create policy properties_assigned_cleaner_select on properties
  for select to authenticated
  using (
    exists (
      select 1 from public.cleaning_tasks t
      where t.property_id = properties.id
        and t.cleaner_id = (select auth.uid())
        and t.status in (
          'accepted'::public.task_status,
          'in_progress'::public.task_status,
          'submitted'::public.task_status,
          'needs_fixes'::public.task_status,
          'ready'::public.task_status,
          'completed'::public.task_status,
          'disputed'::public.task_status
        )
    )
  );

create view public.property_cards
with (security_invoker = false) as
  select p.id, p.region_id, p.complex_name
  from public.properties p
  where (select public.account_is_active()) and exists (
    select 1 from public.cleaning_tasks t
    where t.property_id = p.id
      and public.cleaner_can_see_task(t.id)
  );

grant select on public.property_cards to authenticated;

-- Pristup se proverava kroz get_access_info.

create policy property_access_no_direct_access on property_access
  as restrictive for all to authenticated, anon
  using (false)
  with check (false);

create policy property_rooms_owner_all on property_rooms
  for all to authenticated
  using (public.owns_property(property_id) or public.is_admin())
  with check (public.owns_property(property_id) or public.is_admin());

create policy property_rooms_assigned_cleaner_select on property_rooms
  for select to authenticated
  using (
    exists (
      select 1 from public.cleaning_tasks t
      where t.property_id = property_rooms.property_id
        and t.cleaner_id = (select auth.uid())
    )
  );

create policy reference_photos_owner_all on reference_photos
  for all to authenticated
  using (public.owns_property(property_id) or public.is_admin())
  with check (public.owns_property(property_id) or public.is_admin());

create policy reference_photos_assigned_cleaner_select on reference_photos
  for select to authenticated
  using (
    exists (
      select 1 from public.cleaning_tasks t
      where t.property_id = reference_photos.property_id
        and t.cleaner_id = (select auth.uid())
    )
  );

-- Podrazumevani šabloni (property_id is null) vide svi prijavljeni korisnici.
create policy checklist_templates_read on checklist_templates
  for select to authenticated
  using (
    property_id is null
    or public.owns_property(property_id)
    or public.is_admin()
    or exists (
      select 1 from public.cleaning_tasks t
      where t.property_id = checklist_templates.property_id
        and t.cleaner_id = (select auth.uid())
    )
  );

create policy checklist_templates_owner_write on checklist_templates
  for all to authenticated
  using (
    (property_id is not null and public.owns_property(property_id)) or public.is_admin()
  )
  with check (
    (property_id is not null and public.owns_property(property_id)) or public.is_admin()
  );

create policy checklist_items_read on checklist_items
  for select to authenticated
  using (
    exists (
      select 1 from public.checklist_templates ct
      where ct.id = checklist_items.template_id
        and (
          ct.property_id is null
          or public.owns_property(ct.property_id)
          or public.is_admin()
          or exists (
            select 1 from public.cleaning_tasks t
            where t.property_id = ct.property_id and t.cleaner_id = (select auth.uid())
          )
        )
    )
  );

create policy checklist_items_owner_write on checklist_items
  for all to authenticated
  using (
    exists (
      select 1 from public.checklist_templates ct
      where ct.id = checklist_items.template_id
        and ct.property_id is not null
        and (public.owns_property(ct.property_id) or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.checklist_templates ct
      where ct.id = checklist_items.template_id
        and ct.property_id is not null
        and (public.owns_property(ct.property_id) or public.is_admin())
    )
  );

-- ===== KALENDAR =====
create policy property_calendars_owner_all on property_calendars
  for all to authenticated
  using (public.owns_property(property_id) or public.is_admin())
  with check (public.owns_property(property_id) or public.is_admin());

create policy reservations_owner_select on reservations
  for select to authenticated
  using (public.owns_property(property_id) or public.is_admin());

create policy reservations_admin_write on reservations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== TIM VLASNIKA =====
create policy preferred_cleaners_owner_all on preferred_cleaners
  for all to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin())
  with check (owner_id = (select auth.uid()) or public.is_admin());

create policy preferred_cleaners_cleaner_select on preferred_cleaners
  for select to authenticated
  using (cleaner_id = (select auth.uid()));

-- ===== ZADACI =====
-- Status menja isključivo RPC (SPEC sekcija 5, pravilo iz CLAUDE.md), zato klijent
-- nema UPDATE politiku na cleaning_tasks. RPC prelazi stižu u Fazi 2A.
create policy cleaning_tasks_owner_select on cleaning_tasks
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());

create policy cleaning_tasks_cleaner_select on cleaning_tasks
  for select to authenticated
  using (public.cleaner_can_see_task(id));

create policy cleaning_tasks_owner_insert on cleaning_tasks
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'draft'::public.task_status
    and cleaner_id is null
    and public.owns_property(property_id)
  );

create policy task_offers_cleaner_select on task_offers
  for select to authenticated
  using (cleaner_id = (select auth.uid()));

create policy task_offers_owner_select on task_offers
  for select to authenticated
  using (public.owns_task(task_id) or public.is_admin());

create policy task_offers_admin_all on task_offers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy task_checklist_read on task_checklist
  for select to authenticated
  using (public.owns_task(task_id) or public.is_assigned_cleaner(task_id) or public.is_admin());

-- Spremač štiklira stavke dok radi; sam zadatak time ne menja status.
create policy task_checklist_cleaner_update on task_checklist
  for update to authenticated
  using (
    public.is_assigned_cleaner(task_id)
    and exists (
      select 1 from public.cleaning_tasks t
      where t.id = task_checklist.task_id
        and t.status in ('in_progress'::public.task_status, 'needs_fixes'::public.task_status)
    )
  )
  with check (public.is_assigned_cleaner(task_id));

create policy task_checklist_admin_all on task_checklist
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== SLIKE I AI =====
create policy task_photos_select on task_photos
  for select to authenticated
  using (public.owns_task(task_id) or public.is_assigned_cleaner(task_id) or public.is_admin());

-- Slika sme da uđe samo od dodeljenog spremača i samo dok je zadatak u radu.
create policy task_photos_cleaner_insert on task_photos
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_assigned_cleaner(task_id)
    and exists (
      select 1 from public.cleaning_tasks t
      where t.id = task_photos.task_id
        and t.status in ('in_progress'::public.task_status, 'needs_fixes'::public.task_status)
    )
  );

create policy task_photos_admin_all on task_photos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy ai_inspections_read on ai_inspections
  for select to authenticated
  using (public.owns_task(task_id) or public.is_assigned_cleaner(task_id) or public.is_admin());

create policy ai_inspections_admin_all on ai_inspections
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy ai_photo_results_read on ai_photo_results
  for select to authenticated
  using (
    exists (
      select 1 from public.ai_inspections i
      where i.id = ai_photo_results.inspection_id
        and (public.owns_task(i.task_id) or public.is_assigned_cleaner(i.task_id) or public.is_admin())
    )
  );

create policy ai_photo_results_admin_all on ai_photo_results
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== RECENZIJE =====
-- Javno se vide samo objavljene; učesnik uvek vidi svoju (SPEC sekcija 4).
create policy reviews_select_public on reviews
  for select to anon
  using (published_at is not null);

create policy reviews_select_published on reviews
  for select to authenticated
  using (
    published_at is not null
    or reviewer_id = (select auth.uid())
    or public.is_admin()
  );

create policy reviews_insert_participant on reviews
  for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and published_at is null
    and exists (
      select 1 from public.cleaning_tasks t
      where t.id = reviews.task_id
        and t.status = 'completed'::public.task_status
        and (
          (reviews.direction = 'owner_to_cleaner' and reviews.reviewer_id = t.owner_id
            and reviews.reviewee_id = t.cleaner_id)
          or (reviews.direction = 'cleaner_to_owner' and reviews.reviewer_id = t.cleaner_id
            and reviews.reviewee_id = t.owner_id)
        )
    )
  );

create policy reviews_admin_all on reviews
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== PORUKE =====
create policy messages_participants_select on messages
  for select to authenticated
  using (public.owns_task(task_id) or public.is_assigned_cleaner(task_id) or public.is_admin());

create policy messages_participants_insert on messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (public.owns_task(task_id) or public.is_assigned_cleaner(task_id))
  );

create policy messages_admin_all on messages
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== PRIJAVE ŠTETE I SPOROVI =====
create policy property_reports_read on property_reports
  for select to authenticated
  using (
    public.owns_property(property_id)
    or reported_by = (select auth.uid())
    or public.is_admin()
  );

create policy property_reports_insert on property_reports
  for insert to authenticated
  with check (
    reported_by = (select auth.uid())
    and (public.owns_property(property_id) or (task_id is not null and public.is_assigned_cleaner(task_id)))
  );

create policy property_reports_owner_update on property_reports
  for update to authenticated
  using (public.owns_property(property_id) or public.is_admin())
  with check (public.owns_property(property_id) or public.is_admin());

create policy disputes_read on disputes
  for select to authenticated
  using (public.owns_task(task_id) or public.is_assigned_cleaner(task_id) or public.is_admin());

create policy disputes_insert_participant on disputes
  for insert to authenticated
  with check (
    opened_by = (select auth.uid())
    and (public.owns_task(task_id) or public.is_assigned_cleaner(task_id))
  );

-- Spor rešava samo admin (SPEC sekcija 5).
create policy disputes_admin_update on disputes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== SISTEM =====
create policy push_devices_self_all on push_devices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_select_self on notifications
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy notifications_update_self on notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_admin_all on notifications
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy subscriptions_select_self on subscriptions
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());

-- Pretplatu u pilotu unosi admin ručno (SPEC sekcija 1).
create policy subscriptions_admin_all on subscriptions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- audit_log: klijent ga ne čita ni ne piše. Samo admin čita; upisuju RPC funkcije
-- (SECURITY DEFINER) i service role.
create policy audit_log_admin_select on audit_log
  for select to authenticated
  using (public.is_admin());

-- ===== RPC: PRISTUPNI PODACI =====
-- Vraća podatke samo dodeljenom spremaču, u statusu accepted ili in_progress,
-- od 2 h pre window_start do 1 h posle window_end (SPEC sekcija 4).
-- Šifre ostaju šifrovane; dešifruje ih Edge Function (docs/DECISIONS.md, odluka 4).
create function public.get_access_info(target_task uuid)
returns table (
  property_id uuid,
  key_instructions text,
  lockbox_code_encrypted text,
  wifi_name text,
  wifi_password_encrypted text
)
language plpgsql
-- Namerno VOLATILE (podrazumevano): funkcija upisuje red u audit_log, a STABLE
-- funkcija ne sme da menja bazu.
security definer
set search_path = ''
as $$
declare
  task_row public.cleaning_tasks;
begin
  select * into task_row from public.cleaning_tasks where id = target_task;

  if not found then
    raise exception 'ZADATAK_NE_POSTOJI: zadatak nije pronađen' using errcode = 'P0002';
  end if;

  if not public.account_is_active()
     or task_row.cleaner_id is distinct from (select auth.uid()) then
    raise exception 'NIJE_VAS_ZADATAK: pristupni podaci se vide samo za svoj zadatak'
      using errcode = '42501';
  end if;

  if task_row.status not in ('accepted'::public.task_status, 'in_progress'::public.task_status) then
    raise exception 'POGRESAN_STATUS: pristupni podaci se vide tek posle prihvatanja'
      using errcode = '42501';
  end if;

  if now() < task_row.window_start - interval '2 hours'
     or now() > task_row.window_end + interval '1 hour' then
    raise exception 'VAN_VREMENSKOG_OKVIRA: pristupni podaci se vide od 2 h pre do 1 h posle termina'
      using errcode = '42501';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values ((select auth.uid()), 'get_access_info', 'cleaning_tasks', target_task);

  return query
    select pa.property_id, pa.key_instructions, pa.lockbox_code_encrypted,
           pa.wifi_name, pa.wifi_password_encrypted
    from public.property_access pa
    where pa.property_id = task_row.property_id;
end;
$$;

revoke all on function public.get_access_info(uuid) from public, anon;
grant execute on function public.get_access_info(uuid) to authenticated;
