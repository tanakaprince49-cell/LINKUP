// The /search page: a smooth 3D globe of the public LINKUP membership.
// Every dot is an opted-in, public-eligible profile (same rules as /builders).
// Positions come from each member's city (falls back to their country), resolved
// offline by _cityCoords.js. The whole dataset is embedded in the HTML, so the
// page renders from one request and never calls home from the client.
import { SITE, APP, profileUrl, escapeHtml, documentHtml } from './_publicSeo.js';
import { resolveLocation } from './_cityCoords.js';

const e = escapeHtml;

export function projectSearchMember(uid, p, selectProfileImage, safeUrl) {
  const name = (typeof p.displayName === 'string' && p.displayName.trim()) || (typeof p.fullName === 'string' && p.fullName.trim()) || (typeof p.name === 'string' && p.name.trim()) || '';
  if (!name) return null;
  const photo = selectProfileImage(uid, p, safeUrl);
  return {
    uid,
    name: name.trim().slice(0, 80),
    occupation: String(p.occupation || '').trim().slice(0, 100),
    company: String(p.company || '').trim().slice(0, 120),
    city: String(p.city || '').trim().slice(0, 80),
    country: String(p.country || '').trim().slice(0, 80),
    skills: (Array.isArray(p.skills) ? p.skills : []).slice(0, 8).map(s => String(s).trim().slice(0, 60)).filter(Boolean),
    image: photo?.url || '',
    verified: p.isVerified === true,
    url: profileUrl(uid),
  };
}

export function groupMembersByLocation(members) {
  const groups = new Map();
  const unlocated = [];
  members.forEach((member, index) => {
    const place = resolveLocation(member.city, member.country);
    if (!place) { unlocated.push(index); return; }
    const key = `${place.precision}:${place.label}`;
    if (!groups.has(key)) groups.set(key, { label: place.label, precision: place.precision, lat: place.lat, lng: place.lng, members: [] });
    groups.get(key).members.push(index);
  });
  return { groups: [...groups.values()].sort((a, b) => b.members.length - a.members.length), unlocated };
}

