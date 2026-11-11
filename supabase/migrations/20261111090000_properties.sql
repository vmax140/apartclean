-- Faza 1C: pravljenje apartmana u jednom koraku i upis pristupnih podataka.
-- Izvor: docs/SPEC.md sekcija 7 (vlasnik) i docs/DECISIONS.md, odluke 4 i 5.

-- audit_log nema INSERT politiku ni za koga (Faza 1A), pa funkcije koje rade kao
-- pozivalac ne mogu da upišu trag. Ovaj upisivač je jedini put: podiže pravo samo
-- za taj jedan upis i actor_id uzima iz prijave, pa niko ne može da se potpiše tuđim imenom.
create function public.write_audit(action text, entity text, entity_id uuid, data jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values ((select auth.uid()), action, entity, entity_id, data);
end;
$$;

revoke all on function public.write_audit(text, text, uuid, jsonb) from public, anon;
grant execute on function public.write_audit(text, text, uuid, jsonb) to authenticated;

-- Čarobnjak pravi apartman, sobe, kalendare i checklistu. Bez ovoga bi to bilo
-- nekoliko odvojenih upisa, pa bi prekid na pola ostavljao apartman bez soba.
-- SECURITY INVOKER (podrazumevano): RLS i dalje važi, vlasnik upisuje samo svoje.
create function public.create_property(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  caller uuid := (select auth.uid());
  new_property uuid;
  template uuid;
  room jsonb;
  room_id uuid;
  room_types public.room_type[] := '{}';
begin
  if caller is null then
    raise exception 'NIJE_PRIJAVLJEN: potrebna je prijava' using errcode = '28000';
  end if;

  if jsonb_typeof(payload -> 'rooms') is distinct from 'array'
     or jsonb_array_length(payload -> 'rooms') = 0 then
    raise exception 'SOBE_OBAVEZNE: apartman mora imati bar jednu sobu' using errcode = '22023';
  end if;

  insert into public.properties (
    owner_id, region_id, name, address, complex_name, lat, lng, geofence_m,
    size_m2, bedrooms, bathrooms, beds, max_guests,
    checkout_time, checkin_time, est_duration_min, default_price_rsd, cleaning_notes
  )
  values (
    caller,
    (payload ->> 'region_id')::int,
    payload ->> 'name',
    payload ->> 'address',
    nullif(payload ->> 'complex_name', ''),
    (payload ->> 'lat')::double precision,
    (payload ->> 'lng')::double precision,
    coalesce((payload ->> 'geofence_m')::int, 150),
    (payload ->> 'size_m2')::int,
    (payload ->> 'bedrooms')::int,
    (payload ->> 'bathrooms')::int,
    (payload ->> 'beds')::int,
    (payload ->> 'max_guests')::int,
    coalesce((payload ->> 'checkout_time')::time, '10:00'),
    coalesce((payload ->> 'checkin_time')::time, '14:00'),
    coalesce((payload ->> 'est_duration_min')::int, 120),
    (payload ->> 'default_price_rsd')::int,
    nullif(payload ->> 'cleaning_notes', '')
  )
  returning id into new_property;

  for room in select * from jsonb_array_elements(payload -> 'rooms') loop
    insert into public.property_rooms (property_id, type, name, sort_order)
    values (
      new_property,
      (room ->> 'type')::public.room_type,
      room ->> 'name',
      coalesce((room ->> 'sort_order')::int, 0)
    )
    returning id into room_id;
    room_types := room_types || (room ->> 'type')::public.room_type;
  end loop;

  if jsonb_typeof(payload -> 'calendars') = 'array' then
    insert into public.property_calendars (property_id, source, ical_url)
    select new_property, entry ->> 'source', entry ->> 'ical_url'
    from jsonb_array_elements(payload -> 'calendars') as entry
    where coalesce(entry ->> 'ical_url', '') <> '';
  end if;

  -- Checklista se kopira iz podrazumevanog šablona, ali samo stavke za sobe koje
  -- ovaj apartman zaista ima, plus opšte stavke (room_type is null).
  insert into public.checklist_templates (property_id, name)
  values (new_property, payload ->> 'name')
  returning id into template;

  insert into public.checklist_items (template_id, room_type, label, requires_photo, sort_order)
  select template, source.room_type, source.label, source.requires_photo, source.sort_order
  from public.checklist_items source
  join public.checklist_templates base on base.id = source.template_id
  where base.property_id is null
    and (source.room_type is null or source.room_type = any (room_types));

  perform public.write_audit('create_property', 'properties', new_property);

  return new_property;
end;
$$;

revoke all on function public.create_property(jsonb) from public, anon;
grant execute on function public.create_property(jsonb) to authenticated;

-- Pristupni podaci stižu već šifrovani iz Edge Function-a property-access
-- (docs/DECISIONS.md, odluka 4). Baza ih samo čuva; ključ nikad ne dolazi ovde.
create function public.set_property_access(
  target_property uuid,
  owner uuid,
  instructions text,
  lockbox text,
  wifi text,
  wifi_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.properties
    where id = target_property and owner_id = owner
  ) then
    raise exception 'NIJE_VAS_APARTMAN: pristupne podatke menja samo vlasnik'
      using errcode = '42501';
  end if;

  insert into public.property_access as pa
    (property_id, key_instructions, lockbox_code_encrypted, wifi_name, wifi_password_encrypted)
  values (target_property, instructions, lockbox, wifi, wifi_secret)
  on conflict (property_id) do update set
    key_instructions = excluded.key_instructions,
    lockbox_code_encrypted = excluded.lockbox_code_encrypted,
    wifi_name = excluded.wifi_name,
    wifi_password_encrypted = excluded.wifi_password_encrypted,
    updated_at = now();

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (owner, 'set_property_access', 'properties', target_property);
end;
$$;

revoke all on function public.set_property_access(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_property_access(uuid, uuid, text, text, text, text) to service_role;

-- Vlasnik svoje šifre čita isključivo kroz Edge Function, da ne bi šifrovani
-- zapis izlazio u klijenta bez potrebe.
create function public.get_property_access_for_owner(target_property uuid, owner uuid)
returns table (
  key_instructions text,
  lockbox_code_encrypted text,
  wifi_name text,
  wifi_password_encrypted text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.properties
    where id = target_property and owner_id = owner
  ) then
    raise exception 'NIJE_VAS_APARTMAN: pristupne podatke vidi samo vlasnik'
      using errcode = '42501';
  end if;

  return query
    select pa.key_instructions, pa.lockbox_code_encrypted, pa.wifi_name, pa.wifi_password_encrypted
    from public.property_access pa
    where pa.property_id = target_property;
end;
$$;

revoke all on function public.get_property_access_for_owner(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_property_access_for_owner(uuid, uuid) to service_role;
