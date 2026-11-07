// Public member search rendered over the full-screen Earth scene.
// Photos, names and locations come only from live opted-in public profiles.
import { SITE, APP, profileUrl, escapeHtml } from './_publicSeo.js';
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
    const key = `${place.precision}:${place.label}:${String(member.country || '').toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { label: place.label, country: member.country || '', precision: place.precision, lat: place.lat, lng: place.lng, members: [] });
    groups.get(key).members.push(index);
  });
  return { groups: [...groups.values()].sort((a, b) => b.members.length - a.members.length), unlocated };
}

const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?';
const safeScriptJson = value => JSON.stringify(value).replace(/[<>&]/g, ch => ({'<':'\u003c','>':'\u003e','&':'\u0026'}[ch]));

export function renderSearchPage({ members = [] } = {}) {
  const canonical = `${SITE}/search`;
  const safeMembers = (Array.isArray(members) ? members : []).slice(0, 600);
  const { groups, unlocated } = groupMembersByLocation(safeMembers);
  const profilesMarkup = safeMembers.map((member, index) => {
    const where = [member.city, member.country].filter(Boolean).join(', ') || 'Location not listed';
    const role = [member.occupation, member.company].filter(Boolean).join(' · ');
    const photo = member.image
      ? `<img class="avatar" src="${e(member.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="avatar initials" aria-hidden="true">${e(initials(member.name))}</span>`;
    return `<a class="profileCard" data-index="${index}" data-search="${e([member.name, member.city, member.country, member.occupation, member.company, ...(member.skills || [])].join(' ').toLowerCase())}" href="${e(member.url || profileUrl(member.uid))}" aria-label="Open ${e(member.name)}’s profile">${photo}<span class="profileText"><strong>${e(member.name)}${member.verified ? '<span class="verified" aria-label="Verified">✓</span>' : ''}</strong><span>${e(role || 'LINKUP member')}</span><small>${e(where)}</small></span></a>`;
  }).join('');
  const data = safeScriptJson({ members: safeMembers, groups });
  const countLabel = safeMembers.length === 1 ? '1 public profile' : `${safeMembers.length} public profiles`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>LINKUP — Search public profiles</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${e(canonical)}">
