-- =========================================================
-- Création Audio — ajout du 2e stock « avec bobine »
-- À exécuter dans : Supabase ▸ SQL Editor ▸ New query ▸ (coller) ▸ Run
-- Idempotent : peut être relancé sans risque.
--
-- Chaque filament a désormais DEUX quantités :
--   qty        = recharges (refills, sans bobine)   [colonne existante]
--   qty_spool  = avec bobine                         [nouvelle colonne]
-- =========================================================

alter table public.inventory
  add column if not exists qty_spool integer not null default 0;

-- ---------------------------------------------------------
-- VÉRIFICATION :
--   select code, name, qty, qty_spool from public.inventory order by code limit 5;
-- Toutes les lignes existantes ont qty_spool = 0 (à ajuster ensuite dans
-- le panneau admin, champ « Bobine »).
-- ---------------------------------------------------------
