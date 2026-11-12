-- Faza 2D: rad na terenu (SPEC sekcija 6, koraci 5–8).
--
-- Zatvara rupu iz Faze 2A: nijedna funkcija nije popunjavala task_checklist, pa
-- je provera u submit_task prolazila prazna — spremačica ne bi imala nijednu
-- stavku, a predaja bi svejedno prošla.

-- Checklista se prepisuje iz šablona apartmana u trenutku dolaska. Tekst se
-- kopira (SPEC sekcija 3), da kasnija izmena šablona ne menja već odrađen posao.
-- Stavke vezane za tip sobe se umnožavaju po svakoj sobi tog tipa: apartman sa
-- dva kupatila dobija obe liste.
create function public.materialize_checklist(target_task uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  template uuid;
  added int := 0;
begin
  select * into task from public.cleaning_tasks where id = target_task;
  if not found then
    raise exception 'ZADATAK_NE_POSTOJI: zadatak nije pronađen' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.task_checklist where task_id = task.id) then
    return 0;
  end if;

  template := coalesce(
    task.checklist_template_id,
    (select ct.id from public.checklist_templates ct where ct.property_id = task.property_id limit 1),
    (select ct.id from public.checklist_templates ct where ct.property_id is null limit 1)
  );
  if template is null then
    return 0;
  end if;

  -- Stavke po sobama.
  insert into public.task_checklist (task_id, checklist_item_id, room_id, label, requires_photo)
  select task.id, ci.id, pr.id, ci.label, ci.requires_photo
  from public.checklist_items ci
  join public.property_rooms pr
    on pr.property_id = task.property_id and pr.type = ci.room_type
  where ci.template_id = template;

  -- Opšte stavke, bez sobe.
  insert into public.task_checklist (task_id, checklist_item_id, room_id, label, requires_photo)
  select task.id, ci.id, null, ci.label, ci.requires_photo
  from public.checklist_items ci
  where ci.template_id = template and ci.room_type is null;

  select count(*) into added from public.task_checklist where task_id = task.id;

  if task.checklist_template_id is null then
    update public.cleaning_tasks set checklist_template_id = template where id = task.id;
  end if;
  return added;
end;
$$;

-- check_in sada i priprema checklistu. Stara verzija se zamenjuje u celosti.
create or replace function public.check_in(
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

  if distance > property.geofence_m and coalesce(trim(reason), '') = '' then
    raise exception 'VAN_KRUGA: udaljenost je % m, a dozvoljeno je % m — upiši razlog',
      distance, property.geofence_m
      using errcode = '22023';
  end if;

  update public.cleaning_tasks set
    status = 'in_progress', arrived_at = now(),
    arrival_lat = lat, arrival_lng = lng, arrival_distance_m = distance
  where id = task.id;

  perform public.materialize_checklist(task.id);

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

-- Predaja sada traži i sliku za svaku stavku koja je traži (SPEC sekcija 5:
-- „sve obavezne stavke i slike su poslate"). Ranije je bilo dovoljno da postoji
-- bilo koja slika, pa je stavka sa requires_photo mogla da prođe bez svoje.
create or replace function public.submit_task(target_task uuid)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  missing int;
  without_photo int;
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

  select count(*) into without_photo
  from public.task_checklist tc
  where tc.task_id = task.id
    and tc.requires_photo
    and not exists (
      select 1 from public.task_photos tp
      where tp.task_id = task.id
        and (tp.checklist_row_id = tc.id
             or (tc.room_id is not null and tp.room_id = tc.room_id))
    );
  if without_photo > 0 then
    raise exception 'FALE_SLIKE: % stavki čeka sliku', without_photo using errcode = '22023';
  end if;

  update public.cleaning_tasks set status = 'submitted', submitted_at = now()
  where id = task.id;

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

-- Prijava štete, nestale stvari ili kvara (SPEC sekcija 6, korak 6).
-- Vlasnik dobija obaveštenje odmah, ne na kraju posla.
create function public.report_property_issue(
  target_task uuid,
  category public.report_category,
  description text,
  photo_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.cleaning_tasks;
  caller uuid := (select auth.uid());
  report_id uuid;
begin
  if coalesce(trim(description), '') = '' then
    raise exception 'OPIS_OBAVEZAN: prijava traži opis' using errcode = '22023';
  end if;

  task := public.lock_task(target_task);
  if caller is distinct from task.cleaner_id and caller is distinct from task.owner_id then
    raise exception 'NIJE_VAS_ZADATAK: prijavu podnosi učesnik zadatka' using errcode = '42501';
  end if;

  insert into public.property_reports
    (task_id, property_id, reported_by, category, description, photo_ids)
  values (task.id, task.property_id, caller, category, trim(description), photo_ids)
  returning id into report_id;

  perform public.notify(
    task.owner_id, 'property_report', 'Prijava sa čišćenja',
    trim(description),
    jsonb_build_object('task_id', task.id, 'report_id', report_id, 'category', category)
  );
  perform public.write_audit('report_property_issue', 'property_reports', report_id);
  return report_id;
end;
$$;

grant execute on function public.report_property_issue(uuid, public.report_category, text, uuid[])
  to authenticated;
revoke all on function public.materialize_checklist(uuid) from public, anon;
grant execute on function public.materialize_checklist(uuid) to authenticated;

-- Edge Function zove kao service role, pa auth.uid() nema — korisnik se prosleđuje.
-- Provere su iste kao u get_access_info (SPEC sekcija 4): samo dodeljena
-- spremačica, samo u statusu accepted ili in_progress, i samo u vremenskom okviru.
create function public.get_access_info_for(target_task uuid, cleaner uuid)
returns table (
  property_id uuid,
  key_instructions text,
  lockbox_code_encrypted text,
  wifi_name text,
  wifi_password_encrypted text
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  task public.cleaning_tasks;
begin
  select * into task from public.cleaning_tasks where id = target_task;
  if not found then
    raise exception 'ZADATAK_NE_POSTOJI: zadatak nije pronađen' using errcode = 'P0002';
  end if;

  if task.cleaner_id is distinct from cleaner then
    raise exception 'NIJE_VAS_ZADATAK: pristupni podaci se vide samo za svoj zadatak'
      using errcode = '42501';
  end if;

  if task.status not in ('accepted'::public.task_status, 'in_progress'::public.task_status) then
    raise exception 'POGRESAN_STATUS: pristupni podaci se vide tek posle prihvatanja'
      using errcode = '42501';
  end if;

  if now() < task.window_start - interval '2 hours'
     or now() > task.window_end + interval '1 hour' then
    raise exception 'VAN_VREMENSKOG_OKVIRA: pristupni podaci se vide od 2 h pre do 1 h posle termina'
      using errcode = '42501';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (cleaner, 'get_access_info', 'cleaning_tasks', target_task);

  return query
    select pa.property_id, pa.key_instructions, pa.lockbox_code_encrypted,
           pa.wifi_name, pa.wifi_password_encrypted
    from public.property_access pa
    where pa.property_id = task.property_id;
end;
$$;

revoke all on function public.get_access_info_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_access_info_for(uuid, uuid) to service_role;
