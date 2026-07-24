-- ============================================================
-- Création Audio — journal des ventes
-- Chaque ligne = un article vendu, enregistré au moment où tu
-- cliques « Déduire de l'inventaire » dans la facturation.
--
-- À exécuter dans Supabase : SQL Editor -> New query -> coller -> Run.
--
-- Données d'affaires PRIVÉES : lecture et écriture réservées à
-- l'admin connecté (aucun accès anonyme, contrairement à l'inventaire).
--
-- NB : le suivi ne compte que les ventes postérieures à l'exécution
-- de ce script (pas d'historique rétroactif).
-- ============================================================

create table if not exists public.sales (
  id          bigint generated always as identity primary key,
  sold_at     timestamptz not null default now(),
  invoice_no  text,
  code        text not null,
  name        text,
  material    text,
  type        text not null default 'refill',   -- refill | spool | accessory
  qty         integer not null,
  unit_price  numeric(10,2) not null default 0
);

create index if not exists sales_sold_at_idx on public.sales (sold_at desc);

alter table public.sales enable row level security;

-- lecture : admin connecté uniquement
drop policy if exists sales_admin_read on public.sales;
create policy sales_admin_read
  on public.sales for select
  to authenticated
  using (true);

-- insertion : admin connecté uniquement
drop policy if exists sales_admin_insert on public.sales;
create policy sales_admin_insert
  on public.sales for insert
  to authenticated
  with check (true);

-- (pas de politique pour « anon » = aucun accès public à cette table)

-- Vérification : la table existe et est vide au départ
select count(*) as ventes_enregistrees from public.sales;
