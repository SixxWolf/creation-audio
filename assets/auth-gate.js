/* =========================================================
   Création Audio — connexion protégée (admin + portail dealer)
   CA.signIn(courriel, mdp) : le mot de passe passe par l'Edge Function
   « auth-gate » (anti force brute : 5 essais puis 15 min de blocage, compté
   côté serveur) ; la session reçue est installée dans le client partagé
   CA.sb (persistSession -> commune aux pages du site).
     -> Promise<{ ok:true } | { ok:false, message }>
   CA.mfa : double authentification (code TOTP d'une application
   d'authentification) — état de la session, code, ajout/retrait d'appareils.
   À charger APRÈS supabase-client.js.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';

  var cfg = window.CA_SUPABASE || {};
  function sb() { return window.CA.sb; }   // lu à l'appel (le mode démo remplace le client)
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

  // Repli si le portier est injoignable (non déployé, panne) : connexion directe.
  // Sans risque : un compte déjà converti a un mot de passe dérivé que seul le portier connaît.
  function direct(email, pass) {
    return sb().auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
      if (!res.error) return { ok: true };
      return { ok: false, message: res.error.status === 400 ? 'Courriel ou mot de passe incorrect.' : 'Connexion impossible. Réessaie.' };
    });
  }

  window.CA.signIn = function (email, pass) {
    if (!sb()) return Promise.resolve({ ok: false, message: 'Service indisponible.' });
    return fetch(cfg.url + '/functions/v1/auth-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify({ email: email, password: pass })
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    }).then(function (b) {
      b = b || {};
      if (b.session) {
        return sb().auth.setSession(b.session).then(function (s) {
          return s.error ? { ok: false, message: 'Connexion impossible. Réessaie.' } : { ok: true };
        });
      }
      if (b.error === 'locked') {
        return { ok: false, message: 'Trop d\'essais. Réessaie dans ' + plural(Math.max(1, Math.ceil((b.retry_after || 0) / 60)), 'minute', 'minutes') + '.' };
      }
      if (b.error === 'invalid') return { ok: false, message: 'Identifiants incorrects · ' + plural(b.left, 'essai restant', 'essais restants') + '.' };
      if (b.error === 'revoked') return { ok: false, message: 'Accès retiré. Contacte Création Audio.' };
      if (b.error === 'bad_request') return { ok: false, message: 'Courriel ou mot de passe invalide.' };
      return direct(email, pass);
    }, function () { return direct(email, pass); });
  };

  /* ---------- double authentification (TOTP) ---------- */
  function verified(f) { return f && f.status === 'verified'; }
  function codeError(e) {
    if (e && (e.status === 429 || /rate/i.test(e.code || ''))) return 'Trop d\'essais. Patiente une minute.';
    return 'Code invalide.';
  }
  function factors() {
    return sb().auth.mfa.listFactors().then(function (r) {
      if (r.error) throw r.error;
      return (r.data && r.data.all) || [];
    });
  }

  window.CA.mfa = {
    // 'ok' (code déjà validé) | 'challenge' (code requis) | 'enroll' (aucun appareil)
    state: function () {
      return sb().auth.mfa.getAuthenticatorAssuranceLevel().then(function (r) {
        if (r.error) throw r.error;
        var d = r.data || {};
        if (d.currentLevel === 'aal2') return 'ok';
        return d.nextLevel === 'aal2' ? 'challenge' : 'enroll';
      });
    },
    // appareils actifs : [{ id, friendly_name, created_at }]
    list: function () {
      return factors().then(function (all) {
        return all.filter(function (f) { return verified(f) && f.factor_type === 'totp'; });
      });
    },
    // Valide le code d'un des appareils (chaque appareil a son propre secret).
    verify: function (code) {
      return window.CA.mfa.list().then(function (fs) {
        var i = 0;
        function next(lastErr) {
          if (i >= fs.length) return { ok: false, message: codeError(lastErr) };
          var f = fs[i++];
          return sb().auth.mfa.challengeAndVerify({ factorId: f.id, code: code }).then(function (v) {
            return v.error ? next(v.error) : { ok: true };
          });
        }
        return next(null);
      });
    },
    // Nouvel appareil : secret + code QR (les essais non confirmés sont effacés d'abord).
    enroll: function () {
      return factors().then(function (all) {
        return Promise.all(all.filter(function (f) { return !verified(f); }).map(function (f) {
          return sb().auth.mfa.unenroll({ factorId: f.id });
        }));
      }).then(function () {
        return sb().auth.mfa.enroll({ factorType: 'totp', issuer: 'Création Audio', friendlyName: 'Appareil ' + Date.now().toString(36) });
      }).then(function (r) {
        if (r.error) throw r.error;
        return { id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret };
      });
    },
    confirm: function (factorId, code) {
      return sb().auth.mfa.challengeAndVerify({ factorId: factorId, code: code }).then(function (v) {
        return v.error ? { ok: false, message: codeError(v.error) } : { ok: true };
      });
    },
    remove: function (factorId) {
      return sb().auth.mfa.unenroll({ factorId: factorId }).then(function (r) { if (r.error) throw r.error; });
    }
  };

  // Champ code : chiffres seulement ; 6 chiffres saisis -> le formulaire part tout seul.
  window.CA.codeInput = function (input, form) {
    input.addEventListener('input', function () {
      var v = input.value.replace(/\D/g, '').slice(0, 6);
      if (v !== input.value) input.value = v;
      if (v.length === 6 && form) { if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
  };
})();
