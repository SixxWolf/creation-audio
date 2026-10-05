-- ============================================================
-- Création Audio — SCHÉMA V2 (CMS admin-driven)
-- ------------------------------------------------------------
-- Source de vérité = Supabase. L'admin écrit ; la boutique lit.
-- Une seule table « products » générique couvre filaments,
-- spacers et accessoires (colonne `type`).
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

-- ------------------------------------------------------------
-- COMPTE ADMIN + DOUBLE AUTHENTIFICATION (2FA)
-- is_admin() = le compte admin ET une session validée par le 2e facteur
-- (aal2 : mot de passe + code TOTP de l'application d'authentification).
-- Toutes les policies et fonctions admin passent par ici : un mot de passe
-- volé, sans le code, ne donne accès à rien (ni lecture ni écriture).
-- Une seule source de vérité : si l'e-mail admin change, c'est ICI
-- (+ assets/supabase-config.js).
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(lower((select auth.jwt()) ->> 'email') = 'creationaudio.ca@gmail.com'
              and ((select auth.jwt()) ->> 'aal') = 'aal2', false);
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------
-- TABLE products
-- ------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  type          text    not null default 'filament',   -- 'filament' | 'spacer' | 'accessory'
  name          text    not null,
  brand         text    not null default 'Bambu Lab',    -- marque (Bambu Lab, Elegoo, Anycubic…)
  material      text,                                    -- filament : « PLA Basic »… ; libre sinon
  code          text,                                    -- code Bambu (ex. 10100) — rattachement réception + import V1
  hex           text,                                    -- couleur de la pastille (filament)
  attrs         jsonb   not null default '{}'::jsonb,    -- champs libres par type (véhicule, litrage, specs…)
  image_path    text,                                    -- chemin dans le bucket Storage « products »

  sell_price    numeric(10,2) not null default 0,        -- (hérité V1 / repli si pas de matériau)
  sell_price_2  numeric(10,2),                           -- (hérité V1 / repli si pas de matériau)
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
-- slug = dernier segment d'URL choisi dans l'admin pour CETTE couleur (ex. « rouge-galaxie »).
-- null => la boutique retombe sur un slug auto-généré à partir du nom. Les anciens liens (id UUID) restent valides.
alter table public.products add column if not exists slug         text;

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
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

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
-- slug = segment d'URL de la marque (ex. « bambu-lab ») ; null => auto-généré depuis le nom.
alter table public.brands add column if not exists slug       text;
insert into public.brands (name, sort_order) values ('Bambu Lab', 0) on conflict (name) do nothing;

alter table public.brands enable row level security;
drop policy if exists brands_public_read on public.brands;
create policy brands_public_read on public.brands for select to anon, authenticated using (true);
drop policy if exists brands_admin_write on public.brands;
create policy brands_admin_write on public.brands for all to authenticated
  using ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

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
-- Fiche détaillée (bas de la page filament en boutique) :
alter table public.materials add column if not exists long_desc text;                        -- description longue (paragraphes)
alter table public.materials add column if not exists specs   jsonb not null default '[]'::jsonb; -- specs : [{k,v}] libres (ajout/suppr. à volonté)
alter table public.materials add column if not exists gallery jsonb not null default '[]'::jsonb; -- galerie « prints » : liste de chemins d'images (bucket products)
alter table public.materials add column if not exists slug    text;                            -- segment d'URL du matériau (ex. « pla-basic ») ; null => auto-généré depuis le nom
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
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

-- ------------------------------------------------------------
-- VUE publique : produits actifs, SANS les coûts.
-- Les PRIX proviennent du matériau (jointure) ; repli sur le prix
-- éventuel porté par le produit si le matériau n'existe pas encore.
-- security_invoker = off  =>  la vue contourne la RLS et n'expose
-- que les lignes actives + colonnes non sensibles.
-- attrs : LISTE BLANCHE des clés lues par la boutique (colors, img_spool,
-- img_refill, description). Les clés privées (avg_cost, barcodes,
-- par_spool, par_refill…) ne sortent jamais — une nouvelle clé attrs
-- reste privée tant qu'on ne l'ajoute pas ici (et dans products_dealer).
-- ------------------------------------------------------------
drop view if exists public.products_public;
create view public.products_public
with (security_invoker = off) as
  select
    p.id, p.type, p.name, p.material, p.brand, p.code, p.hex,
    jsonb_strip_nulls(jsonb_build_object(
      'colors',       p.attrs -> 'colors',
      'img_spool',    p.attrs -> 'img_spool',
      'img_refill',   p.attrs -> 'img_refill',
      'description',  p.attrs -> 'description',
      -- fiche spacer : taille du haut-parleur, compatibilité véhicules, specs, texte long, photos
      'speaker_size', p.attrs -> 'speaker_size',
      'fitment',      p.attrs -> 'fitment',
      'specs',        p.attrs -> 'specs',
      'long_desc',    p.attrs -> 'long_desc',
      'gallery',      p.attrs -> 'gallery'
    )) as attrs,
    p.image_path,
    p.slug,                            -- slug perso de la couleur (null = auto côté boutique)
    m.slug        as material_slug,    -- slug perso du matériau (null = auto côté boutique)
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
    m.long_desc   as material_long_desc, -- fiche : description longue
    m.specs       as material_specs,     -- fiche : specs libres [{k,v}]
    m.gallery     as material_gallery,   -- fiche : galerie « prints » (chemins d'images)
    m.sort_order  as material_sort,    -- ordre des matériaux (drag-and-drop admin) -> pilote l'ordre boutique
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
  qty        integer not null default 0,
  unit_cost  numeric(10,2)                    -- [PRIVÉ] prix réellement payé /unité (null = pas encore saisi -> coût catalogue)
);

