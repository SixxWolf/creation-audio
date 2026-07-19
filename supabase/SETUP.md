# Panneau admin — installation Supabase

Objectif : un panneau admin (connexion + inventaire modifiable) branché à Supabase,
pendant que le site reste hébergé gratuitement sur GitHub Pages.

> Le site n'utilise plus qu'**une seule table : l'inventaire**. Le suivi des commandes
> et la messagerie ont été retirés — les clients contactent directement via **Messenger**.

## Ce que TU fais (une seule fois, ~10 min)

1. **Crée un compte** gratuit sur https://supabase.com → **New project**.
   - Donne un nom (ex. `creation-audio`), choisis une région proche (Canada/US East),
     note le mot de passe de la base (tu n'en auras pas besoin pour le site).

2. **Crée la table** : dans le projet → menu **SQL Editor** → **New query** →
   colle le contenu de `supabase/schema.sql` → **Run**.
   (Ça crée l'inventaire, les règles de sécurité RLS et les 30 couleurs PLA Basic.)
   Puis fais de même avec `supabase/insert-materials.sql` (les autres matériaux).

3. **Crée ton identifiant admin** : menu **Authentication** → **Users** → **Add user** →
   entre TON courriel + un mot de passe. C'est cette connexion qui ouvrira le panneau admin.
   - (Optionnel mais conseillé : **Authentication → Providers → Email** → désactive
     « Enable email confirmations » pour te connecter tout de suite.)

3b. ⚠️ **IMPORTANT — SÉCURITÉ : désactive les inscriptions publiques.**
   Le panneau admin donne accès à tout compte connecté. Par défaut, Supabase laisse
   n'importe qui s'inscrire → il faut le bloquer pour que TOI seul puisses te connecter.
   Va dans **Authentication → Sign In / Providers** (ou **Authentication → Settings**)
   et **désactive « Allow new users to sign up » / « User Signups »**.

4. **Récupère les 2 clés** : menu **Project Settings** (roue dentée) → **API** :
   - **Project URL**  (ressemble à `https://xxxx.supabase.co`)
   - **anon / publishable key** — *faite pour être publique côté site ; la sécurité
     vient des règles RLS, pas du secret de la clé.*

Ces valeurs vont dans `assets/supabase-config.js`.

## Fichiers SQL

| Fichier | Rôle |
|---|---|
| `schema.sql` | Crée la table `inventory` + RLS + 30 couleurs de départ |
| `insert-materials.sql` | Ajoute les autres matériaux (PLA Matte, PETG, ABS) |
| `drop-orders-messages.sql` | (déjà utilisé) Supprime les anciennes tables `orders` / `messages` |

## Notes

- **Coût** : gratuit pour ton volume (offre gratuite Supabase largement suffisante).
- **Sécurité** : la clé `anon` est publique par design ; ce sont les règles RLS
  (dans `schema.sql`) qui protègent les données. L'inventaire est **lisible par tous**
  (souhaité) et **modifiable seulement par l'admin connecté**. Il n'y a plus aucune
  table contenant des données personnelles.
- Ça ajoute **une petite librairie externe** (le client Supabase, chargé depuis un CDN) —
  nécessaire pour parler à la base.
