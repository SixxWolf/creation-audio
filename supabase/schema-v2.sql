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
-- bobine vide (accessoire) liée au matériau ; posée ici car la vue products_public l'expose (détail : section BOBINES VIDES)
alter table public.materials add column if not exists empty_spool_id uuid references public.products(id) on delete set null;
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

-- Stock GARDÉ par les réservations en cours (comptes clients, étape 3 — tables
-- plus bas, section RÉSERVATIONS) : retiré du stock affiché par products_public
-- tant que la réservation est active et pas expirée (libéré à la seconde près).
-- plpgsql : le corps n'est validé qu'à l'appel (les tables sont créées plus bas).
-- + commandes en ligne dont le stock est « en attente de paiement » (customer_orders.stock_hold,
-- bouton admin Commandes › Clients en ligne) tant qu'elles sont ouvertes (Nouvelle / En préparation / Prête).
create or replace function public._held_stock()
returns table (product_id uuid, held_main integer, held_refill integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select u.product_id,
           coalesce(sum(u.qty) filter (where u.kind is distinct from 'refill'), 0)::int,
           coalesce(sum(u.qty) filter (where u.kind = 'refill'), 0)::int
      from (
        select l.product_id, l.kind, l.qty
          from public.customer_reservation_lines l
          join public.customer_reservations r on r.id = l.reservation_id
         where r.status = 'active' and r.expires_at > now() and l.product_id is not null
        union all
        select l.product_id, l.kind, l.qty
          from public.customer_order_lines l
          join public.customer_orders o on o.id = l.order_id
         where o.stock_hold and o.status in ('new', 'preparing', 'ready') and l.product_id is not null
      ) u
     group by u.product_id;
end $$;
grant execute on function public._held_stock() to anon, authenticated;   -- appelée par la vue (quantités seulement)

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
-- traduction anglaise (site /en/), écrite en coulisse par la fonction « translate » (section LANGUE ANGLAISE)
alter table public.products  add column if not exists i18n jsonb;
alter table public.materials add column if not exists i18n jsonb;
drop view if exists public.products_public;
create view public.products_public
with (security_invoker = off) as
  select
    p.id, p.type, p.name, p.material, p.brand, p.code, p.hex,
    p.i18n - 'stale' as en,            -- textes anglais de la couleur / du spacer / de l'accessoire
    m.i18n - 'stale' as material_en,   -- textes anglais du matériau
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
      'gallery',      p.attrs -> 'gallery',
      -- spacers : pièces d'origine remplacées [{brand, ref}] (« Remplace Metra 82-5606 ») ; vide = conception maison
      'replaces',     p.attrs -> 'replaces',
      -- spacers : haut-parleurs essayés [{model, ok}] (ok = ajustement confirmé, sinon à confirmer)
      'speakers',     p.attrs -> 'speakers',
      -- spacers : anciens noms (renommés en code maison) -> anciens liens, recherche, fichiers AutoLoop
      'aliases',      p.attrs -> 'aliases',
      -- accessoires : catégorie (puces + rabais cumulé), affichage sur la fiche filament (+ marques visées)
      'category',     p.attrs -> 'category',
      'on_filament',  p.attrs -> 'on_filament',
      'fil_brands',   p.attrs -> 'fil_brands'
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
    m.empty_spool_id,                  -- bobine vide (accessoire) du matériau : avertissement + échange recharge -> bobine (boutique)
    -- stock offert = stock réel − réservations en cours (null = non suivi, reste null)
    case when p.qty   is null then null else greatest(0, p.qty   - coalesce(h.held_main, 0))   end as qty,
    case when p.qty_2 is null then null else greatest(0, p.qty_2 - coalesce(h.held_refill, 0)) end as qty_2,
    p.size, p.sort_order
  from public.products p
  left join public.materials m on m.name = p.material and m.brand = p.brand
  left join public._held_stock() h on h.product_id = p.id
  where p.active = true;

grant select on public.products_public to anon, authenticated;

-- Accessoires (refonte 2026-10-04) : attrs.category (« Bobines vides »…),
-- attrs.on_filament (affiché sur la fiche filament) et attrs.fil_brands
-- (marques visées ; vide = toutes). Amorçage des accessoires d'avant : ils
-- étaient tous des bobines vides affichées sur toutes les fiches filament.
-- L'éditeur écrit toujours ces clés -> relancer ce fichier n'y retouche plus.
update public.products
   set attrs = coalesce(attrs, '{}'::jsonb)
             || jsonb_build_object('on_filament', true, 'fil_brands', '[]'::jsonb)
             || case when coalesce(attrs, '{}'::jsonb) ? 'category' then '{}'::jsonb
                     else jsonb_build_object('category', 'Bobines vides') end
 where type = 'accessory' and not (coalesce(attrs, '{}'::jsonb) ? 'on_filament');
-- « Stock seulement » retiré (2026-10-22) : les bobines vides se commandent au-delà du stock
-- (client connecté), avec un avertissement en boutique (délai sans garantie).
update public.products set attrs = attrs - 'stock_only' where attrs ? 'stock_only';

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
  client_type    text    not null default 'client',          -- 'client' | 'dealer' | 'internal' (usage interne, 0 $)
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
    and i.client_type is distinct from 'internal'          -- usage interne : pas une vente
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
         p.i18n - 'stale' as en,          -- textes anglais (portail /en/dealer.html)
         jsonb_strip_nulls(jsonb_build_object(
           'colors',       p.attrs -> 'colors',
           'img_spool',    p.attrs -> 'img_spool',
           'img_refill',   p.attrs -> 'img_refill',
           'description',  p.attrs -> 'description',
           'speaker_size', p.attrs -> 'speaker_size',
           'fitment',      p.attrs -> 'fitment',
           'specs',        p.attrs -> 'specs',
           'long_desc',    p.attrs -> 'long_desc',
           'gallery',      p.attrs -> 'gallery',
           'replaces',     p.attrs -> 'replaces',
           'speakers',     p.attrs -> 'speakers',
           'aliases',      p.attrs -> 'aliases'
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

-- Quantité ENCORE À REMETTRE au client (commande remise en deux fois : une
-- partie ce soir, le reste commandé chez le fournisseur). 0 = tout remis.
-- À la création, le stock n'est déduit que pour (qty − qty_pending) ; le
-- reste se déduit à la remise (RPC deliver_invoice, plus bas).
alter table public.invoice_lines add column if not exists qty_pending integer not null default 0 check (qty_pending >= 0);

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
  v_pend   integer;
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
    -- « à venir » : borné à la quantité ; seule la partie remise sort du stock
    v_pend  := greatest(0, least(coalesce((v_line ->> 'qty_pending')::integer, 0), abs(v_qty)::integer));
    v_taken := null;
    if p_deduct and v_prod is not null and v_qty > 0 then
      select case when v_kind = 'refill' then coalesce(qty_2,0) else coalesce(qty,0) end
        into v_before from public.products where id = v_prod for update;
      if found then
        v_taken := least(v_before, abs(v_qty)::integer - v_pend);
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
      (invoice_id, product_id, label, meta, kind, ptype, qty, unit_price, unit_cost, line_total, sort_order, qty_deducted, qty_pending)
    values
      (p_id, v_prod, v_line ->> 'label', v_line ->> 'meta', v_kind, v_line ->> 'ptype', v_qty,
       coalesce((v_line ->> 'unit_price')::numeric, 0), coalesce((v_line ->> 'unit_cost')::numeric, 0),
       coalesce((v_line ->> 'line_total')::numeric, 0), v_i, v_taken, v_pend);
    v_i := v_i + 1;
  end loop;

  -- 3) en-tête
  update public.invoices set
    number         = coalesce(nullif(trim(p_invoice ->> 'number'), ''), number),
    client_name    = p_invoice ->> 'client_name',
    client_contact = p_invoice ->> 'client_contact',
    client_address = p_invoice ->> 'client_address',
    client_city    = p_invoice ->> 'client_city',
    -- 'internal' (Usage interne, n° INT-) doit le rester : sinon la sortie compterait dans les ventes
    client_type    = case when p_invoice ->> 'client_type' in ('dealer', 'internal') then p_invoice ->> 'client_type' else 'client' end,
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
-- REMETTRE LES ARTICLES « À VENIR » (Historique -> « Remis » / « Tout remis »)
-- p_line null = toutes les lignes de la facture ; p_qty null = tout ce qui
-- reste sur la ligne. Si la facture a déduit son stock, la partie remise est
-- déduite maintenant (bornée à 0, ajoutée à qty_deducted pour qu'une
-- annulation ne remette que ce qui a vraiment été retiré).
-- Renvoie le nombre d'articles remis.
-- ------------------------------------------------------------
create or replace function public.deliver_invoice(p_invoice uuid, p_line uuid default null, p_qty integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_inv    public.invoices;
  r        record;
  v_n      integer;
  v_before integer;
  v_taken  integer;
  v_total  integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if v_inv.status = 'cancelled' then raise exception 'Une facture annulée ne peut pas être remise.'; end if;

  for r in select id, product_id, kind, qty_pending from public.invoice_lines
            where invoice_id = p_invoice and qty_pending > 0 and (p_line is null or id = p_line)
            order by sort_order for update loop
    v_n := case when p_qty is null then r.qty_pending else least(r.qty_pending, greatest(p_qty, 0)) end;
    continue when v_n <= 0;
    v_taken := 0;
    if v_inv.stock_deducted and r.product_id is not null then
      select case when r.kind = 'refill' then coalesce(qty_2,0) else coalesce(qty,0) end
        into v_before from public.products where id = r.product_id for update;
      if found then
        v_taken := least(v_before, v_n);
        update public.products
           set qty   = case when r.kind <> 'refill' then coalesce(qty,0)   - v_taken else qty   end,
               qty_2 = case when r.kind =  'refill' then coalesce(qty_2,0) - v_taken else qty_2 end,
               updated_at = now()
         where id = r.product_id;
      end if;
    end if;
    update public.invoice_lines
       set qty_pending  = qty_pending - v_n,
           qty_deducted = case when v_inv.stock_deducted and r.product_id is not null
                               then coalesce(qty_deducted, 0) + v_taken else qty_deducted end
     where id = r.id;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;
revoke all on function public.deliver_invoice(uuid, uuid, integer) from public, anon;
grant execute on function public.deliver_invoice(uuid, uuid, integer) to authenticated;

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
-- COMMANDES DEALER saisies par l'ADMIN (demande reçue par message)
-- Onglet Commandes › « Nouvelle commande » : même numérotation (D-0001),
-- mêmes prix que le portail (prix dealer + palier par modèle, recalculés
-- par _dealer_fill_lines) ; la commande apparaît dans « Mes commandes »
-- du dealer. created_by = 'admin' → le portail affiche « ajoutée par
-- Création Audio ». L'admin peut aussi modifier une commande en cours
-- (Nouvelle / En préparation / Prête), jamais une facturée ou annulée.
-- ------------------------------------------------------------
alter table public.dealer_orders add column if not exists created_by text not null default 'dealer';
do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'dealer_orders_created_by_check' and conrelid = 'public.dealer_orders'::regclass) then
    alter table public.dealer_orders add constraint dealer_orders_created_by_check check (created_by in ('dealer', 'admin'));
  end if;
end $$;

-- p_id null = nouvelle commande pour le dealer p_email ; sinon modification (p_email ignoré).
create or replace function public.admin_save_dealer_order(p_id uuid, p_email text, p_lines jsonb, p_note text default null)
returns public.dealer_orders language plpgsql security definer set search_path = public as $$
declare
  v_dealer public.dealers;
  v_order  public.dealer_orders;
  v_note   text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.' using errcode = '42501'; end if;
  if p_id is null then
    select * into v_dealer from public.dealers where lower(email) = lower(btrim(coalesce(p_email, '')));
    if not found then raise exception 'Dealer introuvable.' using errcode = 'P0001'; end if;
    insert into public.dealer_orders (number, dealer_email, dealer_name, note, status, created_by)
    values ('D-' || lpad(nextval('public.dealer_order_seq')::text, 4, '0'),
            v_dealer.email, v_dealer.name, v_note, 'new', 'admin')
    returning * into v_order;
  else
    select * into v_order from public.dealer_orders where id = p_id for update;
    if not found then raise exception 'Commande introuvable.' using errcode = 'P0001'; end if;
    if v_order.status not in ('new', 'preparing', 'ready') then
      raise exception 'Commande facturée ou annulée : plus modifiable.' using errcode = 'P0001';
    end if;
    update public.dealer_orders set note = v_note, updated_at = now() where id = p_id;
  end if;
  perform public._dealer_fill_lines(v_order.id, p_lines);
  select * into v_order from public.dealer_orders where id = v_order.id;
  return v_order;
end $$;
revoke all on function public.admin_save_dealer_order(uuid, text, jsonb, text) from public, anon;
grant execute on function public.admin_save_dealer_order(uuid, text, jsonb, text) to authenticated;

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

-- ============================================================
-- COMPTES CLIENTS (étape 1) — connexion par CODE reçu par courriel
-- Pas de mot de passe. L'Edge Function « compte-code » envoie un code à
-- 6 chiffres (Resend), le vérifie (5 essais, 10 min), PUIS crée l'utilisateur
-- Supabase Auth s'il n'existe pas et rend une session à la page compte.html.
-- Un compte = auth.users + une ligne customers. L'admin relie le compte à une
-- fiche « clients » (onglet Clients) : le client voit alors les factures de
-- cette fiche (invoices.client_id) — jamais les coûts ni la marge.
-- Le client ne lit AUCUNE table directement : RPC me_* seulement.
-- Loi 25 : compte supprimé après 3 ans sans connexion (job customers-cleanup)
-- ou à sa demande (me_delete) ; les factures restent (obligation fiscale).
-- ------------------------------------------------------------
create table if not exists public.customers (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  name         text,
  phone        text,
  client_id    uuid unique references public.clients(id) on delete set null,   -- fiche reliée par l'admin
  can_reserve  boolean not null default false,                                  -- réservations (étape 3)
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  linked_at    timestamptz
);
alter table public.customers enable row level security;
drop policy if exists customers_admin_all on public.customers;
create policy customers_admin_all on public.customers for all to authenticated
  using  ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

-- facture -> fiche client (ce qui la rend visible au compte relié à cette fiche)
alter table public.invoices add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists invoices_client_idx on public.invoices (client_id);

-- Nouvelle facture d'un client : reliée d'office à LA fiche du même nom (s'il n'y
-- en a qu'une). Nom changé à la modification : on relie de nouveau.
create or replace function public._invoice_link_client()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  if new.client_type is distinct from 'client' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.client_name is not distinct from old.client_name then return new; end if;
    -- renommage venu de la fiche (trigger clients_rename_invoices) : le lien reste
    if new.client_id is not null and exists (select 1 from public.clients c
         where c.id = new.client_id and lower(btrim(c.name)) = lower(btrim(new.client_name))) then return new; end if;
    if new.client_id is not distinct from old.client_id then new.client_id := null; end if;
  end if;
  if new.client_id is not null or coalesce(btrim(new.client_name), '') = '' then return new; end if;
  select array_agg(c.id) into v_ids from public.clients c
   where lower(btrim(c.name)) = lower(btrim(new.client_name));
  if coalesce(array_length(v_ids, 1), 0) = 1 then new.client_id := v_ids[1]; end if;
  return new;
end $$;
revoke all on function public._invoice_link_client() from public, anon, authenticated;
drop trigger if exists invoices_link_client on public.invoices;
create trigger invoices_link_client before insert or update of client_name, client_type on public.invoices
  for each row execute function public._invoice_link_client();

-- Fiche client renommée (admin ou client) : ses factures reliées prennent le nouveau nom.
create or replace function public._client_rename_invoices()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(new.name), '') <> '' then
    update public.invoices set client_name = btrim(new.name)
     where client_id = new.id and client_name is distinct from btrim(new.name);
  end if;
  return new;
end $$;
revoke all on function public._client_rename_invoices() from public, anon, authenticated;
drop trigger if exists clients_rename_invoices on public.clients;
create trigger clients_rename_invoices after update of name on public.clients
  for each row when (old.name is distinct from new.name)
  execute function public._client_rename_invoices();

-- rattrapage : factures déjà reliées dont le nom a divergé de la fiche
update public.invoices i set client_name = btrim(c.name)
  from public.clients c
 where i.client_id = c.id and coalesce(btrim(c.name), '') <> '' and i.client_name is distinct from btrim(c.name);

-- ---- codes de connexion (schéma private : Edge Function seulement) ----
create table if not exists private.login_codes (
  email        text primary key,
  code_hash    text,                             -- HMAC du code en cours (jamais le code en clair)
  expires_at   timestamptz,
  tries        integer not null default 0,       -- mauvais codes pour le code en cours
  sends        integer not null default 0,       -- envois dans la fenêtre d'une heure
  window_start timestamptz,
  last_sent    timestamptz,
  updated_at   timestamptz not null default now()
);
create table if not exists private.login_code_ips (
  ip           text primary key,
  sends        integer not null default 0,
  window_start timestamptz not null default now()
);
alter table private.login_codes    enable row level security;   -- aucune policy : fonctions seulement
alter table private.login_code_ips enable row level security;

create or replace function private._code_hash(p_email text, p_code text)
returns text language sql stable set search_path = '' as $$
  select encode(extensions.hmac(convert_to(lower(btrim(p_email)) || E'\n' || p_code, 'UTF8'),
                                convert_to((select value from private.secrets where key = 'auth_pepper'), 'UTF8'),
                                'sha256'), 'hex');
$$;
revoke all on function private._code_hash(text, text) from public, anon, authenticated;

-- Nouveau code : 1 envoi / 60 s et 5 / heure par courriel, 20 / heure par adresse IP.
-- -> { allowed, retry_after (s) }
create or replace function public.compte_code_issue(p_email text, p_ip text, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  g private.login_codes;
  r private.login_code_ips;
begin
  if random() < 0.05 then   -- ménage
    delete from private.login_codes    where updated_at   < now() - interval '1 day';
    delete from private.login_code_ips where window_start < now() - interval '1 day';
  end if;
  if coalesce(p_ip, '') <> '' then
    insert into private.login_code_ips (ip) values (p_ip) on conflict (ip) do nothing;
    select * into r from private.login_code_ips where ip = p_ip for update;
    if r.window_start < now() - interval '1 hour' then r.sends := 0; r.window_start := now(); end if;
    if r.sends >= 20 then
      return jsonb_build_object('allowed', false,
        'retry_after', ceil(extract(epoch from (r.window_start + interval '1 hour' - now())))::int);
    end if;
    update private.login_code_ips set sends = r.sends + 1, window_start = r.window_start where ip = p_ip;
  end if;
  insert into private.login_codes (email) values (v_email) on conflict (email) do nothing;
  select * into g from private.login_codes where email = v_email for update;
  if g.last_sent is not null and g.last_sent > now() - interval '60 seconds' then
    return jsonb_build_object('allowed', false,
      'retry_after', ceil(extract(epoch from (g.last_sent + interval '60 seconds' - now())))::int);
  end if;
  if g.window_start is null or g.window_start < now() - interval '1 hour' then g.sends := 0; g.window_start := now(); end if;
  if g.sends >= 5 then
    return jsonb_build_object('allowed', false,
      'retry_after', ceil(extract(epoch from (g.window_start + interval '1 hour' - now())))::int);
  end if;
  update private.login_codes
     set code_hash = private._code_hash(v_email, p_code), expires_at = now() + interval '10 minutes', tries = 0,
         sends = g.sends + 1, window_start = g.window_start, last_sent = now(), updated_at = now()
   where email = v_email;
  return jsonb_build_object('allowed', true);
end $$;

-- Vérifie un code (usage unique ; 5 mauvais codes -> code annulé, en redemander un).
-- -> { ok } | { ok:false, reason: 'none'|'expired'|'locked'|'invalid', left }
create or replace function public.compte_code_check(p_email text, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  g private.login_codes;
begin
  select * into g from private.login_codes where email = v_email for update;
  if not found or g.code_hash is null then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if g.expires_at < now() then
    update private.login_codes set code_hash = null, updated_at = now() where email = v_email;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if g.code_hash = private._code_hash(v_email, coalesce(p_code, '')) then
    update private.login_codes set code_hash = null, tries = 0, updated_at = now() where email = v_email;
    return jsonb_build_object('ok', true);
  end if;
  g.tries := g.tries + 1;
  if g.tries >= 5 then
    update private.login_codes set code_hash = null, tries = g.tries, updated_at = now() where email = v_email;
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  update private.login_codes set tries = g.tries, updated_at = now() where email = v_email;
  return jsonb_build_object('ok', false, 'reason', 'invalid', 'left', 5 - g.tries);
end $$;

-- Connexion réussie : crée/actualise la ligne du compte. -> { needs_name }
create or replace function public.compte_touch(p_id uuid, p_email text)
returns jsonb language sql security definer set search_path = '' as $$
  insert into public.customers as c (id, email) values (p_id, lower(btrim(p_email)))
  on conflict (id) do update set email = excluded.email, last_seen_at = now()
  returning jsonb_build_object('needs_name', coalesce(btrim(c.name), '') = '');
$$;

revoke all on function public.compte_code_issue(text, text, text) from public, anon, authenticated;
revoke all on function public.compte_code_check(text, text)       from public, anon, authenticated;
revoke all on function public.compte_touch(uuid, text)            from public, anon, authenticated;
grant execute on function public.compte_code_issue(text, text, text) to service_role;
grant execute on function public.compte_code_check(text, text)       to service_role;
grant execute on function public.compte_touch(uuid, text)            to service_role;

-- ---- ce que le client connecté peut lire / faire (compte.html) ----
create or replace function public.me_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c public.customers;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  update public.customers set last_seen_at = now() where id = v_uid returning * into c;
  if not found then
    insert into public.customers (id, email) values (v_uid, lower((select auth.jwt()) ->> 'email')) returning * into c;
  end if;
  return jsonb_build_object('email', c.email, 'name', c.name, 'phone', c.phone,
    'linked', c.client_id is not null, 'can_reserve', c.can_reserve, 'created_at', c.created_at);
end $$;

create or replace function public.me_update(p_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, '')); v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'Nom invalide.'; end if;
  if length(coalesce(v_phone, '')) > 30 then raise exception 'Téléphone invalide.'; end if;
  update public.customers set name = v_name, phone = v_phone where id = (select auth.uid());
  return public.me_account();
end $$;

-- Factures de la fiche reliée — SANS coût, marge ni stock.
create or replace function public.me_invoices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'invoice_date' desc, x ->> 'number' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', i.id, 'number', i.number, 'invoice_date', i.invoice_date, 'status', i.status, 'category', i.category,
      'client_name', i.client_name, 'client_contact', i.client_contact,
      'client_address', i.client_address, 'client_city', i.client_city, 'note', i.note,
      'tax_enabled', i.tax_enabled, 'subtotal', i.subtotal, 'tax_gst', i.tax_gst, 'tax_qst', i.tax_qst, 'total', i.total,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'label', l.label, 'meta', l.meta, 'kind', l.kind, 'ptype', l.ptype, 'qty', l.qty,
          'unit_price', l.unit_price, 'line_total', l.line_total, 'qty_pending', coalesce(l.qty_pending, 0),
          'hex', (select p.hex from public.products p where p.id = l.product_id)
        ) order by l.sort_order, l.id)
        from public.invoice_lines l where l.invoice_id = i.id), '[]'::jsonb)) as x
    from public.invoices i
    join public.customers c on c.client_id = i.client_id
    where c.id = (select auth.uid()) and i.status in ('final', 'cancelled')
  ) s;
