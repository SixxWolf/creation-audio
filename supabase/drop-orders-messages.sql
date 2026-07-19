-- =========================================================
-- Création Audio — retrait des commandes et de la messagerie
-- À exécuter dans : Supabase ▸ SQL Editor ▸ New query ▸ (coller) ▸ Run
--
-- Le site ne gère plus ni commandes ni messages (tout passe par
-- Messenger). Ce script supprime les deux tables de la base.
-- ⚠️  DESTRUCTIF : efface définitivement les commandes et messages
--     existants. Exporte-les d'abord si tu veux en garder une trace.
--
-- Après ce script, la seule barrière RLS restante est l'inventaire
-- (lecture publique / écriture admin), et il n'y a plus AUCUNE table
-- avec des données personnelles exposées.
-- =========================================================

-- Retire les tables de la publication temps réel (ignore l'erreur si absentes)
do $$
begin
  begin
    alter publication supabase_realtime drop table public.orders;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime drop table public.messages;
  exception when others then null;
  end;
end $$;

-- Supprime les tables (et leurs policies/index/données)
drop table if exists public.orders   cascade;
drop table if exists public.messages cascade;

-- ---------------------------------------------------------
-- VÉRIFICATION — il ne doit rester QUE « inventory » :
--   select tablename from pg_tables where schemaname = 'public';
-- et une seule série de policies :
--   select tablename, policyname, roles, cmd
--     from pg_policies where schemaname = 'public' order by cmd;
-- ---------------------------------------------------------
