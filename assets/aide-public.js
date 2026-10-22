/* =========================================================
   Création Audio — tutoriels du centre d'aide public (aide.html)
   [Bouton] = libellé tel qu'il apparaît sur le site ; garder les étapes courtes.
   ========================================================= */
(function () {
  'use strict';
  var GROUPS = ['Commander', 'Spacers', 'Mon compte', 'Après l\'achat', 'Dealers'];
  var TUTOS = [
    /* ---- Commander ---- */
    { id: 'commander', group: 'Commander', title: 'Commander sans compte',
      go: { href: 'boutique.html', label: 'Magasiner' }, keys: 'messenger courriel panier liste',
      steps: [
        'Ouvre la **Boutique** et choisis un matériau, puis une couleur.',
        'Choisis le format : **bobine** ou **recharge**, et la quantité.',
        'Clique [Ajouter au panier]. Répète pour chaque article.',
        'Ouvre le panier et clique [Copier ma liste & écrire sur Messenger] — ou [Écrire par courriel].',
        'On te confirme la disponibilité et le moment du ramassage.',
        'Tu paies au ramassage, à Québec.'
      ] },
    { id: 'commander-en-ligne', group: 'Commander', title: 'Commander en ligne avec ton compte',
      go: { href: 'compte.html', label: 'Mon compte' }, keys: 'envoyer commande connecte',
      steps: [
        'Connecte-toi dans **Mon compte** (voir « Créer un compte »).',
        'Ajoute tes articles au panier, comme d\'habitude.',
        'Dans le panier, ajoute une note au besoin (moment de ramassage, question…).',
        'Clique [Envoyer ma commande].',
        'Tu reçois une confirmation par courriel. On t\'écrit quand c\'est prêt.',
        'Suis ta commande dans **Mon compte › Commandes**.'
      ] },
    { id: 'rupture', group: 'Commander', title: 'Commander un article en rupture',
      go: { href: 'boutique.html', label: 'Boutique' }, keys: 'stock delai fournisseur commander',
      steps: [
        'Connecte-toi dans **Mon compte**.',
        'Sur la fiche, choisis le format en rupture et clique [Commander · 3 à 14 jours].',
        'Envoie ta commande : une fenêtre te rappelle les articles à commander et le délai.',
        'Clique [Compris, envoyer].',
        'On commande chez notre fournisseur et on t\'écrit dès l\'arrivée.'
      ],
      tip: 'Délai : 3 à 14 jours ouvrables pour les filaments et accessoires. Spacers : délai à confirmer.' },
    { id: 'modifier-commande', group: 'Commander', title: 'Modifier ou annuler une commande',
      go: { href: 'compte.html#/commandes', label: 'Mes commandes' }, keys: 'changer annulation',
      steps: [
        'Ouvre **Mon compte › Commandes**.',
        'Sur ta commande, clique [Modifier] : ton panier se remplit avec ses articles.',
        'Ajuste le panier, puis clique [Enregistrer les modifications].',
        'Pour tout annuler : [Annuler la commande].'
      ],
      tip: 'Possible tant que la commande est « Nouvelle ». Ensuite, écris-nous.' },
    { id: 'reserver', group: 'Commander', title: 'Réserver 72 h',
      go: { href: 'boutique.html', label: 'Boutique' }, keys: 'reservation garder',
      steps: [
        'Connecte-toi dans **Mon compte** (réservé aux clients approuvés).',
        'Ajoute des articles **en stock** au panier.',
        'Clique [Réserver 72 h], puis [Réserver].',
        'Les articles sont gardés pour toi 72 h. Tu reçois un rappel par courriel.',
        'Passe les chercher avant l\'échéance — ou [Annuler la réservation] dans **Mon compte › Commandes**.'
      ],
      tip: 'Deux réservations non récupérées suspendent les réservations 60 jours.' },
    { id: 'aviser', group: 'Commander', title: 'Être avisé du retour en stock',
      go: { href: 'boutique.html', label: 'Boutique' }, keys: 'alerte attente rupture m aviser',
      steps: [
        'Sur la fiche d\'une couleur, choisis le format en rupture.',
        'Entre ton courriel et clique [M\'aviser].',
        'Tu reçois un courriel dès que ça rentre.',
        'Connecté ? Tes alertes sont dans **Mon compte › Alertes**.'
      ] },

    /* ---- Spacers ---- */
    { id: 'trouver-spacer', group: 'Spacers', title: 'Trouver le spacer de ton véhicule',
      go: { href: 'spacers.html', label: 'Spacers' }, keys: 'adaptateur haut-parleur vehicule annee',
      steps: [
        'Ouvre **Spacers**.',
        'Tape ton véhicule et l\'année dans la recherche (ex. « civic 2008 ») — ou un code de pièce.',
        'Filtre par taille de haut-parleur au besoin.',
        'Ouvre la fiche : vérifie **Compatibilité** (véhicule, années, emplacement).',
        'Regarde **Haut-parleurs** : « Confirmé » = ajustement parfait, « Compatible* » = fonctionne avec un ajustement imparfait.',
        'Ajoute au panier et commande comme un filament.'
      ],
      tip: 'Ton véhicule n\'est pas listé ? Écris-nous avec la marque, le modèle et l\'année.' },

    /* ---- Mon compte ---- */
    { id: 'compte', group: 'Mon compte', title: 'Créer un compte ou te connecter',
      go: { href: 'compte.html', label: 'Mon compte' }, keys: 'connexion code inscription',
      steps: [
        'Ouvre **Mon compte** (icône en haut à droite).',
        'Entre ton courriel et clique [Recevoir mon code].',
        'Copie le code à 6 chiffres reçu par courriel (valide 10 minutes).',
        'Clique [Me connecter].',
        'Première fois : entre ton nom, puis [Continuer].'
      ],
      tip: 'Aucun mot de passe. Code pas reçu ? Vérifie les indésirables ou clique [Renvoyer le code].' },
    { id: 'factures', group: 'Mon compte', title: 'Retrouver tes factures',
      go: { href: 'compte.html#/commandes', label: 'Mes commandes' }, keys: 'historique achats facture',
      steps: [
        'Connecte-toi dans **Mon compte**.',
        'Ouvre **Commandes** : tes factures et commandes y sont listées.',
        'Des achats d\'avant ton compte manquent ? Écris-nous : on relie ton historique.'
      ] },
    { id: 'messagerie', group: 'Mon compte', title: 'Nous écrire',
      go: { href: 'compte.html#/messages', label: 'Messagerie' }, keys: 'message question contact photo',
      steps: [
        'Clique un lien **Écris-nous** sur le site, ou ouvre **Mon compte › Messages**.',
        'Connecte-toi si ce n\'est pas fait.',
        'Écris ton message. Joins des photos au besoin.',
        'Envoie. Tu reçois un courriel quand on répond.'
      ],
      tip: 'Aussi possible par Messenger ou à contact@creationaudio.ca.' },
    { id: 'profil', group: 'Mon compte', title: 'Modifier ton profil ou supprimer ton compte',
      go: { href: 'compte.html#/infos', label: 'Profil' }, keys: 'nom telephone suppression',
      steps: [
        'Ouvre **Mon compte › Profil**.',
        'Modifie ton nom ou ton téléphone, puis enregistre.',
        'Pour supprimer ton compte : [Supprimer mon compte], puis confirme.'
      ],
      tip: 'Les factures sont gardées 6 ans, comme l\'exige la loi.' },

    /* ---- Après l'achat ---- */
    { id: 'ramassage', group: 'Après l\'achat', title: 'Ramasser ta commande',
      go: { href: './#contact', label: 'Nous joindre' }, keys: 'cueillette paiement quebec',
      steps: [
        'Attends notre message : on confirme que c\'est prêt et le moment.',
        'Passe à Québec, secteur des Saules.',
        'Tu paies sur place. Garde ton numéro de facture.'
      ] },
    { id: 'retour', group: 'Après l\'achat', title: 'Retourner ou échanger un article',
      go: { href: 'retours.html', label: 'Politique de retour' }, keys: 'remboursement echange defaut',
      steps: [
        'Vérifie la politique : spacers retournables 14 jours, filaments vendus fermes.',
        'Écris-nous avec ton **numéro de facture**, le produit et la raison.',
        'Défaut ? Joins des photos.',
        'On organise l\'échange, le remplacement ou le remboursement.'
      ] },

    /* ---- Dealers ---- */
    { id: 'dealer', group: 'Dealers', title: 'Commander comme dealer',
      go: { href: 'dealer.html', label: 'Portail dealer' }, keys: 'revendeur gros prix',
      steps: [
        'Ouvre le **Portail dealer** et connecte-toi (courriel, mot de passe, puis code).',
        'Cherche par véhicule ou par code, puis ajoute les quantités.',
        'Ouvre [Ma commande], ajoute une note au besoin.',
        'Clique [Envoyer ma commande].',
        'Suis-la dans **Mes commandes** : modifiable ou annulable tant qu\'elle est « Nouvelle ».'
      ],
      tip: 'Pas encore dealer ? Écris-nous pour ouvrir un compte.' }
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