$$;

-- Alertes « M'aviser » ouvertes à son courriel.
create or replace function public.me_waitlist()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'kind', w.kind, 'created_at', w.created_at, 'expires_at', w.expires_at,
      'type', p.type, 'name', p.name, 'brand', p.brand, 'material', p.material, 'hex', p.hex, 'slug', p.slug,
      'brand_slug', b.slug, 'material_slug', m.slug
    ) order by w.created_at desc), '[]'::jsonb)
  from public.waitlist w
  join public.products p on p.id = w.product_id
  left join public.brands b on b.name = p.brand
  left join public.materials m on m.brand = p.brand and m.name = p.material
  where w.status = 'open' and w.source = 'site'
    and lower(w.contact) = lower((select auth.jwt()) ->> 'email');
$$;

create or replace function public.me_waitlist_cancel(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.waitlist set status = 'expired', contact = null, name = null
   where id = p_id and status = 'open' and source = 'site'
     and lower(contact) = lower((select auth.jwt()) ->> 'email');
  return found;
end $$;

-- Supprimer mon compte (Loi 25) : compte + alertes. Les factures restent (obligation
-- fiscale) ; un compte admin ou dealer garde son accès (seule la ligne client part).
create or replace function public.me_delete()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text := lower((select auth.jwt()) ->> 'email');
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  update public.waitlist set status = 'expired', contact = null, name = null
   where status = 'open' and source = 'site' and lower(contact) = v_email;
  delete from public.customers where id = v_uid;
  if v_email <> 'creationaudio.ca@gmail.com'
     and not exists (select 1 from public.dealers d where lower(d.email) = v_email) then
    delete from auth.users where id = v_uid;
  end if;
  return true;
end $$;

revoke all on function public.me_account()              from public, anon;
revoke all on function public.me_update(text, text)     from public, anon;
revoke all on function public.me_invoices()             from public, anon;
revoke all on function public.me_waitlist()             from public, anon;
revoke all on function public.me_waitlist_cancel(uuid)  from public, anon;
revoke all on function public.me_delete()               from public, anon;
grant execute on function public.me_account()             to authenticated;
grant execute on function public.me_update(text, text)    to authenticated;
grant execute on function public.me_invoices()            to authenticated;
grant execute on function public.me_waitlist()            to authenticated;
grant execute on function public.me_waitlist_cancel(uuid) to authenticated;
grant execute on function public.me_delete()              to authenticated;

-- Coordonnées de l'entreprise imprimées sur la facture (Réglages › Entreprise,
-- recopiées ici par l'admin) : le client réimprime ses factures à l'identique.
create or replace function public.company_public()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_strip_nulls(jsonb_build_object(
      'name', v -> 'name', 'tagline', v -> 'tagline', 'address', v -> 'address', 'city', v -> 'city',
      'email', v -> 'email', 'phone', v -> 'phone', 'gst', v -> 'gst', 'qst', v -> 'qst', 'logo', v -> 'logo'))
    from (select value as v from public.admin_settings where key = 'entreprise') s), '{}'::jsonb);
$$;
revoke all on function public.company_public() from public, anon;
grant execute on function public.company_public() to authenticated;

-- 3 ans sans connexion -> compte supprimé (sauf admin / dealer : seule la ligne client part).
create or replace function public.customers_cleanup()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.users u using public.customers c
   where c.id = u.id and c.last_seen_at < now() - interval '3 years'
     and lower(u.email) <> 'creationaudio.ca@gmail.com'
     and not exists (select 1 from public.dealers d where lower(d.email) = lower(u.email));
  get diagnostics n = row_count;
  delete from public.customers where last_seen_at < now() - interval '3 years';
  return n;
end $$;
revoke all on function public.customers_cleanup() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'customers-cleanup';
select cron.schedule('customers-cleanup', '30 4 * * *', 'select public.customers_cleanup()');

-- ============================================================
-- USAGE INTERNE — bobines / articles que Théo prend dans son inventaire.
-- Facturation › « Interne » : invoices.client_type = 'internal', prix 0 $
-- (coût unitaire gardé = valeur au coûtant), stock déduit comme une vente.
-- Série de numéros À PART (INT-AAAA-###) : les factures F- restent sans trou.
-- Exclu des ventes : Statistiques (carte « Usage interne » à part), product_popularity.
-- ------------------------------------------------------------
alter table public.invoice_counters add column if not exists seq_int int not null default 0;
create or replace function public.next_internal_number()
returns text language plpgsql security definer set search_path = public as $$
declare y int := extract(year from current_date)::int; n int;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  insert into public.invoice_counters (year, seq, seq_int) values (y, 0, 1)
    on conflict (year) do update set seq_int = public.invoice_counters.seq_int + 1
    returning seq_int into n;
  return 'INT-' || y::text || '-' || lpad(n::text, 3, '0');
end $$;
revoke all on function public.next_internal_number() from public, anon;
grant execute on function public.next_internal_number() to authenticated;

-- ============================================================
-- COMMANDES EN LIGNE (comptes clients, étape 2)
-- Un client connecté (compte.html) envoie son panier depuis la boutique ou la
-- page spacers : RPC customer_submit_order (prix recalculés ICI, même règle que
-- le panier). Un article en rupture se commande quand même : qty_to_order = la
-- part au-delà du stock (délai annoncé au client). Cueillette seulement, aucun
-- paiement en ligne. Numéros C-0001 (séquence). Modifiable / annulable par le
-- client tant que « Nouvelle ». L'admin les voit dans Commandes › Clients ;
-- « Facturer » -> admin_invoice_customer_order (Facturée + compte relié à sa fiche).
-- Courriels : Edge Function « customer-order-notify » (client + Création Audio).
-- ------------------------------------------------------------
create sequence if not exists public.customer_order_seq;
create table if not exists public.customer_orders (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,                       -- C-0001
  customer_id   uuid references public.customers(id) on delete set null,
  email         text not null,                              -- figés à l'envoi (dossier de la commande)
  name          text,
  phone         text,
  status        text not null default 'new' check (status in ('new','preparing','ready','invoiced','cancelled')),
  note          text,
  total         numeric(10,2) not null default 0,
  has_backorder boolean not null default false,             -- au moins un article à commander
  invoice_id    uuid references public.invoices(id) on delete set null,
  cancelled_by  text,                                        -- 'client' | 'admin'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  edited_at     timestamptz,
  notified_at   timestamptz
);
-- cueillette choisie par le client (section CUEILLETTE plus bas)
alter table public.customer_orders add column if not exists pickup_date        date;
alter table public.customer_orders add column if not exists pickup_start       time;
alter table public.customer_orders add column if not exists pickup_end         time;
alter table public.customer_orders add column if not exists pickup_notified_at timestamptz;
alter table public.customer_orders add column if not exists pickup_req         jsonb;   -- demande d'exception (voir CUEILLETTE)
alter table public.customer_orders add column if not exists ready_notified_at  timestamptz;   -- courriel « commande prête » (EF customer-order-notify, event ready)
alter table public.customer_orders add column if not exists stock_hold boolean not null default false;   -- stock retiré du site en attendant le paiement (voir _held_stock)
create index if not exists customer_orders_customer_idx on public.customer_orders (customer_id, created_at desc);
create index if not exists customer_orders_status_idx on public.customer_orders (status);
create table if not exists public.customer_order_lines (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.customer_orders(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  ptype        text,                                         -- filament | accessory | spacer
  kind         text,                                         -- spool | refill | unit
  name         text not null,
  meta         text,
  qty          integer not null check (qty > 0),
  unit_price   numeric(10,2) not null default 0,
  line_total   numeric(10,2) not null default 0,
  qty_to_order integer not null default 0,                   -- au-delà du stock à l'envoi
  sort_order   integer not null default 0
);
create index if not exists customer_order_lines_order_idx on public.customer_order_lines (order_id);
alter table public.customer_orders enable row level security;
alter table public.customer_order_lines enable row level security;
drop policy if exists customer_orders_admin_all on public.customer_orders;
create policy customer_orders_admin_all on public.customer_orders for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists customer_order_lines_admin_all on public.customer_order_lines;
create policy customer_order_lines_admin_all on public.customer_order_lines for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );

-- Prix au palier (même règle que la boutique : le plus haut palier atteint, sinon le prix de base).
create or replace function public._tier_price(p_base numeric, p_tiers jsonb, p_qty integer)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce((
    select (t ->> 'price')::numeric
      from jsonb_array_elements(case when jsonb_typeof(p_tiers) = 'array' then p_tiers else '[]'::jsonb end) t
     where (t ->> 'min') ~ '^\d+$' and (t ->> 'min')::int >= 1 and (t ->> 'min')::int <= p_qty
       and (t ->> 'price') ~ '^\d+(\.\d+)?$'
     order by (t ->> 'min')::int desc limit 1), p_base, 0);
$$;

-- Lignes d'une commande client, prix recalculés côté serveur : filaments = palier sur le
-- TOTAL de la marque (bobines + recharges) ; accessoires = palier sur le total de la catégorie ;
-- spacers = prix client à plat. Doublons fusionnés. -> jsonb [{product_id, ptype, kind, name,
-- meta, qty, unit_price, line_total, qty_to_order, sort_order}]
create or replace function public._customer_fill_lines(p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_in int; v_ok int; v_out jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Ton panier est vide.';
  end if;
  if jsonb_array_length(p_lines) > 60 then raise exception 'Trop d''articles dans une seule commande.'; end if;
  with l as (
    select (x ->> 'product_id')::uuid as pid,
           case when x ->> 'kind' in ('spool', 'refill') then x ->> 'kind' else 'unit' end as kind,
           sum(least((x ->> 'qty')::int, 999))::int as qty
      from jsonb_array_elements(p_lines) x
     where (x ->> 'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and coalesce(x ->> 'qty', '') ~ '^\d{1,4}$' and (x ->> 'qty')::int > 0
     group by 1, 2
  ), j as (
    select l.pid, l.kind, l.qty, pp.type, pp.name, pp.brand, pp.material, pp.sort_order,
           case when pp.type = 'filament' and l.kind = 'refill' then pp.sell_price_2 else pp.sell_price end as base,
           case when pp.type = 'filament' and l.kind = 'refill' then pp.tiers_2
                when pp.type = 'spacer' then '[]'::jsonb else pp.tiers end as tiers,
           case when pp.type = 'filament' then 'fil|' || coalesce(nullif(pp.brand, ''), nullif(pp.material, ''), '')
                when pp.type = 'accessory' and coalesce(btrim(pp.attrs ->> 'category'), '') <> ''
                  then 'acc|' || lower(btrim(pp.attrs ->> 'category'))
                else 'one|' || l.pid::text || '|' || l.kind end as gkey,
           case when l.kind = 'refill' then coalesce(pp.qty_2, 0) else pp.qty end as stock
      from l
      join public.products_public pp on pp.id = l.pid
     where (pp.type = 'filament' and l.kind in ('spool', 'refill'))
        or (pp.type in ('accessory', 'spacer') and l.kind = 'unit')
  ), g as (select gkey, sum(qty)::int as gq from j group by gkey),
  priced as (
    select j.*, round(public._tier_price(j.base, j.tiers, g.gq), 2) as unit
      from j join g using (gkey)
     where j.base is not null
  ), s as (
    select priced.*, row_number() over (order by case type when 'filament' then 0 when 'accessory' then 1 else 2 end,
             brand nulls last, material nulls last, sort_order, name, kind) - 1 as rn
      from priced
  )
  select (select count(*) from l), count(*), coalesce(jsonb_agg(jsonb_build_object(
           'product_id', pid, 'ptype', type, 'kind', kind, 'name', name,
           'meta', case when type = 'filament'
                        then concat_ws(' · ', nullif(brand, ''), nullif(material, ''), case when kind = 'refill' then 'Recharge' else 'Avec bobine' end)
                        when type = 'accessory' then 'Accessoire' else 'Spacer · paire' end,
           'qty', qty, 'unit_price', unit, 'line_total', round(unit * qty, 2),
           'qty_to_order', case when stock is null then 0 else greatest(0, qty - greatest(stock, 0)) end,
           'sort_order', rn) order by rn), '[]'::jsonb)
    into v_in, v_ok, v_out
    from s;
  if v_in = 0 then raise exception 'Ton panier est vide.'; end if;
  if v_ok <> v_in then
    raise exception 'Un article de ton panier n''est plus offert. Recharge la page puis réessaie.';
  end if;
  return v_out;
end $$;
revoke all on function public._customer_fill_lines(jsonb) from public, anon, authenticated;

-- Envoi d'une commande par le client connecté. -> { id, number, total, has_backorder }
-- p_pickup { d: 'AAAA-MM-JJ', s: 'HH:MM' } : facultatif (validé s'il est fourni et que tout est en stock) ;
-- le client choisit sa cueillette juste après l'envoi, sur l'écran « Ma cueillette » de Mon compte.
drop function if exists public.customer_submit_order(jsonb, text);
create or replace function public.customer_submit_order(p_lines jsonb, p_note text default null, p_pickup jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c public.customers; v_lines jsonb; v_id uuid; v_num text;
        v_total numeric; v_bo boolean; v_pk jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into c from public.customers where id = v_uid;
  if not found then raise exception 'Compte introuvable. Reconnecte-toi.' using errcode = '42501'; end if;
  if (select count(*) from public.customer_orders where customer_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de commandes envoyées en peu de temps. Réessaie plus tard.';
  end if;
  v_lines := public._customer_fill_lines(p_lines);
  select coalesce(sum((x ->> 'line_total')::numeric), 0), coalesce(bool_or((x ->> 'qty_to_order')::int > 0), false)
    into v_total, v_bo from jsonb_array_elements(v_lines) x;
  if not v_bo then v_pk := public._pickup_check(p_pickup, null, null, false); end if;
  v_num := 'C-' || lpad(nextval('public.customer_order_seq')::text, 4, '0');
  insert into public.customer_orders (number, customer_id, email, name, phone, note, total, has_backorder,
                                      pickup_date, pickup_start, pickup_end)
  values (v_num, v_uid, c.email, c.name, c.phone, nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_total, v_bo,
          (v_pk ->> 'd')::date, (v_pk ->> 's')::time, (v_pk ->> 'e')::time)
  returning id into v_id;
  insert into public.customer_order_lines (order_id, product_id, ptype, kind, name, meta, qty, unit_price, line_total, qty_to_order, sort_order)
  select v_id, (x ->> 'product_id')::uuid, x ->> 'ptype', x ->> 'kind', x ->> 'name', x ->> 'meta', (x ->> 'qty')::int,
         (x ->> 'unit_price')::numeric, (x ->> 'line_total')::numeric, (x ->> 'qty_to_order')::int, (x ->> 'sort_order')::int
    from jsonb_array_elements(v_lines) x;
  return jsonb_build_object('id', v_id, 'number', v_num, 'total', v_total, 'has_backorder', v_bo);
end $$;

-- Modification par le client (seulement tant que « Nouvelle »). p_pickup null = cueillette inchangée.
drop function if exists public.customer_update_order(uuid, jsonb, text);
create or replace function public.customer_update_order(p_id uuid, p_lines jsonb, p_note text default null, p_pickup jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); o public.customer_orders; v_lines jsonb; v_total numeric; v_bo boolean; v_pk jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into o from public.customer_orders where id = p_id and customer_id = v_uid for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if o.status <> 'new' then raise exception 'Cette commande est déjà en préparation : écris-nous pour la changer.'; end if;
  v_lines := public._customer_fill_lines(p_lines);
  select coalesce(sum((x ->> 'line_total')::numeric), 0), coalesce(bool_or((x ->> 'qty_to_order')::int > 0), false)
    into v_total, v_bo from jsonb_array_elements(v_lines) x;
  if not v_bo and p_pickup is not null then v_pk := public._pickup_check(p_pickup, null, p_id, false); end if;
  delete from public.customer_order_lines where order_id = p_id;
  insert into public.customer_order_lines (order_id, product_id, ptype, kind, name, meta, qty, unit_price, line_total, qty_to_order, sort_order)
  select p_id, (x ->> 'product_id')::uuid, x ->> 'ptype', x ->> 'kind', x ->> 'name', x ->> 'meta', (x ->> 'qty')::int,
         (x ->> 'unit_price')::numeric, (x ->> 'line_total')::numeric, (x ->> 'qty_to_order')::int, (x ->> 'sort_order')::int
    from jsonb_array_elements(v_lines) x;
  update public.customer_orders
     set total = v_total, has_backorder = v_bo, note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         pickup_date  = case when v_pk is not null then (v_pk ->> 'd')::date else pickup_date end,
         pickup_start = case when v_pk is not null then (v_pk ->> 's')::time else pickup_start end,
         pickup_end   = case when v_pk is not null then (v_pk ->> 'e')::time else pickup_end end,
         edited_at = now(), updated_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'number', o.number, 'total', v_total, 'has_backorder', v_bo);
end $$;

-- Annulation par le client (seulement tant que « Nouvelle »).
create or replace function public.customer_cancel_order(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); o public.customer_orders;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into o from public.customer_orders where id = p_id and customer_id = v_uid for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if o.status <> 'new' then raise exception 'Cette commande est déjà en préparation : écris-nous pour l''annuler.'; end if;
  update public.customer_orders set status = 'cancelled', cancelled_by = 'client', updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'number', o.number);
end $$;

-- Ses commandes (Mon compte › Commandes).
create or replace function public.me_orders()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'number', o.number, 'status', o.status, 'created_at', o.created_at, 'edited_at', o.edited_at,
      'note', o.note, 'total', o.total, 'has_backorder', o.has_backorder, 'cancelled_by', o.cancelled_by,
      'pickup_date', o.pickup_date, 'pickup_start', to_char(o.pickup_start, 'HH24:MI'), 'pickup_end', to_char(o.pickup_end, 'HH24:MI'),
      'pickup_req', o.pickup_req,
      'invoice_number', (select i.number from public.invoices i where i.id = o.invoice_id),
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_id', l.product_id, 'ptype', l.ptype, 'kind', l.kind, 'name', l.name, 'meta', l.meta, 'qty', l.qty,
          'unit_price', l.unit_price, 'line_total', l.line_total, 'qty_to_order', l.qty_to_order,
          'hex', (select p.hex from public.products p where p.id = l.product_id)) order by l.sort_order)
        from public.customer_order_lines l where l.order_id = o.id), '[]'::jsonb)
    ) order by o.created_at desc), '[]'::jsonb)
  from (select * from public.customer_orders where customer_id = (select auth.uid())
        order by created_at desc limit 50) o;
