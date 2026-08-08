-- ============================================================
-- Création Audio — SCHÉMA V2 (CMS admin-driven)
-- ------------------------------------------------------------
-- Source de vérité = Supabase. L'admin écrit ; la boutique lit.
-- Une seule table « products » générique couvre filaments,
-- spacers et caissons (colonne `type`).
--
-- À exécuter dans Supabase : SQL Editor -> New query -> coller -> Run.
-- Idempotent : peut être relancé sans casser l'existant.
--
-- Modèle de confidentialité :
--   - lecture publique : UNIQUEMENT via la vue `products_public`
--     (produits actifs, SANS les colonnes de coût/marge).
--   - la table `products` (qui contient cost_price) est privée :
--     lecture + écriture réservées au compte admin (par e-mail).
-- ============================================================

-- Compte admin (une seule source de vérité pour toutes les policies).
-- Si tu changes d'e-mail admin un jour, remplace-le partout ci-dessous.

-- ------------------------------------------------------------
-- TABLE products
-- ------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  type          text    not null default 'filament',   -- 'filament' | 'spacer' | 'caisson'
  name          text    not null,
  brand         text    not null default 'Bambu Lab',    -- marque (Bambu Lab, Elegoo, Anycubic…)
  material      text,                                    -- filament : « PLA Basic »… ; libre sinon
  code          text,                                    -- code Bambu (ex. 10100) — rattachement réception + import V1
  hex           text,                                    -- couleur de la pastille (filament)
  attrs         jsonb   not null default '{}'::jsonb,    -- champs libres par type (véhicule, litrage, specs…)
  image_path    text,                                    -- chemin dans le bucket Storage « products »

  sell_price    numeric(10,2) not null default 0,        -- (hérité V1 / repli si pas de matériau)
  sell_price_2  numeric(10,2),                           -- (hérité V1 / repli si pas de matériau)
  sell_override    numeric(10,2),                        -- prix BOBINE personnalisé pour CETTE couleur (override matériau ; null = hérite)
  sell_override_2  numeric(10,2),                        -- prix RECHARGE personnalisé pour CETTE couleur (override matériau ; null = hérite)
  cost_price    numeric(10,2) not null default 0,        -- COÛT payé (dimension principale) -> marge  [PRIVÉ]
  cost_price_2  numeric(10,2),                           -- coût 2e dimension (recharge)               [PRIVÉ]

  tiers         jsonb   not null default '[]'::jsonb,    -- rabais quantité BOBINE : [{min:5,price:10}, …]
  tiers_2       jsonb   not null default '[]'::jsonb,    -- rabais quantité RECHARGE
  qty           integer not null default 0,              -- stock (dimension principale / bobine)
  qty_2         integer,                                 -- stock 2e dimension (recharge)
  offer_spool   boolean not null default true,           -- cette couleur vendue en bobine (si le matériau l'offre)
  offer_refill  boolean not null default true,           -- cette couleur vendue en recharge (si le matériau l'offre)

  size          text    not null default '1x1',          -- taille de la case dans la grille (1x1, 2x1, 1x2, 2x2)
  sort_order    integer not null default 0,              -- ordre d'affichage (drag-and-drop)
  active        boolean not null default true,           -- visible en boutique (masquer sans supprimer)

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Migrations douces si la table préexistait sans certaines colonnes :
alter table public.products add column if not exists sell_price_2 numeric(10,2);
alter table public.products add column if not exists cost_price_2 numeric(10,2);
alter table public.products add column if not exists qty_2        integer;
alter table public.products add column if not exists attrs        jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists tiers        jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists tiers_2      jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists size         text  not null default '1x1';
alter table public.products add column if not exists sort_order   integer not null default 0;
alter table public.products add column if not exists code         text;
alter table public.products add column if not exists offer_spool  boolean not null default true;
alter table public.products add column if not exists offer_refill boolean not null default true;
alter table public.products add column if not exists brand        text not null default 'Bambu Lab';

create index if not exists products_type_idx       on public.products (type);
create index if not exists products_code_idx       on public.products (code);
create index if not exists products_sort_idx       on public.products (type, sort_order);
create index if not exists products_active_idx     on public.products (active);

-- ------------------------------------------------------------
-- RLS : table privée (admin uniquement, par e-mail)
-- ------------------------------------------------------------
alter table public.products enable row level security;

-- Une seule policy admin (SELECT/INSERT/UPDATE/DELETE) : évite le doublon
-- permissif (read + write) sur le rôle authenticated. La lecture publique
-- passe par la vue products_public (security definer), pas par cette table.
drop policy if exists products_admin_read  on public.products;
drop policy if exists products_admin_write on public.products;
drop policy if exists products_admin_all   on public.products;
create policy products_admin_all
  on public.products for all
  to authenticated
  using  ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

-- ------------------------------------------------------------
-- TABLE brands — marques (Bambu Lab, Elegoo, Anycubic…)
-- Gérée dans l'admin ; référencée par materials et products.
-- ------------------------------------------------------------
create table if not exists public.brands (
  name       text primary key,
  sort_order integer not null default 0,
  image_path text,                                  -- logo/vitrine de la marque (bucket products)
  created_at timestamptz not null default now()
);
alter table public.brands add column if not exists image_path text;
insert into public.brands (name, sort_order) values ('Bambu Lab', 0) on conflict (name) do nothing;

alter table public.brands enable row level security;
drop policy if exists brands_public_read on public.brands;
create policy brands_public_read on public.brands for select to anon, authenticated using (true);
drop policy if exists brands_admin_write on public.brands;
create policy brands_admin_write on public.brands for all to authenticated
  using ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

-- ------------------------------------------------------------
-- TABLE materials — PRIX & COÛTS PAR (MARQUE, MATÉRIAU)
-- Toutes les couleurs d'un même matériau partagent ces valeurs.
-- Clé = (brand, name) : « PLA Basic » peut exister pour Bambu ET Elegoo.
-- ------------------------------------------------------------
create table if not exists public.materials (
  brand        text    not null default 'Bambu Lab',  -- marque
  name         text    not null,                       -- « PLA Basic », « PETG Basic »…
  sell_spool   numeric(10,2),                      -- prix AVEC BOBINE (null = pas vendu en bobine)
  sell_refill  numeric(10,2),                      -- prix RECHARGE   (null = pas vendu en recharge)
  cost_spool   numeric(10,2),                      -- coût bobine   [PRIVÉ]
  cost_refill  numeric(10,2),                      -- coût recharge [PRIVÉ]
  tiers_spool  jsonb   not null default '[]'::jsonb, -- rabais quantité bobine
  tiers_refill jsonb   not null default '[]'::jsonb, -- rabais quantité recharge
  description  text,                              -- caractéristiques (affichées en boutique), une par ligne
  image_path   text,                              -- image vitrine du matériau (bucket products ; choisie à la main dans l'admin)
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- migrations douces (table préexistante) :
alter table public.materials alter column sell_spool drop not null;
alter table public.materials alter column sell_spool drop default;
alter table public.materials alter column cost_spool drop not null;
alter table public.materials alter column cost_spool drop default;
alter table public.materials add column if not exists description text;
alter table public.materials add column if not exists image_path  text;
alter table public.materials add column if not exists brand text not null default 'Bambu Lab';
-- clé primaire = (brand, name) : on retire l'ancienne (sur name) et on pose la composite
alter table public.materials drop constraint if exists materials_pkey;
alter table public.materials add  constraint materials_pkey primary key (brand, name);

alter table public.materials enable row level security;

-- Une seule policy admin (voir products). La boutique lit les prix via la vue
-- products_public (security definer), jamais directement la table materials.
drop policy if exists materials_admin_read  on public.materials;
drop policy if exists materials_admin_write on public.materials;
drop policy if exists materials_admin_all   on public.materials;
create policy materials_admin_all
  on public.materials for all
  to authenticated
  using  ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

-- ------------------------------------------------------------
-- VUE publique : produits actifs, SANS les coûts.
-- Les PRIX proviennent du matériau (jointure) ; repli sur le prix
-- éventuel porté par le produit si le matériau n'existe pas encore.
-- security_invoker = off  =>  la vue contourne la RLS et n'expose
-- que les lignes actives + colonnes non sensibles.
-- ------------------------------------------------------------
drop view if exists public.products_public;
create view public.products_public
with (security_invoker = off) as
  select
    p.id, p.type, p.name, p.material, p.brand, p.code, p.hex, p.attrs, p.image_path,
    -- prix null = format non vendu (bobine ou recharge) quand le matériau existe ;
    -- repli sur le prix porté par le produit uniquement s'il n'a pas de matériau.
    -- respecte aussi les formats désactivés manuellement sur la couleur (offer_spool / offer_refill)
    case when not p.offer_spool  then null when m.name is not null then m.sell_spool  else p.sell_price   end as sell_price,
    case when not p.offer_refill then null when m.name is not null then m.sell_refill else p.sell_price_2 end as sell_price_2,
    -- Spacers : les rabais quantité sont RÉSERVÉS AU DEALER -> jamais exposés au public.
    case when p.type = 'spacer' then '[]'::jsonb when m.name is not null then m.tiers_spool  else p.tiers   end as tiers,
    case when m.name is not null then m.tiers_refill else p.tiers_2 end as tiers_2,
    m.description as material_desc,
    m.image_path  as material_image,   -- image vitrine choisie à la main pour le matériau (E4)
    p.qty, p.qty_2, p.size, p.sort_order
  from public.products p
  left join public.materials m on m.name = p.material and m.brand = p.brand
  where p.active = true;

grant select on public.products_public to anon, authenticated;

-- ------------------------------------------------------------
-- RÉCEPTIONS DE COMMANDE (entrées de stock) + historique
-- Chaque réception = une commande reçue (n° Bambu, date) avec ses
-- lignes. La confirmation d'une réception incrémente le stock des
-- filaments concernés. Tout est PRIVÉ (admin uniquement).
-- ------------------------------------------------------------
create table if not exists public.receipts (
  id           uuid primary key default gen_random_uuid(),
  order_number text,                          -- n° de commande Bambu (exact)
  received_at  date    not null default current_date,
  supplier     text    default 'Bambu Lab',
  note         text,
  created_at   timestamptz not null default now()
);

create table if not exists public.receipt_lines (
  id         uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  label      text,                            -- « PLA Basic · Gray » (texte, conservé même si non rattaché)
  kind       text not null default 'spool',   -- 'spool' (bobine) | 'refill' (recharge)
  qty        integer not null default 0
);

create index if not exists receipts_received_idx     on public.receipts (received_at desc);
create index if not exists receipt_lines_receipt_idx on public.receipt_lines (receipt_id);

alter table public.receipts      enable row level security;
alter table public.receipt_lines enable row level security;

drop policy if exists receipts_admin_all on public.receipts;
create policy receipts_admin_all
  on public.receipts for all
  to authenticated
  using  ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

drop policy if exists receipt_lines_admin_all on public.receipt_lines;
create policy receipt_lines_admin_all
  on public.receipt_lines for all
  to authenticated
  using  ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

-- Incrément de stock atomique (évite un read-modify-write côté client).
-- kind = 'refill' -> qty_2 ; sinon -> qty.
-- p_qty peut être négatif (annulation lors d'une suppression/modification) ;
-- le stock est borné à 0 (jamais négatif).
create or replace function public.receive_stock(p_product uuid, p_kind text, p_qty integer)
returns void language sql security definer set search_path = public as $$
  update public.products
     set qty   = case when p_kind <> 'refill' then greatest(0, coalesce(qty,0)   + p_qty) else qty   end,
         qty_2 = case when p_kind =  'refill' then greatest(0, coalesce(qty_2,0) + p_qty) else qty_2 end,
         updated_at = now()
   where id = p_product;
$$;
revoke all on function public.receive_stock(uuid, text, integer) from public, anon;
grant execute on function public.receive_stock(uuid, text, integer) to authenticated;

-- ------------------------------------------------------------
-- STORAGE — bucket des images de produits
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

-- lecture publique des fichiers (les images s'affichent en boutique) :
drop policy if exists products_files_public_read on storage.objects;
create policy products_files_public_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'products');

-- dépôt / màj / suppression : admin uniquement
drop policy if exists products_files_admin_insert on storage.objects;
create policy products_files_admin_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'products' and ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com');

drop policy if exists products_files_admin_update on storage.objects;
create policy products_files_admin_update
  on storage.objects for update
  to authenticated
  using  (bucket_id = 'products' and ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com')
  with check (bucket_id = 'products' and ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com');

drop policy if exists products_files_admin_delete on storage.objects;
create policy products_files_admin_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'products' and ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com');

-- ============================================================
-- PHASE 4 — FACTURATION
-- Chaque facture générée est PERSISTÉE (invoices + invoice_lines)
-- -> historique consultable, réimprimable, base des statistiques.
-- Tout est PRIVÉ (admin uniquement). Le coût (cost_total / unit_cost)
-- ne sert qu'au calcul de marge côté admin ; jamais exposé au public.
-- ------------------------------------------------------------

-- Numérotation atomique F-AAAA-### (un compteur par année).
create table if not exists public.invoice_counters (
  year int primary key,
  seq  int not null default 0
);
alter table public.invoice_counters enable row level security;
drop policy if exists invoice_counters_admin_read on public.invoice_counters;
create policy invoice_counters_admin_read on public.invoice_counters for select to authenticated
  using ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

-- Réserve et renvoie le prochain numéro (incrément atomique).
create or replace function public.next_invoice_number()
returns text language plpgsql security definer set search_path = public as $$
declare y int := extract(year from current_date)::int; n int;
begin
  insert into public.invoice_counters (year, seq) values (y, 1)
    on conflict (year) do update set seq = public.invoice_counters.seq + 1
    returning seq into n;
  return 'F-' || y::text || '-' || lpad(n::text, 3, '0');
end $$;
revoke all on function public.next_invoice_number() from public, anon;
grant execute on function public.next_invoice_number() to authenticated;

-- ------------------------------------------------------------
-- TABLE invoices — en-tête de facture
-- ------------------------------------------------------------
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  number         text unique,                                -- F-AAAA-###
  client_name    text,
  client_contact text,                                       -- courriel / téléphone / Messenger
  client_address text,                                       -- adresse (facture pro)
  client_city    text,                                       -- ville, code postal
  client_type    text    not null default 'client',          -- 'client' | 'olivier' (dealer)
  category       text    not null default 'filament',         -- 'filament' | 'spacer' | 'caisson' | 'mixte'
  invoice_date   date    not null default current_date,
  note           text,                                        -- conditions de paiement / mot libre
  tax_enabled    boolean not null default false,
  subtotal       numeric(10,2) not null default 0,
  tax_gst        numeric(10,2) not null default 0,            -- TPS
  tax_qst        numeric(10,2) not null default 0,            -- TVQ
  total          numeric(10,2) not null default 0,
  cost_total     numeric(10,2) not null default 0,            -- [PRIVÉ] somme des coûts -> marge
  stock_deducted boolean not null default false,             -- le stock est-il actuellement déduit ?
  status         text    not null default 'final',            -- 'final' | 'cancelled'
  cancelled_at   timestamptz,                                 -- date d'annulation (Phase 5)
  created_at     timestamptz not null default now()
);

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,  -- null = ligne libre (caisson, main-d'œuvre…)
  label       text,                                          -- « Titan Gray », « Main-d'œuvre »…
  meta        text,                                          -- « Bambu Lab · PLA Basic · Recharge », specs…
  kind        text    not null default 'spool',               -- 'spool' | 'refill' | 'unit' | 'free'
  qty         numeric(10,2) not null default 1,
  unit_price  numeric(10,2) not null default 0,
  unit_cost   numeric(10,2) not null default 0,               -- [PRIVÉ]
  line_total  numeric(10,2) not null default 0,
  sort_order  integer not null default 0
);

-- migrations douces si invoices préexistait :
alter table public.invoices add column if not exists client_address text;
alter table public.invoices add column if not exists client_city    text;
alter table public.invoices add column if not exists cancelled_at   timestamptz;   -- Phase 5 : annulation

create index if not exists invoices_date_idx        on public.invoices (invoice_date desc);
create index if not exists invoices_category_idx     on public.invoices (category);
create index if not exists invoices_status_idx       on public.invoices (status);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index if not exists invoice_lines_product_idx on public.invoice_lines (product_id);

alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;

drop policy if exists invoices_admin_all on public.invoices;
create policy invoices_admin_all
  on public.invoices for all
  to authenticated
  using  ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

drop policy if exists invoice_lines_admin_all on public.invoice_lines;
create policy invoice_lines_admin_all
  on public.invoice_lines for all
  to authenticated
  using  ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

-- Déduction de stock : on réutilise receive_stock() avec une quantité NÉGATIVE
-- (bornée à 0). kind='refill' -> qty_2 ; sinon -> qty (bobine, unité spacer).

-- ============================================================
-- PORTAIL DEALER — prix spéciaux « gros / dealer » (spacers)
-- ------------------------------------------------------------
-- Deux tarifs pour les spacers :
--   - PUBLIC (client lambda) : products.sell_price, à plat, SANS rabais
--     quantité (les rabais spacer sont retirés de products_public ci-dessus).
--   - DEALER (Olivier & co) : products.dealer_price + products.tiers
--     (rabais quantité), visibles UNIQUEMENT via la vue products_dealer,
--     réservée aux comptes listés dans public.dealers. Le coût reste privé.
-- ------------------------------------------------------------

-- prix dealer par spacer (le prix client reste dans sell_price)
alter table public.products add column if not exists dealer_price numeric(10,2);

-- Amorçage : le prix spacer déjà saisi (avec ses rabais) = le prix DEALER.
-- L'admin ajoutera ensuite le prix CLIENT (sell_price) plus bas.
update public.products set dealer_price = sell_price
  where type = 'spacer' and dealer_price is null;

-- Comptes autorisés au portail dealer (gérés dans l'admin, onglet Dealers).
create table if not exists public.dealers (
  email      text primary key,
  name       text,
  created_at timestamptz not null default now()
);
alter table public.dealers enable row level security;
drop policy if exists dealers_admin_all on public.dealers;
create policy dealers_admin_all on public.dealers for all to authenticated
  using  ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' )
  with check ( ((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com' );

-- Le compte connecté est-il un dealer ? (le portail s'en sert pour ouvrir l'accès)
create or replace function public.is_dealer()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.dealers d where d.email = (select auth.jwt() ->> 'email'));
$$;
revoke all on function public.is_dealer() from public, anon;
grant execute on function public.is_dealer() to authenticated;

-- Vue DEALER : spacers actifs, PRIX DEALER + rabais quantité + stock, SANS coût.
-- security_invoker = off + filtre par e-mail dealer => invisible aux anonymes
-- et aux comptes non-dealer (0 ligne). L'alias sell_price permet de réutiliser
-- exactement le même rendu que la boutique publique.
drop view if exists public.products_dealer;
create view public.products_dealer with (security_invoker = off) as
  select p.id, p.type, p.name, p.attrs, p.image_path,
         coalesce(p.dealer_price, p.sell_price) as sell_price,
         p.tiers, p.qty, p.sort_order
  from public.products p
  where p.active = true and p.type = 'spacer'
    and (select auth.jwt() ->> 'email') in (select email from public.dealers);
grant select on public.products_dealer to authenticated;

-- ------------------------------------------------------------
-- Vérification
-- ------------------------------------------------------------
select count(*) as produits_v2 from public.products;
select count(*) as factures_v2 from public.invoices;
select count(*) as dealers_v2  from public.dealers;
