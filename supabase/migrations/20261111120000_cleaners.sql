-- Faza 1D: profil spremačice, odluka o verifikaciji i tim vlasnika.
-- Izvor: docs/SPEC.md sekcije 6, 7 (admin) i 9; docs/DECISIONS.md, odluke 2, 5 i 13.
--
-- cleaner_profiles.verification menja isključivo Edge Function verify-decision
-- preko service role-a (trigger guard_cleaner_verification to i čuva). Stanje
-- „čeka odobrenje" zato živi u verification_requests.status, ne u profilu.

-- Profil i regioni se čuvaju zajedno: spremačica bez regiona ne može da dobije
-- nijednu ponudu, pa polovično sačuvan profil nema smisla.
create function public.save_cleaner_profile(payload jsonb)
returns void
language plpgsql
as $$
declare
  caller uuid := (select auth.uid());
  region_ids int[];
begin
  if caller is null then
    raise exception 'NIJE_PRIJAVLJEN: potrebna je prijava' using errcode = '28000';
  end if;

  if not public.has_role('cleaner'::public.app_role) then
    raise exception 'NIJE_SPREMACICA: profil popunjava samo spremačica' using errcode = '42501';
  end if;

  select coalesce(array_agg((value #>> '{}')::int), '{}')
  into region_ids
  from jsonb_array_elements(coalesce(payload -> 'region_ids', '[]'::jsonb)) as value;

  if array_length(region_ids, 1) is null then
    raise exception 'REGION_OBAVEZAN: izaberi bar jedan region' using errcode = '22023';
  end if;

  insert into public.cleaner_profiles as cp (
    user_id, bio, languages, base_price_rsd, has_car, brings_supplies, max_jobs_per_day
  )
  values (
    caller,
    nullif(payload ->> 'bio', ''),
    coalesce(
      (select array_agg(value #>> '{}') from jsonb_array_elements(payload -> 'languages') as value),
      '{sr}'
    ),
    (payload ->> 'base_price_rsd')::int,
    coalesce((payload ->> 'has_car')::boolean, false),
    coalesce((payload ->> 'brings_supplies')::boolean, false),
    coalesce((payload ->> 'max_jobs_per_day')::int, 3)
  )
  on conflict (user_id) do update set
    bio = excluded.bio,
    languages = excluded.languages,
    base_price_rsd = excluded.base_price_rsd,
    has_car = excluded.has_car,
    brings_supplies = excluded.brings_supplies,
    max_jobs_per_day = excluded.max_jobs_per_day;

  delete from public.cleaner_regions where cleaner_id = caller;
  insert into public.cleaner_regions (cleaner_id, region_id)
  select caller, unnest(region_ids);

  perform public.write_audit('save_cleaner_profile', 'cleaner_profiles', caller);
end;
$$;

revoke all on function public.save_cleaner_profile(jsonb) from public, anon;
grant execute on function public.save_cleaner_profile(jsonb) to authenticated;

-- Odluka administratora. Poziva je Edge Function verify-decision, i to tek pošto
-- je obrisala oba fajla iz storage-a (SPEC sekcija 9: slike se brišu odmah po
-- odluci, broj dokumenta se nikad ne čuva).
create function public.decide_verification(
  request_id uuid,
  approve boolean,
  reason text,
  decided_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.verification_requests;
begin
  select * into request from public.verification_requests where id = request_id;
  if not found then
    raise exception 'ZAHTEV_NE_POSTOJI: zahtev nije pronađen' using errcode = 'P0002';
  end if;

  if request.status <> 'pending'::public.verification_status then
    raise exception 'ZAHTEV_VEC_RESEN: o zahtevu je već odlučeno' using errcode = '22023';
  end if;

  if not approve and coalesce(trim(reason), '') = '' then
    raise exception 'RAZLOG_OBAVEZAN: odbijanje traži obrazloženje' using errcode = '22023';
  end if;

  update public.verification_requests set
    status = case when approve then 'verified' else 'rejected' end::public.verification_status,
    reviewed_by = decided_by,
    reviewed_at = now(),
    rejection_reason = case when approve then null else trim(reason) end,
    -- Putanje se brišu zajedno sa fajlovima: posle odluke nema traga gde su bili.
    doc_front_path = null,
    selfie_path = null,
    files_deleted_at = now()
  where id = request_id;

  update public.cleaner_profiles set
    verification = case when approve then 'verified' else 'rejected' end::public.verification_status,
    verified_at = case when approve then now() else null end,
    verified_by = case when approve then decided_by else null end
  where user_id = request.user_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (
    decided_by,
    case when approve then 'verification_approved' else 'verification_rejected' end,
    'verification_requests',
    request_id,
    jsonb_build_object('cleaner', request.user_id)
  );

  return request.user_id;
end;
$$;

revoke all on function public.decide_verification(uuid, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.decide_verification(uuid, boolean, text, uuid) to service_role;

-- Spisak spremačica koji vlasnik pretražuje (SPEC sekcija 7: „pretraga verifikovanih").
-- Pogled namerno ne izlaže ništa iz punog reda u profiles.
create view public.cleaner_directory
with (security_invoker = false) as
  select
    cp.user_id,
    pr.full_name,
    pr.avatar_url,
    pr.rating_avg,
    pr.rating_count,
    cp.bio,
    cp.languages,
    cp.base_price_rsd,
    cp.has_car,
    cp.brings_supplies,
    cp.completed_jobs,
    cp.reliability_pct,
    cp.verification = 'verified'::public.verification_status as is_verified,
    coalesce(
      (select array_agg(cr.region_id order by cr.region_id)
       from public.cleaner_regions cr where cr.cleaner_id = cp.user_id),
      '{}'
    ) as region_ids
  from public.cleaner_profiles cp
  join public.profiles pr on pr.id = cp.user_id
  where pr.status = 'active'::public.account_status;

grant select on public.cleaner_directory to authenticated;

-- Jedan glavni spremač po vlasniku (SPEC sekcija 5: priority = 1 je glavni).
create unique index preferred_cleaners_one_primary
  on public.preferred_cleaners (owner_id) where priority = 1;
