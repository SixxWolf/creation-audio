/* =========================================================
   Création Audio — tutoriels du centre d'aide public (aide.html)
   [Bouton] = libellé tel qu'il apparaît sur le site ; garder les étapes courtes.
   ========================================================= */
(function () {
  'use strict';
  var _t = window.CA.t;    // tutoriels anglais : assets/i18n-en.js (libellés = boutons de la version anglaise)
  var GROUPS = ['Commander', _t('Spacers'), _t('Mon compte'), _t('Après l\'achat'), _t('Dealers')];
  var TUTOS = [
    /* ---- Commander ---- */
    { id: 'commander', group: _t('Commander'), title: _t('Commander sans compte'),
      go: { href: 'boutique.html', label: _t('Magasiner') }, keys: _t('messenger courriel panier liste'),
      steps: [
        'Ouvre la **Boutique** et choisis un matériau, puis une couleur.',
        _t('Choisis le format : **bobine** ou **recharge**, et la quantité.'),
        _t('Clique [Ajouter au panier]. Répète pour chaque article.'),
        _t('Ouvre le panier et clique [Copier ma liste & écrire sur Messenger] — ou [Écrire par courriel].'),
        _t('On te confirme la disponibilité et le moment du ramassage.'),
        _t('Tu paies au ramassage, à Québec.')
      ] },
    { id: 'commander-en-ligne', group: _t('Commander'), title: _t('Commander en ligne avec ton compte'),
      go: { href: 'compte.html', label: _t('Mon compte') }, keys: _t('envoyer commande connecte'),
      steps: [
        'Connecte-toi dans **Mon compte** (voir « Créer un compte »).',
        _t('Ajoute tes articles au panier, comme d\'habitude.'),
        _t('Dans le panier, ajoute une note au besoin (moment de ramassage, question…).'),
        'Clique [Envoyer ma commande].',
        _t('Tu reçois une confirmation par courriel. On t\'écrit quand c\'est prêt.'),
        _t('Suis ta commande dans **Mon compte › Commandes**.')
      ] },
    { id: 'rupture', group: _t('Commander'), title: _t('Commander un article en rupture'),
      go: { href: 'boutique.html', label: _t('Boutique') }, keys: _t('stock delai fournisseur commander'),
      steps: [
        'Connecte-toi dans **Mon compte**.',
        _t('Sur la fiche, choisis le format en rupture et clique [Commander · 3 à 14 jours].'),
        _t('Envoie ta commande : une fenêtre te rappelle les articles à commander et le délai.'),
        'Clique [Compris, envoyer].',
        _t('On commande chez notre fournisseur et on t\'écrit dès l\'arrivée.')
      ],
      tip: _t('Délai : 3 à 14 jours ouvrables pour les filaments et accessoires. Spacers : délai à confirmer.') },
    { id: 'modifier-commande', group: _t('Commander'), title: _t('Modifier ou annuler une commande'),
      go: { href: 'compte.html#/commandes', label: _t('Mes commandes') }, keys: _t('changer annulation'),
      steps: [
        'Ouvre **Mon compte › Commandes**.',
        _t('Sur ta commande, clique [Modifier] : ton panier se remplit avec ses articles.'),
        _t('Ajuste le panier, puis clique [Enregistrer les modifications].'),
        _t('Pour tout annuler : [Annuler la commande].')
      ],
      tip: _t('Possible tant que la commande est « Nouvelle ». Ensuite, écris-nous.') },
    { id: 'reserver', group: _t('Commander'), title: _t('Réserver 72 h'),
      go: { href: 'boutique.html', label: _t('Boutique') }, keys: _t('reservation garder'),
      steps: [
        'Connecte-toi dans **Mon compte** (réservé aux clients approuvés).',
        _t('Ajoute des articles **en stock** au panier.'),
        _t('Clique [Réserver 72 h], puis [Réserver].'),
        _t('Les articles sont gardés pour toi 72 h. Tu reçois un rappel par courriel.'),
        _t('Passe les chercher avant l\'échéance — ou [Annuler la réservation] dans **Mon compte › Commandes**.')
      ],
      tip: _t('Deux réservations non récupérées suspendent les réservations 60 jours.') },
    { id: 'aviser', group: _t('Commander'), title: _t('Être avisé du retour en stock'),
      go: { href: 'boutique.html', label: _t('Boutique') }, keys: _t('alerte attente rupture m aviser'),
      steps: [
        'Sur la fiche d\'une couleur, choisis le format en rupture.',
        _t('Entre ton courriel et clique [M\'aviser].'),
        _t('Tu reçois un courriel dès que ça rentre.'),
        _t('Connecté ? Tes alertes sont dans **Mon compte › Alertes**.')
      ] },

    /* ---- Spacers ---- */
    { id: 'trouver-spacer', group: _t('Spacers'), title: _t('Trouver le spacer de ton véhicule'),
      go: { href: 'spacers.html', label: _t('Spacers') }, keys: _t('adaptateur haut-parleur vehicule annee'),
      steps: [
        'Ouvre **Spacers**.',
        _t('Tape ton véhicule et l\'année dans la recherche (ex. « civic 2008 ») — ou un code de pièce.'),
        _t('Filtre par taille de haut-parleur au besoin.'),
        _t('Ouvre la fiche : vérifie **Compatibilité** (véhicule, années, emplacement).'),
        _t('Regarde **Haut-parleurs** : « Confirmé » = ajustement parfait, « Compatible* » = fonctionne avec un ajustement imparfait.'),
        _t('Ajoute au panier et commande comme un filament.')
      ],
      tip: _t('Ton véhicule n\'est pas listé ? Écris-nous avec la marque, le modèle et l\'année.') },

    /* ---- Mon compte ---- */
    { id: 'compte', group: _t('Mon compte'), title: _t('Créer un compte ou te connecter'),
      go: { href: 'compte.html', label: _t('Mon compte') }, keys: _t('connexion code inscription'),
      steps: [
        'Ouvre **Mon compte** (icône en haut à droite).',
        _t('Entre ton courriel et clique [Recevoir mon code].'),
        _t('Copie le code à 6 chiffres reçu par courriel (valide 10 minutes).'),
        'Clique [Me connecter].',
        _t('Première fois : entre ton nom, puis [Continuer].')
      ],
      tip: _t('Aucun mot de passe. Code pas reçu ? Vérifie les indésirables ou clique [Renvoyer le code].') },
    { id: 'factures', group: _t('Mon compte'), title: _t('Retrouver tes factures'),
      go: { href: 'compte.html#/commandes', label: _t('Mes commandes') }, keys: _t('historique achats facture'),
      steps: [
        'Connecte-toi dans **Mon compte**.',
        _t('Ouvre **Commandes** : tes factures et commandes y sont listées.'),
        _t('Des achats d\'avant ton compte manquent ? Écris-nous : on relie ton historique.')
      ] },
    { id: 'messagerie', group: _t('Mon compte'), title: _t('Nous écrire'),
      go: { href: 'compte.html#/messages', label: _t('Messagerie') }, keys: _t('message question contact photo'),
      steps: [
        'Clique un lien **Écris-nous** sur le site, ou ouvre **Mon compte › Messages**.',
        _t('Connecte-toi si ce n\'est pas fait.'),
        _t('Écris ton message. Joins des photos au besoin.'),
        _t('Envoie. Tu reçois un courriel quand on répond.')
      ],
      tip: _t('Aussi possible par Messenger ou à contact@creationaudio.ca.') },
    { id: 'profil', group: _t('Mon compte'), title: _t('Modifier ton profil ou supprimer ton compte'),
      go: { href: 'compte.html#/infos', label: _t('Profil') }, keys: _t('nom telephone suppression'),
      steps: [
        'Ouvre **Mon compte › Profil**.',
        _t('Modifie ton nom ou ton téléphone, puis enregistre.'),
        _t('Pour supprimer ton compte : [Supprimer mon compte], puis confirme.')
      ],
      tip: _t('Les factures sont gardées 6 ans, comme l\'exige la loi.') },

    /* ---- Après l'achat ---- */
    { id: 'ramassage', group: _t('Après l\'achat'), title: _t('Ramasser ta commande'),
      go: { href: './#contact', label: _t('Nous joindre') }, keys: _t('cueillette paiement quebec'),
      steps: [
        'Attends notre message : on confirme que c\'est prêt et le moment.',
        _t('Passe à Québec, secteur des Saules.'),
        _t('Tu paies sur place. Garde ton numéro de facture.')
      ] },
    { id: 'retour', group: _t('Après l\'achat'), title: _t('Retourner ou échanger un article'),
      go: { href: 'retours.html', label: _t('Politique de retour') }, keys: _t('remboursement echange defaut'),
      steps: [
        'Vérifie la politique : spacers retournables 14 jours, filaments vendus fermes.',
        _t('Écris-nous avec ton **numéro de facture**, le produit et la raison.'),
        _t('Défaut ? Joins des photos.'),
        _t('On organise l\'échange, le remplacement ou le remboursement.')
      ] },

    /* ---- Dealers ---- */
    { id: 'dealer', group: _t('Dealers'), title: _t('Commander comme dealer'),
      go: { href: 'dealer.html', label: _t('Portail dealer') }, keys: _t('revendeur gros prix'),
      steps: [
        'Ouvre le **Portail dealer** et connecte-toi (courriel, mot de passe, puis code).',
        _t('Cherche par véhicule ou par code, puis ajoute les quantités.'),
        _t('Ouvre [Ma commande], ajoute une note au besoin.'),
        'Clique [Envoyer ma commande].',
        _t('Suis-la dans **Mes commandes** : modifiable ou annulable tant qu\'elle est « Nouvelle ».')
      ],
      tip: _t('Pas encore dealer ? Écris-nous pour ouvrir un compte.') }
  ];

  var root = document.getElementById('aide');
  if (!root || !window.CAAide) return;
  var ui = window.CAAide.mount(root, {
    groups: GROUPS, tutos: TUTOS,
    get: function () { return (location.hash || '').replace(/^#\/?/, '') || null; },
    set: function (id) { history.replaceState(null, '', id ? '#/' + id : location.pathname); }
  });
  window.addEventListener('hashchange', function () { ui.show((location.hash || '').replace(/^#\/?/, '') || null); });
})();
