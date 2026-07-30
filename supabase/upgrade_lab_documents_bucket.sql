-- lab-documents storage bucket -----------------------------------------------
-- SDS, certificate of analysis, and invoice/delivery-order files attached to a
-- chemical registration. Same reasoning as the delivery-photos bucket: private
-- (not `public`), because an invoice shows pricing and a CoA can show batch
-- detail — gated by the same approval check as everything else, not
-- "unlisted but guessable."
--
-- The chemicals.sds_url / coa_url / invoice_url columns already exist and
-- historically held plain external links (a manufacturer's SDS page, say).
-- Uploaded files are stored under this bucket and referenced from the same
-- columns using a `storage:` prefix so the app can tell "external URL, use
-- as-is" apart from "our bucket, mint a signed URL" without a schema change.
insert into storage.buckets (id, name, public)
values ('lab-documents', 'lab-documents', false)
on conflict (id) do nothing;

drop policy if exists "approved users manage lab documents" on storage.objects;
create policy "approved users manage lab documents"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'lab-documents' and public.is_approved())
  with check (bucket_id = 'lab-documents' and public.is_approved());

notify pgrst, 'reload schema';
