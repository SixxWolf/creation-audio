/* =========================================================
   Création Audio V2 — configuration Supabase
   ---------------------------------------------------------
   La clé « publishable » (sb_publishable_...) est PUBLIQUE par
   design : la sécurité vient des règles RLS (V2/supabase/schema-v2.sql).
   Ne mets JAMAIS la clé « secret » (sb_secret_...) ici.
   ========================================================= */
window.CA_SUPABASE = {
  url: 'https://cqfmvdknppscazfynoiy.supabase.co',
  anonKey: 'sb_publishable_FdytIYT-VYT0rghOIqHfqA_dBBsR3Wo'
};

/* Compte admin autorisé à écrire (doit correspondre au SQL). */
window.CA_ADMIN_EMAIL = 'creationaudio.ca@gmail.com';
