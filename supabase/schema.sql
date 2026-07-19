-- =========================================================
-- Création Audio — schéma Supabase
-- À exécuter dans : Supabase ▸ SQL Editor ▸ New query ▸ (coller) ▸ Run
--
-- Le site n'utilise plus qu'UNE table : l'inventaire.
-- (Le suivi des commandes et la messagerie ont été retirés :
--  tout passe désormais par Messenger.)
-- =========================================================

-- ---------------------------------------------------------
-- INVENTAIRE — lecture publique, écriture réservée à l'admin connecté
-- ---------------------------------------------------------
create table if not exists public.inventory (
  code       text primary key,
  name       text not null,
  qty        integer not null default 0,   -- recharges (refills, sans bobine)
  qty_spool  integer not null default 0,   -- avec bobine
  updated_at timestamptz not null default now()
);
-- si la table existait déjà sans la colonne (bases créées avant l'ajout) :
alter table public.inventory add column if not exists qty_spool integer not null default 0;

alter table public.inventory enable row level security;

drop policy if exists inventory_public_read on public.inventory;
create policy inventory_public_read
  on public.inventory for select
  to anon, authenticated
  using (true);

drop policy if exists inventory_admin_write on public.inventory;
create policy inventory_admin_write
  on public.inventory for all
  to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------
-- DONNÉES DE DÉPART — inventaire (30 couleurs PLA Basic)
--   Les autres matériaux sont ajoutés par supabase/insert-materials.sql.
--   Modifie ensuite les quantités depuis le panneau admin du site.
-- ---------------------------------------------------------
insert into public.inventory (code, name, qty) values
  ('10100','Jade White',6), ('10101','Black',12), ('10102','Silver',0),
  ('10103','Gray',8), ('10104','Light Gray',5), ('10105','Dark Gray',3),
  ('10200','Red',10), ('10201','Beige',0), ('10202','Magenta',4),
  ('10203','Pink',7), ('10204','Hot Pink',2), ('10205','Maroon Red',1),
  ('10300','Orange',9), ('10301','Pumpkin Orange',0), ('10400','Yellow',6),
  ('10401','Gold',3), ('10402','Sunflower Yellow',5), ('10501','Bambu Green',8),
  ('10502','Mistletoe Green',4), ('10503','Bright Green',0), ('10601','Blue',7),
  ('10602','Blue Grey',2), ('10603','Cyan',5), ('10604','Cobalt Blue',1),
  ('10605','Turquoise',6), ('10700','Purple',4), ('10701','Indigo Purple',0),
  ('10800','Brown',3), ('10801','Bronze',2), ('10802','Cocoa Brown',5)
on conflict (code) do nothing;
