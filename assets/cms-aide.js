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
        'Choisis le paiement : [Comptant] ou [Interac]. Obligatoire pour enregistrer.',
        'Clique [Enregistrer la facture] : le stock est déduit et le PDF part par courriel au client.',
        'Pas de courriel au dossier ? Remets-la avec [Imprimer / PDF].'
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
    { id: 'renvoyer-facture', group: 'Ventes', tab: 'historique', title: 'Renvoyer une facture par courriel',
      go: { href: '#historique', label: 'Historique' }, keys: 'courriel pdf envoyer client copie envoi automatique',
      steps: [
        'Ouvre **Historique**, puis la facture.',
        'Clique [Renvoyer] ([Envoyer] si rien n\'est encore parti), puis confirme.',
        'La pastille dit où ça en est : courriel envoyé, non envoyé ou pas de courriel.'
      ],
      tip: 'Pour couper l\'envoi automatique : **Réglages › Entreprise › Facture par courriel**.' },
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
        'Choisis [Production] (filament pris pour imprimer des spacers) ou [Autre] (toi, un projet).',
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
      go: { href: '#production', label: 'Production' }, keys: 'impression batch gcode filament',
      steps: [
        'Ouvre **Production**.',
        'Glisse le fichier .gcode.3mf (ou envoie-le depuis AutoLoop) : il passe **En impression**.',
        'Impression finie : clique [Terminé], ajuste les pièces bonnes et le filament (coût moyen du filament).',
        'Clique [Enregistrer la production] : les spacers entrent en stock.',
        'Pour retirer le filament du stock : **Facturation**, [Interne], [Production].'
      ] },
    { id: 'bobines-vides', group: 'Stock', tab: 'inventaire', title: 'Ajouter des bobines vides',
      go: { href: '#inventaire/reception', label: 'Réception' }, keys: 'scan vide revendre stock',
      steps: [
        'Ouvre **Inventaire › Réception**, puis [Réception sans commande] : les bobines vides ne viennent d\'aucune commande.',
        'Scanne chaque bobine vide : elle entre en stock pour la vente.',
        'Clique [Confirmer la réception].'
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