-- migration douce si receipt_lines préexistait (marge adaptative / coût moyen pondéré) :
alter table public.receipt_lines add column if not exists unit_cost numeric(10,2);

create index if not exists receipts_received_idx     on public.receipts (received_at desc);
create index if not exists receipt_lines_receipt_idx on public.receipt_lines (receipt_id);

alter table public.receipts      enable row level security;
alter table public.receipt_lines enable row level security;

drop policy if exists receipts_admin_all on public.receipts;
create policy receipts_admin_all
  on public.receipts for all
  to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

drop policy if exists receipt_lines_admin_all on public.receipt_lines;
create policy receipt_lines_admin_all
  on public.receipt_lines for all
  to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

-- Incrément de stock atomique (évite un read-modify-write côté client).
-- kind = 'refill' -> qty_2 ; sinon -> qty.
-- p_qty peut être négatif (annulation lors d'une suppression/modification) ;
-- le stock est borné à 0 (jamais négatif).
create or replace function public.receive_stock(p_product uuid, p_kind text, p_qty integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Garde : fonction SECURITY DEFINER réservée à l'admin (sinon n'importe quel
  -- compte connecté, ex. un dealer, pourrait modifier le stock). Advisor
  -- « Signed-In Users Can Execute SECURITY DEFINER Function ».
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  update public.products
     set qty   = case when p_kind <> 'refill' then greatest(0, coalesce(qty,0)   + p_qty) else qty   end,
         qty_2 = case when p_kind =  'refill' then greatest(0, coalesce(qty_2,0) + p_qty) else qty_2 end,
         updated_at = now()
   where id = p_product;
end $$;
revoke all on function public.receive_stock(uuid, text, integer) from public, anon;
grant execute on function public.receive_stock(uuid, text, integer) to authenticated;

-- ------------------------------------------------------------
-- STORAGE — bucket des images de produits
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

-- Lecture publique des images : le bucket est PUBLIC, donc les fichiers se
-- servent via l'URL publique (getPublicUrl) SANS RLS. On ne crée donc PAS de
-- policy SELECT anonyme : cela empêche le LISTAGE anonyme du bucket
-- (advisor « Public Bucket Allows Listing ») sans casser l'affichage des
-- images. Le code n'utilise jamais .list()/.download() (uniquement getPublicUrl,
-- upload et remove — couverts par les policies admin ci-dessous).
drop policy if exists products_files_public_read on storage.objects;

-- dépôt / màj / suppression : admin uniquement
drop policy if exists products_files_admin_insert on storage.objects;
create policy products_files_admin_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'products' and (select public.is_admin()));

drop policy if exists products_files_admin_update on storage.objects;
create policy products_files_admin_update
  on storage.objects for update
  to authenticated
  using  (bucket_id = 'products' and (select public.is_admin()))
  with check (bucket_id = 'products' and (select public.is_admin()));

drop policy if exists products_files_admin_delete on storage.objects;
create policy products_files_admin_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'products' and (select public.is_admin()));

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
  using ( (select public.is_admin()) );

