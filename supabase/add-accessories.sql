-- ============================================================
-- Création Audio — accessoires dans l'inventaire
-- Bobines vides réutilisables (standard 5 $ et haute température 10 $)
--
-- À exécuter dans Supabase : SQL Editor -> New query -> coller -> Run.
-- Idempotent : ON CONFLICT DO NOTHING (ne touche pas aux quantités
-- déjà ajustées dans l'admin si tu le relances).
--
-- Ces deux lignes rendent les accessoires gérables dans le panneau
-- admin (groupe « Accessoires », affiché en dernier) et affichent
-- leur stock sur la page Filament.
--
-- NB : un accessoire n'a qu'UN seul stock -> colonne « qty ».
--      La colonne « qty_spool » reste à 0 et est ignorée pour eux.
-- Quantité de départ : 0 (mets tes vraies quantités dans l'admin).
-- ============================================================

insert into public.inventory (code, name, qty, qty_spool) values
  ('SPOOL',   'Accessoire · Bobine vide réutilisable', 0, 0),
  ('SPOOLHT', 'Accessoire · Bobine vide réutilisable — haute température', 0, 0)
on conflict (code) do nothing;

-- Vérification : doit renvoyer les 2 lignes
select code, name, qty from public.inventory where code in ('SPOOL', 'SPOOLHT');
