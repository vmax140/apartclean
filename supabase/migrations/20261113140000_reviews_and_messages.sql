-- Faza 2E: zatvaranje, ocene i poruke (SPEC sekcija 6, koraci 10–11).

-- Ocena se daje jednom po zadatku i samo za završen posao. Smer se izvodi iz
-- toga ko ocenjuje, da klijent ne može da ga slaže.
-- Objavljivanje je posao iz Faze 2B (publish_due_reviews, odluka 14): kada obe
-- strane ocene ili 7 dana posle prve.
create function public.submit_review(
  target_task uuid,
  rating int,
  quality int default null,
  punctuality int default null,
  communication int default null,
  comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
  reviewee uuid;
  direction public.review_direction;
  review_id uuid;
begin
  if rating is null or rating < 1 or rating > 5 then
    raise exception 'OCENA_NEISPRAVNA: ocena ide od 1 do 5' using errcode = '22023';
  end if;

  task := public.lock_task(target_task);

  -- Spor nije zatvoren posao; ocenjuje se tek kada se završi.
  if task.status <> 'completed'::public.task_status then
    raise exception 'POGRESAN_STATUS: ocenjuje se tek završen posao' using errcode = '22023';
  end if;

  if caller = task.owner_id then
    reviewee := task.cleaner_id;
    direction := 'owner_to_cleaner';
  elsif caller = task.cleaner_id then
    reviewee := task.owner_id;
    direction := 'cleaner_to_owner';
  else
    raise exception 'NIJE_VAS_ZADATAK: ocenu daje samo učesnik' using errcode = '42501';
  end if;

  if reviewee is null then
    raise exception 'NEMA_KOGA_OCENITI: zadatak nije imao spremačicu' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.reviews where task_id = task.id and reviewer_id = caller
  ) then
    raise exception 'VEC_OCENJENO: ovaj zadatak si već ocenio' using errcode = '23505';
  end if;

  insert into public.reviews
    (task_id, reviewer_id, reviewee_id, direction, rating, quality, punctuality, communication, comment)
  values (
    task.id, caller, reviewee, direction, rating,
    quality, punctuality, communication, nullif(trim(comment), '')
  )
  returning id into review_id;

  perform public.write_audit('submit_review', 'reviews', review_id);

  -- Kada stigne i druga ocena, objava ne mora da čeka noćni posao.
  if (select count(*) from public.reviews where task_id = task.id) >= 2 then
    perform public.publish_due_reviews();
  end if;

  return review_id;
end;
$$;

grant execute on function public.submit_review(uuid, int, int, int, int, text) to authenticated;

-- Oznaka plaćanja. U pilotu nema online naplate: vlasnik plaća direktno
-- spremačici, a aplikacija samo beleži da je plaćeno (SPEC sekcija 1).
create function public.mark_task_paid(target_task uuid, paid boolean default true)
returns public.payment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  result public.payment_status;
begin
  task := public.lock_task(target_task);
  perform public.require_owner(task.owner_id);

  if task.status not in ('completed'::public.task_status, 'ready'::public.task_status) then
    raise exception 'POGRESAN_STATUS: plaćanje se beleži na završenom poslu' using errcode = '22023';
  end if;

  result := case when paid then 'paid_offline' else 'unpaid' end::public.payment_status;
  update public.cleaning_tasks set payment_status = result where id = task.id;

  if paid and task.cleaner_id is not null then
    perform public.notify(
      task.cleaner_id, 'task_paid', 'Posao je označen kao plaćen',
      'Vlasnik je potvrdio isplatu.',
      jsonb_build_object('task_id', task.id)
    );
  end if;

  perform public.write_audit('mark_task_paid', 'cleaning_tasks', task.id,
    jsonb_build_object('payment_status', result));
  return result;
end;
$$;

grant execute on function public.mark_task_paid(uuid, boolean) to authenticated;

-- Prijave štete menja vlasnik (potvrda i zatvaranje), pa mu treba i jasan prelaz.
create function public.set_report_status(target_report uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report public.property_reports;
begin
  if new_status not in ('open', 'acknowledged', 'resolved') then
    raise exception 'NEPOZNAT_STATUS: dozvoljeni su open, acknowledged i resolved'
      using errcode = '22023';
  end if;

  select * into report from public.property_reports where id = target_report;
  if not found then
    raise exception 'PRIJAVA_NE_POSTOJI: prijava nije pronađena' using errcode = 'P0002';
  end if;
  if not public.owns_property(report.property_id) and not public.is_admin() then
    raise exception 'NIJE_VAS_APARTMAN: prijavu zatvara vlasnik apartmana' using errcode = '42501';
  end if;

  update public.property_reports set status = new_status where id = target_report;
  perform public.write_audit('set_report_status', 'property_reports', target_report,
    jsonb_build_object('status', new_status));
end;
$$;

grant execute on function public.set_report_status(uuid, text) to authenticated;

-- Poruke po zadatku stižu uživo (SPEC sekcija 2: Realtime). RLS i dalje važi,
-- pa Realtime šalje red samo onome ko sme da ga vidi.
alter publication supabase_realtime add table public.messages;

-- Zaštita polja profila prelazi sa trigera na prava nad kolonama.
--
-- Triger guard_profile_fields je branio status, ocene i potvrdu telefona tako
-- što je gledao auth.uid(). Problem: auth.uid() ostaje isti i unutar SECURITY
-- DEFINER funkcija, pa je triger zaustavljao i sistem — publish_due_reviews nije
-- mogao da upiše prosečnu ocenu koju je sam izračunao.
--
-- Prava nad kolonama su pravi alat: proveravaju se pre RLS-a, korisnik ih nema,
-- a funkcije koje rade kao vlasnik ih imaju.
drop trigger if exists profiles_guard_fields on profiles;
drop function if exists public.guard_profile_fields();

-- Oduzimanje pojedinačnih kolona ne deluje dok god postoji dozvola nad celom
-- tabelom: ona podrazumeva sve kolone. Zato prvo ide cela, pa se vraćaju samo
-- one koje korisnik sme da menja.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, avatar_url, locale) on public.profiles to authenticated;

-- Telefon potvrđuje administrator pozivom (SPEC sekcija 1), pa mu treba put
-- koji prolazi i bez prava nad kolonom.
create function public.set_phone_verified(target_user uuid, verified boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin'::public.app_role) then
    raise exception 'SAMO_ADMIN: potvrdu telefona upisuje administrator' using errcode = '42501';
  end if;
  update public.profiles
  set phone_verified_at = case when verified then now() else null end
  where id = target_user;
  perform public.write_audit('set_phone_verified', 'profiles', target_user);
end;
$$;

grant execute on function public.set_phone_verified(uuid, boolean) to authenticated;
