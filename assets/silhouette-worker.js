/* =========================================================
   Création Audio — Silhouettes : calculs en arrière-plan
   Garde l'image en gris et le cache des étapes (silhouette-engine.js) ;
   l'onglet reste fluide pendant qu'on glisse un curseur.
   Le ?v= de ce fichier sert aussi au moteur (même numéro, bumper les deux).
   Messages : image | compute | mesh | export  ->  image | result | mesh | file | error
   ========================================================= */
(function () {
  'use strict';
  var V = (/[?&]v=([\w.-]+)/.exec(self.location.search) || [])[1] || '1';
  importScripts('silhouette-engine.js?v=' + V, 'vendor/fflate-0.8.3.min.js');
  var E = self.SilEngine, ctx = null;

  self.onmessage = function (e) {
    var m = e.data || {};
    try {
      if (m.type === 'image') {
        ctx = E.context(m.gray, m.w, m.h);
        self.postMessage({ type: 'image', id: m.id, otsu: E.otsu(m.gray) });
        return;
      }
      if (!ctx) throw new Error('Aucune image chargée.');
      if (m.type === 'compute') {
        self.postMessage({ type: 'result', job: m.job, res: E.compute(ctx, m.params) });
      } else if (m.type === 'mesh') {
        var mesh = E.preview3d(ctx, m.params);
        self.postMessage({ type: 'mesh', job: m.job, mesh: mesh }, mesh.data ? [mesh.data.buffer] : []);
      } else if (m.type === 'export') {
        var f = E.exportFile(ctx, m.params, m.format, m.name);
        self.postMessage({ type: 'file', job: m.job, file: f }, f.bytes ? [f.bytes.buffer] : []);
      }
    } catch (err) {
      self.postMessage({ type: 'error', job: m.job, kind: m.type, message: String(err && err.message || err) });
    }
  };
})();
