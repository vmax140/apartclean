-- Faza 2B: kalendar i automatika (SPEC sekcije 5 i 6).
--
-- Logika stoji u bazi, a Edge Function ical-sync samo skida i raščlanjuje iCal pa
-- je prosledi ovamo. Tako se pravilo šta postaje zadatak i šta se otkazuje može
-- testirati bez ijednog HTTP poziva.

-- ===== KALENDAR =====

-- Pravi zadatak za dan odjave, u prozoru od odjave do prijave sledećeg gosta.
create function public.ensure_task_for_reservation(target_reservation uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.reservations;
  property public.properties;
  task_id uuid;
begin
  select * into reservation from public.reservations where id = target_reservation;
  select * into property from public.properties where id = reservation.property_id;

  select id into task_id from public.cleaning_tasks
  where reservation_id = reservation.id
    and status <> 'cancelled'::public.task_status;
  if found then
    return task_id;
  end if;

  insert into public.cleaning_tasks (
    property_id, owner_id, reservation_id, type, status,
    window_start, window_end, price_rsd, checklist_template_id
  )
  values (
    property.id, property.owner_id, reservation.id, 'turnover', 'draft',
    (reservation.check_out + property.checkout_time) at time zone 'Europe/Belgrade',
    (reservation.check_out + property.checkin_time) at time zone 'Europe/Belgrade',
    property.default_price_rsd,
    (select ct.id from public.checklist_templates ct where ct.property_id = property.id limit 1)
  )
  returning id into task_id;

  perform public.notify(
    property.owner_id, 'task_created', 'Novo čišćenje iz kalendara',
    'Rezervacija se završava ' || to_char(reservation.check_out, 'DD.MM.') || '.',
    jsonb_build_object('task_id', task_id, 'property_id', property.id)
  );
  return task_id;
end;
$$;

-- Jedna sinhronizacija jednog kalendara. events je niz {uid, checkIn, checkOut}.
create function public.sync_reservations(target_calendar uuid, events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  calendar public.property_calendars;
  event jsonb;
  seen text[] := '{}';
  reservation public.reservations;
  created int := 0;
  cancelled int := 0;
  task public.cleaning_tasks;
begin
  select * into calendar from public.property_calendars where id = target_calendar;
  if not found then
    raise exception 'KALENDAR_NE_POSTOJI: kalendar nije pronađen' using errcode = 'P0002';
  end if;

  for event in select * from jsonb_array_elements(events) loop
    seen := seen || (event ->> 'uid');

    insert into public.reservations (property_id, calendar_id, external_uid, check_in, check_out)
    values (
      calendar.property_id, calendar.id, event ->> 'uid',
      (event ->> 'checkIn')::date, (event ->> 'checkOut')::date
    )
    on conflict (calendar_id, external_uid) do update set
      check_in = excluded.check_in,
      check_out = excluded.check_out,
      is_cancelled = false
    returning * into reservation;

    if public.ensure_task_for_reservation(reservation.id) is not null then
      created := created + 1;
    end if;
  end loop;

  -- Rezervacija koje više nema u izvozu je otkazana kod gosta.
  for reservation in
    select * from public.reservations
    where calendar_id = calendar.id
      and not is_cancelled
      and not (external_uid = any (seen))
  loop
    update public.reservations set is_cancelled = true where id = reservation.id;
    cancelled := cancelled + 1;

    select * into task from public.cleaning_tasks
    where reservation_id = reservation.id
      and status not in ('cancelled'::public.task_status, 'completed'::public.task_status);
    if found then
      if task.status in ('draft'::public.task_status, 'offered'::public.task_status,
                         'open'::public.task_status) then
        -- Niko još nije prihvatio: zadatak se gasi sam (SPEC sekcija 6, Izuzeci).
        update public.cleaning_tasks set
          status = 'cancelled', cancelled_at = now(),
          cancel_reason = 'Rezervacija je otkazana u kalendaru.'
        where id = task.id;
        update public.task_offers set status = 'withdrawn', responded_at = now()
        where task_id = task.id and status = 'offered'::public.offer_status;
      else
        -- Spremačica je već prihvatila: odluku donosi vlasnik.
        perform public.notify(
          task.owner_id, 'reservation_cancelled', 'Rezervacija je otkazana',
          'Spremačica je već prihvatila ovo čišćenje. Potvrdi da li ga otkazuješ.',
          jsonb_build_object('task_id', task.id)
        );
      end if;
    end if;
  end loop;

  update public.property_calendars set last_synced_at = now(), last_error = null
  where id = calendar.id;

  return jsonb_build_object('created', created, 'cancelled', cancelled);
end;
$$;

create function public.record_calendar_error(target_calendar uuid, message text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.property_calendars
  set last_synced_at = now(), last_error = left(message, 500)
  where id = target_calendar;
$$;

-- ===== NEDOLAZAK =====

-- 30 min posle početka bez prijave dolaska: alarm vlasniku i ponuda rezervnoj
-- (SPEC sekcija 6, Izuzeci). Pošto zadatak izađe iz statusa accepted, isti red
-- se sledeći put više ne hvata, pa alarm ne može da se ponovi.
create function public.flag_no_shows()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  absent uuid;
  next_cleaner uuid;
  changed int := 0;
begin
  for task in
    select * from public.cleaning_tasks
    where status = 'accepted'::public.task_status
      and arrived_at is null
      and window_start + interval '30 minutes' < now()
    for update
  loop
    absent := task.cleaner_id;

    update public.task_offers set status = 'expired', responded_at = now()
    where task_id = task.id and cleaner_id = absent;

    update public.cleaner_profiles set
      reliability_pct = greatest(0, round(coalesce(reliability_pct, 100) - 10, 2))
    where user_id = absent;

    next_cleaner := public.next_team_cleaner(task.id, task.owner_id);
    update public.cleaning_tasks set
      status = case when next_cleaner is null then 'open' else 'offered' end::public.task_status,
      cleaner_id = null,
      accepted_at = null
    where id = task.id;

    if next_cleaner is not null then
      perform public.offer_to(task, next_cleaner);
    end if;

    perform public.notify(
      task.owner_id, 'task_no_show', 'Spremačica nije stigla',
      'Prošlo je 30 minuta od početka termina. Zadatak je ponuđen dalje.',
      jsonb_build_object('task_id', task.id)
    );
    insert into public.audit_log (actor_id, action, entity, entity_id, data)
    values (null, 'no_show', 'cleaning_tasks', task.id, jsonb_build_object('cleaner', absent));
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- ===== OBJAVA OCENA =====

-- Objavi kada obe strane ocene, ili 7 dana posle prve ocene
-- (docs/DECISIONS.md, odluka 14).
create function public.publish_due_reviews()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.reviews;
  changed int := 0;
begin
  for review in
    select r.* from public.reviews r
    where r.published_at is null
      and (
        exists (
          select 1 from public.reviews other
          where other.task_id = r.task_id and other.reviewer_id <> r.reviewer_id
        )
        or r.created_at < now() - interval '7 days'
      )
    for update
  loop
    update public.reviews set published_at = now() where id = review.id;

    -- Prosečna ocena se računa samo iz objavljenih.
    update public.profiles p set
      rating_avg = sub.avg_rating,
      rating_count = sub.n
    from (
      select reviewee_id, round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as n
      from public.reviews
      where reviewee_id = review.reviewee_id and published_at is not null
      group by reviewee_id
    ) as sub
    where p.id = sub.reviewee_id;

    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- ===== PRAVA =====
revoke all on function public.sync_reservations(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ensure_task_for_reservation(uuid) from public, anon, authenticated;
revoke all on function public.record_calendar_error(uuid, text) from public, anon, authenticated;
revoke all on function public.flag_no_shows() from public, anon, authenticated;
revoke all on function public.publish_due_reviews() from public, anon, authenticated;
grant execute on function public.sync_reservations(uuid, jsonb) to service_role;
grant execute on function public.record_calendar_error(uuid, text) to service_role;
grant execute on function public.flag_no_shows() to service_role;
grant execute on function public.publish_due_reviews() to service_role;

-- ===== CRON POSLOVI (SPEC sekcija 5) =====
-- Ping protiv pauziranja namerno nije ovde: pauziran projekat ne pokreće svoj
-- pg_cron, pa poziv mora da dođe spolja (docs/DECISIONS.md, odluka 15).

select cron.schedule('ical-sync', '*/30 * * * *',
  $$select public.call_edge_function('ical-sync')$$);

select cron.schedule('expire-offers', '*/5 * * * *',
  $$select public.expire_offers()$$);

select cron.schedule('flag-no-shows', '*/5 * * * *',
  $$select public.flag_no_shows()$$);

select cron.schedule('auto-complete-tasks', '*/15 * * * *',
  $$select public.auto_complete_tasks()$$);

select cron.schedule('expire-tasks', '*/15 * * * *',
  $$select public.expire_tasks()$$);

select cron.schedule('publish-reviews', '30 2 * * *',
  $$select public.publish_due_reviews()$$);

select cron.schedule('purge-task-photos', '45 3 * * *',
  $$select public.call_edge_function('purge-task-photos')$$);
