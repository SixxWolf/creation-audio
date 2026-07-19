-- ============================================================
-- Création Audio — inventaire des nouveaux matériaux
-- PLA Matte, PETG Basic, ABS  (49 couleurs)
-- À exécuter dans Supabase : SQL Editor -> New query -> coller -> Run.
-- Idempotent : ON CONFLICT DO NOTHING (ne touche pas aux quantités
-- que tu auras déjà ajustées dans l'admin).
-- Quantité de départ : 5 (ajuste ensuite dans l'admin).
-- ============================================================

insert into public.inventory (code, name, qty) values
  ('11100', 'PLA Matte · Ivory White', 5),
  ('11101', 'PLA Matte · Charcoal', 5),
  ('11102', 'PLA Matte · Ash Gray', 5),
  ('11103', 'PLA Matte · Bone White', 5),
  ('11104', 'PLA Matte · Nardo Gray', 5),
  ('11200', 'PLA Matte · Scarlet Red', 5),
  ('11201', 'PLA Matte · Sakura Pink', 5),
  ('11202', 'PLA Matte · Dark Red', 5),
  ('11203', 'PLA Matte · Terracotta', 5),
  ('11204', 'PLA Matte · Plum', 5),
  ('11300', 'PLA Matte · Mandarin Orange', 5),
  ('11400', 'PLA Matte · Lemon Yellow', 5),
  ('11401', 'PLA Matte · Desert Tan', 5),
  ('11500', 'PLA Matte · Grass Green', 5),
  ('11501', 'PLA Matte · Dark Green', 5),
  ('11502', 'PLA Matte · Apple Green', 5),
  ('11600', 'PLA Matte · Marine Blue', 5),
  ('11601', 'PLA Matte · Ice Blue', 5),
  ('11602', 'PLA Matte · Dark Blue', 5),
  ('11603', 'PLA Matte · Sky Blue', 5),
  ('11700', 'PLA Matte · Lilac Purple', 5),
  ('11800', 'PLA Matte · Latte Brown', 5),
  ('11801', 'PLA Matte · Dark Brown', 5),
  ('11802', 'PLA Matte · Dark Chocolate', 5),
  ('11803', 'PLA Matte · Caramel', 5),
  ('30105', 'PETG Basic · Black', 5),
  ('30106', 'PETG Basic · White', 5),
  ('30107', 'PETG Basic · Gray', 5),
  ('30108', 'PETG Basic · Misty Blue', 5),
  ('30201', 'PETG Basic · Red', 5),
  ('30301', 'PETG Basic · Orange', 5),
  ('30402', 'PETG Basic · Yellow', 5),
  ('30403', 'PETG Basic · Dark Beige', 5),
  ('30502', 'PETG Basic · Green', 5),
  ('30503', 'PETG Basic · Pine Green', 5),
  ('30603', 'PETG Basic · Reflex Blue', 5),
  ('30604', 'PETG Basic · Navy Blue', 5),
  ('30800', 'PETG Basic · Dark Brown', 5),
  ('40100', 'ABS · White', 5),
  ('40101', 'ABS · Black', 5),
  ('40102', 'ABS · Silver', 5),
  ('40200', 'ABS · Red', 5),
  ('40300', 'ABS · Orange', 5),
  ('40402', 'ABS · Tangerine Yellow', 5),
  ('40500', 'ABS · Bambu Green', 5),
  ('40502', 'ABS · Olive', 5),
  ('40600', 'ABS · Blue', 5),
  ('40601', 'ABS · Azure', 5),
  ('40602', 'ABS · Navy Blue', 5)
on conflict (code) do nothing;

-- Vérification :
-- select left(code,2) as famille, count(*) from public.inventory group by 1 order by 1;