-- Réserve et renvoie le prochain numéro (incrément atomique).
create or replace function public.next_invoice_number()
returns text language plpgsql security definer set search_path = public as $$
declare y int := extract(year from current_date)::int; n int;
begin
  -- Garde admin (voir receive_stock) : évite qu'un compte connecté non-admin
  -- incrémente le compteur de factures.
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
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
  client_type    text    not null default 'client',          -- 'client' | 'dealer'
  category       text    not null default 'filament',         -- 'filament' | 'spacer' | 'accessory' | 'mixte'
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
  product_id  uuid references public.products(id) on delete set null,  -- null = ligne libre (main-d'œuvre, divers…)
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
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

drop policy if exists invoice_lines_admin_all on public.invoice_lines;
create policy invoice_lines_admin_all
  on public.invoice_lines for all
  to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

-- ------------------------------------------------------------
-- POPULARITÉ PUBLIQUE (agrégat marketing, SANS donnée sensible)
-- Unités vendues par produit, calculées sur les factures FINALES
-- (annulées exclues). N'expose QUE product_id + qty_sold — aucun prix,
-- aucun client, aucun revenu. security_invoker=off pour lire invoice_lines
-- (RLS admin) et publier l'agrégat en lecture anon. Sert à classer les
-- produits « populaires » (ex. top 5 filaments vendus) sur l'accueil.
-- ------------------------------------------------------------
drop view if exists public.product_popularity;
create view public.product_popularity
with (security_invoker = off) as
  select l.product_id,
         sum(l.qty)::numeric as qty_sold
  from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id
  where i.status = 'final' and l.product_id is not null
  group by l.product_id;

grant select on public.product_popularity to anon, authenticated;

-- Déduction de stock : on réutilise receive_stock() avec une quantité NÉGATIVE
-- (bornée à 0). kind='refill' -> qty_2 ; sinon -> qty (bobine, unité spacer).

-- ============================================================
-- PORTAIL DEALER — prix spéciaux « gros / dealer » (spacers)
-- ------------------------------------------------------------
-- Deux tarifs pour les spacers :
--   - PUBLIC (client lambda) : products.sell_price, à plat, SANS rabais
--     quantité (les rabais spacer sont retirés de products_public ci-dessus).
--   - DEALER (portail dealer) : products.dealer_price + products.tiers
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
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

-- Le compte connecté est-il un dealer ? (le portail s'en sert pour ouvrir l'accès)
-- Le compte ADMIN a aussi accès au portail (aperçu + commandes de test), sans
-- figurer dans la table dealers (donc absent de l'onglet Dealers / Facturation).
create or replace function public.is_dealer()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.dealers d where d.email = (select auth.jwt() ->> 'email'))
      or public.is_admin();
$$;
revoke all on function public.is_dealer() from public, anon;
grant execute on function public.is_dealer() to authenticated;

-- Vue DEALER : spacers actifs, PRIX DEALER + rabais quantité + stock, SANS coût.
-- security_invoker = off + filtre par e-mail dealer => invisible aux anonymes
-- et aux comptes non-dealer (0 ligne). L'alias sell_price permet de réutiliser
-- exactement le même rendu que la boutique publique.
-- attrs : même liste blanche que products_public (jamais avg_cost/barcodes/par_*).
drop view if exists public.products_dealer;
create view public.products_dealer with (security_invoker = off) as
  select p.id, p.type, p.name,
         jsonb_strip_nulls(jsonb_build_object(
           'colors',       p.attrs -> 'colors',
           'img_spool',    p.attrs -> 'img_spool',
           'img_refill',   p.attrs -> 'img_refill',
           'description',  p.attrs -> 'description',
           'speaker_size', p.attrs -> 'speaker_size',
           'fitment',      p.attrs -> 'fitment',
           'specs',        p.attrs -> 'specs',
           'long_desc',    p.attrs -> 'long_desc',
           'gallery',      p.attrs -> 'gallery'
         )) as attrs,
         p.image_path,
         coalesce(p.dealer_price, p.sell_price) as sell_price,
         p.tiers, p.qty, p.sort_order,
         p.slug                          -- adresse de la fiche (dealer.html#/s/<slug>) ; null = auto
  from public.products p
  where p.active = true and p.type = 'spacer'
    and ( (select auth.jwt() ->> 'email') in (select email from public.dealers)
          or (select public.is_admin()) );   -- admin (2FA validée) : aperçu du portail
grant select on public.products_dealer to authenticated;

-- ------------------------------------------------------------
-- CARNET DE CLIENTS (facturation) — nom, courriel, téléphone…
-- Mémorise les clients pour les resuggérer sur une facture.
-- Géré dans l'admin (onglet Clients) + auto-mémorisé à chaque facture.
-- Les DEALERS de facturation, eux, viennent de la table `dealers`
-- (mêmes comptes que le portail) — on l'enrichit de coordonnées ci-dessous.
-- ------------------------------------------------------------
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  address    text,
  city       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;
drop policy if exists clients_admin_all on public.clients;
create policy clients_admin_all on public.clients for all to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );
-- évite les doublons de courriel (insensible à la casse) ; les courriels vides sont permis
create unique index if not exists clients_email_uidx on public.clients (lower(email)) where email is not null and email <> '';

-- coordonnées facturation sur les dealers (le menu dealer les pré-remplit)
alter table public.dealers add column if not exists phone   text;
alter table public.dealers add column if not exists address text;
alter table public.dealers add column if not exists city    text;

-- gabarit de CHAQUE ligne de facture (filament/spacer/accessory/divers).
-- Permet aux statistiques de ventiler correctement, y compris les lignes libres
-- (dont la catégorie est choisie à la main dans l'éditeur de facture).
alter table public.invoice_lines add column if not exists ptype text;

-- Quantité RÉELLEMENT retirée du stock par une ligne de facture. Le stock est
-- borné à 0 : vendre 1 article à stock 0 n'en retire aucun. À l'annulation /
-- suppression, on ne remet que ce qui a été retiré (sinon on crée du stock
-- fantôme). NULL = ancienne facture (avant ce suivi) -> on remet qty.
alter table public.invoice_lines add column if not exists qty_deducted integer;

-- Déduction de stock bornée à 0 qui RENVOIE la quantité effectivement retirée.
create or replace function public.deduct_stock(p_product uuid, p_kind text, p_qty integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_before integer; v_taken integer;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  select case when p_kind = 'refill' then coalesce(qty_2,0) else coalesce(qty,0) end
    into v_before from public.products where id = p_product for update;
  if not found then return 0; end if;
  v_taken := least(v_before, abs(p_qty));
  update public.products
     set qty   = case when p_kind <> 'refill' then coalesce(qty,0)   - v_taken else qty   end,
         qty_2 = case when p_kind =  'refill' then coalesce(qty_2,0) - v_taken else qty_2 end,
         updated_at = now()
   where id = p_product;
  return v_taken;
end $$;
revoke all on function public.deduct_stock(uuid, text, integer) from public, anon;
grant execute on function public.deduct_stock(uuid, text, integer) to authenticated;

-- NOTE : l'ancienne « caisse en direct » (table public.pos_display + écran
-- client caisse.html) a été retirée. Elle est remplacée par le mode caisse
-- plein écran (déduction directe du stock à la fin de la vente). La table
-- pos_display n'est plus utilisée par aucun code et doit être supprimée
-- (drop table if exists public.pos_display;) — voir aussi les tables V1
-- orphelines inventory / sales / spacers, également supprimées.

-- ============================================================
-- LISTE D'ATTENTE « M'aviser quand disponible »
-- Une demande = une personne qui attend un produit (et un format).
--  - source 'site'        : formulaire public de la boutique (courriel) ;
--  - source 'marketplace' / 'autre' : saisie à la main dans l'admin.
-- Loi 25 : le courriel ne sert QU'À l'avis. Après l'avis ou l'expiration
-- (60 jours), nom + contact sont EFFACÉS ; il ne reste qu'une trace
-- anonyme (produit, format, dates) pour les statistiques.
-- Lecture / gestion : admin seulement. Le public n'insère QUE via la
-- RPC waitlist_subscribe (validation, anti-doublon, anti-pourriel).
-- L'envoi du courriel se fait par l'Edge Function « waitlist-notify ».
-- ------------------------------------------------------------
create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  kind        text,                         -- 'spool' | 'refill' | 'item' ; null = n'importe quel format
  name        text,                         -- optionnel (saisie admin)
  contact     text,                         -- courriel (site) ou « Messenger » ; null après avis/expiration
  source      text not null default 'site' check (source in ('site','marketplace','autre')),
  status      text not null default 'open' check (status in ('open','notified','expired')),
  note        text,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  expires_at  timestamptz not null default (now() + interval '60 days')
);
create index if not exists waitlist_open_idx on public.waitlist (product_id) where status = 'open';
-- anti-doublon : même courriel + même produit + même format, tant que la demande est ouverte
create unique index if not exists waitlist_open_uidx
  on public.waitlist (lower(contact), product_id, coalesce(kind, ''))
  where status = 'open' and source = 'site';

alter table public.waitlist enable row level security;
drop policy if exists waitlist_admin_all on public.waitlist;
create policy waitlist_admin_all on public.waitlist for all to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

-- Expiration + effacement des renseignements (Loi 25). Appelée chaque jour
-- par pg_cron, et au passage par waitlist_subscribe (filet de sécurité).
create or replace function public.waitlist_cleanup()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.waitlist
     set status = 'expired', name = null, contact = null
   where status = 'open' and expires_at < now();
  get diagnostics n = row_count;
  -- filet : aucune donnée personnelle ne doit survivre à une demande close
  update public.waitlist set name = null, contact = null
   where status <> 'open' and (name is not null or contact is not null);
  return n;
end $$;
revoke all on function public.waitlist_cleanup() from public, anon, authenticated;

-- Inscription publique (boutique). p_hp = champ piège (honeypot) : doit être vide.
-- Renvoie : 'ok' | 'exists' | 'invalid' | 'unavailable' | 'busy'
create or replace function public.waitlist_subscribe(p_product uuid, p_kind text, p_email text, p_hp text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
        v_kind  text := nullif(trim(coalesce(p_kind, '')), '');
begin
  -- robot : on fait semblant que tout va bien, sans rien enregistrer
  if coalesce(p_hp, '') <> '' then return 'ok'; end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then return 'invalid'; end if;
  if v_kind is not null and v_kind not in ('spool','refill','item') then return 'invalid'; end if;
  if not exists (select 1 from public.products where id = p_product and active) then return 'unavailable'; end if;
  perform public.waitlist_cleanup();
  -- anti-pourriel : 5 demandes ouvertes max par courriel, 40 inscriptions/heure au total
  if (select count(*) from public.waitlist where status = 'open' and source = 'site' and lower(contact) = v_email) >= 5
     or (select count(*) from public.waitlist where source = 'site' and created_at > now() - interval '1 hour') >= 40 then
    return 'busy';
  end if;
  if exists (select 1 from public.waitlist where status = 'open' and source = 'site' and lower(contact) = v_email
               and product_id = p_product and coalesce(kind, '') = coalesce(v_kind, '')) then
    return 'exists';
  end if;
  insert into public.waitlist (product_id, kind, contact, source) values (p_product, v_kind, v_email, 'site');
  return 'ok';
end $$;
revoke all on function public.waitlist_subscribe(uuid, text, text, text) from public;
grant execute on function public.waitlist_subscribe(uuid, text, text, text) to anon, authenticated;

-- Nettoyage quotidien (4 h UTC) via pg_cron.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'waitlist-cleanup';
select cron.schedule('waitlist-cleanup', '0 4 * * *', 'select public.waitlist_cleanup()');

-- ============================================================
-- MODIFIER UNE FACTURE ENREGISTRÉE (Historique -> « Modifier »)
-- Tout se fait dans UNE transaction (tout ou rien) :
--   1. le stock retiré par la version d'origine est remis
--      (qty_deducted, ou qty pour une ancienne facture) ;
--   2. les lignes sont remplacées ; si p_deduct, le stock de la
--      nouvelle version est déduit (borné à 0, quantité retirée
--      mémorisée dans qty_deducted comme à la création) ;
--   3. l'en-tête est mis à jour (même id ; n° modifiable, unique).
-- Une facture annulée ne se modifie pas. updated_at = dernière modif.
-- ------------------------------------------------------------
alter table public.invoices add column if not exists updated_at timestamptz;

create or replace function public.update_invoice(p_id uuid, p_invoice jsonb, p_lines jsonb, p_deduct boolean)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare
  v_inv    public.invoices;
  r        record;
  v_line   jsonb;
  v_i      integer := 0;
  v_back   integer;
  v_prod   uuid;
  v_kind   text;
  v_qty    numeric;
  v_before integer;
  v_taken  integer;
begin
  -- Garde admin (voir receive_stock).
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  select * into v_inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if v_inv.status = 'cancelled' then raise exception 'Une facture annulée ne peut pas être modifiée.'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'La facture doit contenir au moins une ligne.';
  end if;

  -- 1) remet le stock retiré par la version d'origine
  if v_inv.stock_deducted then
    for r in select product_id, kind, qty, qty_deducted from public.invoice_lines
              where invoice_id = p_id and product_id is not null loop
      v_back := coalesce(r.qty_deducted, abs(r.qty)::integer);
      if v_back > 0 then
        update public.products
           set qty   = case when r.kind <> 'refill' then coalesce(qty,0)   + v_back else qty   end,
               qty_2 = case when r.kind =  'refill' then coalesce(qty_2,0) + v_back else qty_2 end,
               updated_at = now()
         where id = r.product_id;
      end if;
    end loop;
  end if;

  -- 2) remplace les lignes (+ déduction de la nouvelle version)
  delete from public.invoice_lines where invoice_id = p_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_prod  := nullif(v_line ->> 'product_id', '')::uuid;
    v_kind  := coalesce(nullif(v_line ->> 'kind', ''), 'spool');
    v_qty   := coalesce((v_line ->> 'qty')::numeric, 0);
    v_taken := null;
    if p_deduct and v_prod is not null and v_qty > 0 then
      select case when v_kind = 'refill' then coalesce(qty_2,0) else coalesce(qty,0) end
        into v_before from public.products where id = v_prod for update;
      if found then
        v_taken := least(v_before, abs(v_qty)::integer);
        update public.products
           set qty   = case when v_kind <> 'refill' then coalesce(qty,0)   - v_taken else qty   end,
               qty_2 = case when v_kind =  'refill' then coalesce(qty_2,0) - v_taken else qty_2 end,
               updated_at = now()
         where id = v_prod;
      else
        v_taken := 0;
      end if;
    end if;
    insert into public.invoice_lines
      (invoice_id, product_id, label, meta, kind, ptype, qty, unit_price, unit_cost, line_total, sort_order, qty_deducted)
    values
      (p_id, v_prod, v_line ->> 'label', v_line ->> 'meta', v_kind, v_line ->> 'ptype', v_qty,
       coalesce((v_line ->> 'unit_price')::numeric, 0), coalesce((v_line ->> 'unit_cost')::numeric, 0),
       coalesce((v_line ->> 'line_total')::numeric, 0), v_i, v_taken);
    v_i := v_i + 1;
  end loop;

  -- 3) en-tête
  update public.invoices set
    number         = coalesce(nullif(trim(p_invoice ->> 'number'), ''), number),
    client_name    = p_invoice ->> 'client_name',
    client_contact = p_invoice ->> 'client_contact',
    client_address = p_invoice ->> 'client_address',
    client_city    = p_invoice ->> 'client_city',
    client_type    = case when p_invoice ->> 'client_type' = 'dealer' then 'dealer' else 'client' end,
    category       = coalesce(nullif(p_invoice ->> 'category', ''), category),
    invoice_date   = coalesce((p_invoice ->> 'invoice_date')::date, invoice_date),
    note           = p_invoice ->> 'note',
    tax_enabled    = coalesce((p_invoice ->> 'tax_enabled')::boolean, false),
    subtotal       = coalesce((p_invoice ->> 'subtotal')::numeric, 0),
    tax_gst        = coalesce((p_invoice ->> 'tax_gst')::numeric, 0),
    tax_qst        = coalesce((p_invoice ->> 'tax_qst')::numeric, 0),
    total          = coalesce((p_invoice ->> 'total')::numeric, 0),
    cost_total     = coalesce((p_invoice ->> 'cost_total')::numeric, 0),
    stock_deducted = coalesce(p_deduct, false),
    updated_at     = now()
  where id = p_id
  returning * into v_inv;
  return v_inv;
