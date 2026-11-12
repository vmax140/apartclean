-- Faza 2C: dostava obaveštenja (SPEC sekcija 6, koraci 2–4).
--
-- Red u notifications nastaje unutar prelaza statusa. Slanje push-a i mejla je
-- posao Edge Function-a, a okidač je samo poziva. Ključno: slanje nikad ne sme
-- da obori prelaz. Ako okidač pukne — nema tajni u vault-u, Edge Function ne
-- odgovara, Expo je nedostupan — zadatak je svejedno prešao u novi status, a
-- greška ostaje zapisana u audit_log.

-- Uređaj zna samo svoj token; isti token može da pređe na drugi nalog kada se
-- neko odjavi i neko drugi prijavi na istom telefonu.
create function public.register_push_device(token text, device_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'NIJE_PRIJAVLJEN: potrebna je prijava' using errcode = '28000';
  end if;
  if token is null or token = '' or device_platform not in ('ios', 'android', 'web') then
    raise exception 'NEISPRAVAN_URED: token ili platforma nisu ispravni' using errcode = '22023';
  end if;

  delete from public.push_devices
  where expo_push_token = token and user_id <> caller;

  insert into public.push_devices (user_id, expo_push_token, platform)
  values (caller, token, device_platform)
  on conflict (expo_push_token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    last_seen_at = now();
end;
$$;

revoke all on function public.register_push_device(text, text) from public, anon;
grant execute on function public.register_push_device(text, text) to authenticated;

-- Token koji Expo prijavi kao nepostojeći briše Edge Function preko ove funkcije.
create function public.drop_push_device(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_devices where expo_push_token = token;
$$;

revoke all on function public.drop_push_device(text) from public, anon, authenticated;
grant execute on function public.drop_push_device(text) to service_role;

-- Dostava se beleži u data, da ne bismo dodavali kolone kojih nema u SPEC sekciji 3.
create function public.record_delivery(notification_id uuid, delivery jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set data = data || jsonb_build_object('delivery', delivery)
  where id = notification_id;
$$;

revoke all on function public.record_delivery(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_delivery(uuid, jsonb) to service_role;

create function public.deliver_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.call_edge_function(
      'send-notification',
      jsonb_build_object('notificationId', new.id)
    );
  exception when others then
    -- Namerno se guta: obaveštenje je sporedno u odnosu na prelaz koji ga je
    -- napravio. Trag ostaje, pa se tiha greška može naći.
    insert into public.audit_log (actor_id, action, entity, entity_id, data)
    values (null, 'notification_dispatch_failed', 'notifications', new.id,
            jsonb_build_object('error', sqlerrm));
  end;
  return new;
end;
$$;

create trigger notifications_deliver
  after insert on notifications
  for each row execute function public.deliver_notification();

-- Čišćenje uređaja koji se nisu javili tri meseca: stari tokeni samo prave
-- uzaludne pozive ka Expo-u.
create function public.purge_stale_devices()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  delete from public.push_devices where last_seen_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_stale_devices() from public, anon, authenticated;
grant execute on function public.purge_stale_devices() to service_role;

select cron.schedule('purge-stale-devices', '0 4 * * 0',
  $$select public.purge_stale_devices()$$);
