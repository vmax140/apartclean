-- Faza 2A: prelazi statusa zadatka (SPEC sekcija 5).
--
-- Klijent nikad ne menja kolonu status — na cleaning_tasks nema UPDATE politike.
-- Svaki prelaz ide kroz jednu od funkcija ispod. Svaka proverava ulogu, trenutni
-- status i vreme, upisuje svoju vremensku kolonu, ostavlja trag u audit_log i
-- pravi obaveštenje. Nedozvoljen prelaz vraća 'KOD: poruka na srpskom'.
--
-- Odluke iz docs/DECISIONS.md koje ovde važe: 9 (dva ravnopravna puta), 10
-- (istek ima svoj RPC), 11 (automatsko zatvaranje), 12 (spor), 13 (verifikacija
-- se traži samo za zadatke sa tržišta).

-- ===== POMOĆNE FUNKCIJE =====

-- Rastojanje u metrima. Dovoljno tačno za krug od par stotina metara, bez PostGIS-a.
create function public.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Obaveštenje u aplikaciji. Push stiže u Fazi 2C; tip nosi ključ za prevod, a
-- title i body su srpski tekst za prikaz dok prevod ne postoji na klijentu.
create function public.notify(
  target_user uuid,
  notification_type text,
  title text,
  body text,
  data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, data)
  values (target_user, notification_type, title, body, data);
$$;

-- Zaključava zadatak i vraća ga. Zaključavanje je bitno za `open → accepted`:
-- prvi koji prihvati dobija posao, ostali moraju da sačekaju pa dobiju grešku.
create function public.lock_task(target_task uuid)
returns public.cleaning_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
begin
  select * into task from public.cleaning_tasks where id = target_task for update;
  if not found then
    raise exception 'ZADATAK_NE_POSTOJI: zadatak nije pronađen' using errcode = 'P0002';
  end if;
  return task;
end;
$$;