end $$;
revoke all on function public.update_invoice(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.update_invoice(uuid, jsonb, jsonb, boolean) to authenticated;

-- ============================================================
-- COMMANDES DEALER (portail dealer -> onglet admin « Commandes »)
-- ------------------------------------------------------------
-- Le dealer envoie son panier depuis dealer.html : la commande est
-- ENREGISTRÉE ici (plus de copier-coller Messenger). Tout est commandable,
-- même à stock 0 (impression sur demande) : l'admin voit « à imprimer ».
--   Statuts : new (Nouvelle) -> preparing -> ready -> invoiced (+ cancelled).
--   Le dealer peut modifier / annuler tant que la commande est « new ».
-- Sécurité : le dealer ne LIT que ses propres commandes (RLS) et n'écrit
-- QUE via les RPC ci-dessous (SECURITY DEFINER), qui recalculent les prix
-- côté serveur (prix dealer + palier PAR MODÈLE) : un prix trafiqué dans le
-- navigateur est ignoré. L'admin a tous les droits (passage de statut, lien
-- vers la facture).
-- ------------------------------------------------------------
create sequence if not exists public.dealer_order_seq;

create table if not exists public.dealer_orders (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique,                    -- « D-0001 »
  dealer_email text not null,
  dealer_name  text,
  status       text not null default 'new'
               check (status in ('new', 'preparing', 'ready', 'invoiced', 'cancelled')),
  note         text,                                    -- note du dealer
  total        numeric(10,2) not null default 0,        -- total dealer (hors taxes) au moment de la commande
  invoice_id   uuid references public.invoices(id) on delete set null,
  cancelled_by text check (cancelled_by in ('dealer', 'admin')),
  edited_at    timestamptz,                             -- dernière modification par le dealer
  notified_at  timestamptz,                             -- dernier courriel d'avis envoyé à l'admin
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists dealer_orders_email_idx  on public.dealer_orders (dealer_email, created_at desc);
create index if not exists dealer_orders_status_idx on public.dealer_orders (status);
create index if not exists dealer_orders_invoice_idx on public.dealer_orders (invoice_id);

create table if not exists public.dealer_order_lines (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.dealer_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name       text not null,                             -- nom figé au moment de la commande
  qty        integer not null check (qty > 0),
  unit_price numeric(10,2) not null default 0,
  line_total numeric(10,2) not null default 0,
  sort_order integer not null default 0
);
create index if not exists dealer_order_lines_order_idx   on public.dealer_order_lines (order_id);
create index if not exists dealer_order_lines_product_idx on public.dealer_order_lines (product_id);

alter table public.dealer_orders      enable row level security;
alter table public.dealer_order_lines enable row level security;

drop policy if exists dealer_orders_admin_all on public.dealer_orders;
create policy dealer_orders_admin_all on public.dealer_orders for all to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );
drop policy if exists dealer_orders_own_read on public.dealer_orders;
create policy dealer_orders_own_read on public.dealer_orders for select to authenticated
  using ( lower(dealer_email) = lower((select auth.jwt()) ->> 'email') and (select public.is_dealer()) );   -- dealer retiré : plus rien

