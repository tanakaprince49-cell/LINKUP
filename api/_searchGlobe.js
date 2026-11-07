// Public member search rendered as a full-screen, interactive Earth.
// Profile photos and city/country labels come only from opted-in public profiles.
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

export function renderSearchPage({ members }) {
  const dataJson = JSON.stringify({
    members: members.map(m => ({ ...m, location: resolveLocation(m.city, m.country) })),
  }).replace(/</g, '\\u003c');
  const canonical = `${SITE}/search`;
  const description = 'Explore public LINKUP builders on a full-screen 3D Earth. Search skills and locations, then open profiles to connect.';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Search the LINKUP community</title>
<meta name="description" content="${e(description)}"><meta name="robots" content="noindex,follow">
<link rel="canonical" href="${e(canonical)}">
<meta name="theme-color" content="#03070d"><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#03070d;color:#f5f7fa;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{min-height:100svh}#earthSearch{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:radial-gradient(ellipse at 50% 52%,#10263b 0%,#07111c 45%,#03070d 83%)}#globe{position:absolute;inset:0;width:100%;height:100%;touch-action:none}#globe canvas{display:block;width:100%;height:100%;outline:none}.globe-overlay{position:absolute;z-index:3;top:max(16px,env(safe-area-inset-top));left:16px;right:16px;display:flex;align-items:center;gap:10px;pointer-events:none}.globe-overlay>*{pointer-events:auto}#globeFilter{min-width:0;flex:1;height:48px;padding:0 18px;border:1px solid rgba(255,255,255,.17);border-radius:999px;background:rgba(5,12,20,.72);backdrop-filter:blur(14px);color:#f5f7fa;font-size:15px;outline:none}#globeFilter::placeholder{color:#aab8c8}#globeFilter:focus-visible{border-color:#fbe618;box-shadow:0 0 0 2px rgba(251,230,24,.3)}#globeCount{white-space:nowrap;padding:12px 16px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(5,12,20,.72);backdrop-filter:blur(14px);font-size:12px;font-weight:800}#globeTip{position:absolute;z-index:4;display:none;max-width:260px;padding:9px 12px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(4,10,17,.9);box-shadow:0 10px 32px rgba(0,0,0,.35);color:#f8fafc;font-size:12px;line-height:1.45;pointer-events:none;backdrop-filter:blur(12px)}#globeTip strong{display:block;font-size:13px}.globe-panel{position:absolute;z-index:5;top:0;right:0;bottom:0;width:min(360px,88vw);display:flex;flex-direction:column;border-left:1px solid rgba(255,255,255,.14);background:rgba(5,11,19,.88);color:#f5f7fa;backdrop-filter:blur(18px);transform:translateX(102%);transition:transform .24s ease}.globe-panel.open{transform:translateX(0)}.globe-panel header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 16px;border-bottom:1px solid rgba(255,255,255,.1)}.globe-panel header h2{margin:0;color:#fff;font-size:16px;line-height:1.3}.panel-close{width:36px;height:36px;border:1px solid rgba(255,255,255,.18);border-radius:11px;background:rgba(255,255,255,.05);color:#fff;font-size:19px;cursor:pointer}.panel-list{overflow:auto;padding:9px}.panel-member{display:flex;align-items:center;gap:11px;padding:10px 8px;border-radius:14px;color:inherit;text-decoration:none}.panel-member:hover,.panel-member:focus-visible{outline:none;background:rgba(255,255,255,.08)}.panel-member img,.panel-initials{width:48px;height:48px;flex:none;border:2px solid rgba(255,255,255,.16);border-radius:50%;object-fit:cover}.panel-initials{display:grid;place-items:center;background:#152a3d;color:#fbe618;font-weight:900}.panel-member span:nth-child(2){min-width:0;flex:1}.panel-member b,.panel-member small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.panel-member b{font-size:13px}.panel-member small{margin-top:3px;color:#aab8c8;font-size:11px}.earth-vignette{position:absolute;z-index:2;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 48%,rgba(0,0,0,.16) 76%,rgba(0,0,0,.48) 100%)}@media(max-width:560px){.globe-overlay{top:max(10px,env(safe-area-inset-top));left:10px;right:10px;gap:6px}#globeFilter{height:44px;padding:0 14px;font-size:13px}#globeCount{padding:11px 12px;font-size:11px}.globe-panel{width:min(340px,92vw)}}@media(prefers-reduced-motion:reduce){.globe-panel{transition:none}}
</style></head><body>
<main id="earthSearch" aria-label="Interactive public LINKUP member search">
  <div id="globe" role="application" aria-label="Full-screen interactive Earth showing public LINKUP member photos by city and country"></div>
  <div class="globe-overlay"><input id="globeFilter" type="search" autocomplete="off" placeholder="Search people, skills, city or country…" aria-label="Search public LINKUP members"><span id="globeCount">${members.length}</span></div>
  <div id="globeTip" role="status" aria-live="polite"></div>
  <aside class="globe-panel" id="globePanel" aria-hidden="true" aria-label="Selected location profiles"><header><h2 id="panelTitle">Public builders</h2><button class="panel-close" id="panelClose" type="button" aria-label="Close location results">×</button></header><div class="panel-list" id="panelList"></div></aside>
</main>
<script type="application/json" id="globe-data">${dataJson}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js" crossorigin="anonymous"></script>
<script>
(function(){
'use strict';
var host=document.getElementById('globe'),tip=document.getElementById('globeTip'),filter=document.getElementById('globeFilter'),countEl=document.getElementById('globeCount'),panel=document.getElementById('globePanel'),panelList=document.getElementById('panelList'),panelTitle=document.getElementById('panelTitle'),closeBtn=document.getElementById('panelClose');
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function initials(n){var p=String(n||'').trim().split(/\\s+/);return((p[0]||'?')[0]+(p.length>1?p[p.length-1][0]:'')).toUpperCase()}
var data;try{data=JSON.parse(document.getElementById('globe-data').textContent)}catch(_){return}
var members=data.members||[],visible=members.map(function(){return true});
function renderPanel(list,title){panelTitle.textContent=title;panelList.innerHTML=list.map(function(m){var photo=m.image?'<img src="'+esc(m.image)+'" alt="'+esc(m.name)+' profile photo" referrerpolicy="no-referrer" data-name="'+esc(m.name)+'">':'<span class="panel-initials">'+esc(initials(m.name))+'</span>';var place=[m.city,m.country].filter(Boolean).join(', ');return'<a class="panel-member" href="'+esc(m.url)+'">'+photo+'<span><b>'+esc(m.name)+(m.verified?' ✓':'')+'</b><small>'+esc(place||m.occupation||m.skills.join(', '))+'</small></span></a>'}).join('')||'<p style="padding:12px;color:#9aa6b2">No public profiles match.</p>';panelList.querySelectorAll('img').forEach(function(img){img.addEventListener('error',function(){var el=document.createElement('span');el.className='panel-initials';el.textContent=initials(img.dataset.name);img.replaceWith(el)})});panel.classList.add('open');panel.setAttribute('aria-hidden','false')}
closeBtn.addEventListener('click',function(){panel.classList.remove('open');panel.setAttribute('aria-hidden','true')});
if(typeof THREE==='undefined'){host.setAttribute('aria-label','Earth globe unavailable; search profiles using the field above');return}
try{
var radius=1.6,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,120);camera.position.set(0,.7,5.2);
var renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor(0,0);host.appendChild(renderer.domElement);
var controls=new THREE.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.enablePan=false;controls.minDistance=2.3;controls.maxDistance=7;controls.autoRotate=true;controls.autoRotateSpeed=.42;controls.addEventListener('start',function(){controls.autoRotate=false});
scene.add(new THREE.AmbientLight(0xbfd4ff,.9));var sun=new THREE.DirectionalLight(0xffffff,1.1);sun.position.set(5,2.5,4);scene.add(sun);
var globeGroup=new THREE.Group();globeGroup.rotation.y=1.0;scene.add(globeGroup);
var earth=new THREE.Mesh(new THREE.SphereGeometry(radius,72,56),new THREE.MeshPhongMaterial({color:0xffffff,emissive:0x02070d,shininess:7,specular:0x334455}));globeGroup.add(earth);
new THREE.TextureLoader().setCrossOrigin('anonymous').load('${APP}/assets/earth-blue-marble.jpg',function(tex){earth.material.map=tex;earth.material.needsUpdate=true},undefined,function(){});
var atmosphere=new THREE.Mesh(new THREE.SphereGeometry(radius*1.035,64,48),new THREE.MeshBasicMaterial({color:0x35bdf0,transparent:true,opacity:.075,side:THREE.BackSide,depthWrite:false}));globeGroup.add(atmosphere);
var starsPos=new Float32Array(1000*3);for(var si=0;si<1000;si++){var rr=42+Math.random()*30,tt=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1);starsPos[si*3]=rr*Math.sin(ph)*Math.cos(tt);starsPos[si*3+1]=rr*Math.cos(ph);starsPos[si*3+2]=rr*Math.sin(ph)*Math.sin(tt)}var starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(starsPos,3));scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xcfe0ff,size:.07,transparent:true,opacity:.8})));
function latLng(lat,lng,r){var phi=(90-lat)*Math.PI/180,theta=(lng+180)*Math.PI/180;return new THREE.Vector3(-r*Math.sin(phi)*Math.cos(theta),r*Math.cos(phi),r*Math.sin(phi)*Math.sin(theta))}
function initialsTexture(m){var c=document.createElement('canvas');c.width=c.height=96;var x=c.getContext('2d');x.beginPath();x.arc(48,48,46,0,Math.PI*2);x.fillStyle=m.verified?'#746018':'#142a3d';x.fill();x.lineWidth=5;x.strokeStyle=m.verified?'#fbe618':'rgba(255,255,255,.8)';x.stroke();x.fillStyle=m.verified?'#fbe618':'#dcecff';x.font='800 34px system-ui,sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(initials(m.name),48,50);return new THREE.CanvasTexture(c)}
var group=new THREE.Group();globeGroup.add(group);var sprites=[],loader=new THREE.TextureLoader();loader.crossOrigin='anonymous';var golden=Math.PI*(3-Math.sqrt(5));
function attachPhoto(m,sprite){if(!m.image)return;loader.load(m.image,function(tex){try{var c=document.createElement('canvas');c.width=c.height=96;var x=c.getContext('2d');x.beginPath();x.arc(48,48,46,0,Math.PI*2);x.closePath();x.clip();x.drawImage(tex.image,0,0,96,96);x.beginPath();x.arc(48,48,45,0,Math.PI*2);x.lineWidth=5;x.strokeStyle=m.verified?'#fbe618':'rgba(255,255,255,.8)';x.stroke();var map=new THREE.CanvasTexture(c);tex.dispose();sprite.material.map.dispose();sprite.material.map=map;sprite.material.needsUpdate=true}catch(_){tex.dispose()}},undefined,function(){})}
members.forEach(function(m,i){var loc=m.location;if(!loc)return;var spread=loc.precision==='city'?.022:.055,seed=(i*2654435761)%100000/100000,angle=i*golden,rad=spread*(.35+.65*Math.sqrt(seed)),lat=Math.max(-84,Math.min(84,loc.lat+Math.cos(angle)*rad*57)),lng=loc.lng+Math.sin(angle)*rad*57,sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:initialsTexture(m),transparent:true,depthTest:true}));sprite.position.copy(latLng(lat,lng,radius+.045));sprite.scale.set(.17,.17,1);sprite.userData.memberIndex=i;group.add(sprite);sprites.push(sprite);attachPhoto(m,sprite)});
var ray=new THREE.Raycaster(),pointer=new THREE.Vector2();function pick(ev){var r=renderer.domElement.getBoundingClientRect();pointer.x=((ev.clientX-r.left)/r.width)*2-1;pointer.y=-((ev.clientY-r.top)/r.height)*2+1;ray.setFromCamera(pointer,camera);var mh=ray.intersectObjects(sprites,false)[0],eh=ray.intersectObject(earth,false)[0];return mh&&(!eh||mh.distance<eh.distance)?mh.object:null}
renderer.domElement.addEventListener('pointermove',function(ev){var s=pick(ev);renderer.domElement.style.cursor=s?'pointer':'grab';if(!s){tip.style.display='none';return}var m=members[s.userData.memberIndex],r=host.getBoundingClientRect(),place=[m.city,m.country].filter(Boolean).join(', ');tip.innerHTML='<strong>'+esc(place||'Public member location')+'</strong>'+esc(m.name)+(m.occupation?' · '+esc(m.occupation):'');tip.style.left=Math.min(ev.clientX-r.left+12,host.clientWidth-270)+'px';tip.style.top=Math.max(ev.clientY-r.top+12,8)+'px';tip.style.display='block'});
renderer.domElement.addEventListener('pointerleave',function(){tip.style.display='none'});renderer.domElement.addEventListener('click',function(ev){var s=pick(ev);if(!s)return;var m=members[s.userData.memberIndex],place=[m.city,m.country].filter(Boolean).join(', ');renderPanel([m],place||m.name)});
function applyFilter(){var q=filter.value.trim().toLowerCase(),shown=0;members.forEach(function(m,i){var hay=[m.name,m.occupation,m.company,m.city,m.country].concat(m.skills||[]).join(' ').toLowerCase(),ok=!q||q.split(/\\s+/).every(function(t){return hay.includes(t)});visible[i]=ok;if(ok)shown++});sprites.forEach(function(s){s.visible=visible[s.userData.memberIndex]});countEl.textContent=shown+' '+(shown===1?'builder':'builders');if(q)renderPanel(members.filter(function(m){return [m.name,m.occupation,m.company,m.city,m.country].concat(m.skills||[]).join(' ').toLowerCase().includes(q)}).slice(0,60),'Search results')}
var debounce;filter.addEventListener('input',function(){clearTimeout(debounce);debounce=setTimeout(applyFilter,120)});try{var initial=new URLSearchParams(window.location.search).get('q');if(initial){filter.value=initial;applyFilter()}}catch(_){}
function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}var observer=new ResizeObserver(resize);observer.observe(host);resize();function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}animate();
}catch(err){host.setAttribute('aria-label','Interactive Earth could not initialize in this browser')}
})();
</script></body></html>`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
