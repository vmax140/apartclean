-- Faza 1A: storage bucketi i politike (SPEC sekcija 4, poslednja stavka).
-- Putanje su po docs/DECISIONS.md, odluka 5:
--   avatars             {user_id}.jpg                                   javan
--   reference-photos    {property_id}/{room_id}/{photo_id}.jpg          privatan
--   task-photos         {task_id}/{photo_id}.jpg                        privatan
--   verification-docs   {user_id}/{request_id}-front|selfie.jpg         privatan, čita samo admin

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp']),
  ('reference-photos', 'reference-photos', false, 5242880, array['image/jpeg','image/webp']),
  ('task-photos', 'task-photos', false, 5242880, array['image/jpeg','image/webp']),
  ('verification-docs', 'verification-docs', false, 5242880, array['image/jpeg','image/webp'])
on conflict (id) do nothing;

-- ===== AVATARI =====
-- Bucket je javan, pa je čitanje slobodno; upisuje samo vlasnik svog fajla.
create policy apartclean_storage_active_account on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id not in ('avatars', 'reference-photos', 'task-photos', 'verification-docs')
    or (select public.account_is_active())
  )
  with check (
    bucket_id not in ('avatars', 'reference-photos', 'task-photos', 'verification-docs')
    or (select public.account_is_active())
  );

create policy avatars_read on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'avatars');

create policy avatars_write_self on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  );

create policy avatars_update_self on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and split_part(name, '.', 1) = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and split_part(name, '.', 1) = (select auth.uid())::text);

create policy avatars_delete_self on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '.', 1) = (select auth.uid())::text);

-- ===== REFERENTNE SLIKE =====
-- Prvi segment putanje je property_id.
create policy reference_photos_owner_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'reference-photos'
    and (
      public.owns_property(public.safe_uuid((storage.foldername(name))[1]))
      or public.is_admin()
    )
  )
  with check (
    bucket_id = 'reference-photos'
    and (
      public.owns_property(public.safe_uuid((storage.foldername(name))[1]))
      or public.is_admin()
    )
  );

create policy reference_photos_assigned_cleaner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reference-photos'
    and exists (
      select 1 from public.cleaning_tasks t
      where t.property_id = public.safe_uuid((storage.foldername(name))[1])
        and t.cleaner_id = (select auth.uid())
    )
  );

-- ===== SLIKE ZADATAKA =====
-- Prvi segment putanje je task_id. Upis samo dodeljeni spremač i samo dok radi.
create policy task_photos_cleaner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-photos'
    and exists (
      select 1 from public.cleaning_tasks t
      where t.id = public.safe_uuid((storage.foldername(name))[1])
        and t.cleaner_id = (select auth.uid())
        and t.status in ('in_progress'::public.task_status, 'needs_fixes'::public.task_status)
    )
  );

create policy task_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-photos'
    and (
      public.owns_task(public.safe_uuid((storage.foldername(name))[1]))
      or public.is_assigned_cleaner(public.safe_uuid((storage.foldername(name))[1]))
      or public.is_admin()
    )
  );

create policy task_photos_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'task-photos' and public.is_admin())
  with check (bucket_id = 'task-photos' and public.is_admin());

-- ===== DOKUMENTI ZA VERIFIKACIJU =====
-- Prvi segment putanje je user_id. Korisnik sme da pošalje svoj dokument, ali ga
-- posle ne čita — čita ga samo admin (SPEC sekcija 4). Brisanje radi Edge Function
-- verify-decision preko service role, odmah po odluci (SPEC sekcija 9).
create policy verification_docs_insert_self on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy verification_docs_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'verification-docs' and public.is_admin());

create policy verification_docs_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'verification-docs' and public.is_admin());