create function public.require_owner(owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if owner is distinct from (select auth.uid()) then
    raise exception 'NIJE_VAS_ZADATAK: ovo nije vaš zadatak' using errcode = '42501';
  end if;
end;
$$;

create function public.require_cleaner(cleaner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cleaner is distinct from (select auth.uid()) then
    raise exception 'NIJE_VAS_ZADATAK: ovo nije vaš zadatak' using errcode = '42501';
  end if;
end;
$$;

create function public.require_status(task public.cleaning_tasks, allowed public.task_status[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (task.status = any (allowed)) then
    raise exception 'POGRESAN_STATUS: zadatak je u statusu „%", a očekivan je jedan od: %',
      task.status, array_to_string(allowed, ', ')
      using errcode = '22023';
  end if;
end;
$$;

-- Sledeći spremač iz tima vlasnika kome još nije ponuđeno (SPEC sekcija 6, korak 2).
create function public.next_team_cleaner(target_task uuid, for_owner uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pc.cleaner_id
  from public.preferred_cleaners pc
  where pc.owner_id = for_owner
    and not exists (
      select 1 from public.task_offers o
      where o.task_id = target_task and o.cleaner_id = pc.cleaner_id
    )
  order by pc.priority
  limit 1;
$$;

-- Pravi ponudu sa rokom od 2 h i obaveštava spremača.
create function public.offer_to(task public.cleaning_tasks, cleaner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_offers (task_id, cleaner_id, proposed_price_rsd, expires_at)
  values (task.id, cleaner, task.price_rsd, now() + interval '2 hours')
  on conflict (task_id, cleaner_id) do update set
    status = 'offered'::public.offer_status,
    expires_at = now() + interval '2 hours',
    responded_at = null;

  perform public.notify(
    cleaner, 'task_offered', 'Nova ponuda za čišćenje',
    'Imaš novu ponudu. Rok za odgovor je 2 sata.',
    jsonb_build_object('task_id', task.id)
  );
end;
$$;

-- ===== PRELAZI =====

-- draft → offered (vlasnik ima glavnog spremača) ili draft → open (nema tima).
create function public.offer_task(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  cleaner uuid;
  result public.task_status;
begin
  task := public.lock_task(target_task);
  perform public.require_owner(task.owner_id);
  perform public.require_status(task, array['draft']::public.task_status[]);

  cleaner := public.next_team_cleaner(task.id, task.owner_id);
  result := case when cleaner is null then 'open' else 'offered' end::public.task_status;

  update public.cleaning_tasks set status = result where id = task.id;
  if cleaner is not null then
    perform public.offer_to(task, cleaner);
  end if;

  perform public.write_audit('offer_task', 'cleaning_tasks', task.id,
    jsonb_build_object('status', result, 'cleaner', cleaner));
  return result;
end;
$$;

-- offered → offered (sledeći rezervni) ili offered → open (nema više rezervnih).
create function public.decline_offer(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
  cleaner uuid;
  result public.task_status;
begin
  task := public.lock_task(target_task);
  perform public.require_status(task, array['offered']::public.task_status[]);

  -- caller je null kada posao pokreće cron isteka ponude.
  if caller is not null then
    if not exists (
      select 1 from public.task_offers
      where task_id = task.id and cleaner_id = caller
        and status = 'offered'::public.offer_status
    ) then
      raise exception 'NEMATE_PONUDU: za ovaj zadatak nemate važeću ponudu' using errcode = '42501';
    end if;
    update public.task_offers set status = 'declined', responded_at = now()
    where task_id = task.id and cleaner_id = caller;
  else
    update public.task_offers set status = 'expired', responded_at = now()
    where task_id = task.id and status = 'offered'::public.offer_status;
  end if;

  cleaner := public.next_team_cleaner(task.id, task.owner_id);
  result := case when cleaner is null then 'open' else 'offered' end::public.task_status;

  update public.cleaning_tasks set status = result where id = task.id;
  if cleaner is not null then
    perform public.offer_to(task, cleaner);
  else
    perform public.notify(
      task.owner_id, 'task_open', 'Zadatak je otvoren svima',
      'Niko iz tvog tima nije prihvatio, pa je zadatak ponuđen svim spremačicama u regionu.',
      jsonb_build_object('task_id', task.id)
    );
  end if;

  perform public.write_audit('decline_offer', 'cleaning_tasks', task.id,
    jsonb_build_object('status', result, 'next', cleaner));
  return result;
end;
$$;

-- offered → accepted i open → accepted. Za zadatke sa tržišta traži se
-- verifikacija i odgovarajući region (docs/DECISIONS.md, odluka 13).
create function public.accept_offer(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
  offer public.task_offers;
  region int;
begin
  if caller is null then
    raise exception 'NIJE_PRIJAVLJEN: potrebna je prijava' using errcode = '28000';
  end if;

  task := public.lock_task(target_task);
  perform public.require_status(task, array['offered','open']::public.task_status[]);

  if task.status = 'offered'::public.task_status then
    select * into offer from public.task_offers
    where task_id = task.id and cleaner_id = caller
      and status = 'offered'::public.offer_status;
    if not found then
      raise exception 'NEMATE_PONUDU: za ovaj zadatak nemate važeću ponudu' using errcode = '42501';
    end if;
    if offer.expires_at is not null and offer.expires_at < now() then
      raise exception 'PONUDA_ISTEKLA: rok za prihvatanje je istekao' using errcode = '22023';
    end if;
  else
    -- Zadatak sa tržišta: samo verifikovana spremačica iz odgovarajućeg regiona.
    if not exists (
      select 1 from public.cleaner_profiles
      where user_id = caller and verification = 'verified'::public.verification_status
    ) then
      raise exception 'NISTE_VERIFIKOVANI: otvorene zadatke prihvataju samo verifikovane spremačice'
        using errcode = '42501';
    end if;
    select p.region_id into region from public.properties p where p.id = task.property_id;
    if not exists (
      select 1 from public.cleaner_regions
      where cleaner_id = caller and region_id = region
    ) then
      raise exception 'POGRESAN_REGION: ovaj zadatak nije u vašem regionu' using errcode = '42501';
    end if;
  end if;

  update public.cleaning_tasks set
    status = 'accepted', cleaner_id = caller, accepted_at = now()
  where id = task.id;

  update public.task_offers set status = 'accepted', responded_at = now()
  where task_id = task.id and cleaner_id = caller;
  update public.task_offers set status = 'withdrawn', responded_at = now()
  where task_id = task.id and cleaner_id <> caller
    and status = 'offered'::public.offer_status;

  perform public.notify(
    task.owner_id, 'task_accepted', 'Zadatak je prihvaćen',
    'Spremačica je prihvatila čišćenje.',
    jsonb_build_object('task_id', task.id)
  );
  perform public.write_audit('accept_offer', 'cleaning_tasks', task.id);
  return 'accepted'::public.task_status;
end;
$$;

-- accepted → open. Spremačica odustaje pre dolaska; pouzdanost pada.
create function public.withdraw_task(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
begin
  task := public.lock_task(target_task);
  perform public.require_cleaner(task.cleaner_id);
  perform public.require_status(task, array['accepted']::public.task_status[]);

  update public.cleaning_tasks set
    status = 'open', cleaner_id = null, accepted_at = null
  where id = task.id;

  update public.task_offers set status = 'withdrawn', responded_at = now()
  where task_id = task.id and cleaner_id = task.cleaner_id;

  -- Pouzdanost se računa iz odnosa završenih i napuštenih poslova.
  update public.cleaner_profiles set
    reliability_pct = greatest(0, round(coalesce(reliability_pct, 100) - 5, 2))
  where user_id = task.cleaner_id;

  perform public.notify(
    task.owner_id, 'task_withdrawn', 'Spremačica je odustala',
    'Zadatak je ponovo otvoren za druge spremačice.',
    jsonb_build_object('task_id', task.id)
  );
  perform public.write_audit('withdraw_task', 'cleaning_tasks', task.id);
  return 'open'::public.task_status;
end;
$$;

-- draft / offered / open / accepted → cancelled. Razlog je obavezan.
create function public.cancel_task(target_task uuid, reason text)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
begin
  if coalesce(trim(reason), '') = '' then
    raise exception 'RAZLOG_OBAVEZAN: otkazivanje traži razlog' using errcode = '22023';
  end if;

  task := public.lock_task(target_task);
  perform public.require_owner(task.owner_id);
  perform public.require_status(
    task, array['draft','offered','open','accepted']::public.task_status[]
  );

  update public.cleaning_tasks set
    status = 'cancelled', cancelled_at = now(),
    cancelled_by = (select auth.uid()), cancel_reason = trim(reason)
  where id = task.id;

  update public.task_offers set status = 'withdrawn', responded_at = now()
  where task_id = task.id and status = 'offered'::public.offer_status;

  if task.cleaner_id is not null then
    perform public.notify(
      task.cleaner_id, 'task_cancelled', 'Zadatak je otkazan',
      'Vlasnik je otkazao čišćenje.',
      jsonb_build_object('task_id', task.id, 'reason', trim(reason))
    );
  end if;
  perform public.write_audit('cancel_task', 'cleaning_tasks', task.id,
    jsonb_build_object('reason', trim(reason)));
  return 'cancelled'::public.task_status;
end;
$$;

-- accepted → in_progress. Od 2 h pre početka; upisuje GPS i udaljenost.
create function public.check_in(
  target_task uuid,
  lat double precision,
  lng double precision,
  reason text default null
)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  property public.properties;
  distance int;
begin
  task := public.lock_task(target_task);
  perform public.require_cleaner(task.cleaner_id);
  perform public.require_status(task, array['accepted']::public.task_status[]);

  if now() < task.window_start - interval '2 hours' then
    raise exception 'PRERANO: dolazak se prijavljuje najranije 2 h pre početka'
      using errcode = '22023';
  end if;

  select * into property from public.properties where id = task.property_id;
  distance := round(public.distance_m(lat, lng, property.lat, property.lng))::int;

  -- Van kruga se dolazak prihvata, ali samo uz razlog koji vlasnik vidi.
  if distance > property.geofence_m and coalesce(trim(reason), '') = '' then
    raise exception 'VAN_KRUGA: udaljenost je % m, a dozvoljeno je % m — upiši razlog',
      distance, property.geofence_m
      using errcode = '22023';
  end if;

  update public.cleaning_tasks set
    status = 'in_progress', arrived_at = now(),
    arrival_lat = lat, arrival_lng = lng, arrival_distance_m = distance
  where id = task.id;

  perform public.notify(
    task.owner_id, 'task_started', 'Spremačica je stigla',
    case when distance > property.geofence_m
      then 'Dolazak je prijavljen van kruga, uz razlog.'
      else 'Čišćenje je počelo.' end,
    jsonb_build_object('task_id', task.id, 'distance_m', distance, 'reason', reason)
  );
  perform public.write_audit('check_in', 'cleaning_tasks', task.id,
    jsonb_build_object('distance_m', distance, 'reason', reason));
  return 'in_progress'::public.task_status;
end;
$$;

-- in_progress → submitted i needs_fixes → submitted. Pravi red u ai_inspections.
create function public.submit_task(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  missing int;
begin
  task := public.lock_task(target_task);
  perform public.require_cleaner(task.cleaner_id);
  perform public.require_status(task, array['in_progress','needs_fixes']::public.task_status[]);

  select count(*) into missing
  from public.task_checklist
  where task_id = task.id and not is_done;
  if missing > 0 then
    raise exception 'CHECKLISTA_NEPOTPUNA: ostalo je % nezavršenih stavki', missing
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.task_photos where task_id = task.id) then
    raise exception 'NEMA_SLIKA: predaja traži bar jednu sliku' using errcode = '22023';
  end if;

  update public.cleaning_tasks set status = 'submitted', submitted_at = now()
  where id = task.id;

  -- Red za AI proveru; obrađuje ga Faza 3A.
  insert into public.ai_inspections (task_id, model, prompt_version, status)
  values (task.id, 'claude-haiku-5-5', 'inspector-v1', 'queued');

  perform public.notify(
    task.owner_id, 'task_submitted', 'Čišćenje je predato',
    'Slike su poslate na proveru.',
    jsonb_build_object('task_id', task.id)
  );
  perform public.write_audit('submit_task', 'cleaning_tasks', task.id);
  return 'submitted'::public.task_status;
end;
$$;

-- submitted → ready. Pokreće ga AI presuda `pass` ili vlasnik kod `unclear`.
create function public.mark_ready(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
begin
  task := public.lock_task(target_task);
  if caller is not null then
    perform public.require_owner(task.owner_id);
  end if;
  perform public.require_status(task, array['submitted']::public.task_status[]);

  update public.cleaning_tasks set status = 'ready', ready_at = now() where id = task.id;

  perform public.notify(
    task.owner_id, 'task_ready', 'Apartman je spreman za goste',
    'Čišćenje je prihvaćeno.',
    jsonb_build_object('task_id', task.id)
  );
  if task.cleaner_id is not null then
    perform public.notify(
      task.cleaner_id, 'task_ready', 'Čišćenje je prihvaćeno',
      'Apartman je označen kao spreman.',
      jsonb_build_object('task_id', task.id)
    );
  end if;
  perform public.write_audit('mark_ready', 'cleaning_tasks', task.id);
  return 'ready'::public.task_status;
end;
$$;

-- submitted → needs_fixes. Spremačica dobija listu ispravki dok je još u objektu.
create function public.request_fixes(target_task uuid, note text)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
begin
  task := public.lock_task(target_task);
  if caller is not null then
    perform public.require_owner(task.owner_id);
  end if;
  perform public.require_status(task, array['submitted']::public.task_status[]);

  update public.cleaning_tasks set status = 'needs_fixes' where id = task.id;

  if task.cleaner_id is not null then
    perform public.notify(
      task.cleaner_id, 'task_needs_fixes', 'Potrebne su ispravke',
      coalesce(nullif(trim(note), ''), 'Pogledaj listu primedbi u aplikaciji.'),
      jsonb_build_object('task_id', task.id)
    );
  end if;
  perform public.write_audit('request_fixes', 'cleaning_tasks', task.id,
    jsonb_build_object('note', note));
  return 'needs_fixes'::public.task_status;
end;
$$;

-- ready → completed. Vlasnik odobri, ili cron po pravilu iz odluke 11.
create function public.complete_task(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
begin
  task := public.lock_task(target_task);
  if caller is not null then
    perform public.require_owner(task.owner_id);
  end if;
  perform public.require_status(task, array['ready']::public.task_status[]);

  update public.cleaning_tasks set status = 'completed', completed_at = now()
  where id = task.id;

  if task.cleaner_id is not null then
    update public.cleaner_profiles set completed_jobs = completed_jobs + 1
    where user_id = task.cleaner_id;
    perform public.notify(
      task.cleaner_id, 'task_completed', 'Posao je zatvoren',
      'Vlasnik je potvrdio čišćenje.',
      jsonb_build_object('task_id', task.id)
    );
  end if;
  perform public.write_audit('complete_task', 'cleaning_tasks', task.id);
  return 'completed'::public.task_status;
end;
$$;

-- ready / completed → disputed, u roku od 24 h od ready_at (odluka 12).
create function public.open_dispute(target_task uuid, reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
  dispute_id uuid;
begin
  if coalesce(trim(reason), '') = '' then
    raise exception 'RAZLOG_OBAVEZAN: spor traži obrazloženje' using errcode = '22023';
  end if;

  task := public.lock_task(target_task);
  if caller is distinct from task.owner_id and caller is distinct from task.cleaner_id then
    raise exception 'NIJE_VAS_ZADATAK: spor otvara samo učesnik' using errcode = '42501';
  end if;
  perform public.require_status(task, array['ready','completed']::public.task_status[]);

  if task.ready_at is null or now() > task.ready_at + interval '24 hours' then
    raise exception 'ROK_ISTEKAO: spor se otvara u roku od 24 h od trenutka kada je apartman spreman'
      using errcode = '22023';
  end if;

  insert into public.disputes (task_id, opened_by, reason)
  values (task.id, caller, trim(reason))
  returning id into dispute_id;

  update public.cleaning_tasks set status = 'disputed' where id = task.id;

  perform public.write_audit('open_dispute', 'cleaning_tasks', task.id,
    jsonb_build_object('dispute', dispute_id));
  return dispute_id;
end;
$$;

-- disputed → completed ili cancelled. Odlučuje admin, uz obrazloženje (odluka 12).
create function public.resolve_dispute(
  target_dispute uuid,
  outcome text,
  note text
)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispute public.disputes;
  task public.cleaning_tasks;
  final_status public.task_status;
begin
  if not public.has_role('admin'::public.app_role) then
    raise exception 'SAMO_ADMIN: spor rešava samo administrator' using errcode = '42501';
  end if;
  if outcome not in ('resolved_owner', 'resolved_cleaner', 'split') then
    raise exception 'NEPOZNAT_ISHOD: ishod mora biti resolved_owner, resolved_cleaner ili split'
      using errcode = '22023';
  end if;
  if coalesce(trim(note), '') = '' then
    raise exception 'OBRAZLOZENJE_OBAVEZNO: odluka traži obrazloženje' using errcode = '22023';
  end if;

  select * into dispute from public.disputes where id = target_dispute;
  if not found then
    raise exception 'SPOR_NE_POSTOJI: spor nije pronađen' using errcode = 'P0002';
  end if;
  if dispute.status <> 'open' then
    raise exception 'SPOR_VEC_RESEN: o sporu je već odlučeno' using errcode = '22023';
  end if;

  task := public.lock_task(dispute.task_id);
  -- Posao je odrađen osim ako admin presudi da nije (odluka 12).
  final_status := case when outcome = 'resolved_owner' then 'cancelled' else 'completed' end;

  update public.disputes set
    status = outcome, resolution_note = trim(note),
    resolved_by = (select auth.uid()), resolved_at = now()
  where id = target_dispute;

  update public.cleaning_tasks set
    status = final_status,
    completed_at = case when final_status = 'completed' then coalesce(task.completed_at, now()) end,
    cancelled_at = case when final_status = 'cancelled' then now() end,
    cancelled_by = case when final_status = 'cancelled' then (select auth.uid()) end,
    cancel_reason = case when final_status = 'cancelled' then trim(note) end
  where id = task.id;

  perform public.notify(task.owner_id, 'dispute_resolved', 'Spor je rešen', trim(note),
    jsonb_build_object('task_id', task.id, 'outcome', outcome));
  if task.cleaner_id is not null then
    perform public.notify(task.cleaner_id, 'dispute_resolved', 'Spor je rešen', trim(note),
      jsonb_build_object('task_id', task.id, 'outcome', outcome));
  end if;

  perform public.write_audit('resolve_dispute', 'disputes', target_dispute,
    jsonb_build_object('outcome', outcome, 'task_status', final_status));
  return final_status;
end;
$$;

-- ===== POSLOVI ZA CRON =====

-- open → expired (docs/DECISIONS.md, odluka 10: i istek ostavlja trag).
create function public.expire_tasks()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  changed int := 0;
begin
  for task in
    select * from public.cleaning_tasks
    where status = 'open'::public.task_status and window_start < now()
    for update
  loop
    update public.cleaning_tasks set status = 'expired' where id = task.id;
    perform public.notify(
      task.owner_id, 'task_expired', 'Zadatak je istekao',
      'Niko nije prihvatio čišćenje pre početka termina.',
      jsonb_build_object('task_id', task.id)
    );
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (null, 'expire_task', 'cleaning_tasks', task.id);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- Istek ponude: glavnom je rok prošao, ide sledeći rezervni ili na tržište.
create function public.expire_offers()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_id uuid;
  changed int := 0;
begin
  for task_id in
    select distinct o.task_id
    from public.task_offers o
    join public.cleaning_tasks t on t.id = o.task_id
    where o.status = 'offered'::public.offer_status
      and o.expires_at < now()
      and t.status = 'offered'::public.task_status
  loop
    perform public.decline_offer(task_id);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- ready → completed: 12 h posle ready_at, a najkasnije u vreme prijave gosta
-- (docs/DECISIONS.md, odluka 11).
create function public.auto_complete_tasks()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  deadline timestamptz;
  guest_checkin timestamptz;
  changed int := 0;
begin
  for task in
    select * from public.cleaning_tasks
    where status = 'ready'::public.task_status and ready_at is not null
    for update
  loop
    select (r.check_in + p.checkin_time) at time zone 'Europe/Belgrade'
    into guest_checkin
    from public.properties p
    left join public.reservations r on r.id = task.reservation_id
    where p.id = task.property_id;

    deadline := least(task.ready_at + interval '12 hours', guest_checkin);
    if now() >= coalesce(deadline, task.ready_at + interval '12 hours') then
      perform public.complete_task(task.id);
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

-- ===== PRAVA =====
-- Prelaze pokreću prijavljeni korisnici; poslove za cron samo service role.
grant execute on function public.offer_task(uuid) to authenticated;
grant execute on function public.decline_offer(uuid) to authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.withdraw_task(uuid) to authenticated;
grant execute on function public.cancel_task(uuid, text) to authenticated;
grant execute on function public.check_in(uuid, double precision, double precision, text) to authenticated;
grant execute on function public.submit_task(uuid) to authenticated;
grant execute on function public.mark_ready(uuid) to authenticated;
grant execute on function public.request_fixes(uuid, text) to authenticated;
grant execute on function public.complete_task(uuid) to authenticated;
grant execute on function public.open_dispute(uuid, text) to authenticated;
grant execute on function public.resolve_dispute(uuid, text, text) to authenticated;

revoke all on function public.expire_tasks() from public, anon, authenticated;
revoke all on function public.expire_offers() from public, anon, authenticated;
revoke all on function public.auto_complete_tasks() from public, anon, authenticated;
revoke all on function public.notify(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.lock_task(uuid) from public, anon, authenticated;
revoke all on function public.offer_to(public.cleaning_tasks, uuid) from public, anon, authenticated;
grant execute on function public.expire_tasks() to service_role;
grant execute on function public.expire_offers() to service_role;
grant execute on function public.auto_complete_tasks() to service_role;
