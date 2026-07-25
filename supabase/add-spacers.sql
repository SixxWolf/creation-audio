-- ============================================================
-- Création Audio — Spacers imprimés 3D (annonces)
-- Gérés depuis l'onglet « Spacers » du panneau admin.
--
-- À exécuter dans Supabase : SQL Editor -> New query -> coller -> Run.
--
-- Modèle de confidentialité : ces annonces ne sont PAS publiques.
--   - lecture  : réservée aux comptes CONNECTÉS (toi + Olivier plus tard)
--                => invisibles pour un visiteur anonyme du site.
--   - écriture : réservée aux comptes connectés (admin).
--
-- NB (phase 2 — portail dealer) : quand le compte d'Olivier sera créé,
-- il faudra RESTREINDRE l'écriture à l'admin uniquement (par ex. selon
-- l'e-mail / un rôle), sinon un dealer connecté pourrait modifier une
-- annonce. Pour l'instant seul le compte admin existe : OK.
-- ============================================================

-- ---------------------------------------------------------
-- TABLE
-- ---------------------------------------------------------
create table if not exists public.spacers (
  id          bigint generated always as identity primary key,
  name        text    not null,
  price       numeric(10,2) not null default 0,
  qty         integer not null default 0,     -- quantité disponible (0 = rupture)
  tiers       jsonb   not null default '[]'::jsonb,  -- rabais quantité : [{min:5,price:10},{min:20,price:9}]
  image_path  text,                            -- chemin dans le bucket Storage « spacers »
  active      boolean not null default true,   -- visible pour les dealers (permet de masquer sans supprimer)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- si la table existait déjà sans la colonne (base créée avant l'ajout des paliers) :
alter table public.spacers add column if not exists tiers jsonb not null default '[]'::jsonb;

create index if not exists spacers_created_at_idx on public.spacers (created_at desc);

alter table public.spacers enable row level security;

-- lecture : comptes connectés uniquement (aucun accès anonyme)
drop policy if exists spacers_auth_read on public.spacers;
create policy spacers_auth_read
  on public.spacers for select
  to authenticated
  using (true);

-- écriture : comptes connectés uniquement (admin)
-- (à resserrer en phase 2, cf. en-tête)
drop policy if exists spacers_admin_write on public.spacers;
create policy spacers_admin_write
  on public.spacers for all
  to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------
-- STORAGE — bucket des photos de spacers
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('spacers', 'spacers', true)
on conflict (id) do nothing;

-- lecture publique des fichiers (les photos s'affichent partout via URL publique) :
drop policy if exists spacers_files_public_read on storage.objects;
create policy spacers_files_public_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'spacers');

-- dépôt / remplacement / suppression : comptes connectés (admin)
drop policy if exists spacers_files_admin_insert on storage.objects;
create policy spacers_files_admin_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'spacers');

drop policy if exists spacers_files_admin_update on storage.objects;
create policy spacers_files_admin_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'spacers') with check (bucket_id = 'spacers');

drop policy if exists spacers_files_admin_delete on storage.objects;
create policy spacers_files_admin_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'spacers');

-- ---------------------------------------------------------
-- PHASE 2 — ÉCRITURE RÉSERVÉE À L'ADMIN (creationaudio.ca@gmail.com)
-- Un dealer connecté (ex. Olivier) pourra LIRE le catalogue mais PAS
-- modifier les annonces ni les photos. Ce bloc est ACTIF : il s'exécute
-- avec le reste du script.
-- ---------------------------------------------------------
drop policy if exists spacers_admin_write on public.spacers;
create policy spacers_admin_write
  on public.spacers for all
  to authenticated
  using ( (auth.jwt() ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( (auth.jwt() ->> 'email') = 'creationaudio.ca@gmail.com' );

-- idem pour les fichiers photos (dépôt/màj/suppression réservés à l'admin) :
drop policy if exists spacers_files_admin_insert on storage.objects;
create policy spacers_files_admin_insert on storage.objects for insert
  to authenticated with check (bucket_id='spacers' and (auth.jwt() ->> 'email')='creationaudio.ca@gmail.com');
drop policy if exists spacers_files_admin_update on storage.objects;
create policy spacers_files_admin_update on storage.objects for update
  to authenticated using (bucket_id='spacers' and (auth.jwt() ->> 'email')='creationaudio.ca@gmail.com')
  with check (bucket_id='spacers' and (auth.jwt() ->> 'email')='creationaudio.ca@gmail.com');
drop policy if exists spacers_files_admin_delete on storage.objects;
create policy spacers_files_admin_delete on storage.objects for delete
  to authenticated using (bucket_id='spacers' and (auth.jwt() ->> 'email')='creationaudio.ca@gmail.com');

-- Vérification
select count(*) as spacers_enregistres from public.spacers;