<meta name="theme-color" content="#03070d"><style>
*{box-sizing:border-box}html,body{position:fixed;inset:0;width:100%;height:100%;margin:0;overflow:hidden;background:#03070d;color:#f4f7fb;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#earthScene{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:radial-gradient(ellipse at 50% 52%,#10263b 0%,#07111c 45%,#03070d 83%)}#globe{position:absolute;inset:0;width:100%;height:100%;touch-action:none}#globe canvas{display:block;width:100%;height:100%;outline:none}#topbar{position:fixed;z-index:5;top:max(14px,env(safe-area-inset-top));left:max(14px,env(safe-area-inset-left));right:max(14px,env(safe-area-inset-right));display:flex;justify-content:space-between;align-items:center;gap:12px;pointer-events:none}.brand,.filter{pointer-events:auto;border:1px solid rgba(209,229,255,.16);background:rgba(6,16,28,.76);backdrop-filter:blur(14px);box-shadow:0 12px 32px rgba(0,0,0,.25)}.brand{padding:10px 14px;border-radius:16px}.brand b{display:block;font-size:13px;letter-spacing:.13em;color:#fbe618}.brand span{display:block;font-size:11px;color:#c8d5e4;margin-top:3px}.filter{width:min(340px,58vw);height:42px;border-radius:14px;padding:0 13px;color:#fff;font:inherit;font-size:13px;outline:none}.filter::placeholder{color:#a7b5c5}.filter:focus{border-color:#fbe618}#markerLayer{position:absolute;inset:0;pointer-events:none;z-index:2}.mapMarker{position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;gap:7px;max-width:180px;padding:5px 10px 5px 5px;border:1px solid rgba(255,255,255,.65);border-radius:999px;background:rgba(4,13,23,.88);color:#fff;font-family:inherit;font-size:11px;font-weight:700;line-height:1.1;white-space:nowrap;box-shadow:0 4px 15px rgba(0,0,0,.45);pointer-events:auto;cursor:pointer}.mapMarker img,.mapAvatar{width:31px;height:31px;border-radius:50%;object-fit:cover;background:#1d3a50}.mapAvatar{display:grid;place-items:center;color:#fbe618;font-weight:900}.markerCount{display:grid;place-items:center;min-width:18px;height:18px;padding:0 4px;border-radius:99px;background:#fbe618;color:#07111c;font-size:10px}.mapMarker:hover,.mapMarker:focus-visible{z-index:4;transform:translate(-50%,-50%) scale(1.08);outline:2px solid #fbe618}#profileRail{position:fixed;z-index:4;left:0;right:0;bottom:0;padding:12px max(14px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));background:linear-gradient(180deg,rgba(3,7,13,0),rgba(3,7,13,.82) 14%,rgba(3,7,13,.96));}.railHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 auto 9px;max-width:1160px;color:#d4e0ee;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.railHead small{font-size:10px;font-weight:500;letter-spacing:0;text-transform:none;color:#a8b8c8}.rail{display:flex;gap:9px;overflow-x:auto;scroll-snap-type:x mandatory;max-width:1160px;margin:auto;padding:1px 1px 5px;scrollbar-width:thin;scrollbar-color:#51697b transparent}.profileCard{scroll-snap-align:start;flex:0 0 235px;min-height:80px;display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(209,229,255,.17);border-radius:16px;background:rgba(7,18,30,.92);color:inherit;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.25)}.profileCard:hover,.profileCard:focus-visible{border-color:#fbe618;outline:none}.avatar{width:50px;height:50px;flex:0 0 50px;display:block;border-radius:50%;object-fit:cover;background:#1d3a50}.initials{display:grid;place-items:center;color:#fbe618;font-weight:900}.profileText{min-width:0;display:flex;flex-direction:column;gap:4px}.profileText strong{display:flex;align-items:center;gap:5px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.profileText span:not(.verified){font-size:10px;color:#c4d1df;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.profileText small{font-size:10px;color:#91a6b9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.verified{display:inline-grid;place-items:center;width:14px;height:14px;flex:0 0 14px;border-radius:50%;background:#1678d2;color:#fff;font-size:10px}.empty{display:grid;place-items:center;flex:1;color:#c4d1df;font-size:12px;padding:16px}.status{font-size:10px;color:#a7bdce}#status{position:fixed;z-index:3;top:72px;right:18px;color:#d1deeb;font-size:10px;text-shadow:0 1px 5px #000}.hidden{display:none!important}@media(max-width:600px){.brand{padding:8px 10px}.brand b{font-size:11px}.brand span{font-size:10px}.filter{width:min(55vw,250px);height:39px;font-size:12px}.mapMarker{max-width:132px;font-size:10px}.mapMarker .markerLabel{max-width:68px;overflow:hidden;text-overflow:ellipsis}.profileCard{flex-basis:210px;min-height:74px}.avatar{width:44px;height:44px;flex-basis:44px}#profileRail{padding-top:8px}}
</style></head><body>
<main id="earthScene" aria-label="Search LINKUP public profiles around Earth">
  <div id="globe" role="img" aria-label="Rotating Earth with public member profile locations"></div>
  <div id="markerLayer" aria-label="Profile locations"></div>
  <header id="topbar"><div class="brand"><b>LINKUP · EARTH</b><span>Browse public member profiles</span></div><input id="profileFilter" class="filter" type="search" autocomplete="off" placeholder="Filter by name, role, skill or city…" aria-label="Filter public profiles"></header>
  <div id="status" aria-live="polite">${e(countLabel)}${unlocated.length ? ` · ${unlocated.length} without a mapped location` : ''}</div>
  <section id="profileRail" aria-label="Public member profiles"><div class="railHead"><span>Public profiles</span><small id="visibleCount">${e(countLabel)} · Select a card to view the profile</small></div><div class="rail" id="profiles">${profilesMarkup || '<div class="empty">No public profiles are available right now.</div>'}</div></section>
</main>
<script>window.LINKUP_SEARCH=${data};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js" crossorigin="anonymous"></script>
<script>
(function(){
'use strict';
var dataset=window.LINKUP_SEARCH||{},members=dataset.members||[],groups=dataset.groups||[],host=document.getElementById('globe'),layer=document.getElementById('markerLayer'),rail=document.getElementById('profiles'),filter=document.getElementById('profileFilter'),visible=document.getElementById('visibleCount'),currentQuery='';
function matches(member,q){return !q||[member.name,member.city,member.country,member.occupation,member.company].concat(member.skills||[]).join(' ').toLowerCase().includes(q)}
function updateFilter(){currentQuery=(filter.value||'').trim().toLowerCase();var shown=0;Array.prototype.forEach.call(rail.querySelectorAll('.profileCard'),function(card){var index=Number(card.getAttribute('data-index')),ok=matches(members[index]||{},currentQuery);card.classList.toggle('hidden',!ok);if(ok)shown++});visible.textContent=shown+' of '+members.length+' public profiles · Select a card to view the profile';markers.forEach(function(m){m.filteredOut=!m.indices.some(function(i){return matches(members[i]||{},currentQuery)});if(m.filteredOut)m.el.classList.add('hidden')})}
filter.addEventListener('input',updateFilter);updateFilter();
if(typeof THREE==='undefined'||!host)return;
try{
var radius=1.65,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,120);camera.position.set(0,.32,5);
var renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor(0,0);host.appendChild(renderer.domElement);
var controls=new THREE.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.enablePan=false;controls.minDistance=2.4;controls.maxDistance=8;controls.autoRotate=true;controls.autoRotateSpeed=.36;
scene.add(new THREE.AmbientLight(0xbfd4ff,.9));var sun=new THREE.DirectionalLight(0xffffff,1.25);sun.position.set(5,2.5,4);scene.add(sun);var rim=new THREE.DirectionalLight(0x1685d2,.55);rim.position.set(-4,-1,-5);scene.add(rim);
var globeGroup=new THREE.Group();globeGroup.rotation.y=1.0;scene.add(globeGroup);
var earth=new THREE.Mesh(new THREE.SphereGeometry(radius,88,64),new THREE.MeshPhongMaterial({color:0xffffff,emissive:0x02070d,shininess:8,specular:0x334455}));globeGroup.add(earth);
new THREE.TextureLoader().setCrossOrigin('anonymous').load('${APP}/assets/earth-blue-marble.jpg',function(tex){tex.colorSpace=THREE.SRGBColorSpace;earth.material.map=tex;earth.material.needsUpdate=true},undefined,function(){});
var atmosphere=new THREE.Mesh(new THREE.SphereGeometry(radius*1.035,64,48),new THREE.MeshBasicMaterial({color:0x35bdf0,transparent:true,opacity:.075,side:THREE.BackSide,depthWrite:false}));globeGroup.add(atmosphere);
var starsPos=new Float32Array(1200*3);for(var i=0;i<1200;i++){var r=24+Math.random()*28,t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1);starsPos[i*3]=r*Math.sin(p)*Math.cos(t);starsPos[i*3+1]=r*Math.cos(p);starsPos[i*3+2]=r*Math.sin(p)*Math.sin(t)}var starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(starsPos,3));scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xcfe0ff,size:.055,transparent:true,opacity:.72})));
var markers=[];groups.forEach(function(group){var first=members[group.members[0]]||{},button=document.createElement('button');button.type='button';button.className='mapMarker';button.setAttribute('aria-label','View '+group.label+' profiles ('+group.members.length+')');var face;if(first.image){face=document.createElement('img');face.src=first.image;face.alt='';face.referrerPolicy='no-referrer'}else{face=document.createElement('span');face.className='mapAvatar';face.textContent=(first.name||'?').split(/\\s+/).slice(0,2).map(function(x){return x[0]||''}).join('').toUpperCase()}button.appendChild(face);var label=document.createElement('span');label.className='markerLabel';label.textContent=group.label;button.appendChild(label);if(group.members.length>1){var count=document.createElement('span');count.className='markerCount';count.textContent=group.members.length;button.appendChild(count)}button.addEventListener('click',function(){var card=rail.querySelector('[data-index="'+group.members[0]+'"]');if(card)card.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'})});layer.appendChild(button);var lat=Number(group.lat)*Math.PI/180,lon=Number(group.lng)*Math.PI/180;var anchor=new THREE.Object3D();anchor.position.set(-radius*Math.cos(lat)*Math.sin(lon),radius*Math.sin(lat),radius*Math.cos(lat)*Math.cos(lon));globeGroup.add(anchor);markers.push({el:button,anchor:anchor,indices:group.members,filteredOut:false})});updateFilter();
function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}var observer=new ResizeObserver(resize);observer.observe(host);resize();
function positionMarkers(){globeGroup.updateMatrixWorld();var rect=renderer.domElement.getBoundingClientRect();markers.forEach(function(m){var world=m.anchor.getWorldPosition(new THREE.Vector3()),normal=world.clone().normalize(),toCamera=camera.position.clone().sub(world).normalize(),front=normal.dot(toCamera)>.03;if(m.filteredOut||!front){m.el.classList.add('hidden');return}var projected=world.clone().project(camera),inside=projected.z<1&&Math.abs(projected.x)<1.1&&Math.abs(projected.y)<1.1;if(!inside){m.el.classList.add('hidden');return}m.el.classList.remove('hidden');m.el.style.left=((projected.x+1)*.5*rect.width)+'px';m.el.style.top=((-projected.y+1)*.5*rect.height)+'px'})}
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);positionMarkers()}animate();
}catch(_){/* Profile cards remain usable if WebGL is unavailable. */}
})();
</script></body></html>`;
}
