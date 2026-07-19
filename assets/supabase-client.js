/* =========================================================
   Création Audio — client Supabase partagé
   Initialise le client à partir de assets/supabase-config.js
   et l'expose sur window.CA.sb (null si non configuré / hors ligne).
   À charger APRÈS supabase-config.js et le CDN @supabase/supabase-js.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';
  var cfg = window.CA_SUPABASE || {};
  var ok = cfg.url && cfg.anonKey && window.supabase && window.supabase.createClient;
  window.CA.sb = ok ? window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  }) : null;
  window.CA.ready = !!window.CA.sb;
})();