$$;

-- Admin : commande facturée -> « Facturée » + facture rattachée à la fiche du client
-- (fiche du compte, sinon celle qui a son courriel, sinon nouvelle fiche) ; le compte est
-- relié à cette fiche s'il ne l'était pas : la facture apparaît dans Mon compte.
create or replace function public.admin_invoice_customer_order(p_order uuid, p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.customer_orders; c public.customers; v_cid uuid;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select * into o from public.customer_orders where id = p_order for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  update public.customer_orders set status = 'invoiced', invoice_id = p_invoice, updated_at = now() where id = p_order;
  if o.customer_id is not null then
    select * into c from public.customers where id = o.customer_id;
    v_cid := c.client_id;
    if v_cid is null then
      select id into v_cid from public.clients where lower(email) = lower(o.email) limit 1;
      if v_cid is null then
        insert into public.clients (name, email, phone)
        values (coalesce(nullif(btrim(o.name), ''), o.email), lower(o.email), o.phone) returning id into v_cid;
      end if;
      if exists (select 1 from public.customers x where x.client_id = v_cid and x.id <> c.id) then
        v_cid := null;   -- fiche déjà reliée à un autre compte : on ne touche à rien
      else
        update public.customers set client_id = v_cid, linked_at = now() where id = c.id;
      end if;
    end if;
    if v_cid is not null then update public.invoices set client_id = v_cid where id = p_invoice; end if;
  end if;
  return jsonb_build_object('client_id', v_cid);
end $$;

-- Modification par l'admin d'une commande client en cours (Nouvelle / En préparation / Prête) :
-- remplace les lignes (prix recalculés comme à l'envoi). N'écrit pas edited_at (= « modifiée par le client »).
create or replace function public.admin_update_customer_order(p_id uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.customer_orders; v_lines jsonb; v_total numeric; v_bo boolean;
begin
  if not (select public.is_admin()) then raise exception 'Réservé à l''admin.' using errcode = '42501'; end if;
  select * into o from public.customer_orders where id = p_id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if o.status not in ('new', 'preparing', 'ready') then raise exception 'Commande facturée ou annulée : plus modifiable.'; end if;
  v_lines := public._customer_fill_lines(p_lines);
  select coalesce(sum((x ->> 'line_total')::numeric), 0), coalesce(bool_or((x ->> 'qty_to_order')::int > 0), false)
    into v_total, v_bo from jsonb_array_elements(v_lines) x;
  delete from public.customer_order_lines where order_id = p_id;
  insert into public.customer_order_lines (order_id, product_id, ptype, kind, name, meta, qty, unit_price, line_total, qty_to_order, sort_order)
  select p_id, (x ->> 'product_id')::uuid, x ->> 'ptype', x ->> 'kind', x ->> 'name', x ->> 'meta', (x ->> 'qty')::int,
         (x ->> 'unit_price')::numeric, (x ->> 'line_total')::numeric, (x ->> 'qty_to_order')::int, (x ->> 'sort_order')::int
    from jsonb_array_elements(v_lines) x;
  update public.customer_orders set total = v_total, has_backorder = v_bo, updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'number', o.number, 'total', v_total, 'has_backorder', v_bo);
end $$;
revoke all on function public.admin_update_customer_order(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_customer_order(uuid, jsonb) to authenticated;

revoke all on function public.customer_submit_order(jsonb, text, jsonb)       from public, anon;
revoke all on function public.customer_update_order(uuid, jsonb, text, jsonb) from public, anon;
revoke all on function public.customer_cancel_order(uuid)              from public, anon;
revoke all on function public.me_orders()                               from public, anon;
revoke all on function public.admin_invoice_customer_order(uuid, uuid)  from public, anon;
grant execute on function public.customer_submit_order(jsonb, text, jsonb)       to authenticated;
grant execute on function public.customer_update_order(uuid, jsonb, text, jsonb) to authenticated;
grant execute on function public.customer_cancel_order(uuid)              to authenticated;
grant execute on function public.me_orders()                               to authenticated;
grant execute on function public.admin_invoice_customer_order(uuid, uuid)  to authenticated;

-- ============================================================
-- RÉSERVATIONS (comptes clients, étape 3)
-- Un client APPROUVÉ (customers.can_reserve, case « Peut réserver » dans Clients)
-- réserve depuis le panier de la boutique des filaments / accessoires EN STOCK
-- (jamais les spacers, jamais au-delà du stock : il y a « Commander · délai »).
-- Gardé 72 h, sans dépôt, sans maximum d'articles : le stock gardé sort de
-- products_public (fonction _held_stock, plus haut) -> invisible aux autres.
-- Numéros R-0001. Le client annule lui-même dans Mon compte (sans pénalité).
-- À l'échéance (pg_cron « reservations-tick », aux 10 min) : « Expirée », stock
-- libéré, 1 non récupérée comptée ; 2 non récupérées -> réservations suspendues
-- 60 jours (compteur remis à 0). L'admin : Commandes › Réservations — « Facturer »
-- (admin_invoice_reservation, pénalité retirée si expirée), « Annuler » (sans
-- pénalité), « Retirer la pénalité » ; Clients : compteur + « Lever ».
-- Courriels : Edge Function « reservation-notify » — confirmation (client) + avis
-- (Création Audio) à la réservation ; avis d'annulation par le client ; rappel
-- ~12 h avant l'échéance, avis d'expiration et d'annulation par l'admin envoyés
-- par le tick (pg_net -> la fonction, clé private.secrets « cron_key »).
-- ------------------------------------------------------------
alter table public.customers add column if not exists no_shows integer not null default 0;   -- non récupérées (remis à 0 à la suspension)
alter table public.customers add column if not exists reserve_suspended_until timestamptz;

create sequence if not exists public.customer_reservation_seq;
create table if not exists public.customer_reservations (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,                     -- R-0001
  customer_id      uuid references public.customers(id) on delete set null,
  email            text not null,                            -- figés à la réservation
  name             text,
  phone            text,
  status           text not null default 'active' check (status in ('active','invoiced','cancelled','expired')),
  note             text,
  total            numeric(10,2) not null default 0,
  expires_at       timestamptz not null,
  penalized        boolean not null default false,           -- comptée « non récupérée »
  invoice_id       uuid references public.invoices(id) on delete set null,
  cancelled_by     text,                                     -- 'client' | 'admin'
  notified_at      timestamptz,                              -- confirmation envoyée
  reminded_at      timestamptz,                              -- rappel ~12 h avant
  closed_mailed_at timestamptz,                              -- avis d'expiration / d'annulation par l'admin
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.customer_reservations add column if not exists pickup_date        date;   -- section CUEILLETTE
alter table public.customer_reservations add column if not exists pickup_start       time;
alter table public.customer_reservations add column if not exists pickup_end         time;
alter table public.customer_reservations add column if not exists pickup_notified_at timestamptz;
alter table public.customer_reservations add column if not exists pickup_req         jsonb;
create index if not exists customer_reservations_customer_idx on public.customer_reservations (customer_id, created_at desc);
create index if not exists customer_reservations_status_idx on public.customer_reservations (status, expires_at);
create table if not exists public.customer_reservation_lines (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.customer_reservations(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  ptype          text,                                       -- filament | accessory
  kind           text,                                       -- spool | refill | unit
  name           text not null,
  meta           text,
  qty            integer not null check (qty > 0),
  unit_price     numeric(10,2) not null default 0,
  line_total     numeric(10,2) not null default 0,
  sort_order     integer not null default 0
);
create index if not exists customer_reservation_lines_res_idx on public.customer_reservation_lines (reservation_id);
create index if not exists customer_reservation_lines_prod_idx on public.customer_reservation_lines (product_id);
alter table public.customer_reservations enable row level security;
alter table public.customer_reservation_lines enable row level security;
drop policy if exists customer_reservations_admin_all on public.customer_reservations;
create policy customer_reservations_admin_all on public.customer_reservations for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists customer_reservation_lines_admin_all on public.customer_reservation_lines;
create policy customer_reservation_lines_admin_all on public.customer_reservation_lines for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );

-- Non récupérée : +1 ; à 2 -> suspendu 60 jours et compteur remis à 0.
create or replace function public._reservation_penalize(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.customers
     set no_shows = case when no_shows + 1 >= 2 then 0 else no_shows + 1 end,
         reserve_suspended_until = case when no_shows + 1 >= 2 then now() + interval '60 days' else reserve_suspended_until end
   where id = p_customer;
end $$;
-- Pénalité retirée : -1 ; si elle avait déclenché la suspension, la suspension est levée.
create or replace function public._reservation_forgive(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.customers
     set no_shows = case when no_shows > 0 then no_shows - 1
                         when reserve_suspended_until > now() then 1 else 0 end,
         reserve_suspended_until = case when no_shows > 0 then reserve_suspended_until else null end
   where id = p_customer;
end $$;
revoke all on function public._reservation_penalize(uuid) from public, anon, authenticated;
revoke all on function public._reservation_forgive(uuid)  from public, anon, authenticated;

-- Réservation par le client connecté. -> { id, number, total, expires_at }
-- p_pickup { d, s } : plage de cueillette avant l'échéance (facultative : choisie ensuite dans « Ma cueillette »).
drop function if exists public.customer_reserve(jsonb, text);
create or replace function public.customer_reserve(p_lines jsonb, p_note text default null, p_pickup jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c public.customers; v_lines jsonb; v_id uuid; v_num text;
        v_total numeric; v_short text; v_exp timestamptz := now() + interval '72 hours'; v_pk jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into c from public.customers where id = v_uid;
  if not found then raise exception 'Compte introuvable. Reconnecte-toi.' using errcode = '42501'; end if;
  if not c.can_reserve then raise exception 'Les réservations ne sont pas activées pour ton compte.'; end if;
  if c.reserve_suspended_until > now() then
    raise exception 'Réservations suspendues jusqu''au % (2 réservations non récupérées).',
      to_char(c.reserve_suspended_until at time zone 'America/Toronto', 'DD/MM/YYYY');
  end if;
  if (select count(*) from public.customer_reservations where customer_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de réservations en peu de temps. Réessaie plus tard.';
  end if;
  -- une réservation à la fois sur le stock : la 2e voit le stock déjà gardé par la 1re
  perform pg_advisory_xact_lock(hashtext('ca_customer_reservations'));
  v_lines := public._customer_fill_lines(p_lines);
  if exists (select 1 from jsonb_array_elements(v_lines) x where x ->> 'ptype' not in ('filament', 'accessory')) then
    raise exception 'Les spacers ne se réservent pas : envoie-les plutôt en commande.';
  end if;
  select string_agg(x ->> 'name' || coalesce(' (' || (x ->> 'meta') || ')', ''), ', ') into v_short
    from jsonb_array_elements(v_lines) x where (x ->> 'qty_to_order')::int > 0;
  if v_short is not null then
    raise exception 'Plus assez de stock pour : %. Ajuste ton panier ou envoie-le en commande.', v_short;
  end if;
  select coalesce(sum((x ->> 'line_total')::numeric), 0) into v_total from jsonb_array_elements(v_lines) x;
  v_pk := public._pickup_check(p_pickup, v_exp, null, false);
  v_num := 'R-' || lpad(nextval('public.customer_reservation_seq')::text, 4, '0');
  insert into public.customer_reservations (number, customer_id, email, name, phone, note, total, expires_at,
                                            pickup_date, pickup_start, pickup_end)
  values (v_num, v_uid, c.email, c.name, c.phone, nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_total, v_exp,
          (v_pk ->> 'd')::date, (v_pk ->> 's')::time, (v_pk ->> 'e')::time)
  returning id into v_id;
  insert into public.customer_reservation_lines (reservation_id, product_id, ptype, kind, name, meta, qty, unit_price, line_total, sort_order)
  select v_id, (x ->> 'product_id')::uuid, x ->> 'ptype', x ->> 'kind', x ->> 'name', x ->> 'meta', (x ->> 'qty')::int,
         (x ->> 'unit_price')::numeric, (x ->> 'line_total')::numeric, (x ->> 'sort_order')::int
    from jsonb_array_elements(v_lines) x;
  return jsonb_build_object('id', v_id, 'number', v_num, 'total', v_total, 'expires_at', v_exp);
end $$;

-- Annulation par le client (tant qu'elle est active) : stock libéré, aucune pénalité.
create or replace function public.customer_cancel_reservation(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r public.customer_reservations;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into r from public.customer_reservations where id = p_id and customer_id = v_uid for update;
  if not found then raise exception 'Réservation introuvable.'; end if;
  if r.status <> 'active' or r.expires_at <= now() then raise exception 'Cette réservation n''est plus active.'; end if;
  update public.customer_reservations set status = 'cancelled', cancelled_by = 'client', updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'number', r.number);
end $$;

-- Mon compte : droit de réserver, suspension, compteur + ses réservations récentes.
create or replace function public.me_reservations()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'can_reserve', coalesce(c.can_reserve, false),
    'suspended_until', case when c.reserve_suspended_until > now() then c.reserve_suspended_until end,
    'no_shows', coalesce(c.no_shows, 0),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.number,
          'status', case when r.status = 'active' and r.expires_at <= now() then 'expired' else r.status end,
          'created_at', r.created_at, 'expires_at', r.expires_at, 'note', r.note, 'total', r.total,
          'pickup_date', r.pickup_date, 'pickup_start', to_char(r.pickup_start, 'HH24:MI'), 'pickup_end', to_char(r.pickup_end, 'HH24:MI'),
          'pickup_req', r.pickup_req,
          'penalized', r.penalized or (r.status = 'active' and r.expires_at <= now()), 'cancelled_by', r.cancelled_by,
          'invoice_number', (select i.number from public.invoices i where i.id = r.invoice_id),
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
              'product_id', l.product_id, 'ptype', l.ptype, 'kind', l.kind, 'name', l.name, 'meta', l.meta, 'qty', l.qty,
              'unit_price', l.unit_price, 'line_total', l.line_total,
              'hex', (select p.hex from public.products p where p.id = l.product_id)) order by l.sort_order)
            from public.customer_reservation_lines l where l.reservation_id = r.id), '[]'::jsonb)
        ) order by r.created_at desc)
      from (select * from public.customer_reservations where customer_id = c.id
            order by created_at desc limit 30) r), '[]'::jsonb))
  from (select (select auth.uid()) as uid) u
  left join public.customers c on c.id = u.uid;
