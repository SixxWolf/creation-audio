/* =========================================================
   Création Audio — aperçu 3D partagé (CA.ap3d) : page Impression 3D, Messagerie, admin.
   Tout se lit dans le navigateur ; rien ne repart vers le serveur.
   - viewer(canvas, opts) : dessine une pièce (triangles) ou un G-code (trajets en cordons ronds, curseur de couches, Lecture).
     Dessiné à la demande seulement : pas de boucle, sauf pendant une animation.
   - controls(host, view, opts) : curseur, Lecture, légende, bouton Filament, zoom.
   - reader(file, h) : le Worker impression-3mf.js (3MF et G-code).
   - makePreview(file, onProgress) / readCapv(buf) : le petit fichier d'aperçu (.capv) que l'admin joint à une réponse.
     Il ne contient que les trajets et les chiffres : ni G-code, ni réglages, ni compte Bambu.
   - show({ name, url | blob, ext }) : la fenêtre « Voir en 3D » par-dessus la conversation.
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};
  if (CA.ap3d) return;
  var me = document.currentScript;
  var BASE = me && me.src ? me.src.replace(/apercu-3d\.js.*$/, '') : 'assets/';
  var WORKER = BASE + 'impression-3mf.js?v=3';
  var _t = CA.t || function (s) { return s; };
  var EN = CA.lang === 'en';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var css0 = document.createElement('link');
  css0.rel = 'stylesheet';
  css0.href = BASE + 'apercu-3d.css?v=1';
  document.head.appendChild(css0);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n, d) { return n.toLocaleString(CA.locale || 'fr-CA', { maximumFractionDigits: d || 0 }); }
  function coarse() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
  function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); }
  function cssRgb(c) { return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; }
  function accent() {
    var v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue('--ember').trim(); } catch (e) { /* valeur par défaut */ }
    return /^#[0-9a-f]{6}$/i.test(v) ? hexRgb(v) : [0.949, 0.463, 0.18];
  }
  /* Types de lignes : couleurs et ordre de Bambu Studio (BaseRenderer.cpp, Extrusion_Role_Colors). Les numéros suivent gtype() dans impression-3mf.js. */
  var TYPES = [
    [[1, 0.9, 0.3], _t('Mur intérieur')], [[1, 0.49, 0.22], _t('Mur extérieur')], [[0.12, 0.12, 1], _t('Mur en surplomb')],
    [[0.69, 0.19, 0.16], _t('Remplissage')], [[0.59, 0.33, 0.8], _t('Remplissage solide interne')], [[0.9, 0.7, 0.7], _t('Coque verticale flottante')],
    [[0.94, 0.25, 0.25], _t('Surface supérieure')], [[0.4, 0.36, 0.78], _t('Surface inférieure')], [[1, 0.55, 0.41], _t('Lissage')],
    [[0.3, 0.5, 0.73], _t('Pont')], [[1, 1, 1], _t("Remplissage d'espace")], [[0, 1, 0], _t('Supports')],
    [[0, 0.5, 0], _t('Interface de support')], [[0, 0.25, 0], _t('Transition de support')], [[0.6, 1, 0.6], _t('Lissage de support')],
    [[0.7, 0.89, 0.67], _t('Tour de purge')], [[0, 0.53, 0.43], _t('Jupe')], [[0, 0.23, 0.43], _t('Bordure')], [[0.37, 0.82, 0.58], _t('Autre')]
  ];
  function liftDark(c) { return c.map(function (v) { return Math.max(v, 0.2); }); }   // un filament noir garde son relief

  /* =========================================================
     Maillages : tout finit en un Float32Array de triangles (x,y,z × 3 × n), posé sur le plateau et centré.
     ========================================================= */
  function fromTris(raw, n) {
    var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    var i, vol = 0, area = 0;
    for (i = 0; i < n * 9; i += 3) {
      var x = raw[i], y = raw[i + 1], z = raw[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!n || !isFinite(minX + maxX + minY + maxY + minZ + maxZ)) return null;
    if (Math.max(maxX - minX, maxY - minY, maxZ - minZ) > 1e5) return null;   // 100 m : fichier abîmé, pas une pièce
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (i = 0; i < n * 9; i += 9) {
      var ax = raw[i] - cx, ay = raw[i + 1] - cy, az = raw[i + 2] - minZ;
      var bx = raw[i + 3] - cx, by = raw[i + 4] - cy, bz = raw[i + 5] - minZ;
      var dx = raw[i + 6] - cx, dy = raw[i + 7] - cy, dz = raw[i + 8] - minZ;
      raw[i] = ax; raw[i + 1] = ay; raw[i + 2] = az;
      raw[i + 3] = bx; raw[i + 4] = by; raw[i + 5] = bz;
      raw[i + 6] = dx; raw[i + 7] = dy; raw[i + 8] = dz;
      vol += ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx);
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = dx - ax, vy = dy - ay, vz = dz - az;
      var cxx = uy * vz - uz * vy, cyy = uz * vx - ux * vz, czz = ux * vy - uy * vx;
      area += Math.sqrt(cxx * cxx + cyy * cyy + czz * czz) / 2;
    }
    if (vol < 0) {       // normales inversées : on retourne les triangles, l'aperçu s'en sert pour l'intérieur
      for (i = 0; i < n * 9; i += 9) {
        var t0 = raw[i + 3], t1 = raw[i + 4], t2 = raw[i + 5];
        raw[i + 3] = raw[i + 6]; raw[i + 4] = raw[i + 7]; raw[i + 5] = raw[i + 8];
        raw[i + 6] = t0; raw[i + 7] = t1; raw[i + 8] = t2;
      }
    }
    return { pos: raw, count: n * 3, size: [maxX - minX, maxY - minY, maxZ - minZ], volume: Math.abs(vol) / 6, area: area };
  }

  function parseSTL(buf) {
    var dv = new DataView(buf), n = buf.byteLength > 84 ? dv.getUint32(80, true) : 0, raw, i, o, k;
    if (buf.byteLength === 84 + n * 50) {       // binaire
      raw = new Float32Array(n * 9);
      for (i = 0, o = 96, k = 0; i < n; i++, o += 50) {
        for (var j = 0; j < 9; j++) raw[k++] = dv.getFloat32(o + j * 4, true);
      }
      return fromTris(raw, n);
    }
    var txt = new TextDecoder().decode(buf), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, m, list = [];
    while ((m = re.exec(txt))) list.push(+m[1], +m[2], +m[3]);
    n = Math.floor(list.length / 9);
    return fromTris(new Float32Array(list), n);
  }

  function parseOBJ(buf) {
    var txt = new TextDecoder().decode(buf), vs = [], out = [], lines = txt.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.charCodeAt(0) === 118 && l.charCodeAt(1) === 32) {       // « v »
        var p = l.trim().split(/\s+/);
        vs.push(+p[1], +p[2], +p[3]);
      } else if (l.charCodeAt(0) === 102 && l.charCodeAt(1) === 32) { // « f »
        var f = l.trim().split(/\s+/), idx = [];
        for (var j = 1; j < f.length; j++) {
          var v = parseInt(f[j], 10);
          idx.push(v < 0 ? vs.length / 3 + v : v - 1);
        }
        for (var t = 1; t + 1 < idx.length; t++) {
          [idx[0], idx[t], idx[t + 1]].forEach(function (a) { out.push(vs[a * 3], vs[a * 3 + 1], vs[a * 3 + 2]); });
        }
      }
    }
    return fromTris(new Float32Array(out), Math.floor(out.length / 9));
  }

  function fmtDim(mesh) {
    return mesh.size.map(function (v) { return num(v, v < 10 ? 1 : 0); }).join(' × ') + ' mm';
  }
  function fmtWeight(g) { return g >= 1000 ? num(g / 1000, 1) + ' kg' : num(Math.max(1, g), g < 10 ? 1 : 0) + ' g'; }
  function fmtTime(s) {
    var m = Math.max(1, Math.round(s / 60)), h = Math.floor(m / 60);
    m -= h * 60;
    if (!h) return m + ' min';
    return EN ? h + ' h ' + m + ' min' : h + ' h ' + (m < 10 ? '0' : '') + m;
  }

  /* =========================================================
     Nuanceurs
     ========================================================= */
  var VS = 'attribute vec3 aP;uniform mat4 uVP;uniform mat4 uV;varying vec3 vW;varying vec3 vV;' +
    'void main(){vW=aP;vV=(uV*vec4(aP,1.)).xyz;gl_Position=uVP*vec4(aP,1.);}';
  var FS = '#extension GL_OES_standard_derivatives : enable\n' +
    '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform vec3 uC;uniform float uClip;uniform float uTop;uniform float uLayer;varying vec3 vW;varying vec3 vV;' +
    'void main(){if(vW.z>uClip)discard;' +
    'vec3 n=normalize(cross(dFdx(vV),dFdy(vV)));vec3 w=normalize(cross(dFdx(vW),dFdy(vW)));' +
    'vec3 k=normalize(vec3(-.45,.75,.6));vec3 f=normalize(vec3(.7,.15,.5));' +
    'float dk=max(dot(n,k),0.);float df=max(dot(n,f),0.);float rim=pow(1.-max(n.z,0.),3.);' +
    'float sp=pow(max(dot(n,normalize(k+vec3(0.,0.,1.))),0.),48.);' +
    'vec3 a=max(uC,vec3(.15));vec3 c=a*(.38+.6*dk+.17*df)+vec3(.09*rim+.14*sp);' +
    'float t=vW.z/uLayer;float aa=clamp(1.-fwidth(t)*1.5,0.,1.);c*=1.+(1.-abs(w.z))*aa*.075*sin(t*6.2832);' +
    'if(uClip<uTop){if(!gl_FrontFacing)c*=.5;float e=clamp(1.-(uClip-vW.z)/(uLayer*1.6),0.,1.);c=mix(c,vec3(1.,.93,.72),e*.6);}' +
    'gl_FragColor=vec4(c,1.);}';
  var VS_P = 'attribute vec2 aP;uniform mat4 uVP;uniform float uQ;varying vec2 vP;' +
    'void main(){vP=aP*uQ;gl_Position=uVP*vec4(vP,0.,1.);}';
  // uRect : centre x,y et demi-largeurs du vrai plateau (3MF) ; z = 0 : pas de plateau, la grille s'estompe seule
  var FS_P = '#extension GL_OES_standard_derivatives : enable\nprecision highp float;' +
    'uniform float uR;uniform float uFoot;uniform float uGrid;uniform vec4 uRect;varying vec2 vP;' +
    'void main(){float d=length(vP)/uR;float fade=1.-smoothstep(.5,1.,d);vec2 q=uRect.z>0.?vP-uRect.xy+uRect.zw:vP;' +
    'vec2 g=abs(fract(q/uGrid-.5)-.5)/fwidth(q/uGrid);float l=1.-min(min(g.x,g.y),1.);' +
    'float a;if(uRect.z>0.){vec2 e=abs(vP-uRect.xy)-uRect.zw;float s=max(e.x,e.y);float w=fwidth(s);' +
    'a=(.055+l*.085*fade)*(1.-smoothstep(-w,w,s))+.42*(1.-smoothstep(w*.7,w*1.7,abs(s)));}' +
    'else{float sh=exp(-pow(length(vP)/uFoot,4.))*.2;a=(.035+l*.085)*fade;a=a+sh*(1.-a);}' +
    'gl_FragColor=vec4(vec3(.09,.1,.12)*a,a);}';
  /* Cordons : chaque segment est un ruban tourné vers l'œil, aussi large que le vrai cordon vu de cet angle ;
     la lumière suit une section ronde. A et B : x,y,z en 0,02 mm + type|outil|largeur (B < 0 : pas de segment). */
  var VS_G = 'attribute vec2 aQ;attribute vec4 aA;attribute vec4 aB;' +
    'uniform mat4 uVP;uniform mat4 uV;uniform vec3 uEye;uniform vec3 uOff;uniform float uH;uniform float uPx;uniform float uTool;uniform vec3 uPal[24];' +
    'varying vec3 vC;varying vec3 vN1;varying vec3 vN2;varying float vS;' +
    'void main(){vC=vec3(0.);vN1=vec3(0.);vN2=vec3(0.);vS=0.;' +
    'if(aB.w<0.){gl_Position=vec4(2.,2.,2.,1.);return;}' +
    'float m=aB.w;float ty=floor(m/1024.);float to=floor(mod(m,1024.)/64.);float w=mod(m,64.)*.025;if(w<.05)w=.45;' +
    'vec3 a=aA.xyz*.02-uOff;vec3 b=aB.xyz*.02-uOff;a.z-=uH;b.z-=uH;' +
    'vec3 e=b-a;float L=length(e);vec3 d=L>.00001?e/L:vec3(1.,0.,0.);' +
    'vec3 c=mix(a,b,aQ.x);vec3 v=normalize(uEye-c);vec3 p=cross(d,v);float lp=length(p);p=lp>.0001?p/lp:vec3(-d.y,d.x,0.);' +
    'float ph=length(p.xy)*w*.5;float pz=p.z*uH;float hw=max(sqrt(ph*ph+pz*pz),uPx);' +
    'vec3 pos=c+p*aQ.y*hw+d*(aQ.x*2.-1.)*hw;' +
    'vS=aQ.y;vN1=(uV*vec4(p,0.)).xyz;vN2=(uV*vec4(v,0.)).xyz;' +
    'vC=uPal[int(uTool>.5?to:ty)];' +
    'gl_Position=uVP*vec4(pos,1.);}';
  var FS_G = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform float uDim;varying vec3 vC;varying vec3 vN1;varying vec3 vN2;varying float vS;' +
    'void main(){float s=clamp(vS,-1.,1.);float q=sqrt(max(1.-s*s,0.));vec3 n=normalize(vN1*s+vN2*q);' +
    'vec3 k=normalize(vec3(-.45,.75,.6));vec3 f=normalize(vec3(.7,.15,.5));' +
    'float dk=max(dot(n,k),0.);float df=max(dot(n,f),0.);' +
    'float sp=pow(max(dot(n,normalize(k+vec3(0.,0.,1.))),0.),32.);' +
    'vec3 c=vC*(.42+.55*dk+.16*df)+vec3(.14*sp);c*=.8+.2*q;' +
    'gl_FragColor=vec4(c*uDim,1.);}';

  function persp(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2), d = 1 / (n - f);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * d, -1, 0, 0, 2 * f * n * d, 0];
  }
  function mul(a, b) {
    var r = new Array(16);
    for (var c = 0; c < 4; c++) for (var i = 0; i < 4; i++) {
      r[c * 4 + i] = a[i] * b[c * 4] + a[4 + i] * b[c * 4 + 1] + a[8 + i] * b[c * 4 + 2] + a[12 + i] * b[c * 4 + 3];
    }
    return r;
  }

  /* =========================================================
     L'aperçu : opts = { box, tint, onDraw(W, H), tilt }
     tilt : fenêtre « Voir en 3D » (le doigt incline, pince, déplace ; la molette zoome). Sur une page, le défilement reste au téléphone.
     ========================================================= */
  function viewer(canvas, opts) {
    opts = opts || {};
    var box = opts.box || canvas.parentNode;
    var gl = null, inst = null, prog, progP, progG, bufMesh, bufPlate, bufPts, bufQuad, U = {}, UP = {}, UG = {};
    var cam = { az: -0.62, el: 0.72 }, mesh = null, tint = opts.tint || accent(), forced = false, clipT = 1, anim = 0;
    var mode = 'type', shown = 0, playing = false, arriving = false, pal = new Float32Array(72);
    var zoom = 1, off = [0, 0, 0], last = null;
    var api = {
      ok: false, canPaths: false, onRange: null, onPlay: null,
      set: set, draw: draw, build: build, tint: setTint, setColor: function (c, f) { setTint(c, f); draw(); },
      setClip: function (v) { clipT = v; }, paths: function () { return mesh && mesh.pts ? mesh : null; },
      isForced: function () { return forced; }, mode: function () { return mode; }, setMode: setMode,
      layer: curLayer, setLayer: setLayer, play: play, pause: pause, isPlaying: function () { return playing; },
      zoomBy: function (f) { zoomKey(f); draw(); }, zoomed: function () { return zoom; },
      clear: function () { set(null); last = null; }
    };

    function compile(vs, fs, binds) {
      function sh(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      }
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      (binds || []).forEach(function (name, i) { gl.bindAttribLocation(p, i, name); });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    function initGL() {
      if (!canvas || !canvas.getContext) return false;
      try {
        gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
        if (!gl) return false;
        if (!gl.getExtension('OES_standard_derivatives')) { gl = null; return false; }
        prog = compile(VS, FS, ['aP']); progP = compile(VS_P, FS_P, ['aP']);
        inst = gl.getExtension('ANGLE_instanced_arrays');
        if (inst) {
          try { progG = compile(VS_G, FS_G, ['aQ', 'aA', 'aB']); } catch (e) { inst = null; }
        }
      } catch (e) { gl = null; return false; }
      ['uVP', 'uV', 'uC', 'uClip', 'uTop', 'uLayer'].forEach(function (u) { U[u] = gl.getUniformLocation(prog, u); });
      ['uVP', 'uR', 'uQ', 'uFoot', 'uGrid', 'uRect'].forEach(function (u) { UP[u] = gl.getUniformLocation(progP, u); });
      bufMesh = gl.createBuffer(); bufPlate = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPlate);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      if (inst) {
        ['uVP', 'uV', 'uEye', 'uOff', 'uH', 'uPx', 'uTool', 'uPal', 'uDim'].forEach(function (u) { UG[u] = gl.getUniformLocation(progG, u); });
        bufPts = gl.createBuffer(); bufQuad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      api.canPaths = !!inst;
      return true;
    }
    function upload() {
      if (!gl) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufMesh);
      gl.bufferData(gl.ARRAY_BUFFER, mesh && mesh.pos ? mesh.pos : 4, gl.STATIC_DRAW);
      if (inst) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bufPts);
        gl.bufferData(gl.ARRAY_BUFFER, mesh && mesh.pts ? mesh.pts : 4, gl.STATIC_DRAW);
      }
    }
    function paintPal() {
      var i;
      if (forced) { for (i = 0; i < 24; i++) pal.set(liftDark(tint), i * 3); return; }
      if (mode === 'tool') {
        for (i = 0; i < 24; i++) pal.set([0.55, 0.57, 0.6], i * 3);
        if (mesh && mesh.tools) mesh.tools.forEach(function (t) { if (t.c) pal.set(liftDark(hexRgb(t.c)), t.i * 3); });
        return;
      }
      for (i = 0; i < TYPES.length; i++) pal.set(TYPES[i][0], i * 3);
    }
    function setTint(c, f) { tint = c; forced = !!f; paintPal(); }
    function setMode(m) { mode = m; paintPal(); draw(); }

    function layerIndex(n) {     // la dernière couche commencée avant le point n
      var L = mesh.layers, a = 0, b = L.length - 1;
      while (a < b) {
        var c = (a + b + 1) >> 1;
        if (L[c] < n) a = c; else b = c - 1;
      }
      return a;
    }
    function curLayer() {
      if (!mesh || !mesh.pts) return [0, 0];
      return [shown >= mesh.count ? mesh.layers.length : layerIndex(Math.ceil(shown)) + 1, mesh.layers.length];
    }
    function tell() { if (api.onRange) { var l = curLayer(); api.onRange(l[0], l[1]); } }
    function tellPlay() { if (api.onPlay) api.onPlay(playing); }
    function stopAnim() {
      cancelAnimationFrame(anim);
      arriving = false;
      if (playing) { playing = false; tellPlay(); }
    }
    function setLayer(k) {
      if (!mesh || !mesh.pts) return;
      stopAnim();
      var L = mesh.layers;
      shown = k >= L.length ? mesh.count : L[Math.max(0, k)];
      draw(); tell();
    }
    function pause() { stopAnim(); }
    function play() {
      if (!mesh || !mesh.pts) return;
      stopAnim();
      if (shown >= mesh.count) shown = 0;
      playing = true; tellPlay();
      var rate = mesh.count / Math.max(8, Math.min(30, mesh.count / 20000)), t0 = 0;
      function step(ts) {
        if (!playing) return;
        if (t0) shown += rate * Math.min(0.1, (ts - t0) / 1000);
        t0 = ts;
        if (shown >= mesh.count) { shown = mesh.count; playing = false; tellPlay(); }
        draw(); tell();
        if (playing) anim = requestAnimationFrame(step);
      }
      anim = requestAnimationFrame(step);
    }

    function set(m) {
      stopAnim();
      mesh = m || null;
      zoom = 1; off = [0, 0, 0];
      clipT = 1;
      shown = m && m.pts ? m.count : 0;
      paintPal();
      upload();
      tell();
    }
    function draw() {
      if (!gl || !mesh) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      var W = Math.max(1, Math.round(cw * dpr)), H = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      var s = mesh.fit || mesh.size, h = s[2];
      var R = Math.max(0.5, Math.sqrt(s[0] * s[0] + s[1] * s[1] + h * h) / 2);
      var asp = W / H, fovy = 26 * Math.PI / 180, fovx = 2 * Math.atan(Math.tan(fovy / 2) * asp);
      var dist = R / Math.sin(Math.min(fovy, fovx) / 2) * 1.04 / zoom;
      var ce = Math.cos(cam.el), se = Math.sin(cam.el), ca = Math.cos(cam.az), sa = Math.sin(cam.az);
      var fwd = [-ce * sa, ce * ca, -se];                 // caméra → cible
      var tgt = [off[0], off[1], h * 0.42 + off[2]];
      var eye = [tgt[0] - fwd[0] * dist, tgt[1] - fwd[1] * dist, tgt[2] - fwd[2] * dist];
      var right = [ca, sa, 0];
      var up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
      function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
      var V = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0, -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1];
      var rc = mesh.rect || [0, 0, 0, 0];                 // le vrai plateau, à sa place sous les pièces
      var reach = rc[2] ? Math.sqrt(Math.pow(Math.abs(rc[0]) + rc[2], 2) + Math.pow(Math.abs(rc[1]) + rc[3], 2)) : 0;
      var VP = mul(persp(fovy, asp, Math.max(0.1, dist - R * 4), dist + Math.max(R * 6, reach * 2)), V);
      last = { eye: eye, tgt: tgt, fwd: fwd, right: right, up: up, tan: Math.tan(fovy / 2), asp: asp, cw: cw, ch: ch, dist: dist };

      // le plateau : grille de 10 mm qui s'estompe, ombre de contact
      var plateR = Math.max(R * 2.4, 8);
      var grid = plateR > 400 ? 100 : plateR > 120 ? 20 : plateR > 30 ? 10 : plateR > 12 ? 2 : 1;
      gl.useProgram(progP);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPlate);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(UP.uVP, false, new Float32Array(VP));
      gl.uniform1f(UP.uR, plateR); gl.uniform1f(UP.uQ, Math.max(plateR, reach)); gl.uniform1f(UP.uGrid, grid);
      gl.uniform4f(UP.uRect, rc[0], rc[1], rc[2], rc[3]);
      gl.uniform1f(UP.uFoot, Math.max(s[0], s[1]) * 0.56 + 0.5);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true); gl.disable(gl.BLEND);

      if (mesh.pts) drawPaths(VP, V, eye, dist, H);
      else {
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufMesh);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(U.uVP, false, new Float32Array(VP));
        gl.uniformMatrix4fv(U.uV, false, new Float32Array(V));
        gl.uniform1f(U.uTop, h + 1);
        gl.uniform1f(U.uClip, clipT >= 1 ? h + 1 : h * clipT);
        gl.uniform1f(U.uLayer, Math.max(R / 70, 0.02));
        if (mesh.groups && !forced) {                     // couleurs du fichier ; une pastille choisie recolore tout
          mesh.groups.forEach(function (g) {
            gl.uniform3fv(U.uC, g.c || tint);
            gl.drawArrays(gl.TRIANGLES, g.first, g.count);
          });
        } else {
          gl.uniform3fv(U.uC, tint);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        }
      }
      if (opts.onDraw) opts.onDraw(W, H);
    }
    function drawPaths(VP, V, eye, dist, H) {
      gl.useProgram(progG);
      gl.uniformMatrix4fv(UG.uVP, false, new Float32Array(VP));
      gl.uniformMatrix4fv(UG.uV, false, new Float32Array(V));
      gl.uniform3f(UG.uEye, eye[0], eye[1], eye[2]);
      gl.uniform3f(UG.uOff, mesh.off[0], mesh.off[1], 0);
      gl.uniform1f(UG.uH, mesh.h / 2);
      gl.uniform1f(UG.uPx, dist * Math.tan(13 * Math.PI / 180) * 2 / H * 0.55);    // jamais plus fin qu'un pixel
      gl.uniform1f(UG.uTool, mode === 'tool' && !forced ? 1 : 0);
      gl.uniform3fv(UG.uPal, pal);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      inst.vertexAttribDivisorANGLE(0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPts);
      gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
      inst.vertexAttribDivisorANGLE(1, 1); inst.vertexAttribDivisorANGLE(2, 1);
      function range(a, b, dim) {
        var n = b - a - 1;
        if (n <= 0) return;
        gl.uniform1f(UG.uDim, dim);
        gl.vertexAttribPointer(1, 4, gl.SHORT, false, 8, a * 8);
        gl.vertexAttribPointer(2, 4, gl.SHORT, false, 8, (a + 1) * 8);
        inst.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, n);
      }
      var count = mesh.count, end = Math.min(Math.ceil(shown), count);
      if (end >= count || arriving) range(0, end, 1);
      else {                                               // la couche en cours ressort, les autres s'effacent un peu
        var st = mesh.layers[layerIndex(end)];
        range(0, st, 0.72);
        range(st, end, 1);
      }
      inst.vertexAttribDivisorANGLE(1, 0); inst.vertexAttribDivisorANGLE(2, 0);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    }
    function build(animated) {
      stopAnim();
      var isPaths = !!(mesh && mesh.pts);
      if (!animated || reduce || !mesh) {
        clipT = 1;
        if (isPaths) shown = mesh.count;
        draw(); tell();
        return;
      }
      var t0 = null, finished = false, target = mesh;
      arriving = isPaths;
      if (isPaths) shown = 0; else clipT = 0;
      draw();
      function step(ts) {
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / 1250), v = 1 - Math.pow(1 - p, 2.2);
        if (isPaths) shown = mesh.count * v; else clipT = v;
        if (p >= 1) { arriving = false; finished = true; }
        draw();
        if (isPaths) tell();
        if (p < 1) anim = requestAnimationFrame(step);
      }
      anim = requestAnimationFrame(step);
      // onglet en arrière-plan : la pièce finit quand même affichée
      setTimeout(function () {
        if (finished || mesh !== target || !(isPaths ? arriving : clipT < 0.05)) return;
        cancelAnimationFrame(anim);
        arriving = false; clipT = 1;
        if (isPaths) shown = mesh.count;
        draw(); tell();
      }, 1600);
    }

    /* ---------- zoom et déplacement ---------- */
    function zoomable() { return !!(opts.tilt || (mesh && mesh.pts)); }
    function pick(px, py) {      // le point du plan de la cible sous le doigt
      if (!last) return null;
      var nx = (px / last.cw * 2 - 1) * last.tan * last.asp, ny = (1 - py / last.ch * 2) * last.tan, l = last;
      var d = [l.fwd[0] + l.right[0] * nx + l.up[0] * ny, l.fwd[1] + l.right[1] * nx + l.up[1] * ny, l.fwd[2] + l.right[2] * nx + l.up[2] * ny];
      if (Math.abs(d[2]) < 1e-4) return null;
      var t = (l.tgt[2] - l.eye[2]) / d[2];
      return t > 0 ? [l.eye[0] + d[0] * t, l.eye[1] + d[1] * t] : null;
    }
    function clampOff() {
      if (!mesh) return;
      var s = mesh.fit || mesh.size;
      off[0] = Math.max(-s[0] / 2, Math.min(s[0] / 2, off[0]));
      off[1] = Math.max(-s[1] / 2, Math.min(s[1] / 2, off[1]));
      off[2] = Math.max(-s[2] * 0.42, Math.min(s[2] * 0.58, off[2]));
    }
    function zoomAt(px, py, f) {
      var old = zoom;
      zoom = Math.max(1, Math.min(16, zoom * f));
      if (zoom <= 1.001) { zoom = 1; off = [0, 0, 0]; return; }
      var P = px == null ? null : pick(px, py);
      if (P && last) {
        var k = 1 - old / zoom;
        off[0] += (P[0] - last.tgt[0]) * k;
        off[1] += (P[1] - last.tgt[1]) * k;
        clampOff();
      }
    }
    /* Boutons et clavier : on s'approche de la buse (le dernier point affiché) : le centre d'un anneau, c'est le vide. */
    function zoomKey(f) {
      var old = zoom;
      zoomAt(null, null, f);
      if (zoom === 1 || zoom === old || !last || !mesh || !mesh.pts) return;
      var i = Math.max(0, Math.min(mesh.count, Math.ceil(shown)) - 1) * 4, P = mesh.pts, k = 1 - old / zoom;
      off[0] += (P[i] * 0.02 - mesh.off[0] - last.tgt[0]) * k;
      off[1] += (P[i + 1] * 0.02 - mesh.off[1] - last.tgt[1]) * k;
      off[2] += (P[i + 2] * 0.02 - last.tgt[2]) * k;
      clampOff();
    }
    function panBy(dx, dy) {
      if (!last || zoom <= 1) return;
      var w = 2 * last.dist * last.tan / last.ch, l = last;
      for (var i = 0; i < 3; i++) off[i] += (-l.right[i] * dx + l.up[i] * dy) * w;
      clampOff();
    }

    api.ok = initGL();
    if (!api.ok) return api;
    paintPal();

    /* la pièce tourne au toucher : glisser (souris ou doigt, le défilement vertical reste au téléphone) ou flèches */
    var active = {}, nActive = 0, drag = null, vel = 0, spin = 0, pinch = null, moved = 0, tapT = 0, tapX = 0, tapY = 0;
    var clampEl = function (e) { return Math.max(0.1, Math.min(1.5, e)); };
    function fingers() {
      var ks = Object.keys(active), r = canvas.getBoundingClientRect(), a = active[ks[0]], b = active[ks[1]];
      return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top, d: Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) };
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button && (e.button !== 2 || !zoomable())) return;
      cancelAnimationFrame(spin); vel = 0;
      active[e.pointerId] = { x: e.clientX, y: e.clientY };
      nActive++;
      drag = { pan: e.button === 2 || e.shiftKey };
      moved = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sans capture, le glisser marche dans le cadre */ }
      if (nActive === 2) pinch = fingers();
    });
    canvas.addEventListener('pointermove', function (e) {
      var a = active[e.pointerId];
      if (!a) return;
      var dx = e.clientX - a.x, dy = e.clientY - a.y;
      a.x = e.clientX; a.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (nActive >= 2) {
        if (!opts.tilt) return;
        var q = fingers();
        if (pinch && pinch.d > 0) zoomAt(q.x, q.y, q.d / pinch.d);
        if (pinch) panBy(q.x - pinch.x, q.y - pinch.y);
        pinch = q;
        draw();
        return;
      }
      if (drag.pan) { panBy(dx, dy); draw(); return; }
      vel = dx * 0.008;
      cam.az += vel;
      if (opts.tilt || e.pointerType === 'mouse' || e.pointerType === 'pen') cam.el = clampEl(cam.el + dy * 0.006);
      draw();
    });
    function endPointer(e, cancelled) {
      if (!active[e.pointerId]) return;
      delete active[e.pointerId];
      nActive--;
      pinch = null;
      if (nActive > 0) { vel = 0; return; }
      if (!cancelled && moved < 8 && zoomable()) {      // deux touches au même endroit : on s'approche
        var now = performance.now();
        if (now - tapT < 320 && Math.abs(e.clientX - tapX) < 30 && Math.abs(e.clientY - tapY) < 30) {
          tapT = 0;
          var r = canvas.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, zoom >= 12 ? 1 / zoom : 2);
          draw();
          return;
        }
        tapT = now; tapX = e.clientX; tapY = e.clientY;
      }
      if (cancelled || reduce || (drag && drag.pan) || Math.abs(vel) < 0.002) { vel = 0; return; }
      var coast = function () {
        vel *= 0.92; cam.az += vel; draw();
        if (Math.abs(vel) > 0.0006) spin = requestAnimationFrame(coast);
      };
      spin = requestAnimationFrame(coast);
    }
    canvas.addEventListener('pointerup', function (e) { endPointer(e, false); });
    canvas.addEventListener('pointercancel', function (e) { endPointer(e, true); });
    canvas.addEventListener('contextmenu', function (e) { if (zoomable()) e.preventDefault(); });
    if (opts.tilt) {
      canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        var r = canvas.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
        draw();
      }, { passive: false });
    }
    canvas.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft') cam.az -= 0.14;
      else if (k === 'ArrowRight') cam.az += 0.14;
      else if (k === 'ArrowUp') cam.el = clampEl(cam.el + 0.1);
      else if (k === 'ArrowDown') cam.el = clampEl(cam.el - 0.1);
      else if ((k === '+' || k === '=') && zoomable()) zoomKey(1.5);
      else if (k === '-' && zoomable()) zoomKey(1 / 1.5);
      else return;
      e.preventDefault();
      draw();
    });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stopAnim(); });
    canvas.addEventListener('webglcontextrestored', function () {
      if (!initGL()) return;
      paintPal(); upload(); clipT = 1;
      if (mesh && mesh.pts) shown = mesh.count;
      draw(); tell();
    });
    if ('ResizeObserver' in window) new ResizeObserver(function () { draw(); }).observe(box);
    else window.addEventListener('resize', draw);
    return api;
  }

  /* =========================================================
     Curseur, Lecture, légende, Filament, zoom : o = { box, zoomAlways }
     ========================================================= */
  var I_PLAY = '<svg class="v3d-i-p" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.6v10.8c0 .5.5.8 1 .5l8.4-5.4c.4-.3.4-.8 0-1.1L5 2.1c-.5-.3-1 0-1 .5z"/></svg>';
  var I_PAUSE = '<svg class="v3d-i-s" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
  function controls(host, view, o) {
    o = o || {};
    host.innerHTML =
      '<div class="v3d-bar"><button type="button" class="v3d-play" aria-label="' + esc(_t('Lecture')) + '">' + I_PLAY + I_PAUSE + '</button>' +
      '<input type="range" class="v3d-range" min="1" max="1" step="1" value="1" aria-label="' + esc(_t('Couche')) + '">' +
      '<output class="v3d-lay"></output></div>' +
      '<div class="v3d-leg"><button type="button" class="v3d-fil" aria-pressed="false">' + esc(_t('Filament')) + '</button><ul></ul></div>';
    var play = host.querySelector('.v3d-play'), range = host.querySelector('.v3d-range'), lay = host.querySelector('.v3d-lay');
    var fil = host.querySelector('.v3d-fil'), list = host.querySelector('ul'), zoomEl = null;
    if (o.box) {
      zoomEl = document.createElement('div');
      zoomEl.className = 'v3d-zoom';
      zoomEl.hidden = true;
      zoomEl.innerHTML = '<button type="button" aria-label="' + esc(_t('Zoom avant')) + '">+</button><button type="button" aria-label="' + esc(_t('Zoom arrière')) + '">−</button>';
      o.box.appendChild(zoomEl);
      zoomEl.children[0].addEventListener('click', function () { view.zoomBy(1.6); });
      zoomEl.children[1].addEventListener('click', function () { view.zoomBy(1 / 1.6); });
    }
    function paintRange(k, L) {
      range.value = k;
      range.style.setProperty('--p', (L > 1 ? (k - 1) / (L - 1) * 100 : 100) + '%');
      lay.innerHTML = '<i>' + esc(_t('Couche')) + ' </i>' + k + ' / ' + L;
      range.setAttribute('aria-valuetext', _t('Couche') + ' ' + k + ' / ' + L);
    }
    view.onRange = function (k, L) { if (L) paintRange(Math.max(1, k), L); };
    view.onPlay = function (on) {
      play.classList.toggle('is-on', on);
      play.setAttribute('aria-label', on ? _t('Pause') : _t('Lecture'));
    };
    play.addEventListener('click', function () { if (view.isPlaying()) view.pause(); else view.play(); });
    range.addEventListener('input', function () { view.setLayer(+range.value); });
    fil.addEventListener('click', function () { view.setMode(view.mode() === 'tool' ? 'type' : 'tool'); sync(); });
    function sync() {
      var p = view.paths();
      host.hidden = !p;
      if (zoomEl) zoomEl.hidden = !(p || (o.zoomAlways && view.ok));
      if (!p) return;
      range.max = p.layers.length;
      var cur = view.layer();
      paintRange(Math.max(1, cur[0]), p.layers.length);
      var known = p.tools.some(function (t) { return t.c; }), forced = view.isForced();
      if (!known && view.mode() === 'tool') view.setMode('type');
      var byTool = view.mode() === 'tool';
      fil.hidden = forced || !known;
      fil.setAttribute('aria-pressed', byTool ? 'true' : 'false');
      list.hidden = forced;
      if (forced) { list.innerHTML = ''; return; }
      var items;
      if (byTool) {
        items = p.tools.map(function (t, i) { return [t.c || '#8C939D', t.k || _t('Filament') + ' ' + (i + 1)]; });
      } else {
        items = TYPES.filter(function (g, i) { return p.types & (1 << i); }).map(function (g) { return [cssRgb(g[0]), g[1]]; });
      }
      list.innerHTML = items.map(function (a) { return '<li><i style="background:' + esc(a[0]) + '"></i>' + esc(a[1]) + '</li>'; }).join('');
    }
    return { sync: sync };
  }

  /* =========================================================
     Le Worker : h = { progress(p), meta(m), plate(m), capv(m), fail(), maxPts, paths }
     ========================================================= */
  function reader(file, h) {
    if (!window.Worker) return null;
    if (!/\.gcode$/i.test(file.name) && !window.DecompressionStream) return null;
    var w, req = 0, timer = 0, dead = false, small = coarse();
    try { w = new Worker(WORKER); } catch (e) { return null; }
    function calm() { clearTimeout(timer); timer = 0; }
    function fail() {
      if (dead) return;
      dead = true; calm();
      try { w.terminate(); } catch (e) { /* déjà fini */ }
      if (h.fail) h.fail();
    }
    function arm() { clearTimeout(timer); timer = setTimeout(fail, 90000); }
    w.onerror = fail;
    w.onmessage = function (e) {
      var m = e.data;
      if (dead) return;
      if (m.t === 'progress') { if (timer) arm(); if (h.progress) h.progress(m.p); }
      else if (m.t === 'fail') fail();
      else if (m.t === 'meta') { calm(); if (h.meta) h.meta(m); }
      else if (m.t === 'plate') { if (m.req !== req) return; calm(); if (h.plate) h.plate(m); }
      else if (m.t === 'capv') { calm(); if (h.capv) h.capv(m); }
    };
    arm();
    w.postMessage({ t: 'open', file: file, budget: small ? 6e5 : 8e6, maxTris: small ? 12e6 : 3e7, maxPts: h.maxPts || (small ? 6e5 : 8e6), paths: h.paths !== false });
    return {
      ask: function (i) { req++; arm(); w.postMessage({ t: 'plate', i: i, req: req }); },
      capv: function () { req++; arm(); w.postMessage({ t: 'capv', req: req }); },
      stop: function () { dead = true; calm(); try { w.terminate(); } catch (e) { /* déjà fini */ } }
    };
  }

  /* L'aperçu à joindre : resolve({ blob, plates, points }) ; null s'il n'y a aucun trajet à montrer (on enverra alors le vrai fichier). */
  function makePreview(file, onProgress) {
    return new Promise(function (resolve) {
      var rd = reader(file, {
        maxPts: 6e5,            // un client peut l'ouvrir sur son téléphone
        progress: onProgress,
        fail: function () { resolve(null); },
        meta: function (m) {
          if (m.plates.some(function (p) { return p.gcode; })) rd.capv();
          else { rd.stop(); resolve(null); }
        },
        capv: function (m) {
          rd.stop();
          resolve(m.blob ? { blob: m.blob, plates: m.plates, points: m.points } : null);
        }
      });
      if (!rd) resolve(null);
    });
  }

  /* Relit un .capv ; le fichier vient du serveur : on ne croit aucune taille sans vérifier. */
  function finiteList(a, n) { return Array.isArray(a) && a.length === n && a.every(function (v) { return typeof v === 'number' && isFinite(v); }); }
  async function readCapv(buf) {
    var head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (!window.DecompressionStream) throw new Error('gzip');
      var rd = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(), parts = [], size = 0, r;
      while (!(r = await rd.read()).done) {
        size += r.value.length;
        if (size > 268435456) { rd.cancel(); throw new Error('trop gros'); }
        parts.push(r.value);
      }
      buf = await new Blob(parts).arrayBuffer();
    }
    if (buf.byteLength < 12) throw new Error('capv');
    var top = new Uint8Array(buf, 0, 5);
    if (String.fromCharCode(top[0], top[1], top[2], top[3]) !== 'CAPV' || top[4] !== 1) throw new Error('capv');
    var jsonLen = new DataView(buf).getUint32(8, true), o = 12 + jsonLen;
    if (o > buf.byteLength) throw new Error('capv');
    var meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen)));
    if (!meta || !Array.isArray(meta.plates) || !meta.plates.length || meta.plates.length > 500) throw new Error('capv');
    return meta.plates.map(function (p) {
      var n = p.n, m = p.m, t = p.thumb || 0;
      if (!(n >= 2 && n <= 2e7 && m >= 1 && m <= 1e5 && t >= 0 && t <= 2e7)) throw new Error('capv');
      if (o + m * 4 + n * 8 + t > buf.byteLength) throw new Error('capv');
      if (!finiteList(p.off, 2) || !finiteList(p.fit, 3) || !finiteList(p.size, 3)) throw new Error('capv');
      if (p.rect && !finiteList(p.rect, 4)) throw new Error('capv');
      var layers = new Uint32Array(buf.slice(o, o + m * 4));
      o += m * 4;
      for (var k = 0; k < m; k++) if (layers[k] >= n) throw new Error('capv');
      var cols = new Int16Array(buf.slice(o, o + n * 8)), pts = new Int16Array(n * 4);
      o += n * 8;
      for (var c = 0; c < 4; c++) {
        var prev = 0;
        for (var i = 0; i < n; i++) { prev = (prev + cols[c * n + i]) << 16 >> 16; pts[i * 4 + c] = prev; }
      }
      var url = '';
      if (t) { url = URL.createObjectURL(new Blob([buf.slice(o, o + t)], { type: 'image/png' })); o += t; }
      var tools = (Array.isArray(p.tools) ? p.tools : []).filter(function (x) { return x && x.i >= 0 && x.i < 16; }).map(function (x) {
        return { i: x.i | 0, c: /^#[0-9a-f]{6}$/i.test(x.c) ? x.c : null, k: String(x.k || '').slice(0, 16) };
      });
      return {
        id: p.id, pts: pts, layers: layers, count: n, h: Math.max(0.02, Math.min(2, +p.h || 0.2)), off: p.off, fit: p.fit, size: p.size, rect: p.rect || null,
        tools: tools, types: p.types | 0, time: +p.time || 0, weight: +p.weight || 0, light: !!p.light, volume: 0, area: 0, thumbUrl: url
      };
    });
  }

  /* =========================================================
     « Voir en 3D » : une seule fenêtre, réutilisée (un seul contexte WebGL)
     ========================================================= */
  var D = null, openId = 0;
  function say(d, text) { d.msg.textContent = text || ''; d.msg.hidden = !text; }
  function reset(d) {
    if (d.rd) { d.rd.stop(); d.rd = null; }
    if (d.view.ok) d.view.clear();
    d.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    d.urls = [];
    d.plates = [];
    d.pi = 0;
    d.strip.innerHTML = '';
    d.strip.hidden = true;
    d.read.innerHTML = '';
    d.shot.hidden = true;
    d.shot.removeAttribute('src');
    d.canvas.style.visibility = '';
    d.ctl.sync();
  }
  function dialog() {
    if (D) return D;
    var el = document.createElement('dialog');
    el.className = 'v3d-dlg';
    el.setAttribute('aria-label', _t('Aperçu 3D'));
    el.innerHTML =
      '<header class="v3d-head"><div class="v3d-title"><b></b><span></span></div>' +
      '<button type="button" class="v3d-x" aria-label="' + esc(_t('Fermer')) + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></header>' +
      '<div class="v3d-view"><canvas tabindex="0" role="img" aria-label="' + esc(_t('Aperçu 3D de la pièce. Les flèches du clavier la font tourner.')) + '"></canvas>' +
      '<img class="v3d-shot" alt="" hidden><p class="v3d-msg" role="status" hidden></p></div>' +
      '<div class="v3d-ctl" hidden></div><ul class="v3d-strip" aria-label="' + esc(_t('Plateaux du fichier')) + '" hidden></ul><dl class="v3d-read"></dl>';
    document.body.appendChild(el);
    var box = el.querySelector('.v3d-view'), canvas = el.querySelector('canvas');
    var view = viewer(canvas, { box: box, tilt: true });
    D = {
      el: el, canvas: canvas, view: view, msg: el.querySelector('.v3d-msg'), shot: el.querySelector('.v3d-shot'),
      name: el.querySelector('.v3d-title b'), sub: el.querySelector('.v3d-title span'), strip: el.querySelector('.v3d-strip'), read: el.querySelector('.v3d-read'),
      ctl: controls(el.querySelector('.v3d-ctl'), view, { box: box, zoomAlways: true }), rd: null, urls: [], plates: [], pi: 0
    };
    el.querySelector('.v3d-x').addEventListener('click', function () { el.close(); });
    el.addEventListener('click', function (e) { if (e.target === el) el.close(); });     // à côté de la fenêtre
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.stopPropagation(); });   // la Messagerie derrière reste ouverte
    el.addEventListener('close', function () { openId++; reset(D); });
    D.strip.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var i = +b.getAttribute('data-i');
      if (i === D.pi) return;
      D.pi = i;
      paintStrip(D);
      var p = D.plates[i];
      if (D.rd && !p.mesh && (p.hasMesh || (p.gcode && view.canPaths))) { say(D, _t('Chargement…')); D.rd.ask(i); }
      else paintPlate(D);
    });
    return D;
  }
  function paintStrip(d) {
    var many = d.plates.length > 1;
    d.strip.hidden = !many;
    if (!many) return;
    if (!d.strip.children.length) {
      d.strip.innerHTML = d.plates.map(function (p, i) {
        return '<li><button type="button" data-i="' + i + '" aria-label="' + esc(_t('Voir le plateau') + ' ' + p.id) + '">' +
          (p.url ? '<img src="' + esc(p.url) + '" alt="" width="56" height="56">' : '') + '<span>' + esc(p.id) + '</span></button></li>';
      }).join('');
    }
    [].forEach.call(d.strip.querySelectorAll('button'), function (b, i) { b.setAttribute('aria-pressed', i === d.pi ? 'true' : 'false'); });
  }
  function paintPlate(d) {
    var p = d.plates[d.pi], m = p.mesh, can = m && d.view.ok && (m.pos || d.view.canPaths);
    d.shot.hidden = true;
    d.canvas.style.visibility = can ? '' : 'hidden';
    if (can) {
      say(d, '');
      d.view.set(m);
      d.view.build(true);
    } else {
      if (d.view.ok) d.view.set(null);
      if (p.url) { d.shot.src = p.url; d.shot.hidden = false; say(d, ''); }
      else say(d, _t('Aperçu indisponible pour ce fichier.'));
    }
    d.ctl.sync();
    paintStrip(d);
    var bits = [];
    if (p.size) bits.push([_t('Dimensions'), fmtDim(p)]);
    if (p.time > 0) bits.push([_t('Temps'), fmtTime(p.time)]);
    if (p.weight > 0) bits.push([_t('Poids'), fmtWeight(p.weight)]);
    d.read.innerHTML = bits.map(function (b) { return '<div><dt>' + esc(b[0]) + '</dt><dd>' + esc(b[1]) + '</dd></div>'; }).join('');
    d.read.hidden = !bits.length;
  }
  function openWorker(d, id, file) {
    return new Promise(function (resolve, reject) {
      var rd = reader(file, {
        paths: d.view.canPaths,
        progress: function (v) { if (id === openId) say(d, _t('Chargement…') + ' ' + Math.round(v * 100) + ' %'); },
        fail: function () { reject(new Error('lecture')); },
        meta: function (m) {
          if (id !== openId) return;
          d.plates = m.plates.map(function (p) {
            p.url = p.thumb ? URL.createObjectURL(p.thumb) : '';
            if (p.url) d.urls.push(p.url);
            return p;
          });
          if (m.lightened) d.sub.textContent = _t('aperçu allégé');
          var first = d.plates[0];
          if (first.hasMesh || (first.gcode && d.view.canPaths)) rd.ask(0);
          else { paintPlate(d); resolve(); }
        },
        plate: function (m) {
          if (id !== openId) return;
          var p = d.plates[m.i];
          if (m.paths) {
            var P = m.paths;
            p.size = P.size;
            if (!p.time) p.time = P.time;
            if (!p.weight) p.weight = P.weight;
            if (P.light) d.sub.textContent = _t('aperçu allégé');
            p.mesh = P;
          } else p.mesh = m.pos ? { pos: m.pos, count: m.pos.length / 3, size: p.size, volume: p.volume, area: p.area, groups: m.groups, rect: m.rect } : null;
          d.plates.forEach(function (o, i) { if (i !== m.i) o.mesh = null; });   // on ne garde que le plateau affiché
          if (m.i === d.pi) paintPlate(d);
          resolve();
        }
      });
      if (!rd) { reject(new Error('navigateur')); return; }
      d.rd = rd;
    });
  }
  function show(o) {
    var d = dialog(), id = ++openId;
    reset(d);
    d.name.textContent = o.name || '';
    d.sub.textContent = '';
    say(d, _t('Chargement…'));
    if (!d.el.open) d.el.showModal();
    var ext = String(o.ext || (/\.([a-z0-9]+)$/i.exec(o.name || '') || [])[1] || '').toLowerCase();
    var src = o.blob ? Promise.resolve(o.blob) : fetch(o.url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.blob();
    });
    return src.then(function (blob) {
      if (id !== openId) return null;
      if (ext === 'capv') {
        return blob.arrayBuffer().then(readCapv).then(function (plates) {
          if (id !== openId) { plates.forEach(function (p) { if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl); }); return; }
          d.plates = plates.map(function (P) {
            if (P.thumbUrl) d.urls.push(P.thumbUrl);
            if (P.light) d.sub.textContent = _t('aperçu allégé');
            return { id: P.id, url: P.thumbUrl, size: P.size, time: P.time, weight: P.weight, mesh: P };
          });
          paintPlate(d);
        });
      }
      if (ext === 'stl' || ext === 'obj') {
        return blob.arrayBuffer().then(function (buf) {
          if (id !== openId) return;
          var m = ext === 'stl' ? parseSTL(buf) : parseOBJ(buf);
          if (!m) throw new Error('vide');
          d.plates = [{ id: 1, url: '', size: m.size, time: 0, weight: 0, mesh: m }];
          d.view.tint(accent(), false);
          paintPlate(d);
        });
      }
      if (ext === '3mf' || ext === 'gcode') return openWorker(d, id, new File([blob], 'apercu.' + ext));
      throw new Error('format');
    }).catch(function () {
      if (id !== openId) return;
      if (d.view.ok) d.view.set(null);
      d.canvas.style.visibility = 'hidden';
      say(d, _t('Aperçu indisponible pour ce fichier.'));
      d.ctl.sync();
    });
  }

  CA.ap3d = {
    viewer: viewer, controls: controls, reader: reader, makePreview: makePreview, readCapv: readCapv, show: show,
    fromTris: fromTris, parseSTL: parseSTL, parseOBJ: parseOBJ, fmtDim: fmtDim, fmtWeight: fmtWeight, fmtTime: fmtTime
  };
})();
