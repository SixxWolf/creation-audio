/* =========================================================
   Création Audio — onglet Aide de l'admin (tutoriels étape par étape)
   Moteur partagé : aide.js (CAAide.mount). URL : #aide/<id>.
   Bouton « ? » dans la barre du haut : ouvre le 1er tuto de l'onglet courant (champ tab).
   [Bouton] = libellé tel qu'il apparaît dans l'admin ; garder les étapes courtes.
   ========================================================= */
(function () {
  'use strict';

  var CA = window.CA = window.CA || {};
  var panel = document.querySelector('[data-panel="aide"] .aide-root');
  if (!panel || !window.CAAide || !CA.route) return;

  var GROUPS = ['Ventes', 'Stock', 'Catalogue', 'Contacts', 'Atelier', 'Réglages'];
  var TUTOS = [
    /* ---- Ventes ---- */
    { id: 'facturer', group: 'Ventes', tab: 'facturation', title: 'Faire une facture',
      go: { href: '#facturation', label: 'Facturation' }, keys: 'vente caisse scan client imprimer pdf courriel',
      steps: [
        'Ouvre **Facturation**. Le scanner est déjà à l\'écoute.',
        'Scanne chaque article — ou ajoute-le avec [Filament], [Spacer], [Accessoire] ou [Ligne libre].',
        'Code inconnu ? Choisis l\'article, puis [Associer + ajouter] : il sera reconnu la prochaine fois.',
        'Choisis le client (ou [Dealer]).',
        'Clique [Enregistrer la facture] : le stock est déduit.',
        'Remets-la : [Imprimer / PDF] ou [Envoyer par courriel].'
      ] },
    { id: 'modifier-facture', group: 'Ventes', tab: 'historique', title: 'Modifier ou annuler une facture',
      go: { href: '#historique', label: 'Historique' }, keys: 'corriger erreur annulation',
      steps: [
        'Ouvre **Historique** et trouve la facture (recherche par n° ou client).',
        'Clique [Modifier] : elle se rouvre dans Facturation.',
        'Corrige les lignes, puis [Enregistrer les modifications]. Le stock est ajusté.',
        'Pour l\'annuler plutôt : [Annuler], puis [Annuler la facture]. Le stock est remis.'
      ],
      tip: 'Le prix et le coût d\'origine sont gardés : la marge ne change pas.' },
    { id: 'a-venir', group: 'Ventes', tab: 'historique', title: 'Remettre une commande en deux fois',
      go: { href: '#historique', label: 'Historique' }, keys: 'a venir remis partiel plus tard',
      steps: [
        'Dans **Facturation**, marque les lignes pas encore remises **À venir**.',
        'Enregistre : seul ce qui est remis sort du stock.',
        'Le reste attend dans **Historique › À remettre**.',
        'Le jour venu, ouvre la facture : [Remis] sur la ligne, ou [Tout remis].'
      ] },
    { id: 'interne', group: 'Ventes', tab: 'facturation', title: 'Sortir une bobine pour toi',
      go: { href: '#facturation', label: 'Facturation' }, keys: 'usage interne perso stock 0',
      steps: [
        'Dans **Facturation**, clique [Interne].',
        'Ajoute les articles pris : les prix passent à 0 $.',
        'Clique [Enregistrer la sortie] (n° INT-…).',
        'Retrouve-les dans **Historique › Usage interne**.'
      ] },
    { id: 'commande-client', group: 'Ventes', tab: 'commandes', title: 'Traiter une commande en ligne',
      go: { href: '#commandes', label: 'Commandes' }, keys: 'client en ligne facturer reservation dealer',
      steps: [
        'Ouvre **Commandes** : le badge compte les nouvelles.',
        'Choisis [Clients], [Dealers] ou [Réservations].',
        'Ouvre la commande et vérifie les articles.',
        'Au ramassage, clique [Facturer] : la facture se prépare toute seule.'
      ] },
    { id: 'nouvelle-commande', group: 'Ventes', tab: 'commandes', title: 'Entrer une commande dealer',
      go: { href: '#commandes', label: 'Commandes' }, keys: 'dealer gros',
      steps: [
        'Ouvre **Commandes** et clique [Nouvelle commande].',
        'Choisis le dealer, puis ajoute les pièces.',
        'Clique [Enregistrer la commande].'
      ] },
    { id: 'stats', group: 'Ventes', tab: 'statistiques', title: 'Voir les ventes et la marge',
      go: { href: '#statistiques/apercu', label: 'Statistiques' }, keys: 'chiffre affaires marge produits vendus',
      steps: [
        'Ouvre **Statistiques**.',
        'Choisis la période : [1 semaine] à [Tout].',
        '[Vue d\'ensemble] : ventes, marge, usage interne.',
        '[Produits vendus] : quoi, combien, à quelle marge.'
      ] },

    /* ---- Stock ---- */
    { id: 'commande-fournisseur', group: 'Stock', tab: 'inventaire', title: 'Noter une commande fournisseur',
      go: { href: '#inventaire/commander', label: 'À commander' }, keys: 'bambu en route j ai commande payment details',
      steps: [
        'Ouvre **Inventaire › À commander** pour voir ce qui manque.',
        'Passe ta commande chez le fournisseur.',
        'Clique [J\'ai commandé] et colle le texte de la commande.',
        'Clique [Analyser], vérifie les lignes, puis [Enregistrer la commande].',
        'Elle apparaît **En route** jusqu\'à la réception.'
      ] },
    { id: 'reception', group: 'Stock', tab: 'inventaire', title: 'Recevoir une commande',
      go: { href: '#inventaire/reception', label: 'Réception' }, keys: 'scan arrivage stock entrer',
      steps: [
        'Ouvre **Inventaire › Réception** et choisis la commande arrivée — ou [Réception sans commande].',
        'Scanne chaque bobine ou recharge : le décompte monte.',
        'Code inconnu ? Choisis l\'article, puis [Associer + compter].',
        'Clique [Confirmer la réception] : le stock et le coût moyen sont mis à jour.'
      ] },
    { id: 'cibles', group: 'Stock', tab: 'inventaire', title: 'Régler les cibles de stock',
      go: { href: '#inventaire/commander', label: 'À commander' }, keys: 'reappro minimum manque',
      steps: [
        'Ouvre **Inventaire › À commander**.',
        'Dans **Cibles de stock**, entre combien tu veux garder par format.',
        'La liste se recalcule : manque = cible − stock − en route.'
      ] },
    { id: 'codes', group: 'Stock', tab: 'inventaire', title: 'Associer ou vérifier un code-barres',
      go: { href: '#inventaire/codes', label: 'Codes-barres' }, keys: 'upc ean etiquette scanner',
      steps: [
        'Ouvre **Inventaire › Codes-barres**.',
        '[Associer un code] : choisis l\'article, puis scanne.',
        '[Scanner pour vérifier] : scanne pour voir à quoi un code correspond.'
      ] },
    { id: 'attente', group: 'Stock', tab: 'inventaire', title: 'Voir la liste d\'attente',
      go: { href: '#inventaire/attente', label: 'Liste d\'attente' }, keys: 'aviser alerte rupture',
      steps: [
        'Ouvre **Inventaire › Liste d\'attente** : qui attend quoi.',
        'Reçois l\'article : les personnes inscrites sont avisées par courriel.'
      ] },
    { id: 'production', group: 'Stock', tab: 'production', title: 'Enregistrer une production de spacers',
      go: { href: '#production', label: 'Production' }, keys: 'impression batch gcode bobine',
      steps: [
        'Ouvre **Production**.',
        'Bobine neuve sur l\'imprimante ? [Sortir une bobine], choisis-la, puis [Sortir du stock].',
        'Glisse le fichier .gcode.3mf (ou envoie-le depuis AutoLoop) : il passe **En impression**.',
        'Impression finie : clique [Terminé], ajuste les quantités.',
        'Clique [Enregistrer la production] : les spacers entrent en stock.'
      ] },
    { id: 'bobines-vides', group: 'Stock', tab: 'production', title: 'Gérer les bobines vides',
      go: { href: '#production', label: 'Production' }, keys: 'liberer garder revendre',
      steps: [
        'Une bobine finie apparaît dans **Bobines vides**.',
        '[Libérer] : elle entre en stock pour la vente.',
        '[Garder] : tu la gardes pour toi.'
      ] },

    /* ---- Catalogue ---- */
    { id: 'materiau', group: 'Catalogue', tab: 'filaments', title: 'Créer un matériau et ses prix',
      go: { href: '#filaments', label: 'Filaments' }, keys: 'prix palier pla petg marque',
      steps: [
        'Ouvre **Filaments** et clique [Nouveau matériau].',
        'Choisis la marque, entre le nom et le prix bobine / recharge.',
        'Prix dégressif ? [Ajouter un palier].',
        'Clique [Enregistrer] : toutes les couleurs de ce matériau suivent ce prix.'
      ] },
    { id: 'filament', group: 'Catalogue', tab: 'filaments', title: 'Ajouter une couleur de filament',
      go: { href: '#filaments', label: 'Filaments' }, keys: 'couleur nouveau stock photo',
      steps: [
        'Dans **Filaments**, clique [Nouveau filament].',
        'Choisis le matériau, puis la couleur (pastille).',
        'Entre le stock bobine / recharge et [Ajouter des photos].',
        'Clique [Enregistrer]. Elle apparaît dans la boutique.'
      ] },
    { id: 'spacer', group: 'Catalogue', tab: 'spacers', title: 'Ajouter un spacer',
      go: { href: '#spacers', label: 'Spacers' }, keys: 'adaptateur vehicule haut-parleur code',
      steps: [
        'Ouvre **Spacers** et clique [Nouveau spacer].',
        'Entre le code, le prix, le stock et [Ajouter des photos].',
        '[Ajouter un véhicule] pour chaque modèle et années compatibles.',
        '[Ajouter un haut-parleur] : marque, modèle, Confirmé ou Compatible.',
        'Clique [Enregistrer]. Sa page publique se crée au prochain passage du robot.'
      ] },
    { id: 'accessoire', group: 'Catalogue', tab: 'accessoires', title: 'Ajouter un accessoire',
      go: { href: '#accessoires', label: 'Accessoires' }, keys: 'produit nouveau',
      steps: [
        'Ouvre **Accessoires** et clique [Nouvel accessoire].',
        'Entre le nom, le prix, le stock et [Ajouter des photos].',
        'Clique [Enregistrer].'
      ] },

    /* ---- Contacts ---- */
    { id: 'messages', group: 'Contacts', tab: 'messages', title: 'Répondre à un message',
      go: { href: '#messages', label: 'Messages' }, keys: 'conversation client repondre regle',
      steps: [
        'Ouvre **Messages** : [Ouvertes] montre ce qui attend.',
        'Ouvre la conversation et réponds.',
        'Le client reçoit un courriel s\'il ne l\'a pas lue après 5 min.',
        'Réglé ? Clique [Réglée] : elle passe dans [Réglées].'
      ] },
    { id: 'client', group: 'Contacts', tab: 'clients', title: 'Relier un compte en ligne à un client',
      go: { href: '#clients', label: 'Clients' }, keys: 'compte historique relier reserver approuver',
      steps: [
        'Ouvre **Clients**, section **Comptes en ligne**.',
        'Sur le compte, clique [Relier] et choisis sa fiche client.',
        'Ses anciennes factures apparaissent dans son compte.',
        'Coche [Peut réserver] pour lui permettre de réserver 72 h.'
      ] },
    { id: 'dealer', group: 'Contacts', tab: 'dealers', title: 'Ouvrir un compte dealer',
      go: { href: '#dealers', label: 'Dealers' }, keys: 'revendeur portail acces',
      steps: [
        'Ouvre **Dealers** et clique [Ajouter un dealer].',
        'Entre le nom, le courriel du compte et les coordonnées.',
        'Clique [Enregistrer] : il peut se connecter au portail dealer.'
      ],
      tip: 'Supprimer un dealer coupe son accès tout de suite.' },

    /* ---- Atelier ---- */
    { id: 'autoloop', group: 'Atelier', tab: 'autoloop', title: 'Générer un batch AutoLoop',
      go: { href: '#autoloop', label: 'AutoLoop' }, keys: 'gcode imprimante batch',
      steps: [
        'Ouvre **AutoLoop › Générateur de batch**.',
        'Dépose le fichier .gcode.3mf et règle le nombre de passes.',
        'Clique [Générer le batch].',
        '[Télécharger le gcode], puis [Envoyer à la production].'
      ] },
    { id: 'calculateur', group: 'Atelier', tab: 'autoloop', title: 'Calculer un prix d\'impression',
      go: { href: '#autoloop', label: 'AutoLoop' }, keys: 'prix cout paire piece',
      steps: [
        'Ouvre **AutoLoop › Calculateur de prix**.',
        'Dépose le fichier ou entre le temps et le poids.',
        'Lis le coût et le prix suggéré, à la pièce ou à la paire.'
      ] },
    { id: 'silhouette', group: 'Atelier', tab: 'silhouettes', title: 'Créer une silhouette murale',
      go: { href: '#silhouettes', label: 'Silhouettes' }, keys: 'image mur decoupe ia',
      steps: [
        'Ouvre **Silhouettes** : [Mon image] ou [De zéro].',
        'Au besoin, [Préparer avec l\'IA].',
        'Retouche avec [Pinceau] et [Gomme], puis [Valider].',
        'Vérifie en [Mur] et [3D], puis exporte.'
      ] },

    /* ---- Réglages ---- */
    { id: 'accent', group: 'Réglages', tab: 'apparence', title: 'Changer la couleur des accents',
      go: { href: '#apparence', label: 'Apparence' }, keys: 'couleur theme orange',
      steps: [
        'Ouvre **Apparence**.',
        'Choisis une couleur : tout l\'admin suit.',
        'Pour revenir : [Orange d\'origine].'
      ] },
    { id: 'fond-dealer', group: 'Réglages', tab: 'apparence', title: 'Changer le fond du portail dealer',
      go: { href: '#apparence', label: 'Apparence' }, keys: 'couleur gris dealer portail olivier',
      steps: [
        'Ouvre **Apparence**, section **Portail dealer**.',
        'Choisis une pastille ou une **Couleur libre** : le portail suit au prochain chargement.',
        'Pour revenir : [Gris d\'origine].'
      ] },
    { id: 'appareil', group: 'Réglages', tab: 'securite', title: 'Ajouter un appareil (double authentification)',
      go: { href: '#securite', label: 'Sécurité' }, keys: '2fa code telephone connexion',
      steps: [
        'Ouvre **Sécurité**.',
        'Clique [Ajouter un appareil] et scanne le code QR avec ton appli d\'authentification.',
        'Entre le **Code affiché**, puis [Ajouter].'
      ] },
    { id: 'entreprise', group: 'Réglages', tab: 'entreprise', title: 'Modifier les infos des factures',
      go: { href: '#entreprise', label: 'Entreprise' }, keys: 'tps tvq taxes logo adresse',
      steps: [
        'Ouvre **Entreprise**.',
        'Modifie coordonnées, n° TPS · TVQ, taux ou logo.',
        'Clique [Enregistrer] : les prochaines factures suivent.'
      ] },
    { id: 'recherche', group: 'Réglages', tab: 'aujourdhui', title: 'Tout retrouver avec Ctrl K',
      keys: 'recherche raccourci facture client',
      steps: [
        'Appuie sur **Ctrl K** (ou [Rechercher] en haut).',
        'Tape un n° de facture, un client, une couleur ou un code.',
        'Entrée : tu y vas directement.'
      ] }
  ];

  // onglet absent de cette version de l'admin → son tuto est masqué
  TUTOS = TUTOS.filter(function (t) { return !t.tab || document.querySelector('.tab[data-tab="' + t.tab + '"]'); });

  var ui = window.CAAide.mount(panel, {
    groups: GROUPS, tutos: TUTOS, placeholder: 'Rechercher : facture, réception, spacer…',
    get: function () { var r = CA.route.get(); return r.tab === 'aide' ? r.sub : null; },
    set: function (id) { CA.route.goSub(id); }
  });
  CA.route.onSub(function (sub, tab) { if (tab === 'aide') ui.show(sub); });

  /* ---- bouton « ? » : aide de l'onglet courant ---- */
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm btn-icon aide-btn';
    btn.setAttribute('aria-label', 'Aide de cet onglet');
    btn.title = 'Aide';
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6"/><circle cx="12" cy="17.2" r=".6"/></svg>';
    btn.addEventListener('click', function () {
      var tab = document.body.getAttribute('data-tab');
      var t = TUTOS.filter(function (x) { return x.tab === tab; })[0];
      location.hash = '#aide' + (t ? '/' + t.id : '');
    });
    toggle.parentNode.insertBefore(btn, toggle);
  }
})();