$$;

-- Facture -> fiche du client (fiche du compte, sinon celle qui a son courriel, sinon
-- nouvelle fiche) ; compte relié à cette fiche s'il ne l'était pas. -> id de la fiche
create or replace function public._customer_link_invoice(p_customer uuid, p_email text, p_name text, p_phone text, p_invoice uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_cid uuid;
begin
  if p_customer is null then return null; end if;
  select * into c from public.customers where id = p_customer;
  if not found then return null; end if;
  v_cid := c.client_id;
  if v_cid is null then
    select id into v_cid from public.clients where lower(email) = lower(p_email) limit 1;
    if v_cid is null then
      insert into public.clients (name, email, phone)
      values (coalesce(nullif(btrim(p_name), ''), p_email), lower(p_email), p_phone) returning id into v_cid;
    end if;
    if exists (select 1 from public.customers x where x.client_id = v_cid and x.id <> c.id) then
      v_cid := null;   -- fiche déjà reliée à un autre compte : on ne touche à rien
    else
      update public.customers set client_id = v_cid, linked_at = now() where id = c.id;
    end if;
  end if;
  if v_cid is not null then update public.invoices set client_id = v_cid where id = p_invoice; end if;
  return v_cid;
end $$;
revoke all on function public._customer_link_invoice(uuid, text, text, text, uuid) from public, anon, authenticated;

-- Admin : réservation facturée (même expirée : la pénalité est alors retirée).
create or replace function public.admin_invoice_reservation(p_res uuid, p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.customer_reservations; v_cid uuid;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select * into r from public.customer_reservations where id = p_res for update;
  if not found then raise exception 'Réservation introuvable.'; end if;
  update public.customer_reservations set status = 'invoiced', invoice_id = p_invoice, penalized = false, updated_at = now()
   where id = p_res;
  if r.penalized and r.customer_id is not null then perform public._reservation_forgive(r.customer_id); end if;
  v_cid := public._customer_link_invoice(r.customer_id, r.email, r.name, r.phone, p_invoice);
  return jsonb_build_object('client_id', v_cid);
end $$;

-- Admin : annuler (active -> stock libéré, sans pénalité ; le client est avisé par le tick)
-- ou retirer la pénalité d'une expirée.
create or replace function public.admin_reservation_action(p_res uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.customer_reservations;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select * into r from public.customer_reservations where id = p_res for update;
  if not found then raise exception 'Réservation introuvable.'; end if;
  if p_action = 'cancel' then
    if r.status not in ('active', 'expired') then raise exception 'Cette réservation est déjà fermée.'; end if;
    update public.customer_reservations
       set status = 'cancelled', cancelled_by = 'admin', penalized = false, updated_at = now(),
           closed_mailed_at = case when r.status = 'active' then null else now() end   -- expirée : déjà avisé
     where id = p_res;
    if r.penalized and r.customer_id is not null then perform public._reservation_forgive(r.customer_id); end if;
  elsif p_action = 'forgive' then
    if r.status = 'active' and r.expires_at <= now() then   -- échue, pas encore passée au tick : fermée sans pénalité
      update public.customer_reservations
         set status = 'expired', penalized = false, closed_mailed_at = now(), updated_at = now() where id = p_res;
      return jsonb_build_object('ok', true);
    end if;
    if not r.penalized then return jsonb_build_object('ok', true); end if;
    update public.customer_reservations set penalized = false, updated_at = now() where id = p_res;
    if r.customer_id is not null then perform public._reservation_forgive(r.customer_id); end if;
  else
    raise exception 'Action inconnue.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Compte supprimé (Mon compte / ménage 3 ans) : ses réservations actives sont annulées.
create or replace function public._customer_release_reservations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.customer_reservations
     set status = 'cancelled', cancelled_by = 'client', updated_at = now(), closed_mailed_at = now()
   where customer_id = old.id and status = 'active';
  return old;
end $$;
drop trigger if exists customers_release_reservations on public.customers;
create trigger customers_release_reservations before delete on public.customers
  for each row execute function public._customer_release_reservations();
revoke all on function public._customer_release_reservations() from public, anon, authenticated;

-- Clé du tick -> Edge Function (en-tête x-cron-key), vérifiée par la fonction.
insert into private.secrets (key, value)
  values ('cron_key', encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (key) do nothing;
create or replace function public.reservation_cron_ok(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.secrets where key = 'cron_key' and value = p_key and length(coalesce(p_key, '')) >= 32);
$$;
revoke all on function public.reservation_cron_ok(text) from public, anon, authenticated;
grant execute on function public.reservation_cron_ok(text) to service_role;

-- Tick (aux 10 min) : échues -> « Expirée » + non récupérée comptée ; puis, s'il y a des
-- courriels dus (rappel, expiration, annulation par l'admin), appel de reservation-notify.
create extension if not exists pg_net with schema extensions;   -- fonctions dans le schéma net
create or replace function public.reservations_tick()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id, customer_id from public.customer_reservations
            where status = 'active' and expires_at <= now() for update skip locked loop
    update public.customer_reservations
       set status = 'expired', penalized = (r.customer_id is not null), updated_at = now()
     where id = r.id;
    if r.customer_id is not null then perform public._reservation_penalize(r.customer_id); end if;
    n := n + 1;
  end loop;
  if exists (select 1 from public.customer_reservations
              where (status = 'active' and reminded_at is null and expires_at <= now() + interval '12 hours'
                     and created_at <= now() - interval '1 hour')
                 or (status = 'expired' and closed_mailed_at is null and updated_at > now() - interval '2 days')
                 or (status = 'cancelled' and cancelled_by = 'admin' and closed_mailed_at is null
                     and updated_at > now() - interval '2 days')) then
    perform net.http_post(
      url := 'https://cqfmvdknppscazfynoiy.supabase.co/functions/v1/reservation-notify',
      body := '{"cron":true}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-key', (select value from private.secrets where key = 'cron_key')),
      timeout_milliseconds := 20000);
  end if;
  return n;
end $$;
revoke all on function public.reservations_tick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'reservations-tick';
select cron.schedule('reservations-tick', '*/10 * * * *', 'select public.reservations_tick()');

revoke all on function public.customer_reserve(jsonb, text, jsonb)       from public, anon;
revoke all on function public.customer_cancel_reservation(uuid)          from public, anon;
revoke all on function public.me_reservations()                          from public, anon;
revoke all on function public.admin_invoice_reservation(uuid, uuid)      from public, anon;
revoke all on function public.admin_reservation_action(uuid, text)       from public, anon;
grant execute on function public.customer_reserve(jsonb, text, jsonb)       to authenticated;
grant execute on function public.customer_cancel_reservation(uuid)          to authenticated;
grant execute on function public.me_reservations()                          to authenticated;
grant execute on function public.admin_invoice_reservation(uuid, uuid)      to authenticated;
grant execute on function public.admin_reservation_action(uuid, text)       to authenticated;

-- ============================================================
-- CUEILLETTE (plage de ramassage choisie par le client)
-- Horaire réglé par l'admin (Commandes › Cueillettes) : admin_settings « cueillette »
--   { week: { "1": [{s:"13:00", e:"17:00"}], … "7": [] }   (1 = lundi, ISO)
--     closed: [{from:"AAAA-MM-JJ", to:"AAAA-MM-JJ"}]          (fermé, bornes incluses)
--     extra:  [{d:"AAAA-MM-JJ", s:"10:00", e:"12:00"}]        (plage ponctuelle, même un jour fermé)
--     cap: 3 (commandes max par plage, 0 = illimité) · notice: 24 (h de préavis) · days: 14 (jours offerts) }
-- Chaque plage est découpée en heures d'arrivée aux 15 min (12:00, 12:15… jusqu'à la fin − 15 min) ;
-- le client choisit une heure (pickup_end reste vide). Comptent dans une heure : commandes
-- Nouvelle / En préparation / Prête et réservations actives non échues. Heure de Québec.
-- Commande : obligatoire à l'envoi si tout est en stock (customer_submit_order) ; avec des
-- articles à commander, le client la choisit dans Mon compte une fois la commande Prête.
-- Réservation : obligatoire, avant l'échéance (customer_reserve). Sans aucune plage réglée,
-- rien n'est exigé (le site continue de prendre des commandes).
-- Changement par le client jusqu'à Facturée : customer_set_pickup -> EF « pickup-notify ».
-- ------------------------------------------------------------
create or replace function public._pickup_slots(p_until timestamptz, p_self uuid)
returns table (d date, s time, e time, booked int, cap int)
language sql stable security definer set search_path = '' as $$
  with p as (
    select v, greatest(coalesce((v ->> 'cap')::int, 0), 0) as cap,
           greatest(coalesce((v ->> 'notice')::int, 24), 0) as notice,
           least(greatest(coalesce((v ->> 'days')::int, 14), 1), 60) as days,
           (now() at time zone 'America/Toronto') as lnow
      from (select coalesce((select value from public.admin_settings where key = 'cueillette'), '{}'::jsonb) as v) c
  ), base as (
    select j.g as d, (x ->> 's')::time as s, (x ->> 'e')::time as e
      from p, lateral (select p.lnow::date + i as g from generate_series(0, p.days) i) j,
           jsonb_array_elements(coalesce(p.v -> 'week' -> (extract(isodow from j.g)::int::text), '[]'::jsonb)) x
     where not exists (select 1 from jsonb_array_elements(coalesce(p.v -> 'closed', '[]'::jsonb)) k
                        where j.g between (k ->> 'from')::date and coalesce((k ->> 'to')::date, (k ->> 'from')::date))
    union
    select (x ->> 'd')::date, (x ->> 's')::time, (x ->> 'e')::time
      from p, jsonb_array_elements(coalesce(p.v -> 'extra', '[]'::jsonb)) x
     where (x ->> 'd')::date between p.lnow::date and p.lnow::date + p.days
  ), q as (
    select distinct b.d, t::time as s
      from base b, generate_series(b.d + b.s, b.d + b.e - interval '15 minutes', interval '15 minutes') t
     where b.e > b.s
  )
  select b.d, b.s, null::time as e,
         ((select count(*) from public.customer_orders o
            where o.pickup_date = b.d and o.pickup_start = b.s and o.status in ('new', 'preparing', 'ready')
              and o.id is distinct from p_self)
        + (select count(*) from public.customer_reservations r
            where r.pickup_date = b.d and r.pickup_start = b.s and r.status = 'active' and r.expires_at > now()
              and r.id is distinct from p_self))::int,
         p.cap
    from q b, p
   where b.d + b.s >= p.lnow + make_interval(hours => p.notice)
     and (p_until is null or (b.d + b.s) at time zone 'America/Toronto' < p_until)
   order by b.d, b.s;
$$;
revoke all on function public._pickup_slots(timestamptz, uuid) from public, anon, authenticated;

-- Plages offertes au client. p_until : échéance (réservation) ; p_self : sa commande / réservation
-- (ne se compte pas elle-même). -> [{ d, s, e, full }]
create or replace function public.pickup_slots(p_until timestamptz default null, p_self uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('d', d, 's', to_char(s, 'HH24:MI'), 'e', to_char(e, 'HH24:MI'),
           'full', cap > 0 and booked >= cap) order by d, s), '[]'::jsonb)
    from public._pickup_slots(p_until, p_self);
$$;

-- Valide une plage choisie -> { d, s, e } (null si aucune et rien d'exigé). Verrou : deux clients
-- ne prennent pas la dernière place d'une plage en même temps.
create or replace function public._pickup_check(p_pickup jsonb, p_until timestamptz, p_self uuid, p_required boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_d date; v_s time; r record;
begin
  if p_pickup is null or coalesce(p_pickup ->> 'd', '') = '' then
    if p_required and exists (select 1 from public._pickup_slots(p_until, p_self)) then
      raise exception 'Choisis une date et une plage de cueillette.';
    end if;
    return null;
  end if;
  if coalesce(p_pickup ->> 'd', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_pickup ->> 's', '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Plage de cueillette invalide.';
  end if;
  v_d := (p_pickup ->> 'd')::date; v_s := (p_pickup ->> 's')::time;
  perform pg_advisory_xact_lock(hashtext('ca_pickup'));
  select * into r from public._pickup_slots(p_until, p_self) x where x.d = v_d and x.s = v_s;
  if not found then raise exception 'Cette plage de cueillette n''est plus offerte. Choisis-en une autre.'; end if;
  if r.cap > 0 and r.booked >= r.cap then raise exception 'Cette plage vient de se remplir. Choisis-en une autre.'; end if;
  return jsonb_build_object('d', r.d, 's', to_char(r.s, 'HH24:MI'), 'e', to_char(r.e, 'HH24:MI'));
end $$;
revoke all on function public._pickup_check(jsonb, timestamptz, uuid, boolean) from public, anon, authenticated;

-- Changement par le client (Mon compte) : commande jusqu'à Facturée (avec articles à commander :
-- seulement une fois Prête) ; réservation active, avant son échéance. -> { d, s, e }
create or replace function public.customer_set_pickup(p_kind text, p_id uuid, p_pickup jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); o public.customer_orders; r public.customer_reservations; v_pk jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if p_pickup is null then raise exception 'Choisis une date et une plage de cueillette.'; end if;
  if p_kind = 'reservation' then
    select * into r from public.customer_reservations where id = p_id and customer_id = v_uid for update;
    if not found then raise exception 'Réservation introuvable.'; end if;
    if r.status <> 'active' or r.expires_at <= now() then raise exception 'Cette réservation n''est plus active.'; end if;
    v_pk := public._pickup_check(p_pickup, r.expires_at, p_id, true);
    update public.customer_reservations
       set pickup_date = (v_pk ->> 'd')::date, pickup_start = (v_pk ->> 's')::time, pickup_end = (v_pk ->> 'e')::time,
           updated_at = now()
     where id = p_id;
  else
    select * into o from public.customer_orders where id = p_id and customer_id = v_uid for update;
    if not found then raise exception 'Commande introuvable.'; end if;
    if o.status not in ('new', 'preparing', 'ready') then raise exception 'Cette commande est fermée.'; end if;
    if o.has_backorder and o.status <> 'ready' then
      raise exception 'On t''écrit dès que tes articles sont arrivés : tu choisiras ta cueillette à ce moment-là.';
    end if;
    v_pk := public._pickup_check(p_pickup, null, p_id, true);
    update public.customer_orders
       set pickup_date = (v_pk ->> 'd')::date, pickup_start = (v_pk ->> 's')::time, pickup_end = (v_pk ->> 'e')::time,
           updated_at = now()
     where id = p_id;
  end if;
  return v_pk;
end $$;

revoke all on function public.pickup_slots(timestamptz, uuid)              from public, anon;
revoke all on function public.customer_set_pickup(text, uuid, jsonb)       from public, anon;
grant execute on function public.pickup_slots(timestamptz, uuid)           to authenticated;
grant execute on function public.customer_set_pickup(text, uuid, jsonb)    to authenticated;

-- Demande d'exception : le client propose un jour ouvrable (lundi-vendredi, aujourd'hui ou plus tard) et
-- une heure libre, hors plages, préavis et capacité. pickup_req = { d, s, note, at, state: 'pending' | 'refused', reply }.
-- La plage déjà choisie reste valide tant que l'admin n'a pas répondu (admin_decide_pickup).
create or replace function public.customer_request_pickup(p_kind text, p_id uuid, p_req jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_d date; v_s time; v_note text; v_req jsonb; o public.customer_orders; r public.customer_reservations;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if coalesce(p_req ->> 'd', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_req ->> 's', '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Choisis une date et une heure.';
  end if;
  v_d := (p_req ->> 'd')::date; v_s := (p_req ->> 's')::time;
  v_note := left(trim(coalesce(p_req ->> 'note', '')), 300);
  if v_d < (now() at time zone 'America/Toronto')::date or extract(isodow from v_d) > 5 then
    raise exception 'Choisis un jour ouvrable, à partir d''aujourd''hui.';
  end if;
  if v_d + v_s <= (now() at time zone 'America/Toronto') then raise exception 'Cette heure est déjà passée.'; end if;
  v_req := jsonb_build_object('d', v_d, 's', to_char(v_s, 'HH24:MI'), 'note', v_note, 'at', now(), 'state', 'pending');
  if p_kind = 'reservation' then
    select * into r from public.customer_reservations where id = p_id and customer_id = v_uid for update;
    if not found then raise exception 'Réservation introuvable.'; end if;
    if r.status <> 'active' or r.expires_at <= now() then raise exception 'Cette réservation n''est plus active.'; end if;
    if (v_d + v_s) at time zone 'America/Toronto' >= r.expires_at then raise exception 'Choisis une heure avant l''échéance de ta réservation.'; end if;
    update public.customer_reservations set pickup_req = v_req, updated_at = now() where id = p_id;
  else
    select * into o from public.customer_orders where id = p_id and customer_id = v_uid for update;
    if not found then raise exception 'Commande introuvable.'; end if;
    if o.status not in ('new', 'preparing', 'ready') then raise exception 'Cette commande est fermée.'; end if;
    update public.customer_orders set pickup_req = v_req, updated_at = now() where id = p_id;
  end if;
  return v_req;
end $$;

-- Réponse de l'admin : approuver = la demande devient la cueillette (sans regarder la capacité) ;
-- refuser = la demande reste visible côté client avec le mot de l'admin (state 'refused').
create or replace function public.admin_decide_pickup(p_kind text, p_id uuid, p_ok boolean, p_reply text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req jsonb; v_reply text := left(trim(coalesce(p_reply, '')), 300);
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  if p_kind = 'reservation' then
    select pickup_req into v_req from public.customer_reservations where id = p_id for update;
  else
    select pickup_req into v_req from public.customer_orders where id = p_id for update;
  end if;
  if v_req is null or v_req ->> 'state' <> 'pending' then raise exception 'Aucune demande en attente.'; end if;
  if p_kind = 'reservation' then
    update public.customer_reservations
       set pickup_date = case when p_ok then (v_req ->> 'd')::date else pickup_date end,
           pickup_start = case when p_ok then (v_req ->> 's')::time else pickup_start end,
           pickup_end = case when p_ok then null else pickup_end end,
           pickup_req = case when p_ok then null else v_req || jsonb_build_object('state', 'refused', 'reply', v_reply) end,
           updated_at = now()
     where id = p_id;
  else
    update public.customer_orders
       set pickup_date = case when p_ok then (v_req ->> 'd')::date else pickup_date end,
           pickup_start = case when p_ok then (v_req ->> 's')::time else pickup_start end,
           pickup_end = case when p_ok then null else pickup_end end,
           pickup_req = case when p_ok then null else v_req || jsonb_build_object('state', 'refused', 'reply', v_reply) end,
           updated_at = now()
     where id = p_id;
  end if;
  return v_req;
end $$;
revoke all on function public.customer_request_pickup(text, uuid, jsonb) from public, anon;
revoke all on function public.admin_decide_pickup(text, uuid, boolean, text) from public, anon;
grant execute on function public.customer_request_pickup(text, uuid, jsonb) to authenticated;
grant execute on function public.admin_decide_pickup(text, uuid, boolean, text) to authenticated;

-- ============================================================
-- MESSAGERIE (questions filaments / spacers / compte)
-- Panneau « Écris-nous » de tout le site public (assets/messagerie.js) : on
-- écrit, puis on confirme son courriel par le code à 6 chiffres (Edge Function
-- compte-code) -> la conversation est reliée au compte client (customers).
-- Le client ne lit AUCUNE table directement : RPC msg_start / msg_send /
-- me_conversations / me_messages. L'admin lit / écrit par RLS (onglet Messages).
-- Photos : bucket PRIVÉ « messages », dossier = id du compte (<uid>/<uuid>.jpg),
-- 4 max par message, lues par URL signée ; effacées par le navigateur (API
-- Storage) avec la conversation (admin) ou le compte (Mon compte › Supprimer).
-- Compteurs (non lus, aperçu, réouverture) tenus par un déclencheur.
-- Courriels DIFFÉRÉS : Edge Function « message-notify », appelée par le tick
-- pg_cron (messages_tick, chaque minute) : un message resté non lu 5 min -> UN
-- courriel qui regroupe toute la série non lue ; lire ou répondre réarme l'avis.
-- Présence (« En ligne ») : client_seen_at (me_messages, aux 10 s quand le fil
-- est ouvert) et admin_seen_at (admin_msg_seen, idem côté admin).
-- Loi 25 : conversation effacée 12 mois après le dernier message (purge lancée
-- par l'onglet admin Messages : les photos doivent passer par l'API Storage).
-- ------------------------------------------------------------
create table if not exists public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers(id) on delete cascade,
  topic              text not null default 'autre' check (topic in ('filaments','spacers','compte','autre')),
  ref                text,                     -- contexte : code du spacer, produit consulté…
  page               text,                     -- page d'où la question est partie
  status             text not null default 'open' check (status in ('open','closed')),
  last_from          text check (last_from in ('client','admin')),
  last_preview       text,
  admin_unread       integer not null default 0,
  client_unread      integer not null default 0,
  admin_notified_at  timestamptz,              -- avis envoyé pour la série non lue ; remis à null quand il lit / répond
  client_notified_at timestamptz,              -- idem pour le client
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()   -- dernier message
);
alter table public.conversations
  add column if not exists admin_unread_since  timestamptz,   -- 1er message du client pas encore lu par l'admin
  add column if not exists client_unread_since timestamptz,   -- 1re réponse de l'admin pas encore lue par le client
  add column if not exists admin_seen_at       timestamptz,   -- admin dans ce fil (présence)
  add column if not exists client_seen_at      timestamptz;   -- client dans ce fil (présence)
create index if not exists conversations_customer_idx on public.conversations (customer_id, updated_at desc);
create index if not exists conversations_updated_idx  on public.conversations (updated_at desc);
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender          text not null check (sender in ('client','admin')),
  body            text not null default '' check (length(body) <= 4000),
  photos          jsonb not null default '[]'::jsonb,   -- chemins dans le bucket « messages »
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
drop policy if exists conversations_admin_all on public.conversations;
create policy conversations_admin_all on public.conversations for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists messages_admin_all on public.messages;
create policy messages_admin_all on public.messages for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );

-- Nouveau message -> conversation à jour (aperçu, non lus ; le client rouvre une conversation fermée ;
-- la réponse de l'admin vaut lecture). *_unread_since = début de la série non lue (courriel différé).
create or replace function public._message_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set
    updated_at          = new.created_at,
    last_from           = new.sender,
    last_preview        = left(coalesce(nullif(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), ''),
                               case when jsonb_array_length(new.photos) > 1 then 'Photos' else 'Photo' end), 140),
    admin_unread        = case when new.sender = 'client' then admin_unread + 1 else 0 end,
    client_unread       = case when new.sender = 'admin' then client_unread + 1 else client_unread end,
    admin_unread_since  = case when new.sender = 'client' then coalesce(admin_unread_since, new.created_at) end,
    client_unread_since = case when new.sender = 'admin' then coalesce(client_unread_since, new.created_at) else client_unread_since end,
    status              = case when new.sender = 'client' then 'open' else status end
  where id = new.conversation_id;
  return null;
end $$;
revoke all on function public._message_after_insert() from public, anon, authenticated;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public._message_after_insert();

-- Série lue (non lus à 0, par lecture ou réponse) -> plus de courriel dû ; le prochain message réarme l'avis.
create or replace function public._conversation_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.admin_unread = 0 then new.admin_unread_since := null; new.admin_notified_at := null; end if;
  if new.client_unread = 0 then new.client_unread_since := null; new.client_notified_at := null; end if;
  return new;
end $$;
revoke all on function public._conversation_before_update() from public, anon, authenticated;
drop trigger if exists conversations_before_update on public.conversations;
create trigger conversations_before_update before update on public.conversations
  for each row execute function public._conversation_before_update();

-- Admin dans un fil (aux 10 s, onglet visible) : présence + lu. -> { client_seen_at, now }
create or replace function public.admin_msg_seen(p_conv uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v timestamptz;
begin
  if not (select public.is_admin()) then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  update public.conversations set admin_seen_at = now(), admin_unread = 0 where id = p_conv returning client_seen_at into v;
  return jsonb_build_object('client_seen_at', v, 'now', now());
end $$;
revoke all on function public.admin_msg_seen(uuid) from public, anon;
grant execute on function public.admin_msg_seen(uuid) to authenticated;

-- Tick (chaque minute) : une série non lue depuis 5 min et pas encore avisée -> message-notify
-- (clé x-cron-key du tick des réservations). Rien d'appelé quand rien n'est dû.
create or replace function public.messages_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.conversations
              where (admin_unread > 0 and admin_notified_at is null
                     and admin_unread_since <= now() - interval '5 minutes' and admin_unread_since > now() - interval '2 days')
                 or (client_unread > 0 and client_notified_at is null
                     and client_unread_since <= now() - interval '5 minutes' and client_unread_since > now() - interval '2 days')) then
    perform net.http_post(
      url := 'https://cqfmvdknppscazfynoiy.supabase.co/functions/v1/message-notify',
      body := '{"cron":true}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-key', (select value from private.secrets where key = 'cron_key')),
      timeout_milliseconds := 20000);
  end if;
end $$;
revoke all on function public.messages_tick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'messages-tick';
select cron.schedule('messages-tick', '* * * * *', 'select public.messages_tick()');

-- Photos jointes : chemins du dossier du compte, déjà téléversés, 4 max.
create or replace function public._msg_photos(p_photos jsonb, p_owner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '[]'::jsonb; x text;
begin
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then return v; end if;
  if jsonb_array_length(p_photos) > 4 then raise exception 'Au plus 4 photos par message.'; end if;
  for x in select jsonb_array_elements_text(p_photos) loop
    if x !~ ('^' || p_owner::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then raise exception 'Photo invalide.'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'messages' and o.name = x) then
      raise exception 'Une photo n''a pas été reçue. Réessaie.';
    end if;
    v := v || to_jsonb(x);
  end loop;
  return v;
end $$;
revoke all on function public._msg_photos(jsonb, uuid) from public, anon, authenticated;

-- Garde-fous communs aux envois du client (compte présent, rythme, contenu).
create or replace function public._msg_guard(p_uid uuid, p_body text, p_photos jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not exists (select 1 from public.customers where id = p_uid) then
    raise exception 'Compte introuvable. Reconnecte-toi.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_body, '')) = '' and coalesce(jsonb_array_length(p_photos), 0) = 0 then
    raise exception 'Écris ton message.';
  end if;
  if length(btrim(coalesce(p_body, ''))) > 4000 then raise exception 'Message trop long (4000 caractères max).'; end if;
  if (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id
       where c.customer_id = p_uid and m.sender = 'client' and m.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de messages envoyés en peu de temps. Réessaie plus tard.';
  end if;
  update public.customers set last_seen_at = now() where id = p_uid;   -- compte actif (ménage des 3 ans)
end $$;
revoke all on function public._msg_guard(uuid, text, jsonb) from public, anon, authenticated;

-- Nouvelle conversation. -> { conversation_id, message_id }
create or replace function public.msg_start(p_topic text, p_ref text, p_page text, p_body text, p_photos jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_ph jsonb; v_conv uuid; v_msg uuid;
begin
  perform public._msg_guard(v_uid, p_body, p_photos);
  if (select count(*) from public.conversations where customer_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Trop de nouvelles conversations aujourd''hui. Réponds dans une conversation existante.';
  end if;
  v_ph := public._msg_photos(p_photos, v_uid);
  insert into public.conversations (customer_id, topic, ref, page)
  values (v_uid, case when p_topic in ('filaments','spacers','compte','autre') then p_topic else 'autre' end,
          nullif(left(btrim(coalesce(p_ref, '')), 120), ''), nullif(left(btrim(coalesce(p_page, '')), 200), ''))
  returning id into v_conv;
  insert into public.messages (conversation_id, sender, body, photos)
  values (v_conv, 'client', btrim(coalesce(p_body, '')), v_ph) returning id into v_msg;
  return jsonb_build_object('conversation_id', v_conv, 'message_id', v_msg);
end $$;

-- Réponse du client dans une de ses conversations (une conversation fermée se rouvre). -> { message_id }
create or replace function public.msg_send(p_conv uuid, p_body text, p_photos jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_ph jsonb; v_msg uuid;
begin
  perform public._msg_guard(v_uid, p_body, p_photos);
  if not exists (select 1 from public.conversations where id = p_conv and customer_id = v_uid) then
    raise exception 'Conversation introuvable.';
  end if;
  v_ph := public._msg_photos(p_photos, v_uid);
  insert into public.messages (conversation_id, sender, body, photos)
  values (p_conv, 'client', btrim(coalesce(p_body, '')), v_ph) returning id into v_msg;
  return jsonb_build_object('message_id', v_msg);
end $$;

-- Ses conversations (panneau + Mon compte › Messages).
create or replace function public.me_conversations()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'topic', c.topic, 'ref', c.ref, 'status', c.status, 'last_from', c.last_from,
      'last_preview', c.last_preview, 'unread', c.client_unread, 'created_at', c.created_at, 'updated_at', c.updated_at
    ) order by c.updated_at desc), '[]'::jsonb)
  from (select * from public.conversations where customer_id = (select auth.uid())
        order by updated_at desc limit 100) c;
$$;

-- Fil d'une conversation (relu aux 10 s) ; l'ouvrir vaut lecture et présence (client_seen_at).
create or replace function public.me_messages(p_conv uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c public.conversations;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  update public.conversations set client_unread = 0, client_seen_at = now()
   where id = p_conv and customer_id = v_uid returning * into c;
  if not found then raise exception 'Conversation introuvable.'; end if;
  return jsonb_build_object(
    'conversation', jsonb_build_object('id', c.id, 'topic', c.topic, 'ref', c.ref, 'status', c.status,
                                       'created_at', c.created_at, 'updated_at', c.updated_at,
                                       'admin_online', coalesce(c.admin_seen_at > now() - interval '40 seconds', false)),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,
                            'photos', m.photos, 'created_at', m.created_at) order by m.created_at, m.id)
                          from public.messages m where m.conversation_id = c.id), '[]'::jsonb));
end $$;

revoke all on function public.msg_start(text, text, text, text, jsonb) from public, anon;
revoke all on function public.msg_send(uuid, text, jsonb)              from public, anon;
revoke all on function public.me_conversations()                       from public, anon;
revoke all on function public.me_messages(uuid)                        from public, anon;
grant execute on function public.msg_start(text, text, text, text, jsonb) to authenticated;
grant execute on function public.msg_send(uuid, text, jsonb)              to authenticated;
grant execute on function public.me_conversations()                       to authenticated;
grant execute on function public.me_messages(uuid)                        to authenticated;

-- ---- photos : bucket privé, un dossier par compte, 200 fichiers max par compte ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('messages', 'messages', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- quota du compte connecté seulement (aucun paramètre : on ne compte jamais les photos d'un autre)
drop policy if exists messages_photos_insert on storage.objects;
drop function if exists public._msg_quota_ok(uuid);
create or replace function public._msg_quota_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from storage.objects o
           where o.bucket_id = 'messages' and (storage.foldername(o.name))[1] = (select auth.uid())::text) < 200;
$$;
revoke all on function public._msg_quota_ok() from public, anon;
grant execute on function public._msg_quota_ok() to authenticated;

drop policy if exists messages_photos_read on storage.objects;
create policy messages_photos_read on storage.objects for select to authenticated
  using ( bucket_id = 'messages' and ( (storage.foldername(name))[1] = (select auth.uid())::text
                                       or (select public.is_admin()) ) );
drop policy if exists messages_photos_insert on storage.objects;
create policy messages_photos_insert on storage.objects for insert to authenticated
  with check ( bucket_id = 'messages' and ( (select public.is_admin())
               or ( (storage.foldername(name))[1] = (select auth.uid())::text
                    and (select public._msg_quota_ok()) ) ) );
drop policy if exists messages_photos_delete on storage.objects;
create policy messages_photos_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'messages' and ( (storage.foldername(name))[1] = (select auth.uid())::text
                                       or (select public.is_admin()) ) );

-- ------------------------------------------------------------
-- COMMANDES FOURNISSEUR « EN ROUTE » (Inventaire › À commander)
-- Théo colle sa commande (Bambu, etc.) -> les articles passent « en route » :
-- déduits du Manque (cible + réservés − stock − en route), sans toucher au stock.
-- La Réception les consomme (qty_received) ; la commande se ferme toute seule.
-- Admin seulement (coûts privés).
-- ------------------------------------------------------------
create table if not exists public.supplier_orders (
  id           uuid primary key default gen_random_uuid(),
  order_number text,                                   -- n° fournisseur (ex. ca785184293604298752)
  supplier     text,                                   -- marque / boutique (Bambu Lab, Elegoo…)
  ordered_at   date not null default current_date,
  status       text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  note         text,
  created_at   timestamptz not null default now()
);
create table if not exists public.supplier_order_lines (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.supplier_orders(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  label        text,                                   -- texte lu dans la commande
  kind         text not null default 'spool',          -- 'spool' | 'refill' | 'item'
  qty          integer not null default 0 check (qty >= 0),
  qty_received integer not null default 0 check (qty_received >= 0),
  unit_cost    numeric(10,2)                           -- [PRIVÉ] prix payé /unité (pré-remplit la réception)
);
create index if not exists supplier_orders_status_idx     on public.supplier_orders (status, ordered_at);
create index if not exists supplier_order_lines_order_idx on public.supplier_order_lines (order_id);
create index if not exists supplier_order_lines_prod_idx  on public.supplier_order_lines (product_id);

alter table public.supplier_orders      enable row level security;
alter table public.supplier_order_lines enable row level security;
drop policy if exists supplier_orders_admin_all on public.supplier_orders;
create policy supplier_orders_admin_all on public.supplier_orders for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists supplier_order_lines_admin_all on public.supplier_order_lines;
create policy supplier_order_lines_admin_all on public.supplier_order_lines for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
revoke all on public.supplier_orders      from anon;
revoke all on public.supplier_order_lines from anon;

-- Réception = pointage d'une commande en route (2026-10-10) :
-- taxes du fournisseur par commande (Bambu 14,975 % ; Elegoo 0 %), réception rattachée
-- à sa commande, et plus de prix catalogue : les anciennes réceptions sans prix saisi
-- gardent une fois pour toutes le prix catalogue de l'époque (le coût moyen ne bouge pas).
alter table public.supplier_orders add column if not exists tax_rate numeric(6,3) not null default 0;
alter table public.receipts add column if not exists supplier_order_id uuid references public.supplier_orders(id) on delete set null;
create index if not exists receipts_supplier_order_idx on public.receipts (supplier_order_id);
update public.supplier_orders set tax_rate = 14.975 where supplier ilike 'bambu%' and tax_rate = 0;
update public.supplier_orders set order_number = ltrim(order_number, '#') where order_number like '#%';
update public.receipt_lines rl
   set unit_cost = case when rl.kind = 'refill' then m.cost_refill else m.cost_spool end
  from public.products p
  join public.materials m on m.brand = p.brand and m.name = p.material
 where p.id = rl.product_id and rl.unit_cost is null and p.type = 'filament';

-- ------------------------------------------------------------
-- FACTURE ANNULÉE / SUPPRIMÉE -> sa commande ou réservation d'origine redevient
-- « à facturer » (Historique, 2026-10-11). Commande dealer / client : « Prête » ;
-- réservation : « Active » si elle n'est pas échue (son stock redevient gardé), sinon
-- « Expirée » sans pénalité ni courriel. À appeler APRÈS l'annulation et AVANT la
-- suppression (à la suppression, invoice_id passe à null : le lien serait perdu).
-- -> [{ kind: 'dealer'|'client'|'reservation', number, status }]
-- ------------------------------------------------------------
create or replace function public.admin_reopen_invoice_orders(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := '[]'::jsonb; r record;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  for r in update public.dealer_orders set status = 'ready', invoice_id = null, updated_at = now()
            where invoice_id = p_invoice and status = 'invoiced' returning number loop
    v := v || jsonb_build_object('kind', 'dealer', 'number', r.number, 'status', 'ready');
  end loop;
  for r in update public.customer_orders set status = 'ready', invoice_id = null, updated_at = now()
            where invoice_id = p_invoice and status = 'invoiced' returning number loop
    v := v || jsonb_build_object('kind', 'client', 'number', r.number, 'status', 'ready');
  end loop;
  for r in update public.customer_reservations
              set status = case when expires_at > now() then 'active' else 'expired' end,
                  invoice_id = null, penalized = false, updated_at = now(),
                  closed_mailed_at = case when expires_at > now() then closed_mailed_at else now() end   -- échue : pas de courriel d'expiration
            where invoice_id = p_invoice and status = 'invoiced' returning number, status loop
    v := v || jsonb_build_object('kind', 'reservation', 'number', r.number, 'status', r.status);
  end loop;
  return v;
end $$;
revoke all on function public.admin_reopen_invoice_orders(uuid) from public, anon;
grant execute on function public.admin_reopen_invoice_orders(uuid) to authenticated;

-- ============================================================
-- PRODUCTION DE SPACERS (Stock › Production, 2026-10-11)
-- Bobines sorties du stock de vente pour imprimer (production_spools : −1 au stock
-- du filament, prix payé figé), productions lues dans le G-code AutoLoop
-- (productions + production_uses : grammes par bobine). Une production ajoute
-- ses paires au stock du spacer et recalcule son coût moyen :
--   products.attrs.avg_cost.item = (stock de départ × coût saisi + Σ paires × coût/paire)
--                                  / (stock de départ + Σ paires)
--   attrs.prod_seed {qty, cost} = stock et coût saisi au moment de la 1re production
--   attrs.loose {n:1, cost}     = pièce seule en réserve (complétée à la production suivante)
-- Tout est PRIVÉ (admin) ; écritures par RPC (stock + coût en une transaction).
-- ============================================================
create table if not exists public.production_spools (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references public.products(id) on delete set null,
  label       text not null default '',           -- « Bambu Lab · ABS · Black » (figé)
  material    text,
  hex         text,
  kind        text not null default 'spool' check (kind in ('spool', 'refill')),
  unit_cost   numeric(10,2) not null default 0,   -- [PRIVÉ] prix payé de la bobine (taxes incluses)
  weight_g    integer not null default 1000 check (weight_g > 0),
  stock_taken integer not null default 0,         -- 1 = retirée du stock de vente (0 : stock déjà à 0)
  status      text not null default 'active' check (status in ('active', 'done')),
  taken_at    date not null default current_date,
  closed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create table if not exists public.productions (
  id            uuid primary key default gen_random_uuid(),
  made_at       date not null default current_date,
  spacer_id     uuid references public.products(id) on delete set null,
  spacer_label  text not null default '',
  file_name     text,
  loops         integer not null default 1,
  per_plate     integer not null default 1,
  pieces        integer not null default 0,          -- lancées (loops × pièces par plateau)
  good          integer not null default 0,          -- sorties bonnes
  minutes       integer not null default 0,          -- durée du batch (cooldown compris)
  grams         numeric(10,2) not null default 0,
  filament_cost numeric(10,2) not null default 0,
  machine_cost  numeric(10,2) not null default 0,    -- électricité + usure
  total_cost    numeric(10,2) not null default 0,
  piece_cost    numeric(12,4),
  loose_in      integer not null default 0,          -- pièce seule reprise de la réserve
  loose_in_cost numeric(12,4),
  loose_out     integer not null default 0,          -- pièce seule laissée en réserve
  pairs         integer not null default 0,
  pair_cost     numeric(12,4),
  rates         jsonb not null default '{}'::jsonb,  -- taux $/h utilisés {elec, deprec}
  note          text,
  created_at    timestamptz not null default now()
);
create table if not exists public.production_uses (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  spool_id      uuid not null references public.production_spools(id) on delete restrict,
  grams         numeric(10,2) not null default 0,
  cost          numeric(10,2) not null default 0
);
-- terminée toute seule (vidée par une production) : rouverte si cette production est supprimée
alter table public.production_spools add column if not exists closed_auto boolean not null default false;
create index if not exists production_spools_status_idx  on public.production_spools (status, taken_at desc);
create index if not exists production_spools_product_idx on public.production_spools (product_id);
create index if not exists productions_spacer_idx        on public.productions (spacer_id, created_at desc);
create index if not exists production_uses_prod_idx      on public.production_uses (production_id);
create index if not exists production_uses_spool_idx     on public.production_uses (spool_id);

alter table public.production_spools enable row level security;
alter table public.productions       enable row level security;
alter table public.production_uses   enable row level security;
drop policy if exists production_spools_admin_all on public.production_spools;
create policy production_spools_admin_all on public.production_spools for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists productions_admin_all on public.productions;
create policy productions_admin_all on public.productions for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists production_uses_admin_all on public.production_uses;
create policy production_uses_admin_all on public.production_uses for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
revoke all on public.production_spools from anon;
revoke all on public.productions       from anon;
revoke all on public.production_uses   from anon;

-- Coût moyen d'un spacer rejoué depuis son stock de départ + ses productions.
-- Plus aucune production : avg_cost et prod_seed retirés (retour au coût saisi).
create or replace function public._spacer_recost(p_spacer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_seed jsonb; v_n integer; v_q numeric := 0; v_c numeric := 0; v_pq numeric; v_pc numeric;
begin
  select count(*) into v_n from public.productions where spacer_id = p_spacer;
  if v_n = 0 then
    update public.products set attrs = attrs - 'avg_cost' - 'prod_seed', updated_at = now() where id = p_spacer;
    return;
  end if;
  select attrs -> 'prod_seed' into v_seed from public.products where id = p_spacer;
  if v_seed is not null then
    v_q := greatest(0, coalesce((v_seed ->> 'qty')::numeric, 0));
    v_c := v_q * greatest(0, coalesce((v_seed ->> 'cost')::numeric, 0));
  end if;
  select coalesce(sum(pairs), 0), coalesce(sum(pairs * pair_cost), 0) into v_pq, v_pc
    from public.productions where spacer_id = p_spacer and pairs > 0 and pair_cost is not null;
  v_q := v_q + v_pq; v_c := v_c + v_pc;
  update public.products
     set attrs = case when v_pq > 0 and v_q > 0
                      then jsonb_set(attrs, '{avg_cost}', jsonb_build_object('item', round(v_c / v_q, 2)))
                      else attrs - 'avg_cost' end,
         updated_at = now()
   where id = p_spacer;
end $$;
revoke all on function public._spacer_recost(uuid) from public, anon, authenticated;

-- Sortir des bobines du stock de vente pour la production : p_count bobines d'un coup
-- (une ligne production_spools chacune, 1000 g par défaut) ; −1 au stock par bobine tant
-- qu'il en reste (au-delà : bobine « hors stock », stock_taken = 0). p_date = date locale
-- de l'admin (current_date est en UTC : le soir au Québec, ce serait déjà demain).
-- -> { ids: [...], taken }
drop function if exists public.admin_take_spool(uuid, text, numeric, integer);
create or replace function public.admin_take_spool(p_product uuid, p_kind text, p_cost numeric,
  p_weight integer default 1000, p_count integer default 1, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p public.products%rowtype; v_kind text; v_n integer; v_stock integer; v_taken integer; v_id uuid;
        v_ids jsonb := '[]'::jsonb; i integer;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  v_kind := case when p_kind = 'refill' then 'refill' else 'spool' end;
  v_n := least(50, greatest(1, coalesce(p_count, 1)));
  select * into v_p from public.products where id = p_product and type = 'filament' for update;
  if not found then raise exception 'Filament introuvable.'; end if;
  v_stock := greatest(0, case when v_kind = 'refill' then coalesce(v_p.qty_2, 0) else coalesce(v_p.qty, 0) end);
  v_taken := least(v_n, v_stock);
  update public.products
     set qty   = case when v_kind = 'spool'  then coalesce(qty, 0)   - v_taken else qty   end,
         qty_2 = case when v_kind = 'refill' then coalesce(qty_2, 0) - v_taken else qty_2 end,
         updated_at = now()
   where id = p_product;
  for i in 1 .. v_n loop
    insert into public.production_spools (product_id, label, material, hex, kind, unit_cost, weight_g, stock_taken, taken_at, created_at)
    values (p_product, concat_ws(' · ', nullif(v_p.brand, ''), nullif(v_p.material, ''), v_p.name), v_p.material, v_p.hex,
            v_kind, round(greatest(0, coalesce(p_cost, 0)), 2), greatest(1, coalesce(p_weight, 1000)),
            case when i <= v_taken then 1 else 0 end, coalesce(p_date, current_date), clock_timestamp())
    returning id into v_id;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  return jsonb_build_object('ids', v_ids, 'taken', v_taken);
end $$;
revoke all on function public.admin_take_spool(uuid, text, numeric, integer, integer, date) from public, anon;
grant execute on function public.admin_take_spool(uuid, text, numeric, integer, integer, date) to authenticated;

-- Retirer une bobine jamais utilisée (erreur de saisie) : elle revient au stock de vente.
create or replace function public.admin_spool_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.production_spools%rowtype;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select * into v_s from public.production_spools where id = p_id for update;
  if not found then return; end if;
  if exists (select 1 from public.production_uses where spool_id = p_id) then
    raise exception 'Cette bobine a servi à une production : termine-la plutôt.';
  end if;
  if v_s.product_id is not null and v_s.stock_taken > 0 then
    update public.products
       set qty   = case when v_s.kind = 'spool'  then coalesce(qty, 0)   + v_s.stock_taken else qty   end,
           qty_2 = case when v_s.kind = 'refill' then coalesce(qty_2, 0) + v_s.stock_taken else qty_2 end,
           updated_at = now()
     where id = v_s.product_id;
  end if;
  delete from public.production_spools where id = p_id;
end $$;
revoke all on function public.admin_spool_delete(uuid) from public, anon;
grant execute on function public.admin_spool_delete(uuid) to authenticated;

-- Enregistrer une production :
-- p = { spacer_id, made_at, file_name, loops, per_plate, pieces, good, minutes,
--       machine_cost, rates, note, uses: [{ spool_id, grams }] }
-- Coût filament = grammes × prix de la bobine / poids (calculé ici, pas par le navigateur).
-- -> { id, pairs, pair_cost, loose_out, total_cost, avg_cost }
create or replace function public.admin_save_production(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sp public.products%rowtype; v_s public.production_spools%rowtype; v_u jsonb; v_id uuid;
  v_uses jsonb := '[]'::jsonb; v_g numeric; v_c numeric; v_fil numeric := 0; v_grams numeric := 0;
  v_mach numeric := round(greatest(0, coalesce((p ->> 'machine_cost')::numeric, 0)), 2);
  v_good integer := greatest(0, coalesce((p ->> 'good')::integer, 0));
  v_total numeric; v_piece numeric; v_lin integer := 0; v_linc numeric := 0; v_all integer;
  v_pairs integer; v_lout integer; v_loutc numeric := 0; v_pairc numeric; v_seed jsonb; v_attrs jsonb;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select * into v_sp from public.products where id = (p ->> 'spacer_id')::uuid and type = 'spacer' for update;
  if not found then raise exception 'Spacer introuvable.'; end if;
  if jsonb_typeof(p -> 'uses') is distinct from 'array' or jsonb_array_length(p -> 'uses') = 0 then
    raise exception 'Choisis la bobine utilisée.';
  end if;

  for v_u in select value from jsonb_array_elements(p -> 'uses') loop
    v_g := round(greatest(0, coalesce((v_u ->> 'grams')::numeric, 0)), 2);
    select * into v_s from public.production_spools where id = (v_u ->> 'spool_id')::uuid for update;
    if not found then raise exception 'Bobine de production introuvable.'; end if;
    -- prix payé complet (depuis le 2026-10-19 : la bobine vide n'est plus déduite, elle n'a de coût qu'à la vente)
    v_c := round(v_g * v_s.unit_cost / v_s.weight_g, 2);
    v_fil := v_fil + v_c; v_grams := v_grams + v_g;
    v_uses := v_uses || jsonb_build_object('spool_id', v_s.id, 'grams', v_g, 'cost', v_c);
  end loop;

  v_total := round(v_fil + v_mach, 2);
  v_piece := case when v_good > 0 then v_total / v_good end;
  if coalesce((v_sp.attrs -> 'loose' ->> 'n')::integer, 0) > 0 then
    v_lin := 1; v_linc := greatest(0, coalesce((v_sp.attrs -> 'loose' ->> 'cost')::numeric, 0));
  end if;
  v_all := v_good + v_lin;
  v_pairs := v_all / 2;
  v_lout := v_all % 2;
  if v_lout = 1 then v_loutc := case when v_good > 0 then v_piece else v_linc end; end if;
  if v_pairs > 0 then v_pairc := (v_total + v_linc - v_loutc) / v_pairs; end if;

  -- 1re production de ce spacer : son stock actuel entre dans la moyenne à son coût saisi.
  v_seed := v_sp.attrs -> 'prod_seed';
  if v_seed is null then
    v_seed := jsonb_build_object('qty', case when v_sp.cost_price > 0 then greatest(0, v_sp.qty) else 0 end,
                                 'cost', v_sp.cost_price, 'at', now());
  end if;

  insert into public.productions (made_at, spacer_id, spacer_label, file_name, loops, per_plate, pieces, good, minutes,
         grams, filament_cost, machine_cost, total_cost, piece_cost, loose_in, loose_in_cost, loose_out, pairs, pair_cost, rates, note, created_at)
  values (coalesce((p ->> 'made_at')::date, current_date), v_sp.id, v_sp.name, nullif(p ->> 'file_name', ''),
          greatest(1, coalesce((p ->> 'loops')::integer, 1)), greatest(1, coalesce((p ->> 'per_plate')::integer, 1)),
          greatest(0, coalesce((p ->> 'pieces')::integer, 0)), v_good, greatest(0, coalesce((p ->> 'minutes')::integer, 0)),
          v_grams, round(v_fil, 2), v_mach, v_total, v_piece, v_lin, case when v_lin > 0 then v_linc end, v_lout, v_pairs, v_pairc,
          coalesce(p -> 'rates', '{}'::jsonb), nullif(p ->> 'note', ''),
          clock_timestamp())   -- heure exacte : ordre des productions d'un spacer (suppression de la plus récente)
  returning id into v_id;

  insert into public.production_uses (production_id, spool_id, grams, cost)
  select v_id, (e ->> 'spool_id')::uuid, (e ->> 'grams')::numeric, (e ->> 'cost')::numeric
    from jsonb_array_elements(v_uses) e;

  -- bobine vidée par ce G-code (≤ 5 g restants) : terminée toute seule (closed_auto -> rouverte si on supprime la production)
  update public.production_spools s
     set status = 'done', closed_at = now(), closed_auto = true
   where s.status = 'active'
     and s.id in (select (e ->> 'spool_id')::uuid from jsonb_array_elements(v_uses) e)
     and s.weight_g - (select coalesce(sum(u.grams), 0) from public.production_uses u where u.spool_id = s.id) <= 5;

  v_attrs := jsonb_set(v_sp.attrs, '{prod_seed}', v_seed);
  v_attrs := case when v_lout = 1 then jsonb_set(v_attrs, '{loose}', jsonb_build_object('n', 1, 'cost', round(v_loutc, 4)))
                  else v_attrs - 'loose' end;
  update public.products set qty = coalesce(qty, 0) + v_pairs, attrs = v_attrs, updated_at = now() where id = v_sp.id;
  perform public._spacer_recost(v_sp.id);

  return jsonb_build_object('id', v_id, 'pairs', v_pairs, 'pair_cost', round(v_pairc, 4), 'loose_out', v_lout,
    'total_cost', v_total,
    'avg_cost', (select attrs -> 'avg_cost' ->> 'item' from public.products where id = v_sp.id));
end $$;
revoke all on function public.admin_save_production(jsonb) from public, anon;
grant execute on function public.admin_save_production(jsonb) to authenticated;

-- Supprimer une production (la plus récente de son spacer seulement : la pièce seule
-- en réserve s'enchaîne d'une production à l'autre). Stock −paires, réserve d'avant
-- remise, coût moyen rejoué ; ses grammes reviennent aux bobines.
create or replace function public.admin_delete_production(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pr public.productions%rowtype; v_spools uuid[];
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select * into v_pr from public.productions where id = p_id;
  if not found then return; end if;
  if v_pr.spacer_id is not null then
    perform 1 from public.products where id = v_pr.spacer_id for update;
    if exists (select 1 from public.productions where spacer_id = v_pr.spacer_id and created_at > v_pr.created_at) then
      raise exception 'Supprime d''abord la production plus récente de ce spacer.';
    end if;
    update public.products
       set qty = greatest(0, coalesce(qty, 0) - v_pr.pairs),
           attrs = case when v_pr.loose_in > 0
                        then jsonb_set(attrs, '{loose}', jsonb_build_object('n', 1, 'cost', coalesce(v_pr.loose_in_cost, 0)))
                        else attrs - 'loose' end,
           updated_at = now()
     where id = v_pr.spacer_id;
  end if;
  select array_agg(distinct spool_id) into v_spools from public.production_uses where production_id = p_id;
  delete from public.productions where id = p_id;
  -- bobines terminées toutes seules par cette production : rouvertes si elles ont de nouveau du filament
  update public.production_spools s
     set status = 'active', closed_at = null, closed_auto = false
   where s.id = any(coalesce(v_spools, '{}')) and s.status = 'done' and s.closed_auto
     and s.weight_g - (select coalesce(sum(u.grams), 0) from public.production_uses u where u.spool_id = s.id) > 5;
  if v_pr.spacer_id is not null then perform public._spacer_recost(v_pr.spacer_id); end if;
end $$;
revoke all on function public.admin_delete_production(uuid) from public, anon;
grant execute on function public.admin_delete_production(uuid) to authenticated;

-- ============================================================
-- BOBINES VIDES ← PRODUCTION / USAGE INTERNE (2026-10-12)
-- Les bobines vides (accessoires « Bobines vides ») ne viennent que des bobines
-- que Théo vide lui-même. Lien dans la fiche du matériau (materials.empty_spool_id).
-- Coût (révisé le 2026-10-19) : la production paie la bobine au complet ; la bobine
-- vide n'a de coût qu'à la vente = prix bobine − prix recharge du jour
-- (admin_empty_spool_costs, lu par CA.costing.emptySpoolCost) et figé sur la ligne de
-- facture. Les libérations ne portent donc plus de valeur (unit_cost 0) et ne touchent
-- plus attrs.avg_cost. (production_spools.empty_cost : reste de l'ancien calcul, plus écrit.)
-- « À libérer » : bobines terminées en production (empty_state null) + bobines (pas
-- les recharges) des factures Interne depuis le 2026-10-12. Rien n'entre au stock
-- sans confirmation : admin_release_empty (combien libérer / garder).
-- ============================================================
alter table public.materials add column if not exists empty_spool_id uuid references public.products(id) on delete set null;
alter table public.production_spools add column if not exists empty_cost  numeric(10,2);   -- [PRIVÉ] valeur de la bobine vide (figée au 1er usage)
alter table public.production_spools add column if not exists empty_state text;            -- null = à libérer (si terminée) | released | kept
alter table public.production_spools add column if not exists empty_at    timestamptz;
alter table public.production_spools drop constraint if exists production_spools_empty_state_chk;
alter table public.production_spools add constraint production_spools_empty_state_chk check (empty_state in ('released', 'kept'));

create table if not exists public.empty_spool_moves (
  id           uuid primary key default gen_random_uuid(),
  accessory_id uuid not null references public.products(id) on delete cascade,
  source       text not null check (source in ('production', 'internal')),
  action       text not null check (action in ('released', 'kept')),
  n            integer not null check (n > 0),
  unit_cost    numeric(12,4) not null default 0,   -- [PRIVÉ] valeur moyenne d'une bobine de ce mouvement
  spool_ids    uuid[] not null default '{}',       -- bobines de production concernées
  created_at   timestamptz not null default now()
);
alter table public.empty_spool_moves add column if not exists batch uuid;   -- une confirmation (libérées + gardées) = un lot, annulé d'un coup
create index if not exists empty_spool_moves_acc_idx on public.empty_spool_moves (accessory_id, created_at desc);
create index if not exists materials_empty_spool_idx on public.materials (empty_spool_id);
alter table public.empty_spool_moves enable row level security;
drop policy if exists empty_spool_moves_admin_all on public.empty_spool_moves;
create policy empty_spool_moves_admin_all on public.empty_spool_moves for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
revoke all on public.empty_spool_moves from anon;

-- Valeur de la bobine vide d'un filament acheté p_spool_cost : bobine − recharge
-- (coût moyen recharge du produit, sinon dernier prix payé, sinon coût du matériau) ;
-- pas de recharge connue : coût saisi sur l'accessoire. 0 si le matériau n'en donne pas.
create or replace function public._empty_value(p_product uuid, p_spool_cost numeric)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_p public.products%rowtype; v_m public.materials%rowtype; v_r numeric; v_acc numeric; v_c numeric;
begin
  v_c := greatest(0, coalesce(p_spool_cost, 0));
  if p_product is null then return 0; end if;
  select * into v_p from public.products where id = p_product;
  if not found then return 0; end if;
  select * into v_m from public.materials where brand = v_p.brand and name = v_p.material;
  if not found or v_m.empty_spool_id is null then return 0; end if;
  v_r := coalesce(nullif(v_p.attrs -> 'avg_cost' ->> 'refill', '')::numeric,
                  nullif(v_p.attrs -> 'last_cost' ->> 'refill', '')::numeric, v_m.cost_refill);
  if v_r is null or v_r <= 0 or v_r >= v_c then
    select cost_price into v_acc from public.products where id = v_m.empty_spool_id;
    return round(least(v_c, greatest(0, coalesce(v_acc, 0))), 2);
  end if;
  return round(v_c - v_r, 2);
end $$;
revoke all on function public._empty_value(uuid, numeric) from public, anon, authenticated;

-- Bobines de production terminées, pas encore libérées, de cet accessoire (plus vieille d'abord)
create or replace function public._empty_prod_queue(p_acc uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id order by s.closed_at, s.created_at), '{}')
    from public.production_spools s
    join public.products p on p.id = s.product_id
    join public.materials m on m.brand = p.brand and m.name = p.material
   where m.empty_spool_id = p_acc and s.kind = 'spool' and s.status = 'done' and s.empty_state is null;
$$;
revoke all on function public._empty_prod_queue(uuid) from public, anon, authenticated;

-- Bobines (pas les recharges) sorties en usage interne depuis le 2026-10-12 : { n, value }
create or replace function public._empty_internal(p_acc uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('n', coalesce(sum(l.qty), 0),
           'value', case when sum(l.qty) > 0 then sum(l.qty * public._empty_value(l.product_id, l.unit_cost)) / sum(l.qty) end)
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
    join public.products p on p.id = l.product_id
    join public.materials m on m.brand = p.brand and m.name = p.material
   where m.empty_spool_id = p_acc and i.client_type = 'internal' and i.status is distinct from 'cancelled'
     and i.invoice_date >= date '2026-10-12' and l.kind = 'spool';
$$;
revoke all on function public._empty_internal(uuid) from public, anon, authenticated;

-- Coût moyen de la bobine vide (libérations) : retiré le 2026-10-19, le coût se calcule à la vente.
drop function if exists public._empty_recost(uuid);

-- Coût du jour de chaque bobine vide (2026-10-19) -> { "<accessory_id>": coût }.
-- = écart bobine − recharge de la COMMANDE REÇUE la plus récente qui contient les deux
-- formats d'un même matériau (même marque, matériaux qui donnent une bobine vide) : les deux
-- prix datent de la même époque (palier, hausse, taxes). Médiane si plusieurs matériaux dans
-- cette commande. Repli : anciens coûts du matériau lié (cost_spool − cost_refill).
-- Lu par l'admin (CA.costing.loadEmptyCosts) et figé sur la ligne de facture à la vente.
create or replace function public.admin_empty_spool_costs()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  return coalesce((
    with acc as (
      select distinct m.empty_spool_id id, m.brand from public.materials m where m.empty_spool_id is not null
    ), g as (   -- écart par commande reçue et par matériau (les deux formats présents)
      select r.id rid, r.received_at, r.created_at, p.brand,
             avg(l.unit_cost) filter (where l.kind = 'spool') - avg(l.unit_cost) filter (where l.kind = 'refill') gap
        from public.receipt_lines l
        join public.receipts r on r.id = l.receipt_id
        join public.products p on p.id = l.product_id
        join public.materials m on m.brand = p.brand and m.name = p.material and m.empty_spool_id is not null
       where p.type = 'filament' and l.unit_cost > 0
       group by r.id, r.received_at, r.created_at, p.brand, p.material
      having count(*) filter (where l.kind = 'spool') > 0 and count(*) filter (where l.kind = 'refill') > 0
    ), last_r as (   -- commande la plus récente par marque
      select distinct on (brand) brand, rid from g where gap > 0
       order by brand, received_at desc nulls last, created_at desc
    ), by_brand as (
      select g.brand, percentile_cont(0.5) within group (order by g.gap) gap
        from g join last_r lr on lr.rid = g.rid and lr.brand = g.brand where g.gap > 0 group by g.brand
    ), fallback as (
      select m.empty_spool_id id, percentile_cont(0.5) within group (order by m.cost_spool - m.cost_refill) gap
        from public.materials m
       where m.empty_spool_id is not null and m.cost_spool > m.cost_refill group by m.empty_spool_id
    )
    select jsonb_object_agg(a.id, round(coalesce(
             (select percentile_cont(0.5) within group (order by b.gap) from acc a2 join by_brand b on b.brand = a2.brand where a2.id = a.id),
             (select f.gap from fallback f where f.id = a.id))::numeric, 2))
      from (select distinct id from acc) a
  ), '{}'::jsonb);
end $$;
revoke all on function public.admin_empty_spool_costs() from public, anon;
grant execute on function public.admin_empty_spool_costs() to authenticated;

-- Carte « Bobines vides » (Production) : une ligne par bobine vide liée à un matériau
-- (ou de la catégorie « Bobines vides ») -> à libérer (production / interne), en cours, dernier mouvement.
create or replace function public.admin_empty_spools()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.so, x.nm)
      from (
        select a.sort_order so, a.name nm, jsonb_build_object(
          'id', a.id, 'name', a.name, 'qty', a.qty, 'cost_price', a.cost_price,
          'avg_cost', a.attrs -> 'avg_cost' ->> 'item', 'image_path', a.image_path,
          'prod', coalesce(array_length(public._empty_prod_queue(a.id), 1), 0),
          'internal', greatest(0, (public._empty_internal(a.id) ->> 'n')::numeric
                      - coalesce((select sum(n) from public.empty_spool_moves mv where mv.accessory_id = a.id and mv.source = 'internal'), 0)),
          'active', (select count(*) from public.production_spools s
                       join public.products p on p.id = s.product_id
                       join public.materials m on m.brand = p.brand and m.name = p.material
                      where m.empty_spool_id = a.id and s.kind = 'spool' and s.status = 'active'),
          'materials', (select coalesce(jsonb_agg(m.brand || ' · ' || m.name order by m.brand, m.sort_order), '[]'::jsonb)
                          from public.materials m where m.empty_spool_id = a.id),
          'last', (select jsonb_build_object('batch', mv.batch, 'at', max(mv.created_at),
                            'released', coalesce(sum(mv.n) filter (where mv.action = 'released'), 0),
                            'kept', coalesce(sum(mv.n) filter (where mv.action = 'kept'), 0))
                     from public.empty_spool_moves mv where mv.accessory_id = a.id
                    group by mv.batch order by max(mv.created_at) desc limit 1)
        ) j
        from public.products a
       where a.type = 'accessory'
         and (exists (select 1 from public.materials m where m.empty_spool_id = a.id) or a.attrs ->> 'category' = 'Bobines vides')
      ) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_empty_spools() from public, anon;
grant execute on function public.admin_empty_spools() to authenticated;

-- Libérer p_release bobines vides pour la vente (+stock) et en garder p_keep (sorties du compte).
-- Production d'abord (plus vieille d'abord), puis usage interne. -> { qty, avg_cost, released, kept }
create or replace function public.admin_release_empty(p_acc uuid, p_release integer, p_keep integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a public.products%rowtype; v_rel integer; v_keep integer; v_q uuid[]; v_np integer; v_int jsonb; v_ni integer;
        v_relp uuid[]; v_keepp uuid[]; v_reli integer; v_keepi integer;
        v_b uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select * into v_a from public.products where id = p_acc and type = 'accessory' for update;
  if not found then raise exception 'Bobine vide introuvable.'; end if;
  v_rel := greatest(0, coalesce(p_release, 0)); v_keep := greatest(0, coalesce(p_keep, 0));
  if v_rel + v_keep = 0 then raise exception 'Indique combien en libérer.'; end if;

  v_q := public._empty_prod_queue(p_acc); v_np := coalesce(array_length(v_q, 1), 0);
  v_int := public._empty_internal(p_acc);
  v_ni := greatest(0, (v_int ->> 'n')::numeric
          - coalesce((select sum(n) from public.empty_spool_moves where accessory_id = p_acc and source = 'internal'), 0))::integer;
  if v_rel + v_keep > v_np + v_ni then
    raise exception 'Il n''y en a que % à libérer.', v_np + v_ni;
  end if;

  v_relp  := v_q[1 : least(v_rel, v_np)];
  v_reli  := v_rel - coalesce(array_length(v_relp, 1), 0);
  v_keepp := v_q[coalesce(array_length(v_relp, 1), 0) + 1 : least(coalesce(array_length(v_relp, 1), 0) + v_keep, v_np)];
  v_keepi := v_keep - coalesce(array_length(v_keepp, 1), 0);

  -- stock seulement : le coût se calcule à la vente (2026-10-19)
  if coalesce(array_length(v_relp, 1), 0) > 0 then
    insert into public.empty_spool_moves (accessory_id, source, action, n, unit_cost, spool_ids, batch)
    values (p_acc, 'production', 'released', array_length(v_relp, 1), 0, v_relp, v_b);
    update public.production_spools set empty_state = 'released', empty_at = now() where id = any(v_relp);
  end if;
  if v_reli > 0 then
    insert into public.empty_spool_moves (accessory_id, source, action, n, unit_cost, batch)
    values (p_acc, 'internal', 'released', v_reli, 0, v_b);
  end if;
  if coalesce(array_length(v_keepp, 1), 0) > 0 then
    insert into public.empty_spool_moves (accessory_id, source, action, n, unit_cost, spool_ids, batch)
    values (p_acc, 'production', 'kept', array_length(v_keepp, 1), 0, v_keepp, v_b);
    update public.production_spools set empty_state = 'kept', empty_at = now() where id = any(v_keepp);
  end if;
  if v_keepi > 0 then
    insert into public.empty_spool_moves (accessory_id, source, action, n, batch) values (p_acc, 'internal', 'kept', v_keepi, v_b);
  end if;

  if v_rel > 0 then
    update public.products set qty = coalesce(qty, 0) + v_rel, updated_at = now() where id = p_acc;
  end if;
  return (select jsonb_build_object('qty', qty, 'avg_cost', attrs -> 'avg_cost' ->> 'item', 'released', v_rel, 'kept', v_keep)
            from public.products where id = p_acc);
end $$;
revoke all on function public.admin_release_empty(uuid, integer, integer) from public, anon;
grant execute on function public.admin_release_empty(uuid, integer, integer) to authenticated;

-- Annuler une confirmation (erreur de saisie), tout son lot : les bobines redeviennent
-- « à libérer » ; les libérées retirent aussi leur stock (jamais sous 0), coût moyen rejoué.
drop function if exists public.admin_empty_undo(uuid);
create or replace function public.admin_empty_undo(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_rel integer;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  select accessory_id into v_acc from public.empty_spool_moves where batch = p_batch limit 1;
  if v_acc is null then return null; end if;
  perform 1 from public.products where id = v_acc for update;
  select coalesce(sum(n) filter (where action = 'released'), 0) into v_rel from public.empty_spool_moves where batch = p_batch;
  if v_rel > 0 then
    update public.products set qty = greatest(0, coalesce(qty, 0) - v_rel), updated_at = now() where id = v_acc;
  end if;
  update public.production_spools set empty_state = null, empty_at = null
   where id in (select unnest(spool_ids) from public.empty_spool_moves where batch = p_batch);
  delete from public.empty_spool_moves where batch = p_batch;
  return (select jsonb_build_object('qty', qty, 'avg_cost', attrs -> 'avg_cost' ->> 'item', 'released', v_rel)
            from public.products where id = v_acc);
end $$;
revoke all on function public.admin_empty_undo(uuid) from public, anon;
grant execute on function public.admin_empty_undo(uuid) to authenticated;

-- ------------------------------------------------------------
-- PRODUCTION — FILE « EN IMPRESSION » (2026-10-20)
-- Batchs AutoLoop envoyés à la production (bouton AutoLoop ou glisser dans
-- Stock › Production) : ce qui tourne en ce moment. Seulement les infos lues
-- dans l'en-tête (aucun fichier stocké). « Terminé » charge la ligne dans le
-- formulaire de production ; l'enregistrement la retire.
-- info = { isAuto, loops, minutes, objects, fils: [{ type, hex, perLoop }] }
-- ------------------------------------------------------------
create table if not exists public.production_queue (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null default '',
  spacer_id   uuid references public.products(id) on delete set null,
  loops       integer not null default 1,
  per_plate   integer not null default 1,
  pieces      integer not null default 0,
  minutes     integer not null default 0,
  info        jsonb not null default '{}'::jsonb,
  started_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists production_queue_started_idx on public.production_queue (started_at);
create index if not exists production_queue_spacer_idx  on public.production_queue (spacer_id);
alter table public.production_queue enable row level security;
drop policy if exists production_queue_admin_all on public.production_queue;
create policy production_queue_admin_all on public.production_queue for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
revoke all on public.production_queue from anon;

-- ------------------------------------------------------------
-- NOUVELLES (2026-10-22) — promos, événements, nouveautés, mises à jour
-- Admin : onglet Nouvelles (cms-nouvelles.js), historique gardé (rien ne s'efface
-- à l'expiration). Public : barre du haut sur toutes les pages (nav.js, in_bar)
-- + section « Nouvelles » de l'accueil (accueil.js). Lecture anonyme limitée aux
-- nouvelles actives dans leur fenêtre starts_at / ends_at.
-- kind : promo | event | new | update ; image_path dans le bucket « products » (news/…)
-- ------------------------------------------------------------
create table if not exists public.news (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'new' check (kind in ('promo', 'event', 'new', 'update')),
  title       text not null default '',
  body        text not null default '',
  image_path  text,
  cta_label   text,
  cta_url     text,
  promo_code  text,
  event_at    date,
  starts_at   timestamptz,
  ends_at     timestamptz,
  featured    boolean not null default false,
  in_bar      boolean not null default true,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists news_sort_idx on public.news (sort_order, created_at desc);
-- proposed : nouvelle rédigée par Claude, en attente (active = false → invisible du public)
alter table public.news add column if not exists proposed boolean not null default false;
alter table public.news enable row level security;
drop policy if exists news_public_read on public.news;
create policy news_public_read on public.news for select to anon, authenticated
  using ( active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) );
drop policy if exists news_admin_all on public.news;
create policy news_admin_all on public.news for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
grant select on public.news to anon, authenticated;

-- ------------------------------------------------------------
-- THÈME DES FÊTES (2026-10-25) — skin de Noël du site public
-- admin_settings « fetes » : { on: bool, from: "AAAA-MM-JJ", to: "AAAA-MM-JJ", at }
-- (bornes incluses, heure du visiteur). Réglé dans Réglages › Apparence (cms-fetes.js).
-- Lu en anon par nav.js (public_fetes) qui pose html.fetes et charge fetes.js ;
-- ne renvoie que l'interrupteur et les dates. Réglage de départ : 1er déc. → 6 janv.
-- ------------------------------------------------------------
create or replace function public.public_fetes()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('on', coalesce((v ->> 'on')::boolean, false), 'from', v ->> 'from', 'to', v ->> 'to')
    from (select coalesce((select value from public.admin_settings where key = 'fetes'), '{}'::jsonb) as v) s;
$$;
revoke all on function public.public_fetes() from public;
grant execute on function public.public_fetes() to anon, authenticated;
insert into public.admin_settings (key, value)
  values ('fetes', '{"on": true, "from": "2026-12-01", "to": "2027-01-06"}'::jsonb)
  on conflict (key) do nothing;

-- ------------------------------------------------------------
-- LANGUE ANGLAISE (2026-10-25) — site /en/, traduction automatique
-- Colonne i18n (products, materials, news) : { h, name?, description?, long_desc?,
-- category?, title?, body?, cta_label?, s: { "texte court FR": "EN" } } ; écrite
-- SEULEMENT par la fonction Edge « translate » (Claude), jamais par l'admin.
-- Déclencheur : quand un texte français affiché change (empreinte md5 ≠ h), la
-- ligne passe « stale » (l'ancienne traduction reste affichée en attendant).
-- i18n_tick (aux 5 min) appelle « translate » s'il y a du travail.
-- ------------------------------------------------------------
alter table public.news add column if not exists i18n jsonb;

-- texte français à traduire, tel que le site l'affiche ; {} = rien à traduire
create or replace function public._i18n_src(p_table text, r jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_strip_nulls(case p_table
    when 'products' then jsonb_build_object(
      'name',        case when r ->> 'type' = 'accessory' then nullif(r ->> 'name', '') end,
      'description', nullif(r -> 'attrs' ->> 'description', ''),
      'long_desc',   nullif(r -> 'attrs' ->> 'long_desc', ''),
      'category',    nullif(r -> 'attrs' ->> 'category', ''),
      'specs',       case when jsonb_typeof(r -> 'attrs' -> 'specs') = 'array'
                           and jsonb_array_length(r -> 'attrs' -> 'specs') > 0 then r -> 'attrs' -> 'specs' end,
      'pos',         (select jsonb_agg(distinct f ->> 'pos')
                        from jsonb_array_elements(case when jsonb_typeof(r -> 'attrs' -> 'fitment') = 'array'
                                                       then r -> 'attrs' -> 'fitment' else '[]'::jsonb end) f
                       where coalesce(f ->> 'pos', '') <> ''))
    when 'materials' then jsonb_build_object(
      'description', nullif(r ->> 'description', ''),
      'long_desc',   nullif(r ->> 'long_desc', ''),
      'specs',       case when jsonb_typeof(r -> 'specs') = 'array' and jsonb_array_length(r -> 'specs') > 0 then r -> 'specs' end)
    when 'news' then jsonb_build_object(
      'title', nullif(r ->> 'title', ''), 'body', nullif(r ->> 'body', ''), 'cta_label', nullif(r ->> 'cta_label', ''))
  end), '{}'::jsonb);
$$;

create or replace function public._i18n_mark()
returns trigger language plpgsql set search_path = '' as $$
declare s jsonb;
begin
  s := public._i18n_src(TG_TABLE_NAME, to_jsonb(NEW));
  if s = '{}'::jsonb then NEW.i18n := null; return NEW; end if;
  if NEW.i18n is null or NEW.i18n ->> 'h' is distinct from md5(s::text) then
    NEW.i18n := coalesce(NEW.i18n, '{}'::jsonb) || '{"stale": true}'::jsonb;
  end if;
  return NEW;
end $$;
drop trigger if exists products_i18n  on public.products;
drop trigger if exists materials_i18n on public.materials;
drop trigger if exists news_i18n      on public.news;
create trigger products_i18n  before insert or update on public.products  for each row execute function public._i18n_mark();
create trigger materials_i18n before insert or update on public.materials for each row execute function public._i18n_mark();
create trigger news_i18n      before insert or update on public.news      for each row execute function public._i18n_mark();

-- travail à faire (fonction translate, clé de service) : texte source + empreinte
create or replace function public.i18n_pending(p_limit integer default 40)
returns table (tbl text, key jsonb, src jsonb, h text)
language sql stable security definer set search_path = '' as $$
  select * from (
    select 'products'::text, jsonb_build_object('id', p.id), s, md5(s::text)
      from public.products p, lateral (select public._i18n_src('products', to_jsonb(p)) s) x
     where (p.i18n ->> 'stale')::boolean is true and p.active
    union all
    select 'materials', jsonb_build_object('brand', m.brand, 'name', m.name), s, md5(s::text)
      from public.materials m, lateral (select public._i18n_src('materials', to_jsonb(m)) s) x
     where (m.i18n ->> 'stale')::boolean is true
    union all
    select 'news', jsonb_build_object('id', n.id), s, md5(s::text)
      from public.news n, lateral (select public._i18n_src('news', to_jsonb(n)) s) x
     where (n.i18n ->> 'stale')::boolean is true
  ) t limit greatest(1, least(p_limit, 200));
$$;
revoke all on function public.i18n_pending(integer) from public, anon, authenticated;
grant execute on function public.i18n_pending(integer) to service_role;

-- écrit la traduction si la source n'a pas bougé depuis (sinon la ligne reste « stale »)
create or replace function public.i18n_save(p_tbl text, p_key jsonb, p_h text, p_en jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v jsonb := (p_en - 'stale' - 'h') || jsonb_build_object('h', p_h); n integer;
begin
  if p_tbl = 'products' then
    update public.products set i18n = v where id = (p_key ->> 'id')::uuid
       and md5(public._i18n_src('products', to_jsonb(products))::text) = p_h;
  elsif p_tbl = 'materials' then
    update public.materials set i18n = v where brand = p_key ->> 'brand' and name = p_key ->> 'name'
       and md5(public._i18n_src('materials', to_jsonb(materials))::text) = p_h;
  elsif p_tbl = 'news' then
    update public.news set i18n = v where id = (p_key ->> 'id')::uuid
       and md5(public._i18n_src('news', to_jsonb(news))::text) = p_h;
  else return false; end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.i18n_save(text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.i18n_save(text, jsonb, text, jsonb) to service_role;

create or replace function public.i18n_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.i18n_pending(1)) then
    perform net.http_post(
      url := 'https://cqfmvdknppscazfynoiy.supabase.co/functions/v1/translate',
      body := '{"cron":true}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-key', (select value from private.secrets where key = 'cron_key')),
      timeout_milliseconds := 120000);
  end if;
end $$;
revoke all on function public.i18n_tick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'i18n-tick';
select cron.schedule('i18n-tick', '*/5 * * * *', 'select public.i18n_tick()');

-- amorçage : tout ce qui a du texte est à traduire une première fois
update public.products  set i18n = '{"stale": true}'::jsonb where i18n is null and public._i18n_src('products',  to_jsonb(products))  <> '{}'::jsonb;
update public.materials set i18n = '{"stale": true}'::jsonb where i18n is null and public._i18n_src('materials', to_jsonb(materials)) <> '{}'::jsonb;
update public.news      set i18n = '{"stale": true}'::jsonb where i18n is null and public._i18n_src('news',      to_jsonb(news))      <> '{}'::jsonb;

-- Langue des courriels : celle de la version du site utilisée ('fr' | 'en').
-- customers.lang / dealers.lang : posées par me_set_lang (pages /en/ ou FR, à chaque
-- commande, réservation, cueillette, message, ouverture de Mon compte).
-- waitlist.lang : passée par « M'aviser » (waitlist_subscribe p_lang).
-- Lues par customer-order-notify, reservation-notify, pickup-notify, message-notify,
-- waitlist-notify ; compte-code reçoit la langue dans sa requête.
alter table public.customers add column if not exists lang text not null default 'fr';
alter table public.dealers   add column if not exists lang text not null default 'fr';
alter table public.waitlist  add column if not exists lang text not null default 'fr';
do $$ begin
  alter table public.customers add constraint customers_lang_chk check (lang in ('fr','en'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.dealers add constraint dealers_lang_chk check (lang in ('fr','en'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.waitlist add constraint waitlist_lang_chk check (lang in ('fr','en'));
exception when duplicate_object then null; end $$;

create or replace function public.me_set_lang(p_lang text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text := lower((select auth.jwt()) ->> 'email');
        v_lang text := case when p_lang = 'en' then 'en' else 'fr' end;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  update public.dealers set lang = v_lang where lower(email) = v_email and lang <> v_lang;
  if v_email <> 'creationaudio.ca@gmail.com' then
    insert into public.customers (id, email, lang) values (v_uid, v_email, v_lang)
      on conflict (id) do update set lang = excluded.lang where public.customers.lang <> excluded.lang;
  end if;
  return v_lang;
end $$;
revoke all on function public.me_set_lang(text) from public, anon;
grant execute on function public.me_set_lang(text) to authenticated;

-- « M'aviser » : + langue de la page (courriel de retour en stock dans cette langue)
drop function if exists public.waitlist_subscribe(uuid, text, text, text);
create or replace function public.waitlist_subscribe(p_product uuid, p_kind text, p_email text, p_hp text default '', p_lang text default 'fr')
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
        v_kind  text := nullif(trim(coalesce(p_kind, '')), '');
        v_lang  text := case when p_lang = 'en' then 'en' else 'fr' end;
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
  insert into public.waitlist (product_id, kind, contact, source, lang) values (p_product, v_kind, v_email, 'site', v_lang);
  return 'ok';
end $$;
revoke all on function public.waitlist_subscribe(uuid, text, text, text, text) from public;
grant execute on function public.waitlist_subscribe(uuid, text, text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- CALCULATEUR DE BOÎTES (2026-10-26) — Atelier › Boîtes (cms-boites.js)
-- Subs perso + projets de boîtes, admin seulement (rien de public). La
-- bibliothèque Sundown est dans assets/box-subs.js (pas en base).
-- box_subs.data = fiche T/S en unités de saisie (Re Ω, Le mH, Vas L, Sd cm²,
--   Mms g, Bl T·m, Xmax mm, dimensions po, disp pi³, coils, zc, wiring, rec*)
-- box_projects.params = projet complet (cotes en m) + copie de la fiche du sub
--   (sub: { ref, data }) : un projet reste lisible si le sub est supprimé.
-- ------------------------------------------------------------
create table if not exists public.box_subs (
  id          uuid primary key default gen_random_uuid(),
  brand       text not null default '',
  model       text not null default '',
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.box_projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists box_projects_updated_idx on public.box_projects (updated_at desc);
alter table public.box_subs enable row level security;
alter table public.box_projects enable row level security;
drop policy if exists box_subs_admin_all on public.box_subs;
create policy box_subs_admin_all on public.box_subs for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists box_projects_admin_all on public.box_projects;
create policy box_projects_admin_all on public.box_projects for all to authenticated
  using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
revoke all on public.box_subs from anon;
revoke all on public.box_projects from anon;

-- ------------------------------------------------------------
-- Vérification
-- ------------------------------------------------------------
select count(*) as produits_v2 from public.products;
select count(*) as factures_v2 from public.invoices;
select count(*) as dealers_v2  from public.dealers;
