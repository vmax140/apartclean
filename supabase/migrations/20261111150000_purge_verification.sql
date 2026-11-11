-- Dnevno čišćenje dokumenata za verifikaciju.
--
-- SPEC sekcija 9 pokriva samo brisanje posle odluke administratora. Zahtev o kom
-- se nikad ne odluči ostavljao bi ličnu kartu i selfi u storage-u zauvek, što se
-- kosi sa politikom privatnosti. Posao briše takve fajlove posle 7 dana.
--
-- Ovo je prvi pg_cron posao u projektu; tabela svih poslova je u SPEC sekciji 5
-- i popunjava se u Fazi 2B.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Nov zahtev poništava stari koji još čeka: administrator treba da gleda samo
-- najnovije slike, a stare fajlove pokupi dnevni posao.
create function public.supersede_verification_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.verification_requests set
    status = 'rejected'::public.verification_status,
    rejection_reason = 'Zamenjen novijim zahtevom.',
    reviewed_at = now()
  where user_id = new.user_id
    and id <> new.id
    and status = 'pending'::public.verification_status;
  return new;
end;
$$;

create trigger verification_requests_supersede
  after insert on verification_requests
  for each row execute function public.supersede_verification_requests();

-- Adresa i ključ za poziv Edge Function-a čuvaju se u vault-u, ne u kodu.
-- Lokalno ih upisuje supabase/seed.sql; na pravom projektu vlasnik ih unosi sam.
create function public.call_edge_function(function_name text, payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  service_key text;
begin
  select decrypted_secret into base_url
  from vault.decrypted_secrets where name = 'edge_functions_url';
  select decrypted_secret into service_key
  from vault.decrypted_secrets where name = 'service_role_key';

  if base_url is null or service_key is null then
    raise exception 'TAJNE_NEDOSTAJU: upiši edge_functions_url i service_role_key u vault'
      using errcode = '42704';
  end if;

  return extensions.net_http_post(
    url := base_url || '/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := payload,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

-- Jednom dnevno u 3:15 ujutru, kada nema saobraćaja.
select cron.schedule(
  'purge-verification-docs',
  '15 3 * * *',
  $$select public.call_edge_function('purge-verification-docs')$$
);