drop policy if exists dealer_order_lines_admin_all on public.dealer_order_lines;
create policy dealer_order_lines_admin_all on public.dealer_order_lines for all to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );
drop policy if exists dealer_order_lines_own_read on public.dealer_order_lines;
create policy dealer_order_lines_own_read on public.dealer_order_lines for select to authenticated
  using ( exists (select 1 from public.dealer_orders o
                   where o.id = order_id
                     and lower(o.dealer_email) = lower((select auth.jwt()) ->> 'email')) and (select public.is_dealer()) );

-- Prix dealer d'un spacer pour une quantité : dernier palier dont min <= qté,
-- sinon prix de base (même règle que tierPrice() côté navigateur).
create or replace function public._dealer_unit_price(p_base numeric, p_tiers jsonb, p_qty integer)
returns numeric language sql immutable set search_path = public as $$
  select coalesce((
    select (t ->> 'price')::numeric
      from jsonb_array_elements(case when jsonb_typeof(p_tiers) = 'array' then p_tiers else '[]'::jsonb end) t
     where (t ->> 'price') ~ '^[0-9]{1,7}(\.[0-9]+)?$'
       -- CASE : le cast n'est tenté que si le texte est bien un entier (ordre d'évaluation non garanti)
       and (case when (t ->> 'min') ~ '^[0-9]{1,6}$' then (t ->> 'min')::integer end) between 1 and p_qty
     order by (t ->> 'min')::integer desc
     limit 1
  ), p_base, 0);