export function renderSearchPage({ members }) {
  const { groups, unlocated } = groupMembersByLocation(members);
  const countries = new Set(members.map(m => m.country).filter(Boolean)).size;
  const cities = groups.filter(g => g.precision === 'city').length;
  const placed = members.length - unlocated.length;
  const dataJson = JSON.stringify({
    members: members.map(m => ({ ...m, location: resolveLocation(m.city, m.country) })),
    groups,
  }).replace(/</g, '\\u003c');

  const topCities = groups.slice(0, 8).map(g =>
    `<button class="chip" type="button" data-lat="${g.lat}" data-lng="${g.lng}" data-label="${e(g.label)}">${e(g.label)} · ${g.members.length}</button>`
  ).join('');

  const grid = members.slice(0, 24).map(m => `
    <article class="card g-card">
      ${m.image ? `<a href="${e(m.url)}" aria-label="Open ${e(m.name)} profile"><img class="avatar" src="${e(m.image)}" alt="${e(m.name)} profile photo" width="100" height="100" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>` : `<a class="avatar avatar-initials" href="${e(m.url)}" aria-hidden="true">${e(initials(m.name))}</a>`}
      <h2><a href="${e(m.url)}">${e(m.name)}</a></h2>
      ${m.occupation ? `<p>${e(m.occupation)}</p>` : ''}
      <p class="muted">${e([m.city, m.country].filter(Boolean).join(', '))}</p>
    </article>`).join('');

  const content = `
<style>
.globe-hero{padding:8px 0 4px}
.kicker{display:inline-block;border:1px solid #deded6;border-radius:30px;padding:5px 14px;font-size:12px;letter-spacing:2px;font-weight:800;color:#6b6f66}
.globe-stats{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 0}
.stat{background:#fff;border:1px solid #deded6;border-radius:16px;padding:10px 16px;font-size:13px}
.stat strong{display:block;font-size:22px;letter-spacing:-0.5px}
.globe-shell{position:relative;margin:18px 0;border:1px solid #deded6;border-radius:24px;overflow:hidden;background:radial-gradient(1200px 600px at 50% 120%,#12263a 0%,#05070c 70%)}
#globe{width:100%;height:min(66vh,560px);min-height:420px;touch-action:none}
.globe-overlay{position:absolute;left:16px;right:16px;top:14px;display:flex;gap:10px;align-items:center;pointer-events:none}
.globe-overlay>*{pointer-events:auto}
#globeFilter{flex:1;border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.72);color:#f5f7fa;border-radius:30px;padding:12px 18px;font-size:15px;outline:none;backdrop-filter:blur(4px)}
#globeFilter::placeholder{color:#9aa6b2}
#globeFilter:focus-visible{outline:2px solid #fbe618;border-color:transparent}
#globeCount{background:rgba(10,14,20,.72);color:#f5f7fa;border-radius:30px;padding:10px 16px;font-size:13px;font-weight:700;white-space:nowrap;border:1px solid rgba(255,255,255,.1)}
#globeTip{position:absolute;pointer-events:none;background:#0c1118;border:1px solid rgba(255,255,255,.16);color:#f5f7fa;border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.45;display:none;max-width:240px;z-index:6}
#globeTip strong{display:block;font-size:13px}
.globe-hint{position:absolute;bottom:12px;left:16px;color:#8fa3b8;font-size:12px}
.globe-panel{position:absolute;right:0;top:0;bottom:0;width:min(320px,84vw);background:rgba(8,12,18,.88);backdrop-filter:blur(8px);border-left:1px solid rgba(255,255,255,.12);color:#f5f7fa;transform:translateX(102%);transition:transform .28s ease;z-index:5;display:flex;flex-direction:column}
.globe-panel.open{transform:translateX(0)}
.globe-panel header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
.globe-panel header h2{margin:0;font-size:16px;color:#f5f7fa}
.globe-panel .panel-close{background:none;border:1px solid rgba(255,255,255,.2);color:#f5f7fa;border-radius:10px;width:34px;height:34px;font-size:16px;cursor:pointer}
.panel-list{overflow-y:auto;padding:10px}
.panel-member{display:flex;gap:10px;align-items:center;padding:9px 8px;border-radius:14px;text-decoration:none;color:inherit}
.panel-member:hover,.panel-member:focus-visible{background:rgba(255,255,255,.07)}
.panel-member img,.panel-initials{width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid rgba(255,255,255,.14)}
.panel-initials{display:flex;align-items:center;justify-content:center;background:#1f2c3d;font-weight:800;font-size:15px}
.panel-member b{display:block;font-size:13.5px}
.panel-member small{color:#9aa6b2;font-size:11.5px;display:block}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 10px}
.chip{background:#fff;border:1px solid #deded6;border-radius:30px;padding:7px 14px;font-size:13px;cursor:pointer}
.chip:hover{border-color:#171918}
.globe-foot{font-size:13px;color:#565b55}
.g-card{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.avatar-initials{display:flex;align-items:center;justify-content:center;background:#171918;color:#fbe618;font-weight:900;text-decoration:none;font-size:28px;letter-spacing:1px}
@media (prefers-reduced-motion:reduce){.globe-panel{transition:none}}
</style>
<section class="globe-hero">
  <span class="kicker">LINKUP · LIVE MEMBER MAP</span>
  <h1>Where the builders are.</h1>
  <p class="muted">Every light is an opted-in LINKUP member, plotted from their public city. Drag the globe, filter below, click a face.</p>
  <div class="globe-stats">
    <div class="stat"><strong>${members.length}</strong>public builders</div>
    <div class="stat"><strong>${countries}</strong>countries</div>
    <div class="stat"><strong>${cities}</strong>cities</div>
  </div>
</section>
<div class="globe-shell">
  <div id="globe" role="application" aria-label="Interactive 3D globe of public LINKUP members"></div>
  <div class="globe-overlay">
    <input id="globeFilter" type="search" autocomplete="off" placeholder="Filter by name, skill, role or city…" aria-label="Filter members">
    <span id="globeCount">${members.length} builders</span>
  </div>
  <div id="globeTip" role="status"></div>
  <div class="globe-hint">Drag to spin · Scroll to zoom · Click a face</div>
  <aside class="globe-panel" id="globePanel" aria-hidden="true" aria-label="Member details">
    <header><h2 id="panelTitle">Builders</h2><button class="panel-close" id="panelClose" type="button" aria-label="Close panel">×</button></header>
    <div class="panel-list" id="panelList"></div>
  </aside>
</div>
${topCities ? `<div class="chips" aria-label="Jump to a city">${topCities}</div>` : ''}
<noscript><p class="globe-foot">Enable JavaScript to fly around the globe — or browse the same public members in the grid below.</p></noscript>
<section aria-label="Public member directory">
  <h2>Browse builders</h2>
  <div class="grid">${grid || '<p>No public profiles yet — check back soon.</p>'}</div>
  <p class="globe-foot">Only opted-in, public profiles appear here — the same people you can meet at <a href="${APP}/builders">/builders</a>. Want to be on the globe? <a href="${APP}/landing">Join LINKUP</a> and keep your profile public.</p>
</section>
<script type="application/json" id="globe-data">${dataJson}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js" crossorigin="anonymous"></script>
<script>
(function () {
  'use strict';
  var countEl = document.getElementById('globeCount');
  var tip = document.getElementById('globeTip');
  var filter = document.getElementById('globeFilter');
  var panel = document.getElementById('globePanel');
  var panelList = document.getElementById('panelList');
  var panelTitle = document.getElementById('panelTitle');
  var closeBtn = document.getElementById('panelClose');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var DATA;
  try { DATA = JSON.parse(document.getElementById('globe-data').textContent); } catch (e) { return; }
  var members = DATA.members || [], groups = DATA.groups || [];
  var visible = new Array(members.length).fill(true);

  function matches(m, q) {
    if (!q) return true;
    var hay = [m.name, m.occupation, m.company, m.city, m.country].concat(m.skills || []).join(' ').toLowerCase();
    return q.toLowerCase().split(/\\s+/).filter(Boolean).every(function (t) { return hay.indexOf(t) !== -1; });
  }
  function initials(n) { var p = String(n || '').trim().split(/\\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function locationOf(m) { return m.location; }

  function renderPanel(list, title) {
    panelTitle.textContent = title;
    panelList.innerHTML = list.map(function (m) {
      var img = m.image
        ? '<img class="panel-photo" src="' + esc(m.image) + '" alt="' + esc(m.name) + ' profile photo" referrerpolicy="no-referrer" data-name="' + esc(m.name) + '">'
        : '<span class="panel-initials">' + esc(initials(m.name)) + '</span>';
      return '<a class="panel-member" href="' + esc(m.url) + '">' + img + '<span><b>' + esc(m.name) + (m.verified ? ' ✓' : '') + '</b><small>' + esc([m.occupation, [m.city, m.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')) + '</small></span></a>';
    }).join('') || '<p style="color:#9aa6b2;padding:12px">Nobody matches that yet.</p>';
    panelList.querySelectorAll('img.panel-photo').forEach(function (im) {
      im.addEventListener('error', function () {
        var s = document.createElement('span');
        s.className = 'panel-initials';
        s.textContent = initials(im.getAttribute('data-name') || '?');
        im.replaceWith(s);
      });
    });
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
  }
  closeBtn.addEventListener('click', function () { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); });

  // ── Globe ─────────────────────────────────────────────────────────
  var container = document.getElementById('globe');
  var globeReady = typeof THREE !== 'undefined';
  if (!globeReady) {
    filter.disabled = true;
    countEl.textContent = members.length + ' builders';
    return;
  }
  try { initGlobe(); } catch (err) {
    container.innerHTML = '<p style="color:#9aa6b2;padding:24px">The 3D globe could not start on this device. Scroll down — the full public directory is right below.</p>';
    return;
  }

  function initGlobe() {
    var RADIUS = 1.6;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    camera.position.set(0, 0.9, 5.1);
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.enablePan = false; controls.minDistance = 2.2; controls.maxDistance = 7.5;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.55;
    controls.addEventListener('start', function () { controls.autoRotate = false; });

    scene.add(new THREE.AmbientLight(0xbfd4ff, 0.85));
    var sun = new THREE.DirectionalLight(0xffffff, 1.05); sun.position.set(5, 2.5, 4); scene.add(sun);

    // Starfield
    (function stars() {
      var n = 1400, pos = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var r = 46 + Math.random() * 28, t = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(t); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(t);
      }
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.075, sizeAttenuation: true, transparent: true, opacity: 0.9 })));
    })();

    // Atmosphere halo
    (function halo() {
      var c = document.createElement('canvas'); c.width = c.height = 128;
      var ctx = c.getContext('2d'), grad = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
      grad.addColorStop(0, 'rgba(90,160,255,0)'); grad.addColorStop(0.62, 'rgba(90,160,255,0)'); grad.addColorStop(0.78, 'rgba(110,185,255,0.5)'); grad.addColorStop(1, 'rgba(110,185,255,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      spr.scale.set(RADIUS * 2.72, RADIUS * 2.72, 1); scene.add(spr);
    })();

    var earth = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 64, 48),
      new THREE.MeshPhongMaterial({ color: 0x16324f, emissive: 0x02070d, shininess: 6, specular: 0x334455 })
    );
    scene.add(earth);
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(
      'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/earth-blue-marble.jpg',
      function (tex) { earth.material.map = tex; earth.material.color.set(0xffffff); earth.material.needsUpdate = true; },
      undefined,
      function () { /* keep the procedural ocean — dots still land correctly */ }
    );

    function latLngToVec3(lat, lng, radius) {
      var phi = (90 - lat) * Math.PI / 180, theta = (lng + 180) * Math.PI / 180;
      return new THREE.Vector3(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
    }

    // ── Member sprites: one face each, spiralled around the city point ──
    var faceGroup = new THREE.Group(); scene.add(faceGroup);
    var sprites = [];
    var loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
    function disposableInitialSprite(m) {
      var c = document.createElement('canvas'); c.width = c.height = 96; var ctx = c.getContext('2d');
      ctx.beginPath(); ctx.arc(48, 48, 46, 0, Math.PI * 2); ctx.fillStyle = m.verified ? '#8a6d1a' : '#1d2b3f'; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = m.verified ? '#fbe618' : 'rgba(255,255,255,.55)'; ctx.stroke();
      ctx.fillStyle = m.verified ? '#fbe618' : '#cfe0ff'; ctx.font = '800 34px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(initials(m.name), 48, 50);
      return new THREE.CanvasTexture(c);
    }
    function memberSpriteTexture(m, done) {
      if (!m.image) return done(disposableInitialSprite(m));
      loader.load(m.image, function (tex) {
        try {
          var c = document.createElement('canvas'); c.width = c.height = 96; var ctx = c.getContext('2d');
          ctx.beginPath(); ctx.arc(48, 48, 46, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
          ctx.drawImage(tex.image, 0, 0, 96, 96);
          ctx.beginPath(); ctx.arc(48, 48, 45, 0, Math.PI * 2); ctx.lineWidth = 5; ctx.strokeStyle = m.verified ? '#fbe618' : 'rgba(255,255,255,.75)'; ctx.stroke();
          done(new THREE.CanvasTexture(c));
        } catch (e) { done(disposableInitialSprite(m)); }
      }, undefined, function () { done(disposableInitialSprite(m)); });
    }

    var GOLD = Math.PI * (3 - Math.sqrt(5)); // golden angle
    members.forEach(function (m, index) {
      var loc = locationOf(m); if (!loc) return;
      var spread = loc.precision === 'city' ? 0.02 : 0.055;
      // stable per-member offset so reloads plot the same dots
      var seed = (index * 2654435761) % 100000 / 100000;
      var angle = index * GOLD, rad = spread * (0.35 + 0.65 * Math.sqrt(seed));
      var lat = Math.max(-84, Math.min(84, loc.lat + Math.cos(angle) * rad * 57));
      var lng = loc.lng + Math.sin(angle) * rad * 57;
      var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: disposableInitialSprite(m), transparent: true, depthTest: true }));
      var pos = latLngToVec3(lat, lng, RADIUS + 0.035);
      sprite.position.copy(pos); sprite.scale.set(0.16, 0.16, 1);
      sprite.userData.memberIndex = index;
      faceGroup.add(sprite); sprites.push(sprite);
      memberSpriteTexture(m, function (tex) { sprite.material.map = tex; sprite.material.needsUpdate = true; });
    });

    // ── Picking ─────────────────────────────────────────────────────
    var ray = new THREE.Raycaster(); var pointer = new THREE.Vector2();
    var hovered = null;
    function setPointer(ev) {
      var r = renderer.domElement.getBoundingClientRect();
      var cx = (ev.touches && ev.touches.length ? ev.touches[0].clientX : ev.clientX) - r.left;
      var cy = (ev.touches && ev.touches.length ? ev.touches[0].clientY : ev.clientY) - r.top;
      pointer.x = (cx / r.width) * 2 - 1; pointer.y = -(cy / r.height) * 2 + 1;
      return { x: cx, y: cy };
    }
    function pickVisible(ev) {
      setPointer(ev);
      ray.setFromCamera(pointer, camera);
      var hits = ray.intersectObjects(sprites);
      var camDir = camera.position.clone().normalize();
      for (var i = 0; i < hits.length; i++) {
        var mPos = hits[i].object.position.clone().normalize();
        if (mPos.dot(camDir) > 0.08) return hits[i].object; // near side only
      }
      return null;
    }
    function showTip(sprite, x, y) {
      var m = members[sprite.userData.memberIndex]; if (!m) return;
      tip.innerHTML = '<strong>' + esc(m.name) + (m.verified ? ' ✓' : '') + '</strong>' + esc([m.occupation, [m.city, m.country].filter(Boolean).join(', ')].filter(Boolean).join('<br>'));
      tip.style.left = Math.min(Math.max(x + 12, 8), container.clientWidth - 180) + 'px';
      tip.style.top = Math.max(y + 12, 8) + 'px'; tip.style.display = 'block';
    }
    renderer.domElement.addEventListener('pointermove', function (ev) {
      var s = pickVisible(ev); hovered = s;
      renderer.domElement.style.cursor = s ? 'pointer' : 'grab';
      if (s) { var r = renderer.domElement.getBoundingClientRect(); showTip(s, ev.clientX - r.left, ev.clientY - r.top); } else { tip.style.display = 'none'; }
    });
    renderer.domElement.addEventListener('pointerleave', function () { tip.style.display = 'none'; });
    renderer.domElement.addEventListener('click', function (ev) {
      var s = pickVisible(ev); if (!s) return;
      var m = members[s.userData.memberIndex];
      renderPanel([m], m.name);
    });

    // ── Cities: fly-to chips ────────────────────────────────────────
    var fly = null;
    function flyTo(lat, lng) {
      var target = latLngToVec3(lat, lng, RADIUS + 0.02).normalize().multiplyScalar(5.1);
      fly = { from: camera.position.clone(), to: target, t: 0 };
      controls.autoRotate = false;
    }
    document.querySelectorAll('.chip[data-lat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var lat = parseFloat(btn.dataset.lat), lng = parseFloat(btn.dataset.lng);
        flyTo(lat, lng);
        var here = members.filter(function (m) { var l = locationOf(m); return l && l.label === btn.dataset.label; });
        renderPanel(here, btn.dataset.label + ' · ' + here.length + (here.length === 1 ? ' builder' : ' builders'));
      });
    });

    // ── Filter ───────────────────────────────────────────────────────
    function applyFilter(openPanel) {
      var q = filter.value.trim(); var shown = 0;
      members.forEach(function (m, i) { visible[i] = matches(m, q); if (visible[i]) shown++; });
      sprites.forEach(function (s) { var on = visible[s.userData.memberIndex]; s.material.opacity = on ? 1 : 0.08; s.material.transparent = true; s.visible = true; });
      countEl.textContent = shown + (shown === 1 ? ' builder' : ' builders');
      if (q && openPanel !== false) renderPanel(members.filter(function (m) { return matches(m, q); }).slice(0, 60), '“' + q + '” · ' + shown);
    }
    var debounce;
    filter.addEventListener('input', function () { clearTimeout(debounce); debounce = setTimeout(function () { applyFilter(true); }, 120); });
    // Deep link: /search/?q=<skill|role|city> pre-fills the filter without opening the panel.
    try {
      var q0 = new URLSearchParams(window.location.search).get('q');
      if (q0) { filter.value = q0; applyFilter(false); }
    } catch (e) { /* URLSearchParams unavailable — the filter simply starts empty */ }

    // ── Resize + render loop ─────────────────────────────────────────
    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    window.addEventListener('resize', resize); resize();

    var clockStart = Date.now();
    function tick() {
      requestAnimationFrame(tick);
      if (fly) {
        fly.t = Math.min(1, fly.t + 0.022);
        var k = 1 - Math.pow(1 - fly.t, 3);
        camera.position.lerpVectors(fly.from, fly.to, k);
        if (fly.t >= 1) fly = null;
      }
      controls.update();
      // gentle marker breathing, cheaper than per-frame raycasts
      var t = (Date.now() - clockStart) / 1000;
      for (var i = 0; i < sprites.length; i++) {
        var s = sprites[i]; var base = visible[s.userData.memberIndex] ? 1 : 0.55;
        var pulse = 1 + 0.05 * Math.sin(t * 2 + i * 0.7);
        s.scale.set(0.16 * pulse * base, 0.16 * pulse * base, 1);
      }
      renderer.render(scene, camera);
    }
    tick();
  }
})();
</script>`;

  return documentHtml({
    title: 'Builders on the globe | LINKUP',
    description: 'Spin a 3D globe of public LINKUP members — see where builders, founders and collaborators live, filter by skill or city, and open their profiles.',
    canonical: `${SITE}/search`,
    noindex: true,
    content,
  });
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
