# Carte des dépendances — Création Audio

Ce que le site a besoin pour fonctionner, et ce qui casse si on touche à quelque chose.
Deux fichiers qui vont ensemble :

| Fichier | Contenu | Mise à jour |
|---|---|---|
| **dependances.md** (celui-ci) | Les **chaînes** (prix, stock, coût, factures…), les règles « si tu touches X, vérifie Y », les pièges, les dépendances hors code | **À la main**, à chaque changement qui crée ou coupe un lien |
| [dependances-auto.md](dependances-auto.md) | Inventaire exhaustif : qui lit/écrit chaque table, qui appelle chaque RPC / Edge Function, clés `attrs`, `window.CA.*`, localStorage, assets ↔ pages, cron… + **alertes** | **Script** : `node .claude/skills/creation-audio/scripts/deps.js` |

Dernière revue complète : **2026-10-10** (familles d'affichage : 2026-11-17, § 2.30 ; packs de filament : 2026-11-16, § 2.29 ; journal du stock + photo du jour + comptage : 2026-11-16, § 2.2 ; cueillette des factures « À venir » : 2026-10-31, § 2.4 / 2.8 / 2.16 ; Production sans bobines + usage interne production/autre : 2026-10-29) (+ correctifs du 2026-10-10 et du 2026-10-11, § 6 ; Stock › Production ajouté le 2026-10-11, § 2.2 / 2.3 ; ordre/pastilles + `CA.pick` le 2026-10-11, § 2.12 ; bobines vides ← production/interne le 2026-10-12, § 2.2 / 2.3 ; Atelier › Silhouettes + classes partagées le 2026-10-21, § 2.12 / 2.14 / 6 ; centre d'aide le 2026-10-22, § 2.15 ; fond + couleurs Silhouettes le 2026-10-22, § 2.14 ; plages de cueillette le 2026-10-22, § 2.16 / 2.8 ; nouvelles (barre + accueil) le 2026-10-22, § 2.17 ; bobines vides au-delà du stock le 2026-10-22, § 2.3 ; thème des fêtes le 2026-10-25, § 2.18 ; version anglaise /en/ le 2026-10-26, § 2.19 ; Atelier › Boîtes le 2026-10-26, § 2.20 ; espace max + ratio d'évent le 2026-10-26, § 2.20 ; inscription revendeur + connexion dealer par code le 2026-10-28, § 2.7 / 2.8 / 2.18 / 2.21).

## Mode d'emploi

**Avant** de modifier quelque chose : chercher son nom ici (Ctrl+F) **et** dans dependances-auto.md
(une table, une RPC, une clé `attrs`, un `CA.x`, un asset…). Tout ce qui est listé à côté est à vérifier.
**Et** chercher le **type d'objet** touché (pack, filament, spacer, accessoire, promo…) dans les **familles d'affichage du § 2.30** :
chaque endroit qui montre le même objet doit suivre la modif (affichage, photo, prix, libellé, badge), même sans code partagé.

**Après** :
1. relancer le script → **aucune nouvelle alerte** (section 0 de dependances-auto.md) ;
2. si un lien a été créé, déplacé ou coupé : corriger la chaîne concernée ici (§ 2) et la date ci-dessus ;
3. nouvelle fonctionnalité → suivre la checklist du § 7.

---

## 1. Pièces maîtresses (le plus de dépendants)

| Pièce | Pourquoi c'est sensible | Règle |
|---|---|---|
| Table **`products`** | Filaments, spacers et accessoires dans une seule table ; ~12 modules admin l'écrivent ou la lisent, 10 fonctions SQL y touchent | Jamais lue par une page publique (elle contient les coûts) → passer par les vues |
| **`products.attrs`** (JSON) | Fourre-tout sans migration, écrit par 7 modules : Filaments, Spacers, Accessoires, Inventaire (codes-barres, cibles, CMP), Facturation (codes-barres appris), Marques (renommage → `fil_brands`) — + **en SQL** par les RPC de Production (spacer : `avg_cost`, `prod_seed`, `loose` seulement) | **Toujours écrire par `CA.updateProduct(id, patch, { attrs, opened })`** (admin-core.js) : relit `attrs`/`qty` en base juste avant et ne fusionne que les clés du module (`{clé: valeur}`, `null` = retirer, ou fonction pour les objets imbriqués comme `barcodes`). Jamais `update({ attrs: copieDuCache })` : une copie périmée effaçait les clés posées entre-temps par un autre onglet (corrigé le 2026-10-10) |
| Vues **`products_public`** / **`products_dealer`** | Seule fenêtre du public et des dealers sur les produits ; **liste blanche** des clés `attrs` ; calculent prix (matériau), paliers, stock offert (− réservations) | Une nouvelle clé `attrs` lue en public = l'ajouter à la liste blanche (les deux vues si spacer). Changer une colonne = vérifier boutique, accueil, spacers, dealer, générateur SEO **et `_customer_fill_lines`** (qui lit products_public) |
| Table **`materials`** (clé `brand, name`) | Prix, paliers, coût de repli de **toutes les couleurs** d'un matériau ; jointe **par le texte** `products.material` + `products.brand` | Pas de renommage (champ nom verrouillé). Supprimer un matériau = ses couleurs perdent leur prix (repli `products.sell_price`, souvent 0) |
| **`is_admin()`** | Toutes les policies admin + toutes les RPC admin ; = courriel admin **et** session 2FA (aal2) | Le courriel admin est codé en dur à plusieurs endroits (§ 3) |
| **`CA.sb`** (supabase-client.js) | Client Supabase de l'admin, de la boutique, de l'accueil, des spacers et du portail dealer (session admin/dealer partagée sur le même domaine) | Les pages client (compte, commande, messagerie) ont leur **propre** client : `CA.compteSb`, clé `ca-compte-auth` |
| **`CA.onTab`** (admin) | Chaîne de ~17 modules : chacun garde le précédent et l'appelle | Nouveau module : `var prev = CA.onTab; CA.onTab = function (n) { prev && prev(n); … }`. Un module qui oublie `prev` coupe tous ceux chargés avant lui |
| **`caDialog`** (dialog.js/.css) | Toutes les confirmations / alertes / toasts (admin, boutique, compte, dealer) | Changer sa signature = 20 fichiers. Plus jamais de `window.confirm` |
| **`spacer-catalog.js`** (`CASpacers`) | Une seule fiche et un seul catalogue spacer pour 3 usages : boutique/spacers.html (public), dealer.html, **et le générateur des pages SEO** (exécuté dans Node) | Un changement de rendu change aussi les pages `boutique/spacers/*.html` au prochain passage du robot. Garder `staticProduct` / `staticCatalog` compatibles Node |
| **Chrome public** (en-tête, tiroir, pied) | **Copié dans les 9 pages publiques**, styles dans `site.css` | Un changement d'en-tête/pied = éditer les 9 pages (liste : dependances-auto § 13, ligne `site.css`) |
| **`nav.js`** | Tiroir mobile, et **charge la Messagerie à la demande** (`messagerie.js/css`) | Version de la messagerie = constante `MSG_V` dans nav.js, pas dans le HTML → modifier messagerie.js/css = bumper `MSG_V`, **puis** le `?v=` de nav.js dans ses 8 pages |

---

## 2. Chaînes

### 2.1 Prix & rabais quantité (vente)

**Sources** : filaments = `materials.sell_spool / sell_refill / tiers_spool / tiers_refill` (par couleur : `offer_spool / offer_refill`) ·
accessoires = `products.sell_price + tiers` · spacers = `sell_price` (client, **à plat**) / `dealer_price + tiers` (dealer seulement).

**Règle des paliers** (la même partout) : le plus haut palier `min ≤ quantité` ; quantité = **total du groupe** :
filaments → **par marque**, bobines + recharges + matériaux confondus ; accessoires → **par catégorie** (insensible à la casse ; sans catégorie = la ligne seule) ;
spacers dealer → **toute la commande, tous modèles confondus** (mix and match, 2026-11-13 ; seuils 6/12/24, % propres à chaque modèle) ; spacers client → aucun palier.

La règle est **codée à 6 endroits** — tout changement de règle = les 6 :

| Où | Code |
|---|---|
| Boutique (panier) | `boutique.js` : `tierPrice`, `groupKey`/`groupQty` (marque), `accGroupQty` (catégorie) |
| Facturation | `cms-facturation.js` : `tierPrice`, `filTierKey` (`fil\|marque`), `accTierKey` (`acc\|catégorie`), `repriceLines` |
| Serveur — commande client & réservation | SQL `_customer_fill_lines` (clés `fil\|`, `acc\|`, `one\|`) + `_tier_price` |
| Serveur — commande dealer | SQL `_dealer_fill_lines` + `_dealer_unit_price` |
| Portail dealer / fiche spacer | `spacer-catalog.js` : `tierPrice` |
| Commandes dealer saisies par l'admin (aperçu) | `cms-commandes.js` : `baseOf` + même règle |

Le serveur **recalcule toujours** (un prix trafiqué dans le navigateur est ignoré) → si navigateur et SQL divergent, le client voit un prix et la commande en enregistre un autre.
Spacers : `products_public` force `tiers = []` (paliers réservés au dealer) — ne jamais l'exposer.

### 2.2 Stock

`products.qty` (bobine / unité) et `qty_2` (recharge) — **bornés à 0**.

| Qui modifie | Comment |
|---|---|
| Réception (Inventaire) | RPC `receive_stock(+qté)` ; modifier une réception = `−` ancien puis `+` nouveau |
| Facture enregistrée (case « Déduire ») | RPC `deduct_stock` → renvoie la quantité **réellement** retirée → `invoice_lines.qty_deducted` |
| Lignes « À venir » | non déduites (`qty_pending`) ; déduites à la remise : RPC `deliver_invoice` (Historique) |
| Modifier une facture | RPC `update_invoice` : remet l'ancien, déduit le nouveau, en une transaction |
| Annuler / supprimer une facture | `receive_stock(+qty_deducted)` (ou `qty` pour une très vieille facture) |
| **Éditeurs Filaments / Spacers / Accessoires** | le champ Stock n'est écrit **que s'il a été changé** dans le formulaire (`CA.updateProduct`, `opened` = valeurs à l'ouverture) ; sinon le stock de la base est gardé (vente / réception faite entre-temps) |
| **Production : enregistrer / supprimer** | RPC `admin_save_production` : `qty` du **spacer** + paires ; `admin_delete_production` (la plus récente du spacer seulement) : − paires, borné à 0 |
| **Comptage (Inventaire › Historique)** (2026-11-16) | RPC `admin_set_stock(p_product, p_kind, p_qty, p_reason='count', p_ref)` : met le stock à une valeur exacte, lignes cochées seulement après revue (`cms-stock-journal.js`, brouillon localStorage `ca_stock_count`) |

**Journal du stock** (2026-11-16) : trigger `products_stock_log` (AFTER INSERT/UPDATE OF `qty`,`qty_2`) → table `stock_moves` (avant/après/delta, `reason`, `ref`, `by_email`). La raison vient de `set_config('ca.stock_reason'/'ca.stock_ref', …, true)` posé par la RPC appelante ; sans raison = `manual` (éditeurs), insertion = `created`. **Toute nouvelle RPC qui touche le stock doit poser sa raison**, et toute nouvelle raison doit être ajoutée à `REASONS` de `cms-stock-journal.js` (colonne in/out/int/cor). `receive_stock`/`deduct_stock` prennent `p_reason`, `p_ref` (défauts `reception`/`invoice`) — appelants : cms-inventory (`reception`, `reception_edit`), cms-facturation (`invoice`/`internal`/`production`), cms-historique (`invoice_cancel`) ; `update_invoice` = `invoice_edit`, `deliver_invoice` = `deliver`, production = `production`/`production_delete`. **Photo du jour** : `take_stock_snapshot()` par pg_cron `stock-snapshot` (5 h UTC) → `stock_snapshots(day, product_id)` ; l'Historique compare la fin de période à la photo (écart = mouvement hors journal). Scan Réception : bandeau géant `#scan-banner`, `#scan-undo` (Échap), double lecture < 1 s ignorée, son distinct recharge (`CA.invBeep`).

| Qui modifie | Comment |
|---|---|
| **Production : durée suit les loops** (2026-10-29) | `perLoopMin` = minutes du G-code ÷ loops (= loop + cooldown, linéaire) ; le champ loops réécrit h/min, comme les grammes ; « Arrêter à… » (file En impression) charge n loops au prorata. Avertissement « Pas assez de filament » à l'envoi (`stockWarn`) ; bloc < 150 g = « presque vide » |
| **Production : En impression** (2026-10-20) | Aucun stock. Table `production_queue` (infos d'en-tête seulement, aucun fichier) : ajout par AutoLoop › « Envoyer à la production » (`#al-send-prod` → `CA.prodQueue.addText` défini dans **cms-production.js**, chargé après cms-autoloop.js) ou glisser dans Production (plusieurs fichiers) ; spacer deviné (`detectSpacer`) + pièces = loops × `per_plate` (dernière production du spacer, sinon objets du plateau) ; barre = `started_at` + `minutes`. « Terminé » charge la ligne dans le formulaire ; l'enregistrement la supprime (`fromQueue`). Le parseur d'en-tête (`parseGcode`) sert aux deux chemins |
| **Production : enregistrer / supprimer** (2026-10-29) | RPC `admin_save_production(p)` (`fils:[{product_id,grams,unit_cost}]`, coût = g × CMP / 1 000 calculé en SQL ; **aucun stock de filament touché**) / `admin_delete_production`. Détail figé dans `productions.fils`. Filament retiré du stock = **Facturation › Interne › Production** (`invoices.internal_use` = `production`|`other`, obligatoire ; écrit par `update_invoice`) |

**Stock montré au public** = `qty − réservations actives` (vue `products_public` via `_held_stock()`) ; relu par la boutique au retour sur l'onglet et toutes les 60 s.
**Cartes de l'admin** (Filaments / Spacers / Accessoires, 2026-10-25) : même calcul, `CA.loadHeldStock()` (admin-core, RPC `_held_stock`)
→ `CA.heldStock(pid, kind)` + pastille `CA.heldTag` « N en attente » (plafonnée au stock) ; rechargé au chargement des listes, des
Commandes clients (attente / statut) et des Réservations (60 s), événement `ca:held`. Le champ Stock de l'éditeur reste le stock **physique**.
**Facturation** : alerte si on vend du stock gardé par une réservation (`CA.held`, cms-reservations.js).
**À commander** (Inventaire) : `Manque = cible (attrs.par_spool/par_refill) + promis (CA.reserved) − stock − en route (CA.enRoute)`.
**Promis** (`cms-reserves.js`, depuis 2026-10-11) = articles pas encore sortis du stock mais dus à un client : lignes « À venir »
des factures non annulées (`qty_pending`) + lignes des **réservations actives non échues** + lignes **complètes** des **commandes en
ligne ouvertes** (Nouvelle / En préparation / Prête — toute la quantité, pas seulement `qty_to_order`, car tout sortira du stock à la
facture). Une réservation ou commande facturée sort du compte (sa facture prend le relais si « À venir »). Rechargé à chaque ouverture
de l'Inventaire et après une facture. Même source pour la pastille « 📦 N réservés », les étiquettes « Pour <client> · n° » de la
Liste à commander (ouvrent la facture / la réservation / la commande : `CA.reserved.open`) et l'alerte `#res-alert` au scan.
Alertes au poste de scan : liste d'attente (`CA.waitlist.onScan/onReceived`), promis (`CA.reserved.onScan/onReceived`).

### 2.3 Coût & marge

```
J'ai commandé (En route) : supplier_order_lines.unit_cost  +  supplier_orders.tax_rate + supplier_orders.discount (coupon avant taxes, prorata : cms-inventory.js save())
        │   (taux par défaut : admin_settings « taxes_fournisseur » {marque: %}, Bambu 14,975 %, sinon 0)
        ▼
Réception (pointage) : receipt_lines.unit_cost = prix payé × (1 + taxe)
        │   recomputeAvgCosts() rejoue TOUTES les réceptions du produit
        ▼
products.attrs.avg_cost {spool, refill | item}  +  attrs.last_cost (estimé de la liste à commander)
        (un don à 0 $ compte dans avg_cost mais jamais dans last_cost : seul un prix > 0 est un « dernier prix »)
        ▼
CA.costing.costOf (cms-costing.js) : avg_cost → moyenne même marque+matière → materials.cost_* (figé, plus éditable)
        ▼
Facturation : coût par ligne → invoice_lines.unit_cost, invoices.cost_total  (prix et coûts FIGÉS à l'enregistrement)
        ▼
Statistiques : marge = ventes − coûts, hors taxes, sans factures annulées ni Interne
```

- Accessoires : `avg_cost.item`, sinon `products.cost_price`. **Spacers : `avg_cost.item` (productions), sinon `products.cost_price`** — `itemCost(p)` dans cms-facturation.js (ajout, commande → facture, commande en ligne), `costOf(r)` dans cms-spacers.js (marges des cartes / de l'éditeur). Lignes libres : coût saisi (vide = 0).
- **Spacers — chaîne Production** (2026-10-11, simplifiée 2026-10-29) : plus de bobines assignées. `productions.fils[].cost` = g du G-code × CMP du filament (`CA.costing.costOf(f,'spool')`, lu par le navigateur → `unit_cost` du payload)
  → `productions.total_cost` = filament + `machine_cost` (durée × taux `ap-elec` + `ap-deprec` de
  `admin_settings.autoloop.prix`) → `pair_cost` → `_spacer_recost()` = (`attrs.prod_seed` qty × coût saisi + Σ paires × `pair_cost`) / Σ qté
  → `attrs.avg_cost.item`. Écrit **en SQL** (`jsonb_set` sur la ligne verrouillée, seules `avg_cost` / `prod_seed` / `loose` changent), jamais par le navigateur.
  Pièce seule : `attrs.loose {n:1, cost}` reprise par la production suivante (`loose_in`) — d'où la suppression « la plus récente d'abord ».
  Plus aucune production → `avg_cost` et `prod_seed` retirés (retour au coût saisi). Changer les taux AutoLoop ne touche que les **futures** productions.
- **Bobines vides — chaîne** (2026-10-29) : plus de « à libérer » / Libérer / Garder (tables `empty_spool_moves`, `production_*` supprimées). Les bobines vides entrent au stock par **scan en Inventaire › Réception** (sans commande, coût nul permis). **Coût = à la vente** : RPC
  `admin_empty_spool_costs()` → `{ accessory_id: coût }` = écart bobine − recharge de la **commande reçue la plus récente** contenant
  les deux formats d'un même matériau (même marque, matériaux avec `empty_spool_id` ; médiane), repli `materials.cost_spool − cost_refill`.
  Cache JS `CA.costing.loadEmptyCosts(force)` / `emptySpoolCost(acc)` (cms-costing.js), rechargé par Facturation (ouverture),
  Inventaire (`loadAccessories`), Accessoires (`load`). Lu par Facturation `itemCost` (figé dans `invoice_lines.unit_cost`), fiche accessoire
  (« Coût actuel », lecture seule), valeur d'inventaire. Toucher `receipt_lines`/`receipts.received_at` ou `materials.empty_spool_id` → revoir `admin_empty_spool_costs`.
- **Usage interne — raison** (2026-10-29) : `invoices.internal_use` (`production`|`other`, null = anciennes factures = « autre ») choisi dans Facturation › Interne (`#fx-use`, obligatoire), envoyé par `invoiceFields` → `update_invoice`. Lu par Statistiques (cartes « Interne · production / autre ») et Historique (pastille). Les factures INT- n'ont aucun effet sur les coûts de production : le filament s'y retire à la main.
- **Bobines vides — commande au-delà du stock** (2026-10-22, « Stock seulement » retiré : plus d'`attrs.stock_only`) :
  `products_public.empty_spool_id` (= `materials.empty_spool_id`) marque l'accessoire « bobine vide ». Lu par boutique.js
  (`emptyIds` → `isEmptySpool` : fenêtre `emptyCheck` à l'ajout/hausse, échange recharge → bobine `swapCands`/`doSwap`, libellé
  `BO_EMPTY` « à compléter · sans garantie »), compte.js (`emptyIds`, ligne de commande) et customer-order-notify (`loadEmptyIds`).
  `_customer_fill_lines` ne refuse plus aucun dépassement. Renommer/retirer `empty_spool_id` de la vue → ces 3 lecteurs.
  Avis « prête » : `setStatus('ready')` (cms-commandes-clients.js) → `customer-order-notify` event `ready` (admin aal2, une fois :
  `customer_orders.ready_notified_at`).
- Modifier ou supprimer une réception relance le recalcul → les **futures** factures changent de coût, pas les anciennes.
- Pas de recalcul rétroactif des stats (retiré 2026-09-23).

### 2.4 Cycle de vie d'une facture

1. **Numéro** : RPC `next_invoice_number` (`F-AAAA-###`), `next_internal_number` (`INT-AAAA-###`, Usage interne) ou `next_amazon_number` (`AMZ-AAAA-###`, Envoi Amazon) — compteurs `invoice_counters.seq / seq_int / seq_amz`. N° manuel possible (unique).
   **Envoi Amazon (2026-11-18)** : bouton Facturation `[Amazon]` (`clientType 'amazon'` côté JS seulement) → en base `client_type 'internal'` + `internal_use 'amazon'` + `invoices.amazon` `{fba, center, ship, prep}` (écrit par `invoiceFields` et `update_invoice`). Donc **toute exclusion de l'interne exclut aussi Amazon** (ventes, popularité, courriel). Coût de l'envoi = `cost_total + ship + prep`, lu par Facturation (`amzDocRows`, exposé `CA.amzDocRows`), Historique (`amzTotal`, filtre `amazon`, réimpression) et Statistiques (carte « Envoyé chez Amazon »). Journal du stock : raison `amazon`. Raccourci Production : case `#pr-amazon` → `CA.amazonShipment([{product_id, qty}])` après `admin_save_production` (qty = `d.pairs`). Renommer `invoices.amazon` ou la valeur `amazon` = ces 4 modules.
2. **Enregistrement** : insert direct `invoices` puis `invoice_lines`, puis `deduct_stock` ligne par ligne (→ `qty_deducted`), puis `stock_deducted = true`.
3. **Trigger** `invoices_link_client` : relie la facture à LA fiche client du même nom (s'il n'y en a qu'une) → la rend visible dans **Mon compte** (`me_invoices` via `customers.client_id`).
4. Après : `CA.rememberClient` (carnet), `linkOrder` (commande → Facturée, § 2.5), `CA.reloadHistorique` / `reloadStatistiques` / `printInvoice`.
4b. **« À venir » → cueillette** (2026-10-31) : quand les articles d'une facture finale arrivent, Réception / Historique proposent « Prévenir X » (RPC `admin_invoice_ready` + courriel `ready`) ; le client choisit sa plage dans Mon compte ; chaîne complète en § 2.16.
5. **Historique** : réimprimer (coordonnées : `admin_settings.entreprise` + copie localStorage `ca_v2_facture_company`) · Modifier (`CA.editInvoice` → `update_invoice`) · Remis (`deliver_invoice`) · Annuler · Supprimer.
6. **Compte client** : `me_invoices` (sans coûts) + `company_public()` (lit `admin_settings.entreprise`) → Réglages › Entreprise doit être enregistré pour que le client réimprime à l'identique.
7. **Réglages › Entreprise** (onglet `entreprise`, depuis 2026-10-11 — ex. repliable de la Facturation) : champs `co-*`,
   `gst-rate`/`qst-rate`, logo, bouton `#co-save` ; **toujours gérés par cms-facturation.js** (`fillCompanyForm` au 1er
   `onTab('facturation'|'entreprise')`, `readCompanyForm` lu en direct par l'aperçu de la facture, le courriel et « Copier »).
   Si tu déplaces/renommes ces champs : la facture (taux TPS/TVQ, en-tête) les lit à chaque rendu.

8. **Facture par courriel** (EF `invoice-notify`, design PDF « A · Accent » choisi le 2026-10-29) : `{ invoice_id, event:'auto'|'resend' }`, jeton admin aal2.
   Destinataire = courriel dans `invoices.client_contact`, sinon `clients.email` de la fiche reliée ; aucun → `skipped: no_email` (rien n'est écrit au journal).
   Rien ne part non plus si facture annulée ou `internal`. `auto` : une seule fois (journal `invoice_emails`, `kind='auto' and ok`) et respecte `admin_settings.invoice_email` (`{enabled}`, absent = activé) ;
   `resend` : ignore le réglage, 1 / 30 s. Langue = `customers.lang` (par `client_id`, sinon par courriel). PDF = `pdf.ts` (pdf-lib) : coordonnées lues dans `admin_settings.entreprise`
   (logo PNG/JPEG en data-URL ; SVG ignoré) → renommer ces champs = revoir `pdf.ts`. Jamais de coût/marge dans le PDF (seulement label, meta, qty, unit_price, line_total).
   Polices Inter + Space Grotesk téléchargées de jsdelivr (versions fixées dans `index.ts`), repli Helvetica. Modifier une facture n'envoie rien (bouton « Renvoyer »).
   **Vignettes des articles (2026-11-09)** : `lineImages()` (`index.ts`) lit `invoice_lines.product_id/kind` → filament `attrs.img_spool`/`img_refill` sinon `image_path`, autres `image_path`
   (bucket `products`, réduite par `/storage/v1/render/image` → PNG/JPEG même pour un WebP) ; ligne sans produit dont le libellé = « Entretien [mensuel] — Marque Modèle »
   (`cms-facturation.js` addProduct + `cms-demandes.js` maintLines) → `maintenance_printers.photo` ; photo du site `/assets/entretien/x.webp` → **copie `x.png` voisine obligatoire**
   (pdf-lib ne lit pas le WebP : nouvelle photo par défaut = ajouter sa copie PNG). Renommer ces libellés ou colonnes = vignette perdue (jamais d'échec d'envoi).
   **Côté admin (branché 2026-10-29)** : `cms-facturation.js` expose `CA.invoiceMail = { send(inv, event), resend(inv) }` (resend = confirmation caDialog + toast + `CA.reloadHistorique`) ;
   `onSave` appelle `autoMail(inv)` (sauf usage interne) et ajoute le résultat à `#fx-status` (« ✓ Envoyée à … » / « Pas de courriel : non envoyée » / erreur + [Renvoyer]) ;
   après `update_invoice`, bouton [Renvoyer par courriel]. Réglage = case `#im-on` (Réglages › Entreprise › « Facture par courriel ») → upsert `admin_settings.invoice_email`
   en **conservant `since`** (date de mise en service : l'Historique ne signale « pas de courriel » que pour les factures créées après). `cms-historique.js` lit `invoice_emails`
   (sans `.in()` : table petite, limite 2000) + le réglage, affiche une pastille (`.hd-stock` ok / bad / neutre) et le bouton Envoyer/Renvoyer (`.hd-mail`) — jamais pour annulée ou interne.
   Si tu renommes `invoice_emails.{to_email,ok,error,sent_at}` ou la clé `invoice_email` : revoir `cms-historique.js` (loadMail/mailChip) et `cms-facturation.js` (`IM_KEY`).

8b. **Facture imprimée « A · Accent »** (Théo, 2026-11-18) : `doc-print.js` `build()` reproduit en HTML le PDF de `invoice-notify/pdf.ts` (filet orange, De / Facturé à, vignettes, total en bloc noir ; CSS `.ia-*` dans `doc-print.css`). Utilisé par Facturation « Imprimer / PDF » (`cms-facturation.js` → `CA.docPrint` avec `title`/`internal`/`extra` ; photos = `lineImgPath`/`packImgPath`, mêmes règles que `lineImages` de l'EF) et par les réimpressions dealer (Commandes, portail — **sans photos** : `dealer_order_docs` ne renvoie pas `product_id`). **Encore l'ancien gabarit** : Historique (`cms-historique.js` buildDoc) et Mon compte (`compte.js` buildDoc). Si tu changes le PDF de l'EF, change aussi `build()` (et inversement). `printHtml` attend les images (4 s max) avant `window.print()`.
9. **Mode de paiement** (Théo, 2026-10-29) : colonne `invoices.pay_method` (`'cash'` = comptant | `'interac'` = virement Interac | `'credit'` = entièrement en crédit boutique, § 2.28 | null = anciennes factures et usage interne), check en base.
   **Obligatoire à l'enregistrement et à la modification** (sauf `client_type='internal'`) : `cms-facturation.js` → `payMethod` / `setPay` / `payMissing` (segmenté `#fx-pay`, `.fx-pay-btn[data-pay]`, rien de présélectionné,
   remis à zéro par `resetInvoice`, rechargé par `fillFromInvoice`, caché en « Interne »), écrit par `invoiceFields()` (insert direct ET RPC `update_invoice`, qui ne touche la colonne que si la clé `pay_method` est dans le JSON).
   Affiché : aperçu/réimpression (`.inv-pay` « Paiement » avant « Note » — `cms-facturation.js` render, `cms-historique.js` buildDoc), pastille Historique (`PAY_CHIP`, « payé comptant » / « payé par Interac »),
   **Mon compte** (`me_invoices` → `compte.js` buildDoc + `.ord-note`) et reçu/facture **dealer** (`dealer_order_docs` → `doc-print.js` ; le reçu dit « reçu comptant le » ou « reçu par virement le »),
   PDF + courriel de `invoice-notify` (`pdf.ts` bloc « Paiement » à gauche du total ; `index.ts` ligne sous le total). EN : `i18n-en.js` (Paiement / Comptant / Virement Interac / « reçu comptant le »), EF via `T()`.
   Si tu ajoutes un mode : `check` de la colonne, `PAY_LABEL`/`PAY_CHIP` (admin), `_t()` + `i18n-en.js` (compte, doc-print), `STR` de `pdf.ts` et `payTxt` de `index.ts`. Pas dans Statistiques (choix de Théo).

Exclusions : `client_type = 'internal'` exclu de `product_popularity` (accueil) et des ventes (Statistiques) ; `status = 'cancelled'` exclu partout. ; part payée en crédit boutique (`credit_used`, prorata crédit ÷ total) exclue des ventes/marge/encaissé de Statistiques, montrée dans la carte « Payé en crédit boutique » (2026-11-18)

### 2.5 Commandes → facture

| Origine | Création | Admin | « Facturer » | Après enregistrement |
|---|---|---|---|---|
| Dealer (portail) | RPC `dealer_submit_order` / `dealer_update_order` / `dealer_cancel_order` → EF `dealer-order-notify` | Commandes (`cms-commandes.js`), aussi `admin_save_dealer_order` | `CA.invoiceFromOrder(order)` | update `dealer_orders.status = 'invoiced'`, `invoice_id` |
| Client en ligne | RPC `customer_submit_order` / `update` / `cancel` (`commande-client.js`, `compte.js`) → EF `customer-order-notify` | Commandes › Clients (`cms-commandes-clients.js`) | `CA.invoiceFromOrder({kind:'client'})` | RPC `admin_invoice_customer_order` (Facturée + compte relié à une fiche) |
| Réservation 72 h | RPC `customer_reserve` (clients `can_reserve`) → EF `reservation-notify` | Commandes › Réservations (`cms-reservations.js`, `admin_reservation_action`) | `CA.invoiceFromOrder({kind:'reservation'})` | RPC `admin_invoice_reservation` (Facturée, pénalité retirée) |

- Le statut « Facturée » est posé **après** l'enregistrement de la facture, par un appel séparé : s'il échoue, la facture existe mais la commande reste à facturer (message ⚠ dans la Facturation).
- Annuler ou supprimer la facture (Historique) **rouvre l'origine** : RPC `admin_reopen_invoice_orders` → commande dealer / client
  « Prête » (bouton Facturer), réservation « Active » si pas échue (son stock redevient gardé), sinon « Expirée » sans pénalité ni
  courriel ; `invoice_id` remis à null ; message « Commande D-0007 → Prête ». Suppression : appelée **en premier** (après, le lien
  est perdu ; si elle échoue, rien ne bouge). Annulation : appelée après le passage « Annulée ».
- Pastilles : `#nav-orders-n` = dealer (cms-commandes) + clients + réservations (`CA.ordersCount` / `CA.paintOrdersBadge`). Dealer + clients = commandes **ouvertes** (new/preparing/ready, 2026-11-11) : la pastille reste jusqu’à Facturée ou Annulée.
- Réservations : expiration, pénalités et courriels par le **cron `reservations-tick`** (aux 10 min) → `pg_net` → EF `reservation-notify` (clé `private.secrets.cron_key`).

### 2.6 Identité, noms & adresses (renommer / supprimer)

| Action | Ce qui suit tout seul | Ce qui **ne suit pas** |
|---|---|---|
| Renommer une **marque** (cms-brands `renameBrand`) | Ligne `brands` renommée **sur place** (ordre, logo, slug gardés) · `materials.brand`, `products.brand` · `attrs.fil_brands` des accessoires · `admin_settings.taxes_fournisseur` · `supplier_orders.supplier`, `receipts.supplier` · `localStorage ca_admin_brand` | Slug **auto** de la marque (sans slug perso) → les **anciens liens boutique** `#/m/<ancien-slug>` cassent · un autre onglet admin ouvert garde l'ancien nom en mémoire jusqu'au rechargement. Toute nouvelle donnée qui stocke un **nom de marque** doit être ajoutée à `renameBrand` |
| Renommer un **matériau** | — | Impossible (nom verrouillé) : créer le nouveau, déplacer les couleurs, supprimer l'ancien |
| Renommer une **couleur** (filament) | — | Slug auto → ancien lien `#/m/…/<couleur>` cassé (sauf slug perso) · `admin_settings.commande_alias` reste bon (id du produit) |
| Renommer un **spacer** | `attrs.aliases` reçoit l'ancien nom (anciens liens `#/s/…`, recherche) | Page SEO `boutique/spacers/<slug>.html` (+ redirection `spacer/<slug>.html`) : régénérée au prochain passage du robot (l'ancienne est supprimée) |
| Changer un **slug** (Liens) | — | Les liens déjà partagés (Marketplace, Messenger) cassent |
| **Supprimer** un produit | Lignes de facture / réception / commandes : `product_id` → null (le libellé reste) · liste d'attente supprimée (cascade) | Statistiques et popularité perdent le lien · **préférer « Masqué »** (`active = false`) |
| Supprimer un **client** (fiche) | `invoices.client_id`, `customers.client_id` → null | Le compte client ne voit plus ses factures |
| **Fusionner** deux fiches (bouton « Fusionner », `cms-clients.js`) | RPC `admin_merge_clients(p_keep, p_drop, p_fields)` : déplace `invoices.client_id`/`client_name` + `customers.client_id` vers la fiche gardée, supprime l'autre, complète ses coordonnées vides. Refuse si les deux ont un compte (`customers.client_id` unique). « Doublon possible » = même nom (casse/accents) ou même téléphone | Toute nouvelle table qui pointe `clients.id` doit être déplacée dans cette RPC (2026-11-13) |
| **Prénom / Nom / Entreprise** (clients, customers, dealers, dealer_requests — 2026-11-14) | Colonnes `first_name`, `last_name`, `company` (+ `lang`, `source` sur clients ; `lang`, `source` sur dealers où `name` = commerce). Trigger `person_name_sync` (clients + customers) recompose `name` = « Prénom Nom », sinon entreprise → **tout le code qui lit `name` continue de marcher** ; `name` seul → découpé (`private.split_name`). Nouvelle fiche clients : copie les parties depuis `customers` (même courriel). `me_update(p_first,p_last,p_company,p_phone)` (l'ancien `me_update(p_name,p_phone)` reste pour les pages en cache). Formulaire /revendeur : `contact` = « Prénom | Nom », séparé par le trigger `dealer_request_split` (l'Edge Function `dealer-request` n'a pas changé). Affichage admin : `CA.personName`, `CA.personTodo` (« À compléter »), `CA.fillSources` / `CA.WHO_SOURCES` (cms-clients.js) | `admin_merge_clients` ne copie pas encore `company`/`lang`/`source` · `needs_name` (compte_touch) exige prénom ET nom · tout nouveau formulaire client doit écrire les parties, pas `name` |
| Retirer un **dealer** | Trigger `dealers_access_sync` : compte **banni** + sessions fermées ; le rajouter le débloque | Ses commandes restent (historique) |
| Renommer un **onglet / sous-onglet admin** | — | Liens des courriels : `#commandes`, `#commandes/clients`, `#commandes/reservations`, `#messages/<id>` (Edge Functions) + raccourcis internes `CA.route.goSub` |

### 2.7 Connexion & rôles

| Qui | Page | Mécanisme |
|---|---|---|
| Admin | `coulisses-t6avzpe2.html` | `CA.signIn` (auth-gate.js) → EF `auth-gate` (5 essais / 15 min, `private.login_guard`) → mot de passe **dérivé** HMAC avec `private.secrets.auth_pepper` → 2FA TOTP (`CA.mfa`) → `is_admin()` exige aal2 |
| Dealer | `dealer.html` | **Code à 6 chiffres par courriel** (2026-10-28) : `dealer.js` → EF `compte-code` `{ purpose:'dealer' }` → n'envoie un code **qu'à un courriel présent dans `dealers`** (sinon `not_dealer` → lien revendeur.html) → `sb.auth.setSession` sur `CA.sb` (pas `ca-compte-auth`) ; accès = `is_dealer()`, vue `products_dealer`. L'admin y garde `CA.signIn` + 2FA (le champ mot de passe n'apparaît que pour `CA.adminEmail`, aperçu) |
| Client | `compte.html` (+ panneau Messagerie, commandes boutique) | Pas de mot de passe : code par courriel, EF `compte-code` (Resend) → `compte_code_issue/check` → `compte_touch` ; session `ca-compte-auth` partagée par compte.js, commande-client.js, messagerie.js, nav.js (point « Mon compte »), boutique.js (courriel pré-rempli), **panier-compte.js** (2026-11-05 : pop-up courriel → code → nom du panier, boutique + spacers ; `CA.custOrder.client()` ; code en attente `ca_panier_pending` ; si tu changes les erreurs de `compte-code` ou `me_update`, vérifier aussi ce module et son gabarit dans `spacers.html`/`boutique.html` : `#cart-send`, `#cart-info`, `#cart-tip`, `#cart-login`, `.cart-alt`) |

⚠ Changer `auth_pepper` = **tous** les mots de passe admin/dealer cessent de fonctionner. Ne jamais écrire le nom de la page admin dans un fichier public (robots, sitemap, lien, asset public).

### 2.8 Courriels (Resend)

Toutes les Edge Functions d'envoi passent par **api.resend.com** avec `RESEND_API_KEY` + `MAIL_FROM` (domaine vérifié chez Resend).
Sans clé Resend : **plus de connexion client** (le code n'arrive pas) → donc plus de Messagerie, de commandes en ligne ni de réservations, en plus des avis.

| Edge Function | Déclenchée par | Destinataires |
|---|---|---|
| `compte-code` | compte.js, messagerie.js, **dealer.js** (`purpose:'dealer'`) | client / dealer (code de connexion) |
| `dealer-request` | revendeur.js (`submit`, anon), cms-dealers.js (`decide` / `invite`, jeton admin) | demandeur (accusé de réception, puis bienvenue si approuvé) — refus = **aucun** courriel |
| `waitlist-notify` | Inventaire › Liste d'attente « Aviser » | client |
| `dealer-order-notify` | dealer.js (nouvelle / modifiée / annulée) | admin (`ORDER_NOTIFY_TO`) |
| `customer-order-notify` | commande-client.js, compte.js | client + admin |
| `reservation-notify` | commande-client.js, compte.js, **cron SQL** | client + admin |
| `pickup-notify` | commande-client.js (`CA.custOrder.setPickup`, après `customer_set_pickup`) — 1 avis / 2 min (`pickup_notified_at`) | client + admin |
| `pickup-request-notify` (event `ready`, facture) | cms-reserves.js `notifyInvoice` / cms-historique.js `paintPickup`, après `admin_invoice_ready` ; `confirmed` : `CA.confirmPickup('invoice')` | client (FR/EN selon `customers.lang`) |
| `message-notify` | **cron SQL seulement** (`messages_tick`, chaque minute, clé `x-cron-key`) — les appels du navigateur répondent `deferred` | admin (`MESSAGE_NOTIFY_TO`) / client |
| `order-parse` | cms-en-route.js (repli IA) | — (Claude Haiku, `ANTHROPIC_API_KEY` ; 503 `no_key` si absente) |
| `invoice-notify` | `cms-facturation.js` à l'enregistrement (`event:'auto'`) + [Renvoyer] Facturation/Historique (`'resend'`) via `CA.invoiceMail` — jeton admin aal2 (déployée v2, 2026-10-29 : + mode de paiement) | client (PDF joint, résumé, lien Mon compte) + copie cachée `ORDER_NOTIFY_TO` (défaut contact@) |

### 2.9 Messagerie

Depuis le 2026-11-06, les demandes Impression 3D et Entretien **n'arrivent plus ici** : fiches `service_requests`, § 2.25. Elles partagent seulement le bucket `print-files` et le lien de repli `a.ask`.

Lien `a.ask[data-msg]` (toutes les pages publiques) → `CA.loadMsg` (nav.js, version `MSG_V`) → `messagerie.js` → code courriel (`compte-code`) →
RPC `msg_start` / `msg_send` (photos : bucket **privé** `messages`, dossier = id du compte, 4 max, 200 par compte) → trigger `messages_after_insert` (aperçu, non-lus, `*_unread_since`).
**Courriels différés (2026-10-21)** : rien n'est appelé à l'envoi. Cron `messages-tick` (1 min) → si une série est non lue depuis **5 min** et pas avisée → EF `message-notify` réclame `*_notified_at` puis envoie **un** courriel qui regroupe la série. Lire (non-lus à 0) remet `*_unread_since` + `*_notified_at` à null (trigger `conversations_before_update`).
**Présence** : `me_messages` (client, aux 10 s, fil ouvert) écrit `client_seen_at` et renvoie `admin_online` ; `admin_msg_seen` (admin, aux 10 s) écrit `admin_seen_at` + lu et renvoie `client_seen_at` → « En ligne » < 40 s. Changer la cadence de relecture = revoir ce seuil de 40 s.
Admin : onglet Messages (`cms-messages.js`, RLS) — **la purge Loi 25 (12 mois) est lancée par cet onglet**, pas par un cron (les photos doivent passer par l'API Storage).
**Fichiers 3D (2026-11-05, page Impression 3D)** : `messages.files` jsonb `[{p,n,s}]` ; bucket **privé** `print-files` (dossier = id du compte, 50 Mo, 3 par message, 30 par compte, `.stl/.3mf/.step/.stp/.obj`, téléversé en `application/octet-stream` : **le bucket refuse tout autre type**, et supabase-js ignore l'option `contentType` pour un Blob. `upload3d()` (messagerie.js) refait donc le Blob avec `slice(0, size, 'application/octet-stream')` ; sans ça, Safari et Firefox échouent parce qu'ils donnent un type au fichier, alors que Chrome passe) ; RPC `msg_start`/`msg_send` prennent `p_files` (validé par `_msg_files`, `_msg_guard` à 4 arguments) ; `me_messages` renvoie `files`. `CA.msg.open({files:[File…]})` (messagerie.js) affiche le sélecteur et garde les fichiers dans IndexedDB `ca-msg` pendant le passage par l'appli courriel. Admin : `cms-messages.js` signe les URL du bucket `print-files`. **Toute suppression de conversation / de compte / purge 12 mois doit aussi vider `print-files`** (cms-messages `erase`, compte.js `removeMyPhotos`).
Mon compte › Supprimer : `compte.js` efface d'abord les photos et fichiers 3D (Storage), puis `me_delete`.
**Voir en 3D + plateau joint (2026-11-05)** : `.gcode` accepté partout (`FILE_EXT` messagerie.js, `_msg_files`, policy `print_files_insert`). Le fil affiche « Voir en 3D » pour `.stl/.obj/.3mf/.gcode/.capv` des deux côtés (`view3d` messagerie.js, clic délégué sur `threadEl` cms-messages.js) : `apercu-3d.js` chargé au premier clic, URL signée fraîche de 10 min. **STEP = téléchargement seulement.** Admin : bouton `.ms-attach-3d` → `add3d` → `.gcode`/`.3mf` tranché passe par `CA.ap3d.makePreview` et **seul le `.capv` part** (`upload3d`, `messages.files`), jamais le fichier d'origine ; `.3mf` sans G-code = fichier complet (≤ 50 Mo) ; `.gcode` sans parcours = refusé. **Un `.capv` n'a jamais de lien de téléchargement.** Seul l'admin peut en créer (policy) et les clients ne peuvent pas en référencer (`_msg_files`) ; hors quota de 30 (`_pf_quota_ok`). Purge et suppression : aucun changement, `erase` et `removeMyPhotos` passent par `files`/le dossier.

### 2.10 Liste d'attente (M'aviser)

Boutique (fiche filament / accessoire en rupture) → RPC anon `waitlist_subscribe` (honeypot, anti-doublon, 5 par courriel, 40/h) →
Inventaire : pastille « en attente » dans À commander + alerte au scan et à la réception (`CA.waitlist`, événement `ca:waitlist`) →
« Aviser » → EF `waitlist-notify` (lien construit avec les slugs marque / matériau / couleur) → nom + courriel effacés.
Loi 25 : cron `waitlist-cleanup` (4 h UTC) efface après 60 jours. Mon compte : `me_waitlist` / `me_waitlist_cancel`.
**Par sujet (2026-11-10)** : une ligne = un produit **ou** un `topic` (contrainte `waitlist_target_chk`, `waitlist_topic_chk` = `'printers'` seulement). Page `boutique/imprimantes.html` (« Bientôt », noindex, hors sitemap ; `boutique-imprimantes.js/.css` — **≠ `imprimantes.css` de l'admin**) → RPC anon `waitlist_topic_subscribe`. Admin `cms-attente.js` : groupe `topic:<x>` (`gkey`/`groupLabel`), « Copier les courriels » + « Marquer avisé », **jamais** `waitlist-notify` (l'EF suppose un produit). `me_waitlist` fait un `join products` → les sujets n'apparaissent pas dans Mon compte. **Ajouter un sujet** = contrainte + RPC + `TOPIC_LABEL` + page. **Ouvrir la vraie catégorie** = retirer `.nav-soon` des menus (12 pages FR + gabarit `boutique/spacers.html`), le noindex, puis aviser la liste.
**Par pack (2026-11-18)** : `waitlist.pack_id` (cascade) ; `waitlist_target_chk` = `num_nonnulls(product_id, topic, pack_id) = 1`. Fiche d'un pack épuisé (`packAnyStock` faux) → `notifyHtml(packNotify(pk))` + `wirePackNotify` (rebranché par `renderPack` **et** `updatePackCard`) → RPC anon `waitlist_pack_subscribe`. Avis **automatique** : cron `pack-waitlist-tick` (5 min) → `pack_waitlist_tick()` → si `pack_waitlist_due()` (via `_pack_has_room`, même règle que `packAnyStock` : une composition complète en stock `products_public`, ou Personnaliser N/B avec assez d'unités ; **pack désactivé = jamais avisé**) → EF `waitlist-notify` `{cron:'packs'}` + `x-cron-key`. Admin `cms-attente.js` : groupe `pack:<id>` (« Avis automatique au retour », supprimable). `me_waitlist` = left join products **et** packs (`type:'pack'`, compte.js `productHref`). **Si tu touches** `packAnyStock` (boutique.js) ou les règles de composition, aligne `_pack_has_room`. Depuis le 2026-11-18 soir, le bouton « Ajouter au panier » reste aussi sur la fiche épuisée (pack à commander, § 2.30 Packs).

### 2.11 Spacers : catalogue partagé & pages SEO

- Données : `products` type `spacer` + `attrs` : `fitment`, `speaker_size`, `replaces`, `speakers`, `aliases`, `specs`, `long_desc`, `gallery` — toutes dans la liste blanche des **deux** vues.
- Recherche « véhicule ou code » présente à 4 endroits : `spacer-catalog.js` (boutique + dealer), Facturation (`data-search`), Commandes (`spacerMatches`) → une nouvelle clé cherchable = les 4.
- **Robot GitHub** `.github/workflows/spacer-pages.yml` (aux 6 h, manuel, ou push du générateur) → `node tools/build-spacer-pages.js` : lit `products_public` (clé publique de `supabase-config.js`), exécute `spacer-catalog.js` dans un `vm`, écrit `boutique/spacers/<slug>.html`, les redirections des anciennes adresses (`spacer/<slug>.html`, `spacers.html`, mêmes chemins sous `en/`), les blocs balisés de `boutique/spacers.html` (`<!-- spacers:head -->`, `<!-- spacers:list -->`) et `sitemap.xml` (`<!-- spacers:urls -->`), puis **commite sur main**.
  → Ne pas retirer ces commentaires balises · **`git pull --rebase` avant chaque push**.
- 404.html renvoie `/spacer/<x>` et `/boutique/spacers/<x>` inconnus vers `/boutique/spacers#/s/<x>`.
- ⚠ **Fichier et dossier du même nom** : `boutique.html` + `boutique/`. GitHub Pages sert le fichier pour `/boutique` et `boutique/index.html` pour `/boutique/` (testé sur un vrai dépôt Pages le 2026-11-06). **Depuis le 2026-11-14, `boutique.html` = accueil de la boutique** (« Que cherchez-vous aujourd'hui ? », tuiles + promos + nouveautés, `boutique-accueil.js/.css`) ; un script en tête renvoie les anciennes adresses (`?promo=1` → promotions, `#/accessoires`, `#/a/`, `#/c/` → accessoires, `#/m/` → filaments). Les rayons : `boutique/filaments.html` (source), `boutique/accessoires.html` et `boutique/promotions.html` **générés** par `tools/build-boutique-pages.js` (appelé par `build-en.js`) → ne jamais les éditer à la main. Un seul `boutique.js` sert les trois, selon `<body data-shop="filaments|accessoires|promotions">` ; une route d'un autre rayon est renvoyée par `location.replace`. Liens : `boutique/filaments#/m/<marque>/<matériau>`, `boutique/accessoires#/a/<slug>` (`#/c/<catégorie>`), `boutique/promotions`. Ne pas retirer `boutique/index.html`, `boutique/spacers/index.html` (+ `en/`) : ils renvoient les adresses à barre oblique finale. Tester avec `tools/serve-pages.js`, pas `npx serve`.

### 2.12 Admin : coquille & onglets

- `admin-core.js` : portier (mot de passe → 2FA), routage `#onglet/sous-onglet` (`CA.route`), titre de la barre du haut lu dans le bouton `.tab` (`data-group` + `<span>`).
- Chaque onglet : bouton `.tab[data-tab][data-group]` dans `.side#nav-drawer` + `<section class="tabpanel" data-panel="…">` + son module chargé en bas de page avec `?v=`.
- Les modules se parlent par `window.CA.*` (liste complète : dependances-auto § 9) et par 4 événements DOM (`ca:enroute`, `ca:reserved`, `ca:waitlist`, `ca:msg-change`).
- Couleur d'accent : `admin-accent.js` ↔ `admin_settings.apparence` (+ localStorage `ca-accent`) → **jamais d'orange en dur** dans l'admin ; la facture reste orange.
- **Ordre + pastilles des filaments (2026-10-11)** : partout où des filaments sont listés, ordre = celui de la section Filaments
  (`brands.sort_order` → `materials.sort_order` → `products.sort_order`). Inventaire : `sortFilaments()` / `CA.inv.sortLines()`
  (cms-inventory.js, aussi utilisé par cms-en-route.js) — dépend de `CA.brands.list` et `CA.materials.list` chargés.
  Menu de choix d'article = **`CA.pick(select)`** (`ca-pick.js`, styles `.cpk-*` dans admin.css) : habille un `<select>` existant
  (valeur + `change` inchangés), pastille par `<option data-sw="…">` ; options d'article = `CA.inv.options()`. Le focus-guard du
  scanner de Réception ignore `.cpk-pop` (popover attaché au `<body>`). Production a son propre menu `.pr-pk` (même look).

- **Classes partagées entre onglets** : `.fx-seg` / `.fx-seg-btn` (boutons segmentés, facture.css) servent à Facturation,
  Messages, Commandes, Production, Silhouettes et Boîtes → **toujours cibler ses propres boutons** (conteneur ou attribut, ex.
  `.fx-seg-btn[data-cat]`), jamais `$$('.fx-seg-btn')` sur tout le document (corrigé le 2026-10-21, § 6). Pareil pour les
  classes d'AutoLoop réutilisées par Silhouettes et Boîtes (`.al-card`, `.al-drop`, `.al-acc`, `.al-srow`) : cms-autoloop.js lit
  **toutes** les `.al-defs` et `.al-view` du document → Silhouettes a sa propre barre `.sil-defs`, jamais `.al-defs` / `.al-view`.

### 2.13 Site public : pages & assets

- Toute modif d'un `.js` / `.css` = bumper son `?v=` dans **chaque** page qui le charge (liste : dependances-auto § 13).
- `boutique.css` est partagé par boutique.html, boutique/filaments|accessoires|promotions.html, boutique/spacers.html, boutique/imprimantes.html et dealer.html : `.shop-*`, `.sp-card`, `.cart-*`, `.toast` → ne pas renommer.
  Portail dealer (2026-10-27) : `dealer.css` transforme `.cart-panel` en panneau collé à droite à ≥ 1200 px (`body.dl-in`, `--maxw:1560px`) et ajoute la barre du bas `.dl-mbar` + la barre de rabais par modèle (`.citem-tiers`, paliers via `CASpacers.normalizeTiers`) et arrondit `.spc-bar` (sans débord) → un changement du tiroir ou de `.spc-bar` dans boutique.css se vérifie aussi là.
- Paniers distincts : `ca_v2_cart` (filaments + accessoires, boutique) · `ca_v2_cart_spacers` · `ca_v2_cart_dealer`.
- Liens vers l'accueil : `./` et `./#section`, jamais `index.html`.
- Entretien (refonte 2026-11-05) : `entretien.html` charge `entretien-v2.css` (`et-*`) + `entretien.js` ; `entretien.css` (`en-*`) ne sert plus qu'à `impression.html` → ne pas le supprimer ni y toucher pour Entretien. `entretien.js` lit `#et-points > li` (`data-x`/`data-y` = position du point en % de `.et-view`, `data-photo` optionnel) : si on change l'image ou le cadrage de `.et-machine`, replacer les points. Le formulaire `#demande` passe par `a#et-ask[data-msg]` → Messagerie (nav.js) ; tout texte du message = `_t()` + `i18n-en.js`.

### 2.14 Atelier : Silhouettes (générateur de pièces murales, 2026-10-21)

Onglet `#silhouettes` (groupe Atelier) — **100 % navigateur**, aucune table : seule donnée en base = `admin_settings`
clé **`silhouettes`** `{ vals: {id de champ: valeur}, at }` (défauts réglés par Théo) + copie localStorage `sil-defaults`.

| Pièce | Rôle | Lien fragile |
|---|---|---|
| `assets/silhouette-engine.js` (`SilEngine`, sans DOM) | image en gris → masque à l’échelle → retouches → contrôles (îles / passages minces / petits trous) → coutures (grille) → contours → 3MF / SVG / DXF | Chargé **deux fois** : sur la page (repli) et par le worker (`importScripts`) |
| `assets/silhouette-worker.js` | calculs en arrière-plan ; garde l'image + le cache des étapes | Son `?v=` est **celui du moteur** : cms-silhouettes.js lit la balise `<script src="…silhouette-engine.js?v=N">` et construit `silhouette-worker.js?v=N`, qui importe `silhouette-engine.js?v=N` → modifier le moteur ou le worker = bumper **le seul** `?v=` du moteur dans la page |
| `assets/cms-silhouettes.js` + `silhouettes.css` | UI : aperçu Plan / Mur / 3D (WebGL maison), recadrage, coupes déplaçables, choix par morceau, exports | `.fx-seg-btn` partagé (§ 2.12) : l'état des boutons = `aria-checked`, pas `.is-active` |
| `assets/vendor/fflate-0.8.3.min.js` | ZIP du 3MF (dans le worker) | Même copie locale qu'AutoLoop |

Avec un **fond** (`buildParts`) : pas de mi-bois sur toute la coupure → petits tenons (`BACK_TENON_L` 10 mm, écart `BACK_TENON_PITCH` 40 mm) répartis le long de chaque coupure du fond, demi-épaisseur côté dos (au plateau) ; la pièce voisine a la rainure ouverte au dos + peau devant. Écartés des croisements de coupures et des bords du fond. Fond < 1,2 mm : coupe franche.

Règles du moteur (pour le modifier sans casser la fabrication) : cote demandée = pièce **finale** (2e passe si un morceau
retiré change la boîte, `stages()`) · plateaux `BEDS` (Bambu 256, SV08 500) − `BED_MARGIN` 5 mm · **ponts** (`facingBridges`,
2026-10-21) : zones « face à face » = tronçons de la frontière de Voronoï entre deux morceaux ; on relie **toutes** les zones
proches (≤ max(4 traits, 1,6 × distance au plus proche voisin) des deux morceaux) + l'arbre couvrant pour le reste ; pont au
milieu du côté le plus étroit qui fait face, perpendiculaire → un arc tient par ses deux bouts, symétrique · **joint à tenon
caché au dos** (remplace le mi-bois le 2026-10-21) : la pièce k va de la couture k-1 au bout de son tenon (couture k +
« Tenon » mm) ; tenon = âme des traits (`coreOf` : ≥ `TENON_WALL` 1 mm du bord, filets < `TENON_MIN` 0,8 mm retirés),
demi-épaisseur côté mur ; rainure dans la pièce suivante = âme + `JOINT_GAP` 0,2 mm = **ligne de niveau d'un champ de
distance à l'âme** (jamais de contours qui se croisent : l'ancien décalage de polygones `offsetRings` faisait des rainures qui
se chevauchaient → maillage ouvert), peau devant, parois autour ; tous les segments **dos au plateau** (une seule pièce : face
au plateau) ; (V de soudure au dos essayé puis **retiré le 2026-10-21** à la demande de Théo — ne pas le remettre) ; trait
sans âme = collage bout à bout + alerte « trop mince » (`seg.x/y.joints`) · **coutures adaptatives** (2026-10-21, remplacent
les coupes droites + `refineGrid`) : nombre de pièces par sens = le minimum ; position de départ = pièces de même largeur (ou
`P.cuts = { x: [fractions], y: [fractions] }` glissées, un sens peut rester auto) ; marge ±`SEAM_BAND` 60 mm bornée par le
jeu des pièces voisines (chaque pièce tient sur le plateau) ; chemin par programmation dynamique sur une grille ~0,7 mm
(matière ×41, sans âme ×201 → un trait se traverse à angle droit, là où il est étroit ; matière dans la zone du tenon = trait
longé, pénalisé) ; puis `SEAM_PASSES` passes : les **morceaux seuls** d'une pièce (pas le plus gros) sont pénalisés et le
chemin recalculé ; `seg.x/y = { cuts (positions de départ), lo, hi, seams: [polylignes x,y mm], joints }`, `seg.loose`,
`list[].frags` (0 = case vide, absente du 3MF), `D.sx/D.sy` = coutures internes `{u, v}` (`seamAt`) ; découpe 3D le long
d'une couture : `cutS`/`slabS` (côtés de contour coupés aux sommets de la couture avant le test → un seul croisement par
morceau) ; au croisement, la pièce du bas à droite garde parois + peau et celle du haut à gauche y prolonge son tenon
(`zones` × `zones`) ; brouillon (glissement) = coutures droites · `extrude` : parois tirées du **bord des triangles**
d'earcut (pas des anneaux) → maillage fermé même avec points alignés ou pincements · 3MF = un objet par pièce (« Pièce A1 »),
maillages fermés (tests : arêtes appariées, volumes, rayons verticaux sans chevauchement ; seuls vides = jeu de 0,2 mm) ·
DXF R12 en mm, y vers le haut · **retouches** (mode Édition, 2026-10-21) : `P.edits` en **px de l'image de travail**
(stables au recadrage et à la taille), appliquées par `applyEdits` au masque rendu **au début de l'étape C** (clé C +
`geoKey` incluent les retouches) ; fill = vide fermé → plein (refus si la zone touche le dehors) ; empty = cœur plein vidé,
contour de la largeur médiane des traits (`typicalWidth`) ; line = **arête sans épaisseur** (`edgeFill` : mur d'un pixel,
les vides coupés sont remplis sauf ceux qui donnent sur le dehors, sinon refus « ferme ») ; ses bouts sur une pointe de trait
(`tipDir`) partent dans le prolongement du trait (`spline` à bouts imposés, Hermite) depuis le bord extérieur, et le milieu
suit les traits qui la longent (`hugNeighbours`, ≤ 2 mm) ; une ligne ou le pinceau ajoutent 10 mm de marge au masque
(clé A) ; paint / erase = rond à main levée, diamètre `s` mm ; **aucun pont ne traverse un trait de gomme**
(`facingBridges(…, forbid)`) ; `res.tips` = bouts de traits (`strokeTips`) pour l'aimant · **prompt IA** (étape ①, UI
seulement) : texte anglais rédigé à partir de la largeur / hauteur, Trait max, Trait min. et Trou min. ; aucune API.
· **fond** (étape ⑤ « Fond & couleurs », 2026-10-22) : `P.back` none | contour | rect, `backT` (épaisseur, déf. 2 mm),
`backM` (marge, déf. 5 mm) ; `stageF` (après le masque final) : contour = trous bouchés + dilatation `edt` de M, rect =
rectangle arrondi (`BACK_R` 3 mm) ; anneaux en mm **repère de la pièce** (y vers le bas, comme `E.rings`, décalage
`(bx0+p)·r` soustrait) ; `res.back = { rings, box, T, volume }` ; z −Tb..0 (côté mur), coupé aux **mêmes coutures** que la
pièce (`seg.back`) ; 3MF = objets « Fond A1 » **face au plateau** (z 0..Tb) après les pièces ; SVG `<path id="fond">` dessous
+ viewBox élargie ; DXF calque `FOND`. **Couleurs** `colPiece` / `colBack` = hex visuels seulement (Mur, 3D, SVG) : menus
`CA.pick` remplis par `products` `type=filament`, `brand='Bambu Lab'` (`products.hex`), ordre `CA.materials.list` puis
`sort_order` ; défauts PLA Basic noir / blanc ; défauts admin (`DEF_COLS`) = **id du produit**, pas le hex ;
`CA.silhouettes.setFilaments(list)` = crochet de test.

### 2.15 Centre d'aide (tutoriels, 2026-10-22)

- Moteur partagé **`aide.js`** (`CAAide.mount(root, {groups, tutos, get, set})`) + **`aide.css`** (`.ah-*`, couleurs = jetons → suit l'accent admin).
- Public : `aide.html` + `aide-public.js` (tutos clients, URL `#/<id>`) ; lien « Centre d'aide » dans le pied de **chaque** page publique (boutique/spacers/*.html : réécrit en `../../aide` par `tools/build-spacer-pages.js` depuis boutique/spacers.html) + bouton « Aide » de l'en-tête de Mon compte ; `sitemap.xml`.
- Admin : onglet **Réglages › Aide** (`cms-aide.js`, URL `#aide/<id>`) + bouton **?** injecté avant `#theme-toggle` → 1er tuto dont `tab` = `body[data-tab]`.
- ⚠ Les étapes citent les **libellés exacts** des boutons (`[Bouton]`) et les routes `#onglet/sous-onglet` (« Y aller ») : renommer un bouton, un onglet ou un sous-onglet → mettre à jour `cms-aide.js` / `aide-public.js`.
- `cms-aide.js` ne doit jamais être chargé par une page publique (il nomme les onglets de l'admin, pas la page).

### 2.16 Plages de cueillette (2026-10-22)

- **Réglage** : `admin_settings['cueillette']` `{ week:{"1".."7" (jour ISO) : [{s,e}]}, closed:[{from,to}], extra:[{d,s,e}], cap (0 = illimité), notice (h, 24), days (14, max 60) }`
  — écrit par **Commandes › Cueillettes** (`cms-cueillettes.js`, `#commandes/cueillettes`), lu **seulement côté SQL** (`_pickup_slots`, heure `America/Toronto`).
- **Confirmation (2026-10-28)** : `pickup_confirmed_at` (les deux tables) = cueillette confirmée par Théo ; remis à `null` par `customer_set_pickup` / `admin_set_pickup`, posé par `admin_confirm_pickup` (bouton « Confirmer » des cartes, `CA.confirmPickup`) et par `admin_decide_pickup` (approbation). Courriel `confirmed`/`approved` = EF `pickup-request-notify` (adresse = `admin_settings['cueillette'].address`, champ « Adresse de ramassage »). `me_orders`/`me_reservations` renvoient `pickup_confirmed` + `pickup_address` (adresse seulement si confirmée). `pickup-notify` n'envoie plus qu'un accusé « demande reçue ». **EF pas encore déployées** (attendre le push).
- **Colonnes** `pickup_date`, `pickup_start`, `pickup_end`, `pickup_notified_at` sur `customer_orders` **et** `customer_reservations`.
- **RPC** : `pickup_slots(p_until, p_self)` → `[{d,s,e,full}]` (plage pleine = `cap` atteint par commandes Nouvelle→Prête + réservations actives) ;
  `customer_submit_order` / `customer_update_order` / `customer_reserve` prennent `p_pickup` ; `customer_set_pickup(p_kind, p_id, p_pickup)` (Mon compte, jusqu'à Facturée) ;
  `me_orders` / `me_reservations` renvoient la plage (HH24:MI).
- **Règle** (révisée le 2026-10-22) : **plus de sélecteur au panier** — après l'envoi, `goPickup(kind,id)` (boutique.js / spacers.js) redirige vers
  **`compte.html#/cueillette/c|r/<id>`** (écran « Ma cueillette », `renderPkv` dans compte.js, panneau `#acct-pkv`, styles `.pkv` dans compte.css) : la commande à gauche,
  grand calendrier à droite (`picker(host,{big:true})` → `.pk-lg`). Commande avec articles à commander (`has_backorder`, pas Prête) → même écran sans calendrier.
  `p_pickup` reste **facultatif** à l'envoi (migration `pickup_optional_at_submit`) ; réservation : plages
  **avant l'échéance** (`p_until`). **Aucune plage réglée → rien d'exigé, aucun sélecteur** : le serveur reste la référence (le navigateur ne fait que suivre).
- **Client** : sélecteur `CA.custOrder.picker` (`commande-client.js` + **`cueillette.css`**, chargé par boutique.html, boutique/spacers.html, compte.html) ; la plage est envoyée
  à `customer-order-notify` / `reservation-notify` (courriels « Cueillette : … ») ; changement → EF `pickup-notify`.
  Les courriels « reçue » (tout en stock, sans plage), « Prête » (`customer-order-notify`) et « Cueillette confirmée » (`pickup-notify`) pointent vers
  `#/cueillette/c|r/<id>` → **garder la regex `ROUTE` de compte.js** (`cueillette/(c|r)/<uuid>`) synchronisée avec ces liens.
- **Admin** : ligne `.co-pk` sur les cartes (`CA.pickupLine` / `CA.fmtPickup` / `CA.hourTxt`, définis dans `cms-commandes-clients.js`, réutilisés par
  `cms-reservations.js` et `cms-cueillettes.js` → **charger cms-commandes-clients.js avant**). Grand écran : sous-onglets réduits à [Commandes] (`data-cosub="all"`) | [Cueillettes].
- **Heures aux 15 min** (2026-10-25) : `_pickup_slots` découpe chaque plage réglée en heures d'arrivée (12:00, 12:15… fin − 15 min), `e` = null →
  `pickup_end` reste vide et tous les affichages (picker, courriels, admin) montrent l'heure seule. `cap` = clients par heure de 15 min. Le picker saute une rangée (`.pk-gap`) entre deux plages.
- **Demande d'exception** (2026-10-26) : colonne `pickup_req` jsonb `{d,s,note,at,state:'pending'|'refused',reply}` sur `customer_orders` **et** `customer_reservations` (renvoyée par `me_orders`/`me_reservations`).
  RPC `customer_request_pickup(kind,id,req)` (client : tous les jours (week-end inclus), aujourd'hui ou plus tard, hors plages/préavis/capacité ; l'ancienne plage reste valide) et `admin_decide_pickup(kind,id,ok,reply)` (admin : approuver = `pickup_*` ← demande, `pickup_end` vide ; refuser = `state:'refused'` + mot).
  EF `pickup-request-notify` (events request → admin + accusé client ; approved/refused → client, admin aal2). Client : bouton « Demander une exception » dans « Ma cueillette » (`CO.requestPickup`, compte.js `exView`). Admin : `CA.pickupLine` ajoute Approuver/Refuser, `CA.bindPickupReq` (cartes Clients en ligne + Réservations), tag « Exception » + pastille dans Cueillettes.
- **Jours/heures fermés** (2026-10-28) : `cueillette.off` `[{d, all:true} | {d, h:["16:00",…]}]` — écrit par la bande de dates de Cueillettes (`#cq-cal`, `paintCal`), filtré dans `_pickup_slots` (heures `HH:MM` d'arrivée). À l'enregistrement, `warnBooked` signale les cueillettes déjà prises dans une heure fermée (rien n'est annulé).
- **Cueillette d'une facture « À venir »** (2026-10-31) : 3e « kind » `invoice` (lettre `f`, route `#/cueillette/f/<id>`) à côté de `order` (`c`) et `reservation` (`r`). Colonnes `invoices.pickup_date/start/end`, `pickup_ready_at` (admin a prévenu), `pickup_notified_at`, `pickup_confirmed_at`. RPC `admin_pending_invoices()` (par facture : n_tot / n_in reçus, compte lié, état) et `admin_invoice_ready(p_id)` (exige lignes à venir + compte lié `customers.client_id`) ; `customer_set_pickup` (branche `invoice` : facture à soi, finale, à venir, `pickup_ready_at` posé), `admin_set_pickup` / `admin_confirm_pickup` ; `_pickup_slots` compte les factures à venir qui ont une plage ; `me_invoices` renvoie `pickup_ready/date/start/confirmed/address`. **Pas d'exception** pour une facture (`customer_request_pickup` / `admin_decide_pickup` inchangés). Prêt = pour chaque (produit, bobine/recharge) `least(somme à venir, stock)`, ligne sans produit = reçue. Admin : alerte de réception (`cms-reserves.js`, bouton « Prévenir X » grisé tant que tout n'est pas là → `CA.reserved.notifyInvoice`), Historique (`.hd-pickup`, `paintPickup`), Commandes › Cueillettes (3e requête, badge « Facture », `kind:'inv'`). Courriels : EF `pickup-request-notify` event `ready` (« tes articles sont arrivés », lien `compte.html#/cueillette/f/<id>`) puis `confirmed`. Client : `invoiceView` + `renderPkv` (compte.js). ⚠ Regex `ROUTE` de compte.js = `([crf])`.
- **Commande hors site** (2026-11-18, refaite le jour même : plus de « Nouvelle commande » dans Commandes) : Facturation, bouton `#fx-to-order` « Envoyer dans les commandes » (`cms-facturation.js` : `sendToOrders`/`syncToOrder`/`manualTarget`, masqué en usage interne/Amazon, en modification et sur une commande non manuelle) → `CA.rememberClient(clientFields())` (fiche `clients`) puis RPC `admin_save_manual_order(p_order, p_client, p_lines, p_note, p_pickup{d,s,e})` : lignes **telles quelles** (prix saisis, lignes libres `kind 'free'`, `pack` jsonb), `qty_to_order` = au-delà de `products_public`. Rouverte par Commandes « Facturer » ou « Modifier » (manuelle → même chemin, `invoiceFromOrder`) : le bouton devient « Mettre à jour C-… » (`p_order`, lignes remplacées ; la note « Commande C-… — » est retirée avant l'envoi). Champs : `customer_orders.manual = true`, `client_id` = fiche `clients`, `customer_id` null, `email` facultatif (colonne nullable), statut Prête, `stock_hold`, cueillette confirmée d'office, `ready_notified_at` posé. **Aucun courriel** : tick (`not manual` dans le rappel 1 h) + EF `customer-order-notify` (`.eq("manual", false)`, à redéployer), bouton « Remettre Nouvelle » masqué. Facturer : `admin_invoice_customer_order` met `invoices.client_id = o.client_id` ; note de facture « Commande C-… » (`order.manual`, cms-facturation.js). Lier : même `client_id` ou même courriel (`admin_link_orders` + `candsOf`). `admin_set_pickup(…, p_e)` : fin de fourchette facultative (commandes), `CA.editPickup` champ `#pke-e`, commande manuelle = saisie libre directe. Démo : `.claude/demo/admin-manual-order-demo.html`.
- **Téléphone + paiement** (2026-11-11) : `cueillette.phone` / `cueillette.interac` (champs `#cq-phone` / `#cq-interac` dans Cueillettes) → RPC `pickup_contact()` (authenticated) lue par compte.js `paintContact` (écran « Ma cueillette », visible dès la commande, repli 581 446-3858 / contact@creationaudio.ca) et par EF `pickup-request-notify` (courriel confirmed/approved, mêmes replis). Ligne statique `.cart-pay` « Paiement à la cueillette » sous le total du panier (boutique.html, boutique/spacers.html → pages spacers, boutique/imprimantes.html).
- ⚠ Format des jours (lundi = "1", dimanche = "7") et des heures (`HH:MM`) partagé entre `cms-cueillettes.js` et `_pickup_slots` : changer l'un = changer l'autre.

### 2.17 Nouvelles (promos, événements, nouveautés, mises à jour — 2026-10-22)

- **Table** `news` (schema-v2.sql § NOUVELLES) : `kind` (promo | event | new | update), `title`, `body`, `image_path` (bucket `products`, dossier `news/`),
  `cta_label`/`cta_url`, `promo_code`, `event_at` (date), `starts_at`/`ends_at`, `featured`, `in_bar`, `active`, `sort_order`, `updated_at`.
  **RLS** : anon lit seulement `active` + dans ses dates ; admin = tout. Rien n'est effacé tout seul (Historique dans l'admin).
- **Admin** : onglet **Accueil › Nouvelles** (`data-tab="nouvelles"`, visible à toutes les largeurs, contrairement à Aujourd'hui) — `cms-nouvelles.js`
  (En ligne / Programmées / Historique, glisser = `sort_order`, une seule `featured` : l'enregistrer retire l'étoile aux autres). Dates : début 00:00, fin 23:59:59 locale.
- **Public** : `nav.js` (2e IIFE) → `CA.loadNews()` (REST anon, une fois ; charge `supabase-config.js` si la page ne l'a pas), `CA.newsImg`, `CA.newsHref`
  (lien relatif → `CA.siteRoot`, schémas autres que http/mailto/tel refusés), `CA.newsKinds`. La **barre** `.promo-bar` défile les `in_bar` ; ✕ =
  empreinte ids+`updated_at` dans localStorage `ca-news-closed` (modifier une nouvelle de la barre la fait revenir) puis le texte habituel revient.
  **Accueil** : section `#nouvelles` (caché si vide) rendue par `accueil.js` `renderNews()` — vedette + liste, clic = passe en vedette, « Copier » du code.
- **Couleurs de type** `--nw-promo|event|new|update` + classes `.k-*` : définies **deux fois** (site.css pour le public, admin.css pour l'admin) — garder en phase.
- ⚠ Colonnes lues par `nav.js` (`COLS`) : ajouter une colonne à `news` = l'ajouter là si le public doit la voir.
- **Date affichée** (2026-10-28) : `published_at`, posée par le déclencheur `news_published` à la 1re mise en ligne (active et pas proposée).
  Accueil (`accueil.js` `newsDate`, `.news-date` à droite de la rangée du tag) et admin (`whenText` « Publiée le … ») affichent la plus tardive de `published_at` / `starts_at`.
- **Propositions de Claude** (2026-10-22) : `proposed = true` + `active = false` (la RLS publique exige `active` → invisible). Groupe **Propositions**
  en tête de l'onglet : Publier (`proposed=false, active=true`) / Modifier (enregistrer = la reprendre, `proposed=false`) / Rejeter (suppression).
  Claude les dépose par `execute_sql` (insert) après chaque changement visible des clients déjà **poussé** — vouvoiement, ton chaleureux et pro.
- **Visuels** (2026-10-22) : Claude rend un PNG 1200×630 par proposition (`tools/news-visuals/rendre.ps1` + `gabarit.html`, Edge sans interface) dans `assets/news/<id8>.png` et met `image_path = 'assets/news/<id8>.png'`. Un `image_path` commençant par `assets/` = fichier du dépôt (nav.js `CA.newsImg`, cms-nouvelles.js `publicUrl`/`removeImg` : jamais supprimé du stockage). ⚠ Visible seulement après push de l'image.

### 2.18 Thème des fêtes (décors légers depuis le 2026-11-06)

- **Réglage** : `admin_settings` clé `fetes` `{ on, from, to, at }` (dates AAAA-MM-JJ, bornes incluses, heure du visiteur) — carte **Réglages › Apparence**
  (`cms-fetes.js`, ids `#fe-*` ; ⚠ préfixe `fe-`, pas `fx-` = facture). Lu en anon par la RPC **`public_fetes()`** (schema-v2.sql § THÈME DES FÊTES,
  security definer, ne renvoie que on/from/to). Réglage de départ inséré : 1er déc. 2026 → 6 janv. 2027, activé.
- **Chaîne publique** : `<head>` de chaque page publique = `<link fetes.css>` + **mini-script** identique partout (pose `html.fetes` avant le rendu d'après
  localStorage `ca-fetes` `{a, b}` en ms, ou l'aperçu `?fetes=1|0` → sessionStorage `ca-fetes-voir`) → `nav.js` (3e IIFE) relit `public_fetes`, met le cache à jour,
  corrige la classe et charge `fetes.js?v=FETES_V` (décors). `nav.js` expose `CA.supaCfg` (config Supabase, charge `supabase-config.js` au besoin).
- **Pages qui l'ont** : index, boutique, boutique/spacers (+ `boutique/spacers/*.html` régénérées depuis boutique/spacers.html par le robot — le `<head>` suit tout seul), compte, aide,
  conditions, confidentialite, retours, 404 (`/assets/`). **Pas** dealer.html (choix de Théo) ni l'admin. Nouvelle page publique → copier les 3 lignes du `<head>`.
  **revendeur.html** (page sombre « Atelier ») charge nav.js mais pose `data-fetes-off` sur `<html>` → la 3e IIFE de nav.js sort tout de suite (pas de décors).
- **fetes.css** : tout sous `html.fetes`, **décors seulement** (neige, bouton ❄, guirlande, sapin du héros, sapins du pied de page) : fond blanc, orange et couleurs du site inchangés (choix de Théo, 2026-11-06). Ne plus y remettre de palette, de fond ou de texte recoloré. Images : `assets/img/fetes/` (`village.svg` = sapins sans cadeaux ; `flocons.svg` et `sapins-loin.svg` restent pour `tools/news-visuals/gabarit.html`).
- **fetes.js** dépend de : `.home-top` / `.home-account` / `.drawer-cta` (bouton ❄, localStorage `ca-fetes-neige`),
  `#spool` + `#rail .sw[style*=--sw]` + `aria-pressed` (sapin ; enveloppe `#spool` dans `.xm-spool-wrap`), `.site-foot` (village).

- **Choix du visiteur (2026-11-02, activé d'office, refusable)** : localStorage `ca-fetes-off` = '1' refusé / '0' gardé ; `ca-fetes-vu` = bandeau répondu. Le mini-script du
  `<head>` des 9 pages (+ boutique/spacers/*, en/*) ajoute `&&localStorage.getItem('ca-fetes-off')!=='1'` (⚠ à recopier sur une nouvelle page publique). `nav.js` (3e IIFE) :
  `CA.fetesChoice` { inWindow, stored, set(off, quiet) } ; `set()` du thème ignore l'état « activé » si refusé (sauf aperçu `?fetes=1`) ; bandeau `.fetes-ask` (1,2 s après
  le chargement, seulement dans les dates, une fois) + bouton `.foot-fetes` inséré dans `.foot-bottom-inner` ; événement `ca-fetes-choice`. Styles dans **site.css** (pas fetes.css,
  qui ne vaut que sous `html.fetes`). **look.js** : `mount(el, { fetes: true })` (compte.js seulement, pas le dealer) ajoute la rangée Activé/Désactivé (visible dans les dates) ;
  copie dans `user_metadata.look.fetes = false` (absent = gardé) ; `clean()` conserve la clé (sinon le portail dealer l'effacerait à l'enregistrement) ; sur un nouvel appareil le
  refus du compte s'applique tant qu'aucun choix local n'existe, ensuite l'appareil l'emporte. Textes FR/EN : i18n-en.js § « nav.js : choix du thème des fêtes ».

### 2.18b Fond du portail dealer (2026-10-27)

- **Réglages › Apparence** est en 3 sections (`h2.set-sec`) : **Admin** (accent), **Thèmes de fêtes · site public** (carte « Noël » ; une carte par fête à venir),
  **Portail dealer** (carte « Couleur du fond », `cms-dealer-fond.js`, ids `#dt-*`).
- **Chaîne** : `admin_settings` clé `dealer_theme` `{ bg, at }` → RPC anon **`public_dealer_theme()`** (schema-v2.sql § FOND DU PORTAIL DEALER, ne renvoie que `bg`)
  → `dealer.js` `loadTheme()` (dans `boot()`) → `window.caDealerBg(hex)` (script en ligne du `<head>` de dealer.html, rejoué depuis localStorage `ca-dealer-bg`
  avant le rendu) → `--dl-bg` + classe `html.dl-light` → variables `--dl-fg*`, `--dl-veil*`, `--dl-tabon-*` dans dealer.css.
- ⚠ **Seuil clair/foncé 0.35 codé à deux endroits** : `caDealerBg` (dealer.html) et `DT_LIGHT` (cms-dealer-fond.js, aperçu). Défaut `#3A3E45` aussi en double
  (dealer.css `:root` et `DEFAULT` du module). Un nouveau texte posé directement sur le fond du portail → utiliser `var(--dl-fg…)`, sinon illisible sur fond clair.

### 2.18c Thème arc-en-ciel (2026-10-29 — « troll » débloquable)

- **Public (comptes clients + portail dealer)** : accent `arc` dans `user_metadata.look` `{ mode, accent, rainbow }` ; `rainbow:true` = **débloqué pour de bon**
  (bouton « J'aime les arcs-en-ciel » en bas de la carte Apparence → `caDialog.confirm` « Êtes-vous sûr ? » Non/Oui → confettis + appliqué tout de suite).
  `look.js` `clean()` n'accepte `arc` que si `rainbow===true` ; « Revenir à l'origine » remet orange + clair **sans** reverrouiller (`DEF` n'a pas la clé `rainbow`).
  Le payload `save()` doit garder `rainbow` (sinon `updateUser` l'écrase et reverrouille). Les fêtes l'emportent (`html.fetes` → `DEF`, donc pas d'arc-en-ciel).
- **Admin** : pas de déblocage — pastille « Arc-en-ciel » directe dans Réglages › Apparence ; `admin_settings.apparence.accent = 'rainbow'` (au lieu d'un hex) + localStorage `ca-accent`.
  `admin-accent.js` `norm()` renvoie `'rainbow'` ; le `<head>` de `coulisses-t6avzpe2.html` rejoue `data-rainbow` + le `<link>` avant le rendu (sinon éclair orange).
- **Rendu** : jetons d'une **ancre fixe `#4C9AFF`** (`ARC_HEX`, **codée en deux endroits** : look.js et admin-accent.js) → bordures/liens/cases restent bleu uni ;
  `assets/rainbow.css` (tout sous `html[data-rainbow]`) met un **dégradé des 7 couleurs qui glisse** sur les surfaces pleines (listes de sélecteurs dans le fichier ;
  texte « encre » AA ≥ 5,8:1 sur chaque teinte). **Un nouveau bouton / souligné / pastille plein `var(--ember)` → l'ajouter à rainbow.css.**
  look.js charge la feuille via `document.write` (bloquant, pendant le `<head>`) puis `<link>` ; son URL = `look.js?v=` remplacé par `rainbow.css` → **bumper `look.js?v=`
  quand rainbow.css change** ; admin : `RB_HREF` (admin-accent.js) et le `<head>` de l'admin portent `rainbow.css?v=1` en dur.
- **Pastille** : `.look-dot-arc` (site.css) et `.acc-sw[data-hex="rainbow"]` (admin.css) = `conic-gradient` fixe. Anglais : `_t()` + i18n-en.js (« I love rainbows », « Are you sure? »).

### 2.19 Version anglaise du site public (/en/ — 2026-10-26)

- **Le français reste la source.** `en/*.html` = **générées** par `tools/build-en.js` depuis les pages FR (dictionnaire `tools/i18n/pages.en.json`, clé = texte FR
  exact, espaces compactés ; absent → le FR reste + `tools/i18n/missing.json`). `en/boutique/spacers.html` + `en/boutique/spacers/*.html` = `tools/build-spacer-pages.js` (2e passe
  `buildLang('en')` : gabarit boutique/spacers.html traduit par `translatePage`, catalogue rendu avec `i18n.js` + `i18n-en.js` dans le vm, `seoTextsEn`). ⚠ **Ne jamais
  éditer `en/` à la main** ; modifier une page FR → relancer `node tools/build-en.js` (le robot « Pages spacers » le fait aussi, déclenché par `*.html`,
  `i18n*.js`, `tools/i18n/**`, et commite `en/`). Nouvelle page publique → l'ajouter à `PAGES` de build-en.js + ses textes au dictionnaire + sitemap (FR et `/en/`).
- **Scripts** : `assets/i18n.js` chargé en premier partout (FR compris) → `CA.lang` (d'après `<html lang>`), `CA.t(fr, {vars})`, `CA.tn`, `CA.money` (12,99 $ / $12.99),
  `CA.priceShort`, `CA.locale`, `CA.tr/trm/trs` (textes de la base), `CA.langHref`, lien `[data-lang-switch]` + bandeau « available in English » (jamais de redirection,
  choix gardé dans localStorage `ca-lang`). `assets/i18n-en.js` (seulement en/ ; `CA_EN_V` = son `?v=`, lu par build-en.js) = dictionnaire `[fr, en]`.
  Modules : `var _t = CA0.t || repli` → **un texte affiché = `_t('…')`** (littéral, sinon `node tools/i18n/check-js.js` ne le voit pas ; ex. palette de repli
  d'accueil.js listée à la main). Partagés avec l'admin (dialog, aide, auth-gate) : l'admin ne charge pas i18n.js → repli français ; ne pas y utiliser `{vars}`.
  Liens absolus vers une page (`/compte.html`, `a.ask`) → préfixer `/en` quand `EN` (spacer-catalog `askLink`).
- **Textes de la base** : colonne `i18n` (products, materials, news) marquée `stale` par le déclencheur `_i18n_mark` (empreinte md5 du FR, `_i18n_src`) ;
  cron **`i18n-tick`** (5 min) → Edge Function **`translate`** (claude-haiku-5-5, secret **`ANTHROPIC_API_KEY`**) → `i18n_save` (n'écrit que si le FR n'a pas
  rechangé). Exposé par `products_public.en` / `.material_en` et `products_dealer.en` (alerte deps.js « attrs.en » = faux positif : repli `attrs.en` de `CA.tr`).
  Nouveau champ texte affiché → l'ajouter à `_i18n_src` + au prompt de `translate`. Les pages spacers statiques prennent `p.en` au passage du robot (6 h).
- **Courriels dans la langue du client** : `customers.lang` / `dealers.lang` posés par la RPC **`me_set_lang`** (compte.js, messagerie.js, commande-client.js,
  depuis `CA.lang`) ; `waitlist.lang` via `waitlist_subscribe(p_lang)` ; compte-code reçoit `body.lang`. Lu par customer-order-notify, pickup-notify, message-notify,
  reservation-notify, waitlist-notify (liens `/en/…`). Les avis **à l'admin restent en français**. Nouveau courriel client → branche EN + lien `SITE + '/en'`.
- **SEO** : `hreflang` fr-CA / en-CA / x-default dans chaque page (fiches spacers : vers leur jumelle), canonical `/en/…`, `og:locale en_CA`, sitemap FR + EN.
- **En-tête** : le bouton FR/EN (`.home-lang`) prend ~60 px → sous 1100 px liens resserrés, gap 14 px et **Dealer en icône seule** (site.css) ; masqué sous 960 px
  (lien « English / Français » dans le tiroir), sauf portail dealer.

### 2.20 Atelier : Boîtes (calculateur de boîtes de sub, 2026-10-26)

> Coude adouci (évent en L) : `P.port.soft`/`rad` → `slotLayout` (`chamf`, `rad`) → panneaux à `poly` (+ `notes` → `pieces`) → `prismXZ` (3D) et plan SVG ; anciens projets sans ces clés = adouci par défaut.

Onglet `#boites` (groupe Atelier) — outil **interne** (les caissons restent retirés du site public). Calculs 100 % navigateur.

| Pièce | Rôle | Lien fragile |
|---|---|---|
| `assets/box-engine.js` (`BoxEngine`, sans DOM) | T/S complétés (`completeTS`), câblage (`wirings`/`electrical`), géométrie (subs, fente droite / en L, évents ronds, renfort, panneaux + `ex` d'éclatement), simulation (SPL, Xmax, vitesse d'évent, Z, phase, délai de groupe, puissance max, gain de cabine), assistant `propose()` (`GOALS` sq / daily / sql / spl, `VEHICLES`), coupes guillotine (`cutlist`), fractions (`frac`) | Unités SI partout (m, m³, m²) ; l'UI convertit. Les messages d'erreur portent un code (`g.errK` : size / width / height / depth / port / net) **lu par `propose()`** pour agrandir la boîte → changer un code = revoir la boucle de l'assistant |
| `assets/box-subs.js` (`BoxSubs`) | Bibliothèque **Sundown seulement** (54 entrées, séries E v.7 … SML), recommandations du fabricant (`recSealed`, `recPorted`, `recTune`) | `id` (ex. `sd-sa12v3-d2`) = clé gardée dans les projets (`sub.ref = 'lib:<id>'`) → **ne jamais renommer un id** ; défaut de l'onglet : `sd-sa12v3-d2` |
| `assets/cms-boites.js` + `boites.css` | UI : 5 étapes (l’étape « Objectif » est retirée ; véhicule + gain de cabine dans l’étape 1 ; `proposeNow()` garde l’assistant en arrière-plan avec les défauts daily / auto), aperçu 3D (WebGL maison) / plan SVG coté, courbes + superpositions (≤ 3), coupes sur feuilles, feuille d'atelier imprimable (`#bx-printout`) | `.fx-seg` ciblés **par id** (pas `.al-defs` / `.al-view`, lus par cms-autoloop) ; `CA.pick` sur tous les selects ; `caDialog` pour confirmer ; `CA.onTab` chaîné ; palette des courbes `--s1..--s4` sans orange (accent réglable) |

- **Tables** (schema-v2.sql § « CALCULATEUR DE BOÎTES ») : `box_subs` (id, brand, model, `data` jsonb = fiche T/S complète) = « Mes subs » ;
  `box_projects` (id, name, `params` jsonb `{ v:1, D (sans rec), sub:{ ref, data, dirty } }`). RLS **admin seulement**, aucune lecture anon.
  Un projet garde **sa copie** de la fiche (`sub.data`) : supprimer un sub de Mes subs ou modifier la bibliothèque ne casse pas un projet ouvert.
- **localStorage** : `bx-draft` (`{ D, proj, dirty, recDirty }`, brouillon du projet courant) · `bx-prefs` (unités, fractions, vue, courbe, cabine, transparence, cotes).
  Sans brouillon, l'onglet propose une boîte de départ (`proposeNow()` + `applyProp()`) pour le sub par défaut ; « Nouveau » fait de même.
- **Espace max + ratio d'évent** (2026-10-26) : `D.max` {w,h,d} = plafond strict (`capDims()` + `cap` des champs + `propose()` borne `P.w`) ; `S.max = maxCalc()` → « Net max » + « Accord min » (bissection sur fb, l'évent doit tenir : `errK.port`/`depth`). `D.ratio` (po²/ft³, stocké en impérial, affiché cm²/L en mm via `RATIO_MM`) → `portToRatio()` résout largeur de fente / diamètre par **bissection** (un évent plus large mange du volume : une itération simple oscille) ; champs pw/dp en lecture seule (`portUI()`). `propose()` lit `inp.area` = ratio.
- **Double façade** (2026-10-26) : en recouvrement, la façade 1 recouvre les chants, la **façade 2 est toujours encastrée** entre les côtés (`panels()` : `zf`/`zfL`/`mz0` = `t`, largeur de la 2e = `g.baffle`). Volume net inchangé ; seules changent les coupes (côtés 1 `t` plus longs, façade 2 plus étroite de 2 `t`, mur d’évent plus long de `t`).
- **À venir** (dans le select, désactivés) : bandpass 4e, radiateur passif, bandpass 6e, biseau → nouveau type = `geometry` + `panels` + `simulate` du moteur, puis 3D, plan et coupes.

### 2.21 Inscription revendeur (/revendeur — 2026-10-28)

**Adresse complète (2026-11-05)** : le formulaire demande adresse, ville, province (`CA.pick`, ca-pick.js), code postal. Comme la fonction Edge `dealer-request` ne laisse passer que ses champs connus, `revendeur.js` envoie `city` = « adresse | Ville, QC G1A 1A1 » (120 car. max) ; `dealer_request_submit` sépare sur « | » vers `dealer_requests.address` + `city` ; `admin_dealer_request_decide` copie les deux dans `dealers` ; `dealer_ship_address` les relit pour préremplir la livraison (§ 2.26). Ne pas changer ce format d'un seul côté.

Chaîne : `revendeur.html` (formulaire) → `revendeur.js` POST `/functions/v1/dealer-request` `{ action:'submit', hp, lang, … }` (clé anon)
→ RPC `dealer_request_submit` (limite par IP → `wait`) → table **`dealer_requests`** (schema-v2.sql § DEMANDES D'ACCÈS REVENDEUR ; RLS admin seulement ;
refusées purgées après 90 j) + courriel « demande reçue »
→ admin › Dealers (`cms-dealers.js`) : section « Demandes d'accès » + pastille `#nav-dealers-n` (relue aux 60 s) → Approuver = EF `decide` → RPC
`admin_dealer_request_decide` (ligne dans `dealers`) + courriel de bienvenue · Refuser = statut seulement, **aucun courriel** → le dealer se connecte sur dealer.html par code (§ 2.7).

| Pièce | Lien fragile |
|---|---|
| Champ piège `hp` (`.rv-hp`, hors écran) | Rempli = l'EF répond `ok` **sans rien enregistrer** → ne jamais le rendre visible ni `required` |
| Réponses `submit` : `new` / `pending` / `dealer` / `wait` | `revendeur.js` `done(kind)` affiche un écran par réponse ; un nouveau code de retour = l'y ajouter (FR + i18n-en.js) |
| Cartes de la gamme | `products_public` (type spacer) + `CASpacers.fitmentOf/sizeOf/speakersOf` → **aucun prix ni seuil de palier** sur la page (choix de Théo : « Rabais sur la quantité » seulement, barres sans chiffres) ; ne pas y lire `products_dealer` |
| Liens vers /revendeur | pied de page des pages publiques, carte `.bn-dealer` de l'accueil, connexion dealer (`not_dealer`, porte), sitemap, `build-en.js` (PAGES), case « Vous êtes une entreprise ? » (`.biz-rail`, 2026-11-06) |
| Case entreprise `.biz-rail` | Source = bloc `<!-- biz … /biz -->` de `boutique/spacers.html` ; `build-spacer-pages.js` (`bizOf`) le recopie sur chaque fiche FR + EN → garder ces balises. Styles dans `boutique.css` (marge gauche collante dès 1780 px, bandeau en dessous : re-mesurer si `--maxw` change). Textes dans `tools/i18n/pages.en.json`. Aucun seuil ni % (paliers secrets) |
| Jetons `.rv` (revendeur.css) | Page sombre à part : couleurs en variables `--rv-*`, accent = `var(--ember)` ; ne pas y charger site.css |

### 2.22 AutoLoop : onglet Fichiers = bibliothèque de plateaux (2026-10-29, refait 2026-11-16)
Fichiers d’UN loop, une carte par spacer, plusieurs versions ; admin seulement. Code : `cms-autoloop-files.js` (`window.ALFiles`), chargé AVANT `cms-autoloop.js`.
| Élément | Détail |
|---|---|
| Bucket `autoloop` (PRIVÉ) | `<uuid>.gcode.3mf` (ou `.gcode`) ; policies admin ; 50 Mo max ; `tmp/` = ouvertures Bambu Studio (vidé après 24 h) |
| Table `autoloop_plates` | une ligne = une VERSION : `name`, `spacer_id` (deviné comme Production : nom, n° remplacés, alias), `sort` (ordre dans la carte), `client` jsonb `{kind,id,label}` (dealer = email, customer = id), `meta` jsonb (lu du fichier : murs, remplissage, couches, g, min, vignette `thumb` data:png…, `v` = version du lecteur `META_V`), `settings` (réglages AutoLoop du Générateur) |
| Version par défaut | première dans l’ordre SANS étiquette client (sinon la première) — `ALFiles.defaultOf` ; nouvel envoi = `sort` min − 1 (en haut) |
| Ordre des cartes | `admin_settings` « autoloop_cards » = `{ order: [spacer_id…] }` ; absents → `products.sort_order` |
| Lecture du fichier | `ALFiles.parseMeta` : en-tête + `CONFIG_BLOCK` du gcode, `slice_info.config`, `plate_N_small.png` ; refuse un batch AutoLoop. Changer les champs lus → monter `META_V` (les anciens fichiers sont relus en arrière-plan) |
| Générateur | `#al-lib-sp` + `#al-lib-ver` (`CA.pick`, photo du spacer en pastille) tirés de `ALFiles` ; « Ajouter aux fichiers » = même fenêtre que l’onglet ; « Utiliser » de l’onglet → `CA.autoloopUse(id)` |
| `CA.pick` dans une fenêtre | le menu s’ouvre DANS le `<dialog>` (`ca-pick.js` v3), sinon caché sous la couche du haut |

#### 2.22b AutoLoop : Z de la 1re couche par imprimante (2026-11-16)
- Curseur `#al-ztrim` (carte ① du Générateur, caché si le fichier n'a pas de `G29.1 Z… ; for Textured PEI Plate`). `ztApply` réécrit **toutes** les lignes G29.1 sauf celle commentée « clear » (`G29.1 Z0 ; clear z-trim value first`) — dans `generateBatch` AVANT la répétition → vaut pour chaque loop. Plus haut = moins écrasé.
- Valeurs par imprimante : admin_settings `autoloop_ztrim` = `{values:{printer_id:z}}` ; pastilles = table `printers` filtrée par `; printer_model` du fichier (`model` contenu dans le nom). Imprimante choisie = localStorage `al-zt-printer`. Renommer/supprimer une imprimante (id) → la valeur enregistrée devient orpheline. `CA.autoloopZtReload()` relit imprimantes + valeurs.
- Si Bambu change le start gcode (autre commentaire ou format `Z{…}` non résolu) → `RE_ZT` ne trouve rien et le curseur disparaît (pas de casse).

#### 2.22c AutoLoop : cœur partagé + script de l'atelier (2026-11-18)
| Élément | Détail |
|---|---|
| `assets/autoloop-core.js` (`window.ALCore`, aussi `module.exports`) | TOUTE la génération : `generateBatch` et ses aides, `ztFind/ztApply/RE_ZT`, `fmtDur`, + `FIELD_DEFAULTS` (valeurs d'origine des champs `#al-*` du HTML), `optsFrom(valeurs, N, cal, ztrim)` (ex-`readOpts`), `calFor`. Chargé AVANT `cms-autoloop.js`, qui ne fait plus que l'UI |
| `tools/autoloop-cli/autoloop.js` | script Node du PC de l'atelier (`node tools/autoloop-cli/autoloop.js HKSB110 8 p2s-2 p2s-3`) : charge fflate + `autoloop-3mf.js` + `autoloop-core.js` tels quels (vm), réglages = `FIELD_DEFAULTS` → `admin_settings.autoloop.gcode` → `plate.settings` (même ordre que la page), Z par imprimante, vérifie les `G29.1 Z`, écrit dans Téléchargements, ouvre Bambu Studio. Doc complète en tête du fichier |
| Fonction `autoloop-cli` (verify_jwt off) | lecture seule, jeton du relais (`printer_tokens`) : `list` (plateaux, spacers, défauts, ztrim, état imprimantes) · `file` (lien signé 2 min du bucket `autoloop`) |
| Si tu touches… | un champ `#al-*` (ajout, défaut HTML changé) → **`FIELD_DEFAULTS` + `optsFrom`** dans le cœur · `versionsOf/defaultOf/detectSpacer` d'`ALFiles` → mêmes règles dans le script · colonnes de `autoloop_plates`/`printers` → la fonction `autoloop-cli` · nom de sortie (`projectOutName`) → le script (le relais retrouve le batch par son nom dans Téléchargements) |
| Vérifié 2026-11-18 | script = page à l'octet près (gcode + slice_info), avec et sans Z d'imprimante |

### 2.23 Atelier : Imprimantes — ferme P2S (2026-11-04, pas poussé)
Tableau de bord en lecture seule : une carte par imprimante (caméra, fichier, %, couche, reste, buse, plateau).
| Élément | Détail |
|---|---|
| Relais `tools/farm-relay/relay.js` | tourne sur le PC de l'atelier (lancé par `demarrer-imprimantes.vbs` + raccourci Démarrage) ; lit chaque Bambu en MQTT local (port 8883, utilisateur `bblp`, code d'accès) et appelle la RPC `printer_push` toutes les ~3 s (REST direct, **pas** `sb.rpc` → deps.js signale « jamais appelée » : normal) |
| Config **hors dépôt** | `%USERPROFILE%\Documents\Création Audio - Imprimantes\config.json` : IP + code + n° de série de chaque imprimante, URL/clé anon Supabase, **jeton du relais**. Jamais dans la base ni dans git |
| Table `printers` | `id` (clé du relais), `name`, `model`, `serial`, `cam_src` (nom du flux go2rtc), `sort`, `status` jsonb (online, state, file, pct, layer, layers, left, nozzle(_t), bed(_t), chamber, speed, err, hms), `seen_at` ; RLS admin seulement. Le nom se change en base sans que le relais l'écrase |
| Table `printer_tokens` | hachage sha-256 du jeton (RLS sans policy = fermée) ; RPC `printer_push(p_token, p_rows)` SECURITY DEFINER, exécutable par anon **mais refuse sans jeton valide**. Révoquer = supprimer la ligne ; nouveau relais = nouveau jeton (haché à la main, jamais dans schema-v2.sql) |
| Caméra | go2rtc (`…\go2rtc\go2rtc.exe`, v1.9.15) lié à **127.0.0.1:1984** seulement (jamais ouvert au réseau), flux `rtspx://bblp:CODE@IP:322/streaming/live/1` ; exige « LAN Only Liveview » activé sur l'imprimante. `cms-imprimantes.js` met un `<iframe>` `…/stream.html?src=NOM&mode=mse` (**sans** `loading="lazy"` : le lecteur ne se connecte pas) si `fetch(127.0.0.1:1984/api/streams, {mode:'no-cors'})` aboutit → **vidéo visible seulement sur le PC de l'atelier**, ailleurs « Caméra non disponible ici ». **Aucune entrée `origin`/CORS dans go2rtc.yaml** (go2rtc ne sait que `*`, qui laisserait tout site lire la caméra) : l'iframe et le sondage opaque n'en ont pas besoin |
| Caméra A1/P1 (JPEG, port 6000) | go2rtc ne la lit pas → le **relais** sert `http://127.0.0.1:1985/cam/ID.mjpg` (MJPEG, lié à 127.0.0.1, sans CORS, connexion à l'imprimante ouverte seulement pendant qu'un `<img>` regarde). Config : `"cam": "mjpeg:ID"` ; `cms-imprimantes.js` met un `<img>` si `cam_src` commence par `mjpeg:`, sinon l'iframe go2rtc. A1 Combo = `a1-1` (192.168.18.67) |
| `cms-imprimantes.js` + `imprimantes.css` | onglet `#imprimantes` (groupe Atelier) ; lecture toutes les 3 s tant que l'onglet est ouvert et la page visible ; « Relais éteint » si `seen_at` > 45 s |
| Si tu touches… | une clé de `status` → relais (`status()`) **et** `cms-imprimantes.js` (`fill`) · le jeton / la clé anon → `config.json` du relais · le port de go2rtc → `GO2RTC` dans `cms-imprimantes.js` |
| À venir | commandes (pause/reprise/arrêt), autres imprimantes (ajouter une entrée dans `config.json` + un flux dans `go2rtc.yaml`), caméra à distance (tunnel) |

#### 2.23b Production ↔ imprimantes + badge public « En production » (2026-11-14)
| Élément | Détail |
|---|---|
| Relais `tools/farm-relay/job.js` | à chaque nouvelle tâche (`task_id|subtask_name`), cherche le fichier du batch : FTPS implicite 990 de l'imprimante (`/cache`, `/`, `/model` ; **P2S : session TLS réutilisée obligatoire**, et sans microSD rien n'y est) puis `cfg.jobDirs` (défaut `~/Downloads`, le plus récent). Lit l'en-tête AutoLoop (mêmes règles que `parseGcode` de `cms-production.js` → **toucher l'un = toucher l'autre**) → `status.job` {loops, minutes, fils[{hex,type,perLoop}], objects, isAuto, src}. Réessaie toutes les 2 min tant que ça imprime |
| `printer_push` | sur FINISH/FAILED (une fois par tâche : `printers.last_logged`) → ligne `production_queue` (`printer_id`, `finished_at`, loops au prorata de la couche si FAILED) ; supprime le même batch envoyé à la main (AutoLoop) ; ignoré si fichier marqué « hors production » ou non-AutoLoop sans spacer |
| `production_files` | `file_key` = `prod_file_key(nom)` (minuscules, sans extension ni « AutoLoop… », alphanumérique) → `spacer_id` (null = hors production). Écrit par l'admin (« C'est quel spacer ? », ou à l'enregistrement). Sinon détection par nom/slug/réf remplacée/alias (`private.prod_spacer_for`) — la même logique côté JS = `detectSpacer` |
| `production_live()` (anon) | spacers en impression (imprimante vue < 3 min, RUNNING/PREPARE/PAUSE, produit actif) + `eta` (null en pause). Vide si `admin_settings.production.value.public = false` (case « Badge public » de l'onglet) |
| Badge public | `spacer-catalog.js` (`startLive`, pas en rendu statique) : appel REST direct chaque minute, badge `.sp-live` (boutique.css) sur `.sp-card[data-id]` et `.pdp[data-id]` → spacers publics, fiches, portail dealer, /revendeur. Textes `_t()` dans `i18n-en.js` |
| Si tu touches… | le gabarit de carte/fiche spacer → garder `data-id` + `.sp-body h3` / `.pdp-priceline` · les états Bambu → `trackJob` (relais), `printer_push`, `production_live`, `farmView` · `production_queue` → `cms-production.js` (`queueItem`, `isEnded`) |

---

### 2.24 Visites du site (Statistiques › Visites, 2026-11-05, pas poussé)

- Collecte : dernier bloc de `assets/nav.js` (toutes les pages publiques ; pas dealer.html) → RPC `track_visit` (anon) → table `site_stats` (compteurs par jour × page × langue × appareil × provenance ; ni IP ni identifiant). Repères locaux : sessionStorage `ca-v`, localStorage `ca-vd` et `ca-notrack`.
- Exclusions : Do Not Track, robots, localhost, `/coulisses`, navigateur marqué `ca-notrack` (posé par `admin-core.js` à la connexion ou par `?notrack=1` ; `?notrack=0` l'enlève).
- Lecture : RPC admin `site_stats_summary(from,to)` → `cms-statistiques.js` (sous-onglet `#statistiques/visites`, conteneur `#stat-visits`, mêmes boutons de période que les ventes) ; styles `.vis-*` dans facture.css.
- Si tu touches : le nom d'une page publique (les chemins sans `.html` sont affichés via `PAGE_LABEL`), les sources (liste blanche dans `track_visit` ET `SRC_LABEL`), nav.js (bumper `?v=` dans toutes les pages FR + `node tools/build-en.js` + `node tools/build-spacer-pages.js`).
- Légal : confidentialité § 3 (FR + EN) décrit ce comptage.

### 2.20 Promotions (2026-11-05)

- **Tables** `promotions` (nom FR/EN, dates, `mode` price|percent, `pct`, `stock_min`, `for_public`, `for_dealer`, `enabled`) + `promotion_items` (prix, `price_2`, `tiers`, `tiers_2`, `dealer_price`, `dealer_tiers`). RLS admin seulement.
- **Vue `_promo_best`** (security_invoker=off, jamais accordée) : meilleure promo par (audience, produit), calcule `on1/on2` (stock ≥ `stock_min` ; bobine = `qty`, recharge = `qty_2`). `_promo_cut_tiers()` doit être **exécutable par anon/authenticated** (une fonction appelée dans une vue est vérifiée contre le rôle appelant) — ne pas la révoquer.
- **Le prix promo est dans les vues** : `products_public` / `products_dealer` renvoient le prix et les paliers promo dans `sell_price`/`tiers` ; `reg_price(_2)` = prix normal ; + `promo_id/promo_name/promo_name_en/promo_ends/promo_on/promo_on_2`. Donc boutique, panier, RPC serveur suivent sans changer les 6 endroits de la règle de paliers.
- **Panier** : groupe `'promo|<id>'` (paliers comptés sur le total des articles de la même promo) — SQL `_customer_fill_lines` ET `boutique.js` (`cartPromoId`, `groupQty`, `accGroupQty`). Garder les deux synchronisés. **Dealer : pas de groupe promo** — `_dealer_fill_lines` compte les paliers sur toute la commande (mix and match, 2026-11-13), promo ou non.
- **Front** : `assets/promo.js` (`CA.promo`), ruban/bandeau/section dans `boutique.js` + `boutique.css` (`.promo-*`), `spacer-catalog.js` (spacers, dealer, revendeur), accueil (`#promotions`, `renderPromos` dans `accueil.js`, styles `accueil.css`). Pages spacer statiques = prix normal (`build-spacer-pages.js` neutralise la promo).
- **Admin** : onglet Promotions (`cms-promotions.js`, `.pm-*` dans admin.css), alerte marge via `CA.costing.costOf`.
- **Caisse + commande dealer admin** : RPC admin `admin_promo_prices()` (lit `_promo_best`) ; `cms-facturation.js` (`promoMap`, `promoOf`, groupe `promo|id`, `spacerDual`) et `cms-commandes.js` (dealer_price/tiers remplacés). Lignes d'une facture rouverte = non repricées. Clause promo dans conditions.html § 2 (FR+EN).
- Si tu touches : prix/paliers d'un produit → vérifier `_promo_best` ; une vue produit → garder les colonnes `promo_*`.

### 2.20b Nouveautés — ruban « Nouveau » (2026-11-14)

- **Donnée** : `products.attrs.new_until` (ISO, fin de journée), écrite par Admin › Nouveautés (`cms-nouveautes.js`, durée en jours, via `CA.updateProduct` ; `null` = retirer). **Liste blanche** : la clé `new_until` est dans `products_public` ET `products_dealer` (schema-v2.sql) — sans ça le public ne la voit pas. Une date passée n'affiche plus rien, aucun nettoyage.
- **Front** : `CA.promo.isNew(row)` / `newTag(inline)` dans `promo.js` ; pastille `.new-tag` (bas-gauche de la photo, `boutique.css` + `accueil.css`) sur `matCard` et `accCard` (boutique.js, un matériau est « nouveau » si une de ses couleurs l'est), `cardHtml` (spacer-catalog.js : spacers publics + dealer), `matCard` accueil (pastille en ligne) et section `#nouveautes` (`renderNew` dans accueil.js). Fiches détaillées : pas de pastille. Texte `Nouveau` dans `i18n-en.js` + chaînes de la section dans `tools/i18n/pages.en.json`.
- Si tu touches : la liste blanche `attrs` d'une vue → garder `new_until` ; `promo.js` → bumper son `?v=` (16 pages).
- **Packs (2026-11-17)** : colonne `packs.new_until` (timestamptz), écrite par `cms-nouveautes.js` (groupe « Packs de filament », `sb.from('packs').update`). Lue par `packIsNew()` dans boutique.js (`packTile`, `packMini`, `packCard`), boutique-accueil.js et accueil.js (via `PR.isNew({attrs:{new_until}})` — promo.js inchangé). Les requêtes publiques de packs doivent garder `new_until` dans leur `select`.
- **Promos + Nouveautés regroupées (2026-11-17)** : admin = un seul onglet `promotions` (« Promos & nouveautés ») avec sous-onglets `#promotions` / `#promotions/nouveautes` (gérés par cms-nouveautes.js `showSub`, boutons d'en-tête `data-pmsub-only`) ; ancien `#nouveautes` redirigé. Public = une seule section « Promos et nouveautés » (accueil `#promotions` → accueil.js `renderDeals` ; boutique `#bq-promos` → boutique-accueil.js `renderDeals`) : promos d'abord (meilleur rabais), puis packs nouveaux, puis autres nouveautés ; promo + nouveau = une carte, deux pastilles. Page `boutique/promotions` = « Promos et nouveautés », une grille + pastilles `#pr-chips` Tout · En promo · Nouveau (`renderPromoPage`). Le lien de menu s'appelle « Promos et nouveautés » (13 pages FR + `tabs()` de build-boutique-pages.js) ; la section « En promotion » en haut du rayon Filaments reste promo seulement.

### 2.20c Pastille « Populaire » (2026-11-18)

- **Calcul** (schema-v2.sql § PASTILLE « POPULAIRE ») : `_popular_rank()` lit les factures `status='final'`, `client_type in ('client','dealer')`, `amazon is null`, sur `popular_settings.days` (90). Rayons (`kind`) : `spacer`, `accessory`, `color` (top **dans chaque matériau**, `grp = Marque|Matériau`), `material` (`ref = 'Marque|Matériau'`, somme des couleurs), `pack` (instances distinctes `invoice_id + pack.k`, × `pack.n`). Populaire = rang ≤ `top` (3) **et** qté ≥ `min_qty` (5), sauf `popular_overrides` (`force` / `hide`). Public : RPC `popular_items()` → `(kind, ref)` seulement, **jamais les quantités**. Admin : `admin_popular()`.
- **Front** : `promo.js` `loadPopular()` (une fois, erreur = aucune pastille) / `isPop(kind, ref)` / `popTag(inline)` / `star`. `loadPopular()` est dans le `Promise.all` de chargement de boutique.js, boutique-accueil.js, accueil.js, spacers.js, dealer.js — **un nouvel endroit qui affiche la pastille doit l'ajouter à son chargement**. Pastille `.pop-tag` (dorée, coin haut-droit ; sous `.mcard-brand` / `.pop-brand` via `+`) dans boutique.css et accueil.css (`--pop`, `--pop-2`, `--on-pop`). Étoile `.sw-pop` sur les pastilles de couleur de la fiche filament (coin haut-gauche ; le point promo est en haut à droite).
- **Où** : boutique.js `spacerCard`, `matCard`, `accCard`, `packCard`, `packMini`, `packTile`, pastilles `.sw` de `renderConfig` ; page Promos et nouveautés (`renderPromoPage` : filtre `pop`, populaires-seulement listés après promos et nouveautés) ; boutique-accueil.js `card`, `packCard` ; accueil.js `matCard` (en ligne), `renderDeals` `itemCard` / `packCard` ; spacer-catalog.js `cardHtml` (public + portail dealer). Fiches détaillées (spacer, accessoire, pack) : pas de pastille, comme « Nouveau ». La section « Les plus populaires » de l'accueil (vue `product_popularity`) reste à part et n'affiche pas la pastille.
- **Admin** : Promos & nouveautés › **Populaires** (`#promotions/populaires`, `cms-populaires.js`, `CA.loadPopulaires`, styles `pp-*` dans admin.css) ; sous-onglets gérés par `showSub` de cms-nouveautes.js (`promos | nouveautes | populaires`).
- Texte EN : `Populaire` → `Popular` (i18n-en.js).

### 2.20d Pastille « De retour » (2026-11-19)

- **Calcul** (schema-v2.sql § PASTILLE « DE RETOUR ») : `_back_rank()` lit le **journal `stock_moves`** (§ 2.2) : dernier mouvement `reason in ('reception','production')`, `delta > 0`, `qty_before <= 2`, moins de **7 jours**, par produit **et format** (`kind` spool/refill). Exclut une 1re réception (aucun stock avant au journal **et** produit créé il y a moins de 14 jours). Visible seulement si ce format est encore en stock (`products_public`, donc `active` + stock réservé déduit). Rayons : `color`, `spacer`, `accessory` (ref = id), `material` (`Marque|Matériau`, une couleur suffit), `pack` (pack `enabled`, `_pack_has_room` **et** une de ses couleurs, du format du pack, est de retour). Public : RPC `back_items()` → `(kind, ref, at)`, jamais les quantités. Admin : `admin_back_items()`, `admin_back_hide(product, hide)` → `stock_moves.back_hidden`.
- **Si tu touches** : les raisons de `receive_stock` / Réception (`'reception'`, cms-inventory.js) ou de la Production (`'production'`) → la pastille en dépend ; le trigger `_log_stock_move` ; le nom des colonnes `qty`/`qty_2` de `products_public`.
- **Front** : `promo.js` `loadPopular()` charge aussi `back_items` (même promesse) → `isBack(kind, ref)` / `backTag(inline)`. Les helpers `popT()` de boutique.js, boutique-accueil.js, accueil.js ajoutent la pastille **sauf pour kind `material`** (choix de Théo 2026-11-19 : pas sur les cartes matériau) ; les filaments la montrent **sur les pastilles de couleur** de la fiche (`.sw-back`, icône `CA.promo.backIcon`, bas-droite, comme l'étoile `.sw-pop` ; title/aria « De retour ») ; spacer-catalog.js `cardHtml` l'ajoute à côté de `popTag`. Pastille `.back-tag` **bleue** (`--back`, `--back-2`, `--on-back` ; le vert est à « Nouveau »), **bas-gauche**, au-dessus de `.new-tag` (`.new-tag.is-abs ~ .back-tag.is-abs`) — boutique.css + accueil.css (+ `.mat-name .back-tag` en ligne). Fiches détaillées : pas de pastille. Sections « Promos et nouveautés » de l'accueil / accueil boutique : pas listées pour « De retour » seul (pastille si la carte y est déjà).
- **Page Promos et nouveautés** : `renderPromoPage` (boutique.js) — `bk` par carte, filtre `back` « De retour » entre Nouveau et Populaire ; tri : promos, nouveautés, de retour, populaires.
- **Admin** : Promos & nouveautés › **De retour** (`#promotions/retour`, `cms-retour.js`, `CA.loadRetour`, `#pm-sub-back`, styles `rt-*` dans admin.css) ; sous-onglet géré par `showSub` de cms-nouveautes.js (`promos | nouveautes | retour | populaires`).
- Texte EN : `De retour` → `Back in stock`.

### 2.25 Pages de service : Entretien + Impression 3D (revu 2026-11-06)

- **Entretien** : `entretien.html` (`entretien.js`, `entretien-v2.css`, préfixe `et-*`). **Impression 3D** : `impression.html` (`impression.js`, `impression.css`, préfixe `ip-*`) + copies `en/` générées. Les deux pages sont autonomes : l'ancien `assets/entretien.css` (`en-*`) est retiré.
- **Aperçu 3D** (`assets/apercu-3d.js` + `apercu-3d.css`, `CA.ap3d`, partagé par impression.js, messagerie.js, cms-messages.js) : WebGL1 + `OES_standard_derivatives`, dessin à la demande (aucune boucle), plateau + pièce, rotation au glisser et aux flèches. STL (binaire, ASCII), OBJ, 3MF et G-code lus **dans le navigateur** : rien ne part avant l'envoi (la FAQ le promet : garder ça vrai). STEP : joint sans aperçu. **Modifier apercu-3d.js = bumper son `?v=` à 4 endroits : impression.html (balise), `AP3D_V` dans messagerie.js (+ `MSG_V` de nav.js + `nav.js?v=` sur toutes les pages), `AP3D_V` dans cms-messages.js (+ `cms-messages.js?v=` dans l'admin) et `AP3D_V` dans demande-fil.js (+ `demande-fil.js?v=` dans compte.html et l'admin).** Son CSS et le Worker ont leur `?v=` dans apercu-3d.js. Sans fichier : `exampleMesh()`, adaptateur calculé. Poids = estimation (`grams()`, densités `DENS`) ; alerte au-delà de 256 mm (plateau). `#ip-mini` copie le canvas WebGL en 2D à chaque dessin.
- **Couleurs en stock** : `products_public` type filament, `qty` ou `qty_2` > 0, famille = premier mot de `material` (PLA/PETG/ABS/TPU seulement), reste du mot = gamme. Pastille comme boutique.js (`attrs.colors`, Sparkle/Galaxy/glitter). **Renommer un matériau ou ajouter une famille = vérifier cette page.** Compte affiché en direct, jamais écrit en dur.
- **Vraies pièces** : `products_public` type spacer avec `image_path` (4 premiers par `sort_order`), image `CA.newsImg`, légende `attrs.speaker_size` + `attrs.fitment[].make`, lien `spacers.html#/s/<slug>` : **même règle que `slugify` de spacer-catalog.js** (une page `spacer/<slug>.html` n'existe qu'après le passage du robot). Section masquée sans données.
- **Demandes de service (2026-11-06, ne passent plus par la Messagerie)** : fiche `D-0001` dans `service_requests` (+ `service_request_events` = historique daté, `service_request_messages` = discussion ; numéro = séquence `service_request_seq`).
  - Envoi : `assets/demande.js` (`CA.demande.init/submit`, partagé par impression.js et entretien.js) → sans session, fenêtre centrée de `panier-compte.js` (options `client`, `words`, `onCancel`, `askName`) ; fichiers dans `print-files` (§ 2.9) ; RPC `sr_submit` ; confirmation qui remplace le formulaire. **Un fichier refusé = aucune fiche**, formulaire intact, lien Messagerie + courriel. **Changer `panier-compte.js` = son `?v=` sur boutique, spacers, entretien, impression** (et le robot pour `spacer/*`).
  - Client : Mon compte › Demandes (`compte-demandes.js`, `me_service_requests`, `sr_decide`), onglet visible seulement s'il y a une demande. Admin : Commandes › Demandes (`cms-demandes.js`, RLS, `admin_sr_set_status`, `admin_sr_quote`, pastille `CA.ordersCount.req`). Discussion des deux côtés : `demande-fil.js` + `.css` (`CA.demandeFil.mount`, `me_sr_messages`, `sr_send`).
  - Statuts : `received, reviewing, quoted, accepted, in_progress, done, invoiced, declined, cancelled`. **Ajouter un statut** = contrainte de la table + triggers + `compte-demandes.js` + `cms-demandes.js` + `service-request-notify` + traductions.
  - Courriels : `_sr_notify` → EF `service-request-notify` (confirmation, avis admin, soumission, réponses), bilingue selon `lang`. Pas de courriel aux autres changements de statut.
  - Facturer : `cms-facturation.js` `setFromOrder` avec `kind:'service'`, `linkOrder` → `admin_sr_invoice`.
  - Purge 12 mois des fichiers : lancée à l'ouverture de l'onglet Demandes (`cms-demandes.js`), comme la Messagerie, parce que Storage passe par l'API. Compte supprimé : trigger `_sr_customer_deleted` (non facturée effacée ; facturée gardée sans fichiers ni discussion). `compte.js removeMyPhotos` vide le dossier ; `customers_cleanup` et la suppression côté admin **ne vident pas Storage** (limite existante).
  - Textes : sujets `kind` et valeurs de `details` traduits dans `i18n-en.js`, `check-js.js` FILES inclut `demande.js`, `demande-fil.js`, `compte-demandes.js`.
- **Catalogue d'entretien (2026-11-06)** : table `maintenance_printers` (nom, marque, `photo`, `price_month` — vide = « sur évaluation » —, `minutes`, `sort_order`, `visible`) + `maintenance_settings.hourly_rate` (60 $/h, ligne unique id=1) ; lecture publique (visible seulement), écriture admin. Onglet admin **Entretien** (`cms-entretien.js`, `CA.loadEntretien`, styles `en-*` dans admin.css) : chaque champ s'enregistre en le quittant ; photo = bucket `products` dossier `entretien/` ou chemin du site commençant par `/`.
  - Public : `entretien.js` lit le catalogue (anon) et dessine `#et-models` ; une machine sans prix montre l'avertissement `#et-warn` (taux horaire). Envoi : `details.machines = [{id, qty}]` ; **`sr_submit` refait l'instantané** `[{id, name, brand, qty, price, minutes}]` + `rate` + `monthly` depuis la base (jamais de prix venu du navigateur). Le héros reprend le prix de l'A1 du catalogue. Ancien format `{a1,xp,snap}` encore lu par `machinesOf()` (cms-demandes.js, compte-demandes.js, EF `service-request-notify`).
  - Calculateur de prix (admin seulement, 2026-11-06) : tables `maintenance_calc` (marge % seulement) et `maintenance_materials` (nom, coût, quantité par machine), jamais lisibles en public (c'est pourquoi pas dans `maintenance_settings`). Dans `cms-entretien.js` : prix suggéré = (taux × min/60 + matériaux)/(1 − marge) ; profit = prix − matériaux (le temps de Théo n'est pas un coût) ; gain/h = profit ÷ temps vs taux ; déplacement facturé à part, exclu ; prix suggéré = coût/(1 − marge) arrondi à l'entier supérieur ; « Appliquer » écrit `price_month` (donc change le site).
  - Facturer une demande : `cms-demandes.js` `bill()` → `maintLines()` (une ligne par modèle ; sans prix = 1re visite `taux × minutes/60`, à ajuster ; ajustement si la soumission diffère et qu'aucune machine n'est sans prix) → `order.lines` lu par `invoiceFromOrder` (`cms-facturation.js`). Notes laissées vides ; le n° D-xxxx reste dans le bandeau et la fiche. `loadNextNumberHint` relance `render()` (sinon le n° de facture n'apparaissait pas dans l'aperçu).
  - Facturation, gabarit **Entretien** (2026-11-07, `cms-facturation.js`, `cat = 'maintenance'`) : catalogue = `maintenance_printers` (+ taux `maintenance_settings`), clic = ligne libre `ptype:'divers'`, `productId:null`, `maintId` (aucun stock touché), même libellé que `maintLines()`. **Changer le libellé ou la règle « sans prix » = aligner les deux.**
  - Mon compte › Demandes : cartes à icône, chronologie `.dq-tl`, machines `.dq-ml` (photos via `maintenance_printers`), bouton « Voir ma facture » (`me_service_requests.invoice_id` → onglet Commandes, ouvre `details.ord[data-id]`). **Changer le catalogue ou `sr_submit` = revoir ces quatre fichiers + l'EF.**
- **Prix** : aucun montant sur la page, soumission seulement (choix de Théo, 5 nov. 2026).
- **Aperçu 3MF** : `assets/impression-3mf.js`, un Worker sans bibliothèque (ZIP lu par `file.slice`, zip64 géré, `DecompressionStream('deflate-raw')`, lecture des octets sans `DOMParser`). Il n'a **pas de balise `<script>`** : son URL vient de `document.currentScript.src` dans apercu-3d.js (constante `WORKER`), donc ça marche aussi sous `/en/`. **Modifier le Worker = bumper son `?v=` dans `WORKER`, puis le `?v=` d'apercu-3d.js (4 endroits, voir plus haut), puis `node tools/build-en.js`.**
  - Échange : page → `{t:'open', file, budget, maxTris}`, `{t:'plate', i, req}` ; Worker → `progress`, `meta` (`lightened`, `tooBig`, `tris`, `plates[]` : `id, hasMesh, size, volume, area, tris, thumb, time, weight`), `plate` (`pos` transféré, `groups[]` `{c, first, count}`, `rect` du plateau), `fail`. **Échec ou 90 s sans réponse = « Pas d'aperçu », le fichier part quand même.**
  - Couleurs : filament de chaque pièce + faces peintes au pinceau (`paint_color`, décodées par `paintTri`, vérifiées contre les images des fichiers de Théo). Une pastille recolore tout le plateau ; `state.color` nul = couleurs du fichier.
  - Tranché sans maillage (`.gcode.3mf`) ou `.gcode` : cordons (ci-dessous). Trop lourd (`tooBig`) : image du plateau (`#ip-shot`) + vrais temps et poids de `slice_info.config`. Sans WebGL ou sans `ANGLE_instanced_arrays` : image + chiffres + vignettes.
  - **G-code** : section `gtype … openGcode` du Worker (G0/G1/G2/G3, E relatif ou absolu, types Bambu `; FEATURE:` et Orca/Prusa/Cura `;TYPE:`, largeur, couches, blocs AutoLoop = premier seulement). Point = 8 octets : Int16 x,y,z à 0,02 mm + méta (`0x8000` début de trajet, type<<12, outil<<8, largeur en 0,01 mm). Types : 0 mur ext., 1 mur int., 2 remplissage, 3 plein/pont, 4 dessus/dessous, 5 support, 6 tour de purge, 7 bordure. Dessin : ruban par segment (`ANGLE_instanced_arrays`), éclairage de section ronde. Curseur + Lecture + légende + Filament + zoom : `CA.ap3d.controls`.
  - **`.capv`** (aperçu envoyé au client) : `'CAPV'`, version 1 à l'octet 4, longueur JSON (u32) à l'octet 8, JSON `{v, plates:[…]}`, puis par plateau couches (Uint32), 4 colonnes Int16 codées en delta, PNG ; le tout en gzip. `readCapv` ne croit aucune taille sans vérifier. **Ne jamais y ajouter de vitesses, températures, profils ni identifiant de compte** : c'est la promesse faite à Théo. `sendCapv` est le seul endroit qui l'écrit.
  - Vrai plateau (`rect`) : `uRect` dans `FS_P`, positions Bambu `ox=(i%cols)*W*1.2`, `oy=-floor(i/cols)*H*1.2`, `cols=ceil(sqrt(n))`. Ombre de contact seulement sans `rect` (STL, OBJ, exemple).
  - Téléphone (`pointer:coarse`) : plafond `6e5` triangles par plateau, simplification par grille dans le Worker ; dimensions et poids restent ceux de l'original, le fichier envoyé reste complet. Seuil choisi, pas mesuré sur un vrai téléphone.
  - Vignettes `#ip-plates` : cases toutes cochées au départ, dernière case refusée. La case est dans le coin (34 px sur 78 px) : **une zone plus grande atteint le centre et un toucher sur la vignette coche la case**. `fileLines(f)` écrit `Plateaux : 1, 3, 4 sur 10` ou `Plateaux : tous (10)` dans le message ; `dropFile(f)` ferme le Worker au retrait et à la remise à zéro.
- **Pour ajouter un format d'aperçu** (STEP) : `READ`/`READ3` (expressions des extensions lues), `readFile(f)`, `show`, `readout` dans impression.js, `CA.ap3d.show` (apercu-3d.js), `VIEW_EXT` (messagerie.js), `VIEW_3D` (cms-messages.js) ; la phrase de la FAQ « L'aperçu fonctionne avec tous, sauf le STEP. » (impression.html + `pages.en.json`). STL et OBJ restent lus sur le fil principal : un OBJ lourd fige encore un téléphone. Fichier abîmé : `fromTris` rend `null` au-delà de 100 m ou si une borne n'est pas finie.
- **Voile de glisser-déposer** : minuterie (700 ms) relancée par `dragover`, jamais un compteur : un glisser annulé (Échap, sortie de fenêtre) laissait le voile affiché.
- **Menu « Boutique » déroulant** (`.nav-dd` : Promotions, Filaments, Spacers, Accessoires ; tiroir = `.drawer-parent` + `.drawer-sub`), puis Impression 3D, Entretien, Contact, sur toutes les pages publiques ; comportement tactile/clavier dans `nav.js`, onglets `.shop-tabs` (⌂ · Filaments · Spacers · Accessoires · Imprimantes 3D · Promotions, générés par `tabs()` de `tools/build-boutique-pages.js`) sur boutique.html, les trois pages de rayon (état dans `boutique.js` `showScreen`), boutique/spacers.html et boutique/imprimantes.html. `site.css` gère la place — compaction ≤ 1450 px (Dealer en icône, liens `padding:9px`) ; fêtes : burger ≤ 1070 px (le bouton ❄ prend 54 px) ; pages à panier (`:has(.cart-btn)`) : burger ≤ 1140 px (≤ 1190 px en fêtes) ; burger ≤ 1040 px sinon ; liens `white-space:nowrap`. **Ajouter ou renommer un lien de menu = re-mesurer l’en-tête (1041 → 1600 px, fêtes ON/OFF, boutique/spacers avec panier) et bumper `site.css ?v=` sur les 12 pages FR** (puis `node tools/build-en.js`).
- Pages spacer (`boutique/spacers/*.html`, `en/boutique/spacers.html`) : générées par le robot depuis `boutique/spacers.html` — le nouveau lien de menu et le `site.css ?v=` n’y arrivent qu’au prochain passage du robot.
- Accueil : carte bento `bn-impression` (index.html) ; sitemap : `impression.html` + `en/impression.html` ; `tools/build-en.js` (PAGES) et `tools/i18n/check-js.js` (FILES) listent la page.
- Légal : confidentialité (messagerie : fichiers 3D conservés ; section `#demandes`, suppression, conservation 12 mois, FR+EN) et conditions (entretien + impression : soumission acceptée ou refusée dans le compte, FR+EN) mises à jour le 6 novembre 2026 — texte à relire par Théo. **Changer ce qu'on garde dans une fiche, sa durée ou le sort d'une fiche à la suppression = revoir ces deux pages.**

### 2.26 Livraison dealer (portail, Promotions, Commandes — 2026-11-05)
Réglage : `admin_settings` clé `dealer_shipping` { enabled, threshold, fee, ends } (carte fixe `#pm-ship`, `cms-promotions.js`) → `_dealer_ship_cfg()` → RPC `dealer_shipping()` (réglage + `addr`, la fiche découpée par `dealer_ship_address(p_email)`).
Commande : `dealer_submit_order` / `dealer_update_order` / `admin_save_dealer_order` prennent `p_delivery` + `p_address` **jsonb** { name, address, city, province, postal, phone } → `_dealer_apply_ship` valide, calcule le port, fige `ship_rate`/`ship_threshold`, écrit `ship_parts` (les champs, pour modifier) et `ship_address` (texte complet : cartes, note de facture, courriel). `total` = lignes + `ship_fee`.
- Fiche : `dealers.city` reste « Ville, QC G1A 1A1 » (la facture s’en sert telle quelle) ; `dealer_ship_address` la découpe. **Changer ce format = revoir ce découpage.** Fiche sans adresse → la première livraison la remplit (jamais d’écrasement).
- Facture : `invoiceFromOrder` (`cms-facturation.js`) ajoute une ligne libre Livraison / Livraison gratuite (coût = `ship_rate`, pour une marge juste), EN si `dealers.lang = en`.
- Portail : `dealer.js` (`#cart-addr`, `#sa-*`, `.is-ship` = tout le panneau défile), menu province `ca-pick.js` + `data-nosearch`, styles `.cpk*` copiés dans `dealer.css` (l’admin a les siens). Le port affiché n’est qu’un aperçu : le serveur recalcule.
- Courriel d’avis : EF `dealer-order-notify` (à redéployer après changement de texte).
- Le texte dit « livraison » partout, pas « colis » (choix de Théo) ; les colonnes gardent `ship_*`.

### 2.27 Paliers dealer mix and match (portail, Commandes — 2026-11-13)
Toutes les commandes dealer : les paliers se comptent sur le total des paires, tous modèles confondus. Remplace la « commande découverte » (1re commande seulement, retirée le 2026-11-13 : RPC `dealer_discovery`/`_dealer_discovery_ok`, réglage `admin_settings.dealer_discovery` et carte `#pm-disc` supprimés ; la colonne `dealer_orders.discovery` reste, plus lue).
- **Serveur (seule vérité)** : `_dealer_fill_lines` passe `sum(qty)` de la commande à `_dealer_unit_price` ; chaque ligne garde ses propres `tiers` (Toyota/Ford-002 = 10/20/25 %, les autres 15/25/30 %).
- **Aperçus à garder alignés** : dealer.js (`tierQty` = `count()`, `tierExtra`, `pickTier`), spacer-catalog.js (`o.tierExtra`, table et somme de la fiche), cms-commandes.js (`tierQtyOf`).
- **Bandeau** « Mix and match » permanent sur le portail (`#dl-disc`, dealer.html) ; conditions.html § 3 « Rabais quantité (revendeurs) » (+ EN).
- **Si tu touches** aux paliers ou à `_dealer_fill_lines`, vérifie les trois aperçus. Promo dealer : le palier cumulé s'applique aux prix de `_promo_best`.

### 2.28 Crédit boutique dealer (2026-11-13)
Crédit sans expiration, non remboursable, utilisable sur tout (promos incluses), dealers seulement. Registre en ajout seul.
- **Base** : `public.dealer_credit` (kind grant / adjust / use / return, n° C-0001). Ajout seulement par RPC `admin_credit_add(p_email,p_amount,p_reason,p_note,p_pin)` — **NIP de Théo** (`admin_pin_status`, `admin_pin_set`, essais limités + verrou). `use`/`return` écrits par le trigger `private.invoices_credit_sync` depuis `invoices.credit_used` / `credit_email` (deps.js le croit « jamais appelé » : faux positif, trigger sur `private.`).
- **Facturation** : `cms-facturation.js` (`creditUsed`/`creditAvail`/`creditNow`/`paintCredit`, bloc `#fx-credit`) ; `pay_method='credit'` quand le crédit couvre tout (voir § 2.4 point 9), sinon le reste se paie Comptant/Interac. Commande dealer → facture : `dealer_orders.use_credit` (RPC `dealer_order_use_credit`).
- **Affichage** : `cms-credit.js` (panneau Crédit sous chaque dealer, carte Sécurité « NIP du crédit »), `cms-historique.js` (pastille), `doc-print.js` (lignes crédit + `CA.creditPrint` reçu C-), `invoice-notify` (PDF + courriel), `dealer-request` action `credit` (courriel d'ajout), portail `dealer.js` (`dealer_credit_me`, onglet `#/credit`, case panier `#cart-credit-use`).
- **Si tu touches** au calcul du total ou au paiement d'une facture, revérifie les lignes « Crédit boutique / À payer » à 5 endroits : aperçu Facturation, Historique (réimpression), doc-print (dealer), PDF + courriel invoice-notify. Si les règles du crédit changent : conditions.html (+ EN) et le texte du reçu (`buildCredit`).

### 2.29 Packs de filament (2026-11-16)
Pack = prix fixe pour N recharges/bobines d'une marque (`packs.units`, 1 à 20 ; `pairs` = ancienne colonne inutilisée depuis 2026-11-16), composé à l'unité parmi les couleurs permises (`presets.lines.n` = unités ; un pack de 4 couleurs différentes est possible). Public seulement (pas dealer), limité au stock (jamais en précommande). **« Personnaliser » = packs noir et blanc seulement** (hex #000000/#FFFFFF, règle de Théo 2026-11-16) : vérifié dans `_pack_fill`, `packCustom` (boutique.js) et `bwOnly`/`syncCustom` (cms-packs.js) — un pack de couleurs reste à compositions fixes.
- **Base** : table `public.packs` (name/name_en, kind refill|spool, pairs, price, products[], presets jsonb, enabled, sort_order), lue en anon. Admin › Packs (`cms-packs.js`). `_pack_fill` (dans `place_order` / réservation) attend `{pack_id, qty, comp:[{product_id, qty: unités par pack}]}` : somme = units, couleurs permises, stock ; sort une ligne par couleur (`unit_price` = prix/unités, centimes exacts) avec colonne jsonb `pack {id,k,n,name,name_en,price,kind}`. **Les unités du pack comptent dans le palier de la marque** (option B) mais le pack lui-même n'a pas de rabais.
- **Photos** : `packs.image_path` = photo du pack ; `presets[].img` = photo d'une composition (Admin › Packs, bouton Photo dans chaque composition, envoi immédiat au bucket `products/packs/`). Boutique `packMedia(pk, comp)` : img de la composition dont `compKey` égale la sélection → sinon `image_path` → sinon bobines dessinées (Personnaliser hors composition). Essentiels : `pack-ess-noir|mix|blanc-4.jpg` (2026-11-16).
- **Pages** (2026-11-16) : `boutique/packs#/` = cartes (`packTile`) ; `#/p/<slug>` = fiche (écran `#screen-pack`, `renderPack` / `packCardHtml` en `.pdp`) : galerie = photo du pack puis la photo de chaque couleur (`attrs.img_refill|img_spool` sinon `image_path`), « Ce pack contient » (pastille, nom, `products.code` Bambu, ×n), économie `packSaving` = Σ prix du palier à la quantité du pack (`tierPrice(baseOf, tiersOf, units)`) − prix du pack. Mise à jour sur place `updatePackCard` (jamais de re-rendu complet au clic → pas de saut).
- **Panier** (`boutique.js`, `ca_v2_cart`) : entrée `{id: packId, type:'pack', key:'pack|id|pid:n,…', comp:[{id,n}], qty}` ; stock : packs prioritaires (`freeStock` = stock − `packUse`, `packRoom`). `orderLines()` alimente envoi + réservation. Même format de clé reconstruit par `compte.js` (`editOrder`).
- **Affichage regroupé par `pack.k`** : `compte.js` (`packLines` : commandes, réservations, factures), `cms-commandes-clients.js` (édition : item kind pack), `cms-reservations.js` (pastille), `cms-facturation.js` (bouton « Pack » + résultats « Packs » de la barre `#fx-search` (`renderPackHits`, nom/code/composition, pas les couleurs), tous deux via `addPackLines`, lignes manuelles, `l.live = !l.pack`). **Une ligne par pack partout** : `packGroup`/`packEn` dans `_shared/mail.ts` (customer-order-notify, invoice-notify PDF + courriel, reservation-notify), `CA.packRows` (doc-print.js, utilisé aussi par cms-historique `buildDoc`), `packLines` (compte.js) — détail = « code d'offre · 2 × Black, 2 × Jade White ». Code d'offre = `packs.code` (Admin › Packs), copié dans `pack.code` par `_pack_fill` et le bouton Pack de Facturation.
- **Menu** : lien « Packs de filaments » (`data-nav-packs`, `style=display:none`) après Filaments dans le déroulant, le tiroir et le pied des 13 pages FR ; `nav.js` le montre si `packs` (RLS = actifs) renvoie une ligne. Conditions § 2 + Retours § 1 parlent des packs.
- **Pages** : `boutique/packs.html` généré (build-boutique-pages.js via build-en.js), section vedette en haut de Filaments, bannière `#bq-pack` sur l'accueil boutique ; onglet « Packs » `hidden` dans le HTML, montré par boutique.js / boutique-accueil.js / spacers.js si un pack est en ligne.
- **Si tu touches** au calcul du palier (`groupQty`, `_fil_tier`) ou au format des lignes de commande, revérifie `_pack_fill`, `packLines` et les deux éditeurs (compte.js + cms-commandes-clients.js).
- **Pack personnalisé (Facturation seulement, 2026-11-19)** : ligne « Pack personnalisé » des résultats Packs de `#fx-search` → `customPackDialog` (4 unités, n'importe quel filament offrant le format, prix libre, Recharge | Avec bobine) → `addCustomPack` : lignes `pack:{k,n,name:'Pack personnalisé',name_en:'Custom pack',price,kind,custom:true}` **sans clé `id`** (hors `_popular_rank`, `packImagePaths` = pas de photo). `syncPackPrices()` (dans `render`) recalcule `pack.price` = somme des lignes du pack (prix unitaire modifiable) → `packRows`/courriels affichent le bon total. `compte.js` + `cms-commandes-clients.js` : pack sans `id` = lignes à l'unité (pas de clé `pack|id|…`).
- **Format « Avec bobine » (2026-11-19)** : un pack recharge peut aussi se vendre avec bobine — `packs.spool_price` (vide = pas offert), `spool_image_path`, `presets[].img_spool` (Admin › Packs : case « Avec bobine ($) », photos « Photo bobine »). Panier : entrée `kind:'spool'`, clé `pack|id|spool|…` (boutique.js `packAs`/`packOf`/`packHasSpool` — **ne pas confondre avec `hasSpool(p)` des produits**), envoyé `{pack_id, kind:'spool'}` → `_pack_fill` prend `spool_price` et le stock bobine (lignes kind spool, `pack.kind`=spool, `pack.price`=prix bobine). Hors stock = à commander (pas de M'aviser pour ce format). Suivent : compte.js (clé + nom « · Avec bobine »), cms-commandes-clients.js (renvoie `kind`), cms-facturation.js (résultats Packs doublés « · Avec bobine »), doc-print `packRows` + mail.ts `packGroup` (nom « · Avec bobine / With spool »), mail.ts `packImagePaths` (photos *_spool).
- **Packs prêts (2026-11-20)** : `packs.ready = { "<pid:n,…>": {n, at} }` par composition toute faite (clé = `_pack_ckey` SQL = `compKey` boutique.js = `ckeyOf` cms-packs.js, uuid minuscules triés). Absent = pas suivi (stock à l'unité partagé, comme avant). RPC **`pack_ready()`** (anon) = restants = n − packs facturés depuis `at` (`invoice_lines.pack`, factures non annulées) − gardés (commandes `stock_hold` ouvertes, réservations actives ; la partie à commander n'est pas gardée). `_pack_reserve()` → **`_held_stock`** retire les recharges des packs restants du stock à l'unité (`products_public`). `_customer_fill_lines` : composition suivie → au-delà des restants, pack entier « à commander », et ses lignes ne prennent rien au stock à l'unité (`pks`). `_pack_has_room` (M'aviser) suit aussi. Boutique : `readyLeft`/`readyUsed` dans `packRoom`, `packUse`, `packOver`. Admin › Packs : compteur « Prêts − n + » par composition (`setPackReady` : n = restants voulus + gardés, at = maintenant ; − à 0 = plus suivi « — »). Format « Avec bobine » jamais suivi. **Si tu touches** au format de `pack` (id, k, n, kind) des lignes de commande/facture, revérifie `pack_ready`.
- **Tous les affichages d'un pack** : voir la famille « Packs » au § 2.30 (toute modif d'affichage, de photo ou de prix d'un pack = les passer **tous**).

### 2.30 Familles d'affichage — « si tu touches l'un, regarde tous les autres » (2026-11-17)

**Pourquoi** : le 2026-11-17, le prix à la recharge d'un pack était gris sur les cartes du rayon Packs, mais encore orange dans la vedette de Filaments et sur la fiche. De même, la bannière de l'accueil boutique a montré des pastilles au lieu des photos des packs. Ces affichages ne partagent aucun code, mais ils montrent **le même objet** : Théo s'attend à ce qu'ils changent ensemble.

**Règle** : avant de modifier l'**affichage**, une **photo**, un **prix**, un **libellé** ou un **badge** d'un type d'objet, ouvrir sa famille ci-dessous et passer **chaque ligne**. Pour chaque ligne : on l'aligne, ou on note en une phrase dans le message de fin pourquoi elle reste différente. Chaque ligne se vérifie aussi sur ordi et mobile, en FR et en EN. Nouvel endroit qui montre un de ces objets = l'ajouter ici **dans le même commit**.

#### Packs de filament
| Où | Code | Ce qui y est montré |
|---|---|---|
| Stock sur les cartes (règle de Théo 2026-11-18) | boutique.js `packStockPill` dans `packTile`, `packMini`, `packCard` · css `.pack-instock` | **jamais « Épuisé » ni gris** ; « En stock » seulement si `packAnyStock`. accueil.js / boutique-accueil.js `packCard` : aucune mention (pas de calcul de stock là) · fiche épuisée : `.pack-oos` + « M'aviser » (§ 2.10) |
| Pack hors stock = à commander (Théo 2026-11-18) | serveur `_pack_fill` (plus de refus de stock) + `_customer_fill_lines` (CTE `pkt` : qty_to_order par ligne de pack, packs du panier dans l'ordre) · boutique.js `addPack` → fenêtre caDialog (connecté : ajoute ; sinon « Me connecter » → `ca_pack_pending` sessionStorage → `takePending` dans `onSignedIn`, `onCancel` vide) · `putPack` (max 20) · `packOver` → `boTag` « Réservé à la prochaine réception » + `overStock` (bloque la réservation 72 h) · `maxOf` connecté = 20 · compte.js `packLines` et mail.ts `packGroup` : qty_to_order du pack = max ceil(tor ligne / unités par pack) · customer-order-notify `boLabel` | tuiles et Personnaliser jamais grisés ; customer_reserve refuse toujours un pack à commander |
| Rayon Packs (cartes) | boutique.js `packTile` · css `.pack-tile*` | photo (`packMedia`), nom, unités · ligne, **prix + prix à l'unité gris** (`.pack-tile-price`) |
| « ou 70 $ avec bobine » (2026-11-19) | boutique.js `spoolAlt` dans `packTile`, `packMini`, `packCard` · boutique-accueil.js `spoolAlt` (`packCard` + bannière 1 pack) · accueil.js `packCard` (`.pk-alt`) · css `.pack-alt` | ligne grise sous le prix si `spool_price` ; fiche : `.pack-fmts` (même style `.fmt-opt` que la fiche filament), « +10 $ seulement », `.pack-bo` |
| Vedette en haut de Filaments | boutique.js `packSectionHtml` / `packMini` · css `.pack-mini*` | photo, nom, unités, **prix + prix à l'unité gris** (`.pack-mini-price`) |
| Fiche d'un pack `#/p/<slug>` | boutique.js `renderPack` / `packCardHtml` / `pkStageHtml` / `pkThumbsHtml` / `updatePackCard` · css `.pack-pdp`, `.pack-price`, `.pack-pre*`, `.pack-save`, `.pk-*` | galerie, compositions, **prix + prix à l'unité gris** (`.pack-price span`), économie, « Ce pack contient » |
| Personnaliser (noir et blanc) | boutique.js `packCustom` · css `.pack-custom*`, `.pack-crow`, `.pack-csw` | pastilles, quantités |
| Pastilles sans photo | boutique.js `dotsHtml` · css `.pack-dots` (taille via `--d`) | une pastille par unité |
| Accueil boutique `/boutique` | boutique-accueil.js `renderPack` / `packImg` · css `.bq-pack*` | 1 pack : pastilles + lien fiche · 2 et plus : **photos de chaque pack** + « dès » + lien rayon |
| Promos et nouveautés (pack « Nouveau », 2026-11-17) | boutique.js `packCard` (page boutique/promotions) · boutique-accueil.js `packCard` · accueil.js `renderDeals`/`packCard` · css `.pack-mcard`, `.pack-mc-unit` (boutique.css), `.pk-unit`, `.pk-dots` (accueil.css) | photo, pastille Nouveau, unités, **prix + prix à l'unité gris** |
| Pastille « Nouveau » sur les packs | boutique.js `packIsNew` dans `packTile` + `packMini` (fiche : aucune, comme les produits) | `packs.new_until` |
| Pastilles « Populaire » + « De retour » sur les packs | `popT('pack', pk.id)` dans `packTile`, `packMini`, `packCard` (boutique.js), `packCard` (boutique-accueil.js, accueil.js) | `back_items` kind `pack` (§ 2.20d) |
| Onglet « Packs » de la barre des rayons | boutique.js, boutique-accueil.js, spacers.js (requête `.eq('enabled', true)`) | montré seulement si un pack est en ligne |
| Menu Boutique (déroulant, tiroir, pied) | nav.js `[data-nav-packs]` (requête anon) · 13 pages FR | lien « Packs de filaments » |
| Panier | boutique.js `renderCart` / `thumbHtml` (entrée `type:'pack'`) | une ligne par pack + détail des couleurs |
| Mon compte | compte.js `packLines`, `pkRow`, `renderPkv` | commandes, réservations, factures regroupées |
| Courriels + PDF | `_shared/mail.ts` `packGroup`/`packEn` (customer-order-notify, invoice-notify, reservation-notify) · doc-print.js `CA.packRows` · cms-historique `buildDoc` | une ligne par pack ; pack sans photo (personnalisé) = damier 2×2 des photos de ses filaments (`imgs`/`.ia-quad` doc-print, `quad` pdf.ts + email.ts) |
| Admin | cms-packs.js (liste `pm-meta` : prix à l'unité, photos ; compteur « Prêts » `.pk-rdy` par composition, § 2.29), cms-facturation.js (catégorie « Packs » en tête de la grille filaments, tuiles pleine largeur, format = curseur Recharge/Avec bobine ; « + Pack personnalisé » = barre de 4 cases `.fx-cpk-bar` ; ligne de facture regroupée `packRowHtml` : photo ou damier `.inv-quad`, pastilles nommées, Qté = nb de packs, 2026-11-20), cms-commandes-clients.js, cms-reservations.js | gestion + lignes regroupées |
| Nouvelles + visuels | table `news` · `assets/news/*.png` (`tools/news-visuals/rendre.ps1`) | annonces des packs (photos à jour ?) |
| Textes anglais | i18n-en.js : `la recharge`/`la bobine`, `{n} recharge(s)`, `{n} bobine(s)`, `{n} pack(s) de filament`, `dès` | toute nouvelle chaîne des lignes ci-dessus |

#### Filaments (couleur / matériau)
| Où | Code |
|---|---|
| Catalogue Filaments (cartes matériau) | boutique.js `renderCatalog` / `matCard` / `minPrice` / `minTierPrice` / `brandBadge` |
| Fiche filament | boutique.js `renderConfig` / `mediaHtml` / `renderMedia` / `tierGridHtml` / `stockLineHtml` / `detailsHtml` / `relatedHtml` / `notifyHtml` · `placePick` (mobile : couleurs sous la photo) |
| Accueil du site | accueil.js `buildRail` / `swatchBg` / `fromPrice` / `stockText` / `brandBadge` |
| Accueil boutique | boutique-accueil.js `setTile` / `renderTiles` / `card` / `fromPrice` / `brandBadge` |
| Promotions + Nouveautés | boutique.js `promoSectionHtml` / `renderPromoPage` · boutique-accueil.js `renderPromos` / `renderNew` · promo.js |
| Panier, Mon compte, courriels, PDF, admin | `renderCart`, compte.js, `_shared/mail.ts`, doc-print.js, cms-filaments / cms-materials / cms-inventory (pastille + ordre, § 2.12) |
| Grille de prix imprimable | grille-prix.html (générée de la base) |

#### Spacers
| Où | Code |
|---|---|
| Catalogue + fiche publics | spacer-catalog.js `cardHtml` / `productHtml` / `mediaHtml` / `priceRows` / `tierTableHtml` / `stockBadge` (+ pages SEO générées, § 2.11) |
| Carte spacer dans la boutique | boutique.js `spacerCard` |
| Portail dealer | dealer.js (`renderCart`, `tierBarHtml`, `orderHtml`) + spacer-catalog.js |
| Accueil du site / boutique | accueil.js, boutique-accueil.js (`setTile`) |
| Badge « En production » | § production-imprimantes-live (spacer-catalog.js `liveHtml`) |
| Amazon | `amazon/annonces/*.md` (titres, photos, prix ne sont pas liés au site) |

#### Accessoires
| Où | Code |
|---|---|
| Rayon + fiche | boutique.js `renderAccs` / `accCard` / `renderAcc` / `accMediaHtml` / `accTierGridHtml` |
| Accueil boutique, promos, nouveautés | boutique-accueil.js `card`, `renderPromos`, `renderNew` |
| Admin | cms-accessories.js |

#### Prix en promo + ruban « Nouveau » + pastilles « Populaire » et « De retour » (tous les produits)
| Où | Code |
|---|---|
| Ruban, bannière, « Nouveau » | promo.js `ribbon` / `banner` / `isNew` / `newTag` |
| « De retour » (§ 2.20d) | promo.js `isBack` / `backTag` / `backIcon` (chargé par `loadPopular`) · `.sw-back` des pastilles de couleur (renderConfig) · `popT()` (pas les matériaux) de boutique.js, boutique-accueil.js, accueil.js · spacer-catalog.js `cardHtml` · filtre `back` de `renderPromoPage` · admin cms-retour.js |
| « Populaire » (§ 2.20c) | promo.js `loadPopular` / `isPop` / `popTag` · cartes de boutique.js, boutique-accueil.js, accueil.js, spacer-catalog.js (+ dealer) · étoile `.sw-pop` de la fiche filament · admin cms-populaires.js |
| Vues qui affichent un prix promo | boutique.js, boutique-accueil.js, accueil.js, spacer-catalog.js, dealer.js |
| Prix promo appliqué | cms-facturation.js, cms-commandes.js · admin cms-promotions.js, cms-nouveautes.js |

#### Règles visuelles communes (une règle = tous les endroits)
- **Prix à l'unité** (« 15,00 $ la recharge ») : gris (`var(--muted)`), poids 500, à l'écart du gros prix (`.pack-tile-price`, `.pack-mini-price`, `.pack-price span`).
- **Photos produits** : `object-fit:contain`, jamais rognées (boutique.css, boutique-accueil.css, accueil.css, spacer-catalog). Toujours vérifier `naturalWidth > 0`, et éviter `loading="lazy"` sur les petites vignettes au-dessus de la ligne de flottaison.
- **Pastille de couleur + ordre de la section Filaments** : § 2.12.
- **Requêtes publiques** : filtre explicite (`enabled`, `active`…), car la session admin passe la RLS (§ 1, `CA.sb`).

## 3. Valeurs codées en dur à plusieurs endroits

| Valeur | Où (changer partout) |
|---|---|
| Courriel admin `creationaudio.ca@gmail.com` | `schema-v2.sql` (`is_admin`, `_dealer_revoke`, `me_delete`, `customers_cleanup`) · `supabase-config.js` · `supabase-client.js` · EF `waitlist-notify`, `order-parse`, `compte-code` |
| Courriel public `contact@creationaudio.ca` | Pied de page et contact des pages publiques · pages légales (responsable Loi 25) |
| Projet Supabase `cqfmvdknppscazfynoiy` | `supabase-config.js` (URL + clé anon, aussi lus par `tools/build-spacer-pages.js`) · `schema-v2.sql` (`reservations_tick` → URL de reservation-notify) |
| Page admin `coulisses-t6avzpe2.html` | EF `reservation-notify`, `customer-order-notify`, `dealer-order-notify`, `message-notify` (liens dans les courriels) — **jamais** dans un fichier public |
| Domaine `creationaudio.ca` | `CNAME` · `SITE` des Edge Functions et de `build-spacer-pages.js` · `sitemap.xml`, `robots.txt` · canonical / Open Graph des pages |
| Taxes de vente TPS 5 % / TVQ 9,975 % | `cms-facturation.js` (défauts de Réglages › Entreprise) · taxe fournisseur Bambu 14,975 % : `cms-en-route.js` + `schema-v2.sql` (amorçage) |
| Réservation 72 h · suspension 60 j après 2 non récupérées | `schema-v2.sql` (`customer_reserve`, `_reservation_penalize`) · textes : `boutique.html`, `boutique.js`, `reservation-notify`, `cms-clients.js`, `confidentialite.html` |
| Liste d'attente 60 j · messagerie 12 mois · compte 3 ans | `schema-v2.sql` · `cms-messages.js` (purge) · **`confidentialite.html`** (engagement Loi 25 : à garder en accord) |

---

## 4. Dépendances hors code

| Dépendance | Sert à | Si elle tombe / change |
|---|---|---|
| **Supabase** (projet ca-central-1) | Base, Auth, Storage, Edge Functions, pg_cron, pg_net | Tout le site dynamique |
| Secrets Edge Functions : `RESEND_API_KEY`, `MAIL_FROM`, `ORDER_NOTIFY_TO`, `MESSAGE_NOTIFY_TO`, `ANTHROPIC_API_KEY` | Courriels, lecture IA des commandes | Voir § 2.8 (la liste exacte par fonction : dependances-auto § 4) |
| `private.secrets` : `auth_pepper`, `cron_key` | Mots de passe dérivés, appel du tick → reservation-notify | Pepper changé = connexions admin/dealer cassées ; cron_key absente = plus de rappels/expirations par courriel |
| **pg_cron** : `waitlist-cleanup`, `customers-cleanup`, `reservations-tick`, `i18n-tick` | Loi 25 + réservations + traduction anglaise | Réservations jamais expirées, données gardées trop longtemps ; textes de la base restés en français sur /en/ |
| **Resend** (domaine d'envoi vérifié) | Tous les courriels | Plus de connexion client (§ 2.8) |
| **GitHub Pages** (branche main, `CNAME`) | Hébergement : un push = production | — |
| **GitHub Actions** « Pages spacers » | Pages SEO spacers (FR + en/) aux 6 h + pages en/*.html (build-en.js) | Pages figées (le site reste fonctionnel) |
| **jsDelivr** `@supabase/supabase-js@2.117.3` (figé le 2026-10-11, + empreinte SRI) | Client Supabase de 6 pages + chargement à la demande par `nav.js` (Messagerie sur les pages légales / 404) | Mettre à jour = changer le n° **et** l'empreinte `integrity` aux 7 endroits (6 pages + constantes `SUPABASE_JS`/`SUPABASE_SRI` de nav.js), puis régénérer les pages spacers. Empreinte : `sha384-` + base64 du SHA-384 du fichier. Une empreinte fausse = le client ne se charge plus (site public et admin cassés) → vérifier dans le navigateur |
| **Google Fonts** (Inter, Space Grotesk) | Typo | Repli sur la police système |
| `assets/vendor/fflate-0.8.3.min.js` (copie locale) | ZIP des .gcode.3mf (AutoLoop) | — |

---

## 5. Démo & tests locaux (`.claude/demo`, non publiés)

Les mocks imitent les tables / RPC : un changement de signature de RPC ou de colonne = les mettre à jour, sinon la démo ment.
`demo-sb.js` + `fixtures.json` (`node .claude/demo/build-fixtures.js`) — admin · `orders-demo.js` — commandes dealer ·
`dealer-mock.js` — portail · `compte-mock.js`, `comptes-admin-mock.js` — comptes clients · `messages-admin-mock.js` — messagerie ·
`enroute-mock.js` — En route · `pending-mock.js` — À venir · `acc-mock.js` — accessoires boutique · `scan.js` — scanner de débordement.

---

## 6. Pièges et écarts relevés

**Encore ouverts** : aucun connu.

**Corrigé le 2026-10-21** :
- `cms-facturation.js` branchait son gabarit (`setCat`) sur **tous** les `.fx-seg-btn` du document : un clic sur un filtre de
  Messages / Commandes ou sur Bobine | Recharge (Production) remettait le gabarit de Facturation à rien (`cat = null`) et
  marquait « actifs » les boutons des autres onglets → limité à `.fx-seg-btn[data-cat]` (vu en ajoutant Silhouettes).

**Corrigés le 2026-10-11** :
- Annuler / supprimer une facture rouvre maintenant sa commande ou réservation d'origine (§ 2.5).
- Le Manque compte les réservations actives et les commandes en ligne ouvertes (§ 2.2).
- `supabase-js` figé en 2.117.3 avec empreinte SRI (§ 4).

**Corrigés le 2026-10-10** (revue initiale) :
- `update_invoice` transformait une facture **Interne** en facture client à la modification (SQL `case` sans `'internal'`) → corrigé dans `schema-v2.sql` et en base ; aucune facture n'avait été touchée.
- Éditeurs Filaments / Spacers / Accessoires, Inventaire (codes-barres, cibles, CMP), Facturation (code appris) écrivaient `attrs` (et le stock pour les éditeurs) depuis une copie possiblement périmée → `CA.updateProduct` (§ 1, § 2.2).
- Renommer une marque oubliait `fil_brands`, `taxes_fournisseur`, `supplier_orders`/`receipts.supplier` **et perdait l'ordre, le logo et le slug** de la marque (recréée puis supprimée) → renommage sur place + cascade (§ 2.6).
- `tokens.css` (`?v=3`/`4`) et `dialog.js` (`?v=2`/`3`) mélangés selon les pages → alignés.
- `#fx-cli-hint` (code mort de cms-facturation.js) retiré.

---

## 7. Checklists « si j'ajoute… »

**Une clé `attrs`** : l'écrire par `CA.updateProduct` (§ 1) · si elle contient un nom de marque → l'ajouter à `renameBrand` (§ 2.6) · lue en public → liste blanche `products_public` (+ `products_dealer` si spacer) dans `schema-v2.sql` puis appliquer · cherchable → les 4 recherches spacer (§ 2.11) · relancer le script (alerte si oubliée).

**Une table** : `schema-v2.sql` (idempotent) + RLS (`is_admin()`, ou RPC dédiée pour le public) + `revoke … from anon` si privée · appliquer via le connecteur · `get_advisors` · mock de démo.

**Une RPC** : `security definer` + `set search_path` + garde (`is_admin()` / `auth.uid()`) · `revoke all … from public, anon` puis `grant execute` au bon rôle · toujours tester `res.error` côté navigateur · si elle calcule un prix → règle du § 2.1.

**Une Edge Function** : `supabase/functions/<nom>/index.ts` · secrets à poser (dire lesquels à Théo) · lien admin dans un courriel = nom de l'onglet (§ 2.6) · relancer le script.

**Un onglet admin** : bouton `.tab` + `section.tabpanel` + module `cms-<nom>.js` (IIFE, `CA.onTab` chaîné) + `?v=` · texte sobre (une note d'en-tête max) · couleurs via `var(--ember)` · vérification visuelle (scan de débordement).

**Un réglage partagé (`admin_settings`)** : nouvelle clé, lue/écrite par un seul module si possible ; si le public doit la voir → fonction SQL dédiée (comme `company_public`), jamais d'accès direct.

**Un asset / une page publique** : `?v=` partout où il est chargé · nouvelle page = copier le chrome (en-tête, tiroir, pied) + `i18n.js` + `nav.js` + liens du pied + `sitemap.xml` si indexable · **version anglaise** : `PAGES` de build-en.js, textes au dictionnaire, `hreflang`, relancer build-en.js (§ 2.19) · texte affiché par un script = `_t('…')` + entrée dans i18n-en.js (`check-js.js`).

**Un fournisseur** (En route) : lecteur de format dans `cms-en-route.js` (`parseBambu` / `parseShop`) · taxe par défaut (`taxes_fournisseur`) · `order-parse` en repli.

**Un type de produit ou de format** : `products.type` est lu partout (vues, `_customer_fill_lines`, Facturation, Statistiques, Inventaire, boutique) → faire le tour de dependances-auto § 1 (`products`) avant de commencer.
