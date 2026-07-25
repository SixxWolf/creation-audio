-- ============================================================
-- Création Audio — restreindre l'accès admin à UN seul compte
-- ============================================================
-- Contexte : un dealer (ex. Olivier) a besoin d'un compte Supabase
-- pour l'espace dealer. Mais par défaut, TOUT compte connecté pouvait
-- écrire l'inventaire et lire les ventes (policies « to authenticated
-- using(true) »). Ce script réserve ces droits au SEUL compte admin,
-- pour qu'un dealer connecté ne puisse PAS toucher à l'administration.
--
-- Compte admin : creationaudio.ca@gmail.com
--
-- À exécuter dans Supabase : SQL Editor -> New query -> coller -> Run.
-- (Le blocage côté page admin.html/facture.html est en plus ; CECI est
--  le vrai verrou, côté serveur.)
-- ============================================================

-- --- INVENTAIRE : lecture publique conservée, écriture réservée à l'admin ---
drop policy if exists inventory_admin_write on public.inventory;
create policy inventory_admin_write
  on public.inventory for all
  to authenticated
  using ( (auth.jwt() ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( (auth.jwt() ->> 'email') = 'creationaudio.ca@gmail.com' );

-- --- VENTES : lecture ET insertion réservées à l'admin (données privées) ---
drop policy if exists sales_admin_read on public.sales;
create policy sales_admin_read
  on public.sales for select
  to authenticated
  using ( (auth.jwt() ->> 'email') = 'creationaudio.ca@gmail.com' );

drop policy if exists sales_admin_insert on public.sales;
create policy sales_admin_insert
  on public.sales for insert
  to authenticated
  with check ( (auth.jwt() ->> 'email') = 'creationaudio.ca@gmail.com' );

-- Note : la table « spacers » est déjà restreinte à l'admin par
-- supabase/add-spacers.sql (même filtre courriel). La lecture des spacers
-- reste ouverte aux comptes connectés pour que le dealer voie le catalogue.

-- Vérification : liste des policies actives sur ces tables
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('inventory','sales','spacers')
order by tablename, policyname;
