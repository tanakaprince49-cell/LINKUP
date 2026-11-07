// Full-screen Earth and space scene with circular profile picture markers.
// Never displays or serializes where a member is from, search inputs, or profile rails.
import { SITE, APP, profileUrl, escapeHtml } from './_publicSeo.js';
import { resolveLocation } from './_cityCoords.js';

const e = escapeHtml;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function hashSeed(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

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

export function placeMembersOnEarth(members = []) {
  const seenByPlace = new Map();
  return (Array.isArray(members) ? members : []).map((member, index) => {
    const place = typeof member.lat === 'number' && typeof member.lng === 'number'
      ? { lat: member.lat, lng: member.lng, precision: 'city' }
      : resolveLocation(member.city, member.country);
    let lat;
    let lng;
    if (place) {
      const key = `${place.lat.toFixed(3)},${place.lng.toFixed(3)}`;
      const occurrence = seenByPlace.get(key) || 0;
      seenByPlace.set(key, occurrence + 1);
      if (occurrence === 0) {
        lat = place.lat;
        lng = place.lng;
      } else {
        const angle = occurrence * GOLDEN_ANGLE;
        const step = (place.precision === 'city' ? 1.4 : 2.5) * Math.sqrt(occurrence);
        lat = Math.max(-80, Math.min(80, place.lat + Math.cos(angle) * step));
        lng = ((place.lng + Math.sin(angle) * step + 540) % 360) - 180;
      }
    } else {
      const seed = hashSeed(member.uid || member.name || String(index));
      const angle = (index + 1) * GOLDEN_ANGLE + seed * Math.PI * 2;
      lat = Math.max(-62, Math.min(62, (seed * 2 - 1) * 56));
      lng = (((angle * 180) / Math.PI) % 360 + 540) % 360 - 180;
    }
    return {
      uid: member.uid,
      name: member.name,
      image: member.image || '',
      url: member.url || profileUrl(member.uid),
      lat: Number(lat.toFixed(4)),
      lng: Number(lng.toFixed(4)),
    };
  });
}

const safeScriptJson = value => JSON.stringify(value).replace(/[<>&]/g, ch => ({'<':'\\u003c','>':'\\u003e','&':'\\u0026'}[ch]));

export function renderSearchPage({ members = [], nextCursor = null } = {}) {
  const canonical = `${SITE}/search`;
  const placed = placeMembersOnEarth((Array.isArray(members) ? members : []).slice(0, 40));
  const data = safeScriptJson({ members: placed, nextCursor });
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>LINKUP</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${e(canonical)}">
<meta name="theme-color" content="#03070d"><style>
*{box-sizing:border-box}html,body{position:fixed;inset:0;width:100%;height:100%;margin:0;overflow:hidden;background:#03070d}#earthScene{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:radial-gradient(ellipse at 50% 52%,#10263b 0%,#07111c 45%,#03070d 83%)}#globe{position:absolute;inset:0;width:100%;height:100%;touch-action:none}#globe canvas{display:block;width:100%;height:100%;outline:none}#markerLayer{position:absolute;inset:0;pointer-events:none;z-index:2}.mapMarker{position:absolute;left:0;top:0;width:38px;height:38px;padding:0;border:2px solid rgba(255,255,255,.82);border-radius:50%;background:#10263b;box-shadow:0 4px 14px rgba(0,0,0,.5);transform:translate(-50%,-50%);overflow:hidden;pointer-events:auto;cursor:pointer;text-decoration:none;display:grid;place-items:center}.mapMarker:hover,.mapMarker:focus-visible{z-index:4;transform:translate(-50%,-50%) scale(1.14);border-color:#fbe618;outline:none}.mapMarker img,.mapAvatar{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}.mapAvatar{display:grid;place-items:center;background:#1d3a50;color:#fbe618;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:900}.hidden{display:none!important}@media(max-width:600px){.mapMarker{width:32px;height:32px}}
</style></head><body>
<main id="earthScene" aria-label="Earth in space">
  <div id="globe" role="img" aria-label="Rotating Earth in space"></div>
  <div id="markerLayer"></div>
</main>
<script>window.LINKUP_EARTH=${data};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js" crossorigin="anonymous"></script>
<script>
(function(){
'use strict';
var dataset=window.LINKUP_EARTH||{},members=dataset.members||[],nextCursor=dataset.nextCursor||'',host=document.getElementById('globe'),layer=document.getElementById('markerLayer'),markers=[],appendMembers=function(){};
function initials(name){return String(name||'?').trim().split(/\\s+/).slice(0,2).map(function(x){return x[0]||''}).join('').toUpperCase()||'?'}
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
appendMembers=function(rows){(rows||[]).forEach(function(member){if(typeof member.lat!=='number'||typeof member.lng!=='number')return;var link=document.createElement('a');link.className='mapMarker';link.href=member.url||('/app/p/'+encodeURIComponent(member.uid||''));link.setAttribute('aria-label',member.name||'Profile');if(member.image){var img=document.createElement('img');img.src=member.image;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',function(){var fb=document.createElement('span');fb.className='mapAvatar';fb.textContent=initials(member.name);img.replaceWith(fb)});link.appendChild(img)}else{var fb=document.createElement('span');fb.className='mapAvatar';fb.textContent=initials(member.name);link.appendChild(fb)}layer.appendChild(link);var lat=Number(member.lat)*Math.PI/180,lon=Number(member.lng)*Math.PI/180,anchor=new THREE.Object3D();anchor.position.set(-radius*Math.cos(lat)*Math.sin(lon),radius*Math.sin(lat),radius*Math.cos(lat)*Math.cos(lon));globeGroup.add(anchor);markers.push({el:link,anchor:anchor})})};
appendMembers(members);
(async function loadRemaining(){var cursor=nextCursor,pages=0;while(cursor&&pages<5){pages++;try{var path=window.location.pathname.indexOf('/app/')===0?'/app/api/publicSeo':'/api/publicSeo',response=await fetch(path+'?mode=search-data&after='+encodeURIComponent(cursor),{headers:{Accept:'application/json'}});if(!response.ok)break;var page=await response.json();appendMembers(Array.isArray(page.members)?page.members:[]);cursor=page.nextCursor||''}catch(_){break}}})();
function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}var observer=new ResizeObserver(resize);observer.observe(host);resize();
function positionMarkers(){globeGroup.updateMatrixWorld();var rect=renderer.domElement.getBoundingClientRect();markers.forEach(function(m){var world=m.anchor.getWorldPosition(new THREE.Vector3()),normal=world.clone().normalize(),toCamera=camera.position.clone().sub(world).normalize(),front=normal.dot(toCamera)>.03;if(!front){m.el.classList.add('hidden');return}var projected=world.clone().project(camera),inside=projected.z<1&&Math.abs(projected.x)<1.1&&Math.abs(projected.y)<1.1;if(!inside){m.el.classList.add('hidden');return}m.el.classList.remove('hidden');m.el.style.left=((projected.x+1)*.5*rect.width)+'px';m.el.style.top=((-projected.y+1)*.5*rect.height)+'px'})}
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);positionMarkers()}animate();
}catch(_){/* Keep the page as a clean, full-screen space scene if WebGL is unavailable. */}
})();
</script></body></html>`;
}
