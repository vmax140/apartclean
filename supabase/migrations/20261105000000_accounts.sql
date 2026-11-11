create unique index legal_documents_one_active_version
  on public.legal_documents (kind) where is_active;

drop policy legal_acceptances_insert_self on public.legal_acceptances;
revoke insert on public.legal_acceptances from anon, authenticated;

create function public.require_adult_signup(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if event #> '{user,user_metadata,adult_confirmed}' is distinct from 'true'::jsonb then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'ADULT_CONFIRMATION_REQUIRED'
    ));
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.require_adult_signup(jsonb) from public, anon, authenticated;
grant execute on function public.require_adult_signup(jsonb) to supabase_auth_admin;

create function public.record_legal_acceptance(
  target_user uuid,
  document_ids uuid[],
  client_ip inet,
  client_agent text,
  client_version text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  account public.account_status;
  required_ids uuid[];
begin
  select status into account from public.profiles where id = target_user for update;
  if not found or account not in ('pending', 'active') then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  if not exists (select 1 from public.user_roles where user_id = target_user) then
    raise exception 'ROLE_REQUIRED' using errcode = '42501';
  end if;

  lock table public.legal_documents in share mode;
  select array_agg(d.id order by d.id) into required_ids
    from public.legal_documents d
    where d.is_active and (
      d.applies_to is null or exists (
        select 1 from public.user_roles r where r.user_id = target_user and r.role = any(d.applies_to)
      )
    )
    and not exists (
      select 1 from public.legal_acceptances a where a.user_id = target_user and a.document_id = d.id
    );

  if not coalesce(required_ids, '{}'::uuid[]) <@ coalesce(document_ids, '{}'::uuid[])
     or exists (
       select 1 from unnest(coalesce(document_ids, '{}'::uuid[])) as submitted(id)
       where not exists (
         select 1 from public.legal_documents d where d.id = submitted.id and d.is_active
         and (d.applies_to is null or exists (
           select 1 from public.user_roles r where r.user_id = target_user and r.role = any(d.applies_to)
         ))
       )
     ) then
    raise exception 'DOCUMENTS_CHANGED' using errcode = '22023';
  end if;

  if required_ids is not null then
    insert into public.legal_acceptances (user_id, document_id, ip_address, user_agent, app_version)
      select target_user, id, client_ip, client_agent, client_version from unnest(required_ids) as docs(id);
  end if;
  update public.profiles set status = 'active' where id = target_user and status = 'pending';
end;
$$;

revoke all on function public.record_legal_acceptance(uuid, uuid[], inet, text, text)
  from public, anon, authenticated;
grant execute on function public.record_legal_acceptance(uuid, uuid[], inet, text, text) to service_role;

create function public.anonymize_account(target_user uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.profiles
    set status = 'deleted', full_name = '', phone = null, phone_verified_at = null, avatar_url = null
    where id = target_user;
  delete from public.push_devices where user_id = target_user;
end;
$$;

revoke all on function public.anonymize_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account(uuid) to service_role;