$$;

-- Remplace les lignes d'une commande à partir de [{product_id, qty}] :
-- doublons fusionnés, seuls les spacers ACTIFS sont gardés, qté 1..999,
-- prix recalculés. Met à jour le total. Erreur si aucune ligne valide.
create or replace function public._dealer_fill_lines(p_order uuid, p_lines jsonb)
returns numeric language plpgsql set search_path = public as $$
declare v_n integer; v_total numeric;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Commande vide.'; end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'Trop de lignes dans la commande.'; end if;
  delete from public.dealer_order_lines where order_id = p_order;
  with raw as (
    select e ->> 'product_id' as pid_txt, e ->> 'qty' as qty_txt, ord
      from jsonb_array_elements(p_lines) with ordinality as x(e, ord)
  ), clean as (
    select pid_txt::uuid as pid, least(sum(qty_txt::integer), 999)::integer as qty, min(ord) as ord
      from raw
     where pid_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and qty_txt ~ '^[0-9]{1,4}$'
     group by 1
  ), priced as (
    select c.pid, c.qty, c.ord, p.name,
           public._dealer_unit_price(coalesce(p.dealer_price, p.sell_price, 0), p.tiers, c.qty) as unit
      from clean c
      join public.products p on p.id = c.pid and p.type = 'spacer' and p.active = true
     where c.qty > 0
  )
  insert into public.dealer_order_lines (order_id, product_id, name, qty, unit_price, line_total, sort_order)
  select p_order, pid, name, qty, round(unit, 2), round(round(unit, 2) * qty, 2),
         (row_number() over (order by ord))::integer - 1
    from priced;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Aucun spacer valide dans la commande.'; end if;
  select coalesce(sum(line_total), 0) into v_total from public.dealer_order_lines where order_id = p_order;
  update public.dealer_orders set total = v_total, updated_at = now() where id = p_order;
  return v_total;
end $$;
revoke all on function public._dealer_unit_price(numeric, jsonb, integer) from public, anon, authenticated;
revoke all on function public._dealer_fill_lines(uuid, jsonb) from public, anon, authenticated;

-- Envoi d'une commande par le dealer connecté.
create or replace function public.dealer_submit_order(p_lines jsonb, p_note text default null)
returns public.dealer_orders language plpgsql security definer set search_path = public as $$
declare
  v_email  text := lower((select auth.jwt()) ->> 'email');
  v_dealer public.dealers;
  v_order  public.dealer_orders;
begin
  select * into v_dealer from public.dealers where lower(email) = v_email;
  if not found then
    -- l'admin peut passer une commande de test depuis le portail (visible dans l'onglet Commandes)
    if public.is_admin() then
      v_dealer.email := v_email; v_dealer.name := 'Création Audio (test admin)';
    else
      raise exception 'Réservé aux comptes dealer.' using errcode = '42501';
    end if;
  end if;
  -- garde-fou anti-rafale : 20 commandes max par heure
  if (select count(*) from public.dealer_orders
       where lower(dealer_email) = v_email and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Trop de commandes envoyées en peu de temps. Réessaie plus tard.';
  end if;
  insert into public.dealer_orders (number, dealer_email, dealer_name, note, status)
  values ('D-' || lpad(nextval('public.dealer_order_seq')::text, 4, '0'),
          v_dealer.email, v_dealer.name, nullif(left(btrim(coalesce(p_note, '')), 1000), ''), 'new')
  returning * into v_order;
  perform public._dealer_fill_lines(v_order.id, p_lines);
  select * into v_order from public.dealer_orders where id = v_order.id;
  return v_order;
end $$;

-- Modification par le dealer (seulement tant que la commande est « Nouvelle »).
create or replace function public.dealer_update_order(p_id uuid, p_lines jsonb, p_note text default null)
returns public.dealer_orders language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower((select auth.jwt()) ->> 'email');
  v_order public.dealer_orders;
begin
  if not public.is_dealer() then raise exception 'Accès dealer retiré.' using errcode = '42501'; end if;
  select * into v_order from public.dealer_orders where id = p_id for update;
  if not found or lower(v_order.dealer_email) <> v_email then raise exception 'Commande introuvable.' using errcode = '42501'; end if;
  if v_order.status = 'cancelled' then raise exception 'Cette commande est annulée.' using errcode = 'P0001'; end if;
  if v_order.status <> 'new' then
    raise exception 'Cette commande est déjà en préparation : écris-nous pour la modifier.' using errcode = 'P0001';
  end if;
  update public.dealer_orders
     set note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''), edited_at = now(), updated_at = now()
   where id = p_id;
  perform public._dealer_fill_lines(p_id, p_lines);
  select * into v_order from public.dealer_orders where id = p_id;
  return v_order;
end $$;

-- Annulation par le dealer (seulement tant que la commande est « Nouvelle »).
create or replace function public.dealer_cancel_order(p_id uuid)
returns public.dealer_orders language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower((select auth.jwt()) ->> 'email');
  v_order public.dealer_orders;
begin
  if not public.is_dealer() then raise exception 'Accès dealer retiré.' using errcode = '42501'; end if;
  select * into v_order from public.dealer_orders where id = p_id for update;
  if not found or lower(v_order.dealer_email) <> v_email then raise exception 'Commande introuvable.' using errcode = '42501'; end if;
  if v_order.status = 'cancelled' then return v_order; end if;   -- déjà annulée : rien à faire
  if v_order.status <> 'new' then
    raise exception 'Cette commande est déjà en préparation : écris-nous pour l''annuler.' using errcode = 'P0001';
  end if;
  update public.dealer_orders set status = 'cancelled', cancelled_by = 'dealer', updated_at = now()
   where id = p_id returning * into v_order;
  return v_order;
end $$;

revoke all on function public.dealer_submit_order(jsonb, text)       from public, anon;
revoke all on function public.dealer_update_order(uuid, jsonb, text) from public, anon;
revoke all on function public.dealer_cancel_order(uuid)              from public, anon;
grant execute on function public.dealer_submit_order(jsonb, text)       to authenticated;
grant execute on function public.dealer_update_order(uuid, jsonb, text) to authenticated;
grant execute on function public.dealer_cancel_order(uuid)              to authenticated;

-- ------------------------------------------------------------
-- TABLE admin_settings — réglages de l'admin, clé → JSON
-- (ex. « autoloop » : valeurs par défaut d'AutoLoop enregistrées par Théo,
-- synchronisées entre ses appareils). Admin seulement, jamais lue en public.
-- ------------------------------------------------------------
create table if not exists public.admin_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.admin_settings enable row level security;

drop policy if exists admin_settings_admin_all on public.admin_settings;
create policy admin_settings_admin_all
  on public.admin_settings for all
  to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

revoke all on public.admin_settings from anon;

-- Ancien bucket « spacers » (V1, plus utilisé par le site) : mêmes règles admin + 2FA.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'spacers_files_admin_insert') then
    alter policy spacers_files_admin_insert on storage.objects
      with check (bucket_id = 'spacers' and (select public.is_admin()));
    alter policy spacers_files_admin_update on storage.objects
      using (bucket_id = 'spacers' and (select public.is_admin()))
      with check (bucket_id = 'spacers' and (select public.is_admin()));
    alter policy spacers_files_admin_delete on storage.objects
      using (bucket_id = 'spacers' and (select public.is_admin()));
  end if;
end $$;

-- ------------------------------------------------------------
-- PORTAIL DEALER — retirer un dealer = couper son accès
-- Supprimer sa ligne (onglet Dealers › Retirer) bloque son compte (banni :
-- plus de connexion possible) et ferme ses sessions ouvertes ; ses lectures
-- (catalogue, commandes) sont aussi gardées par is_dealer(). Le rajouter le
-- débloque. Ses commandes restent en base (historique / facturation).
-- ------------------------------------------------------------
create or replace function public._dealer_revoke(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if lower(coalesce(p_email, '')) in ('', 'creationaudio.ca@gmail.com') then return; end if;   -- jamais l'admin
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then return; end if;
  update auth.users set banned_until = now() + interval '100 years' where id = v_uid;
  delete from auth.refresh_tokens where user_id = v_uid::text;
  delete from auth.sessions where user_id = v_uid;
end $$;

create or replace function public._dealer_access_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and lower(old.email) is distinct from lower(new.email)) then
    perform public._dealer_revoke(old.email);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update auth.users set banned_until = null
     where lower(email) = lower(new.email) and banned_until is not null;
  end if;
  return null;
end $$;
revoke all on function public._dealer_revoke(text)  from public, anon, authenticated;
revoke all on function public._dealer_access_sync() from public, anon, authenticated;

drop trigger if exists dealers_access_sync on public.dealers;
create trigger dealers_access_sync after insert or update or delete on public.dealers
  for each row execute function public._dealer_access_sync();

-- ------------------------------------------------------------
-- ANTI FORCE BRUTE — connexion admin + portail dealer
-- Les pages ne vérifient plus le mot de passe directement auprès de Supabase
-- Auth : elles passent par l'Edge Function « auth-gate », qui compte les
-- essais PAR COMPTE : 5 mauvais mots de passe en 15 min -> compte bloqué
-- 15 min (même le bon mot de passe est refusé). L'essai est compté AVANT la
-- vérification (une rafale en parallèle ne passe pas) ; une connexion réussie
-- remet le compteur à zéro.
-- Le mot de passe enregistré dans Supabase Auth est DÉRIVÉ de celui tapé
-- (HMAC-SHA256 avec le secret « auth_pepper ») : attaquer l'API Supabase Auth
-- en direct, sans passer par le portier, ne mène nulle part.
-- Schéma « private » : jamais exposé par l'API REST ; seules les fonctions
-- auth_gate_* (réservées au service_role = l'Edge Function) y touchent.
-- ------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.login_guard (
  email        text primary key,
  fails        integer not null default 0,     -- essais dans la fenêtre en cours
  first_fail   timestamptz,                     -- début de la fenêtre de 15 min
  locked_until timestamptz,                     -- bloqué jusqu'à…
  updated_at   timestamptz not null default now()
);
create table if not exists private.secrets (
  key   text primary key,
  value text not null
);
alter table private.login_guard enable row level security;   -- aucune policy : fonctions seulement
alter table private.secrets     enable row level security;
insert into private.secrets (key, value)
  values ('auth_pepper', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (key) do nothing;

-- Avant de vérifier un mot de passe : bloqué ? sinon l'essai est compté tout de suite.
-- -> { allowed, retry_after (s), left (essais restants après celui-ci), exists, pepper }
create or replace function public.auth_gate_begin(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  g private.login_guard;
begin
  if random() < 0.05 then   -- ménage : vieux compteurs (courriels inventés par un robot…)
    delete from private.login_guard
     where updated_at < now() - interval '1 day' and (locked_until is null or locked_until < now());
  end if;
  insert into private.login_guard (email) values (v_email) on conflict (email) do nothing;
  select * into g from private.login_guard where email = v_email for update;
  if g.locked_until is not null and g.locked_until > now() then
    return jsonb_build_object('allowed', false,
      'retry_after', ceil(extract(epoch from (g.locked_until - now())))::int);
  end if;
  if g.first_fail is null or g.first_fail < now() - interval '15 minutes' then
    g.fails := 0; g.first_fail := now();
  end if;
  g.fails := g.fails + 1;
  update private.login_guard
     set fails = g.fails, first_fail = g.first_fail, updated_at = now(),
         locked_until = case when g.fails >= 5 then now() + interval '15 minutes' end
   where email = v_email;
  return jsonb_build_object('allowed', true, 'left', greatest(0, 5 - g.fails),
    'exists', exists (select 1 from auth.users u where lower(u.email) = v_email),
    'pepper', (select value from private.secrets where key = 'auth_pepper'));
end $$;

-- Connexion réussie : compteur effacé.
create or replace function public.auth_gate_ok(p_email text)
returns void language sql security definer set search_path = '' as $$
  delete from private.login_guard where email = lower(btrim(coalesce(p_email, '')));
$$;

revoke all on function public.auth_gate_begin(text) from public, anon, authenticated;
revoke all on function public.auth_gate_ok(text)    from public, anon, authenticated;
grant execute on function public.auth_gate_begin(text) to service_role;
grant execute on function public.auth_gate_ok(text)    to service_role;

-- ------------------------------------------------------------
-- Vérification
-- ------------------------------------------------------------
select count(*) as produits_v2 from public.products;
select count(*) as factures_v2 from public.invoices;
select count(*) as dealers_v2  from public.dealers;
