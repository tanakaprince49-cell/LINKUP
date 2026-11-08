// Full-screen Earth and space scene with circular profile picture markers.
// Hovering over a profile picture shows name, city, country.
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

export function locationLabels(members = []) {
  const list = Array.isArray(members) ? members : [];
  const { groups } = groupMembersByLocation(list);
  // City labels: merge groups that share an anchor (same city typed with
  // different country spellings still lands on one label).
  const cities = new Map();
  for (const g of groups) {
    if (g.precision === 'country') continue;
    const key = `${g.label}:${g.lat}:${g.lng}`;
    const entry = cities.get(key) || { kind: 'city', text: g.label, lat: g.lat, lng: g.lng, count: 0 };
    entry.count += g.members.length;
    cities.set(key, entry);
  }
  // Country labels: one per country anchor, however members spelled it
  // ("USA" / "America" / "United States" become a single label).
  const byCoords = new Map();
  for (const member of list) {
    const country = resolveLocation('', member?.country);
    if (!country) continue;
    const key = `${country.lat.toFixed(3)}:${country.lng.toFixed(3)}`;
    const slot = byCoords.get(key) || { lat: country.lat, lng: country.lng, votes: new Map(), count: 0 };
    slot.count += 1;
    slot.votes.set(country.label, (slot.votes.get(country.label) || 0) + 1);
    byCoords.set(key, slot);
  }
  const countries = [...byCoords.values()].map(slot => {
    const text = [...slot.votes.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    return { kind: 'country', text, lat: slot.lat, lng: slot.lng, count: slot.count };
  });
  return [...cities.values(), ...countries];
}

export function placeMembersOnEarth(members = []) {
  const seenByPlace = new Map();
  const list = (Array.isArray(members) ? members : []).filter(m => m && typeof m === 'object');
  // Deterministic order: the same profile keeps the same spot on every page,
  // every render and every deploy.
  const ordered = [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.uid || '').localeCompare(String(b.uid || '')));
  return ordered.map(member => {
    const base = {
      uid: member.uid,
      name: String(member.name || '').trim(),
      city: String(member.city || '').trim(),
      country: String(member.country || '').trim(),
      image: member.image || '',
      url: member.url || profileUrl(member.uid),
    };
    // Already placed upstream (renderSearchPage receives handler output): keep the pin.
    if (typeof member.lat === 'number' && typeof member.lng === 'number') {
      return { ...base, lat: member.lat, lng: member.lng };
    }
    const place = resolveLocation(member.city, member.country);
    // No usable location: never invent coordinates. Unlocated profiles are
    // listed by name under the globe instead of floating in an ocean.
    if (!place) return base;
    const key = `${place.lat.toFixed(3)},${place.lng.toFixed(3)}`;
    const occurrence = seenByPlace.get(key) || 0;
    seenByPlace.set(key, occurrence + 1);
    // Same-place profiles fan out in a tight ring around their real anchor,
    // each at its own stable angle: city clusters stay within ~1.5 degrees
    // (~165 km) of the city centre, country clusters within ~3.5 degrees.
    const step = place.precision === 'city' ? 0.35 : 1.2;
    const cap = place.precision === 'city' ? 1.5 : 3.5;
    const radius = Math.min(step * Math.sqrt(occurrence), cap);
    const angle = hashSeed(member.uid || member.name || key) * Math.PI * 2 + occurrence * GOLDEN_ANGLE;
    const cosLat = Math.max(Math.cos((place.lat * Math.PI) / 180), 0.35);
    const lat = Math.max(-80, Math.min(85, place.lat + Math.sin(angle) * radius));
    const lng = ((((place.lng + (Math.cos(angle) * radius) / cosLat) + 540) % 360) + 360) % 360 - 180;
    return { ...base, lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
  });
}

const safeScriptJson = value => JSON.stringify(value).replace(/[<>&]/g, ch => ({'<':'\\u003c','>':'\\u003e','&':'\\u0026'}[ch]));

export function renderSearchPage({ members = [], nextCursor = null } = {}) {
  const canonical = `${SITE}/search`;
  const placed = placeMembersOnEarth(Array.isArray(members) ? members : []);
  const onMap = placed.filter(m => typeof m.lat === 'number' && typeof m.lng === 'number');
  const unlocated = placed.filter(m => typeof m.lat !== 'number' || typeof m.lng !== 'number');
  const summaryText = `${onMap.length} builder${onMap.length === 1 ? '' : 's'} on the map${unlocated.length ? ` · ${unlocated.length} have not shared a location yet` : ''}`;
  const unlocatedItems = unlocated.map(m => `<li><a href="${e(m.url || profileUrl(m.uid))}">${e(m.name || 'Builder')}</a></li>`).join('');
  const data = safeScriptJson({ members: placed, nextCursor, labels: locationLabels(members) });
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>LINKUP</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${e(canonical)}">
<meta name="theme-color" content="#03070d"><style>
*{box-sizing:border-box}html,body{position:fixed;inset:0;width:100%;height:100%;margin:0;overflow:hidden;background:#03070d;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#earthScene{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:radial-gradient(ellipse at 50% 52%,#10263b 0%,#07111c 45%,#03070d 83%)}#globe{position:absolute;inset:0;width:100%;height:100%;touch-action:none}#globe canvas{display:block;width:100%;height:100%;outline:none}#markerLayer{position:absolute;inset:0;pointer-events:none;z-index:2}.mapMarker{position:absolute;left:0;top:0;width:38px;height:38px;padding:0;border:2px solid rgba(255,255,255,.82);border-radius:50%;background:#10263b;box-shadow:0 4px 14px rgba(0,0,0,.5);transform:translate(-50%,-50%);overflow:hidden;pointer-events:auto;cursor:pointer;text-decoration:none;display:grid;place-items:center}.mapMarker:hover,.mapMarker:focus-visible{z-index:4;transform:translate(-50%,-50%) scale(1.16);border-color:#fbe618;outline:none}.mapMarker img,.mapAvatar{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}.mapAvatar{display:grid;place-items:center;background:#1d3a50;color:#fbe618;font-size:12px;font-weight:900}#globeTip{position:fixed;z-index:6;left:0;top:0;transform:translate(-50%,calc(-100% - 12px));padding:7px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(4,11,20,.94);color:#f4f7fb;font-size:12px;line-height:1.35;white-space:nowrap;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.45)}#globeTip strong{display:block;font-size:12.5px;color:#fbe618}#globeTip span{display:block;color:#d6e3f3;font-size:11.5px}.mapLabel{position:absolute;left:0;top:0;transform:translate(-50%,-170%);padding:2px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(3,9,18,.72);color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.02em;white-space:nowrap;pointer-events:none}.mapLabel.country{transform:translate(-50%,-50%);padding:0;border:none;background:none;color:rgba(219,234,255,.6);font-size:11px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;text-shadow:0 1px 8px rgba(0,0,0,.9)}#globeSummary{position:fixed;left:14px;bottom:14px;z-index:7;padding:9px 14px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(3,9,18,.78);color:#eef4ff;font-size:12.5px;font-weight:600;pointer-events:none;backdrop-filter:blur(8px)}#unlocatedPanel{position:fixed;left:14px;bottom:56px;z-index:7;max-width:min(400px,calc(100vw - 28px));padding:10px 14px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(3,9,18,.84);color:#eef4ff;font-size:12.5px;backdrop-filter:blur(8px)}#unlocatedPanel summary{cursor:pointer;font-weight:700;color:#fff}#unlocatedPanel ul{margin:8px 0 2px;padding:0;list-style:none;max-height:30vh;overflow:auto}#unlocatedPanel li{margin:3px 0}#unlocatedPanel a{color:#fbe618;text-decoration:none;font-weight:600}#unlocatedPanel a:hover{text-decoration:underline}.hidden{display:none!important}@media(max-width:600px){.mapMarker{width:32px;height:32px}}
</style></head><body>
<main id="earthScene" aria-label="Earth in space">
  <div id="globe" role="img" aria-label="Rotating Earth in space"></div>
  <div id="markerLayer"></div>
  <div id="globeTip" class="hidden" role="tooltip"></div>
  <div id="globeSummary" role="status">${e(summaryText)}</div>
  <details id="unlocatedPanel"${unlocated.length ? '' : ' class="hidden"'}><summary>Not on the map yet (${unlocated.length}) — no location shared</summary><ul id="unlocatedList">${unlocatedItems}</ul></details>
</main>
<script>window.LINKUP_EARTH=${data};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js" crossorigin="anonymous"></script>
<script>
(function(){
'use strict';
var dataset=window.LINKUP_EARTH||{},members=dataset.members||[],labels=dataset.labels||[],nextCursor=dataset.nextCursor||'',host=document.getElementById('globe'),layer=document.getElementById('markerLayer'),tip=document.getElementById('globeTip'),markers=[],seenUids={},appendMembers=function(){},appendLabels=function(){};
var summaryEl=document.getElementById('globeSummary'),unlocatedPanel=document.getElementById('unlocatedPanel'),unlocatedEl=document.getElementById('unlocatedList'),unlocatedMembers=[],unlocatedKeys={},seenLabels={},labelMarkers=[];
function refreshSummary(){var n=markers.length,m=unlocatedMembers.length;if(summaryEl)summaryEl.textContent=n+' builder'+(n===1?'':'s')+' on the map'+(m?' · '+m+' have not shared a location yet':'');if(unlocatedPanel){unlocatedPanel.classList.toggle('hidden',m===0);var sum=unlocatedPanel.querySelector('summary');if(sum)sum.textContent='Not on the map yet ('+m+') — no location shared'}if(unlocatedEl){unlocatedEl.textContent='';unlocatedMembers.forEach(function(member){var li=document.createElement('li'),a=document.createElement('a');a.href=member.url||('/app/p/'+encodeURIComponent(member.uid||''));a.textContent=member.name||'Builder';li.appendChild(a);unlocatedEl.appendChild(li)})}}
function initials(name){return String(name||'?').trim().split(/\\s+/).slice(0,2).map(function(x){return x[0]||''}).join('').toUpperCase()||'?'}
function hoverText(member){return [member.name,member.city,member.country].filter(Boolean).join(', ')}
function showTip(el,member){if(!tip)return;var where=[member.city,member.country].filter(Boolean).join(', ');tip.textContent='';var nameEl=document.createElement('strong');nameEl.textContent=member.name||'Member';tip.appendChild(nameEl);if(where){var locEl=document.createElement('span');locEl.textContent=where;tip.appendChild(locEl)}var r=el.getBoundingClientRect();tip.style.left=(r.left+r.width/2)+'px';tip.style.top=Math.max(36,r.top)+'px';tip.classList.remove('hidden')}
function hideTip(){if(tip)tip.classList.add('hidden')}
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
appendMembers=function(rows){(rows||[]).forEach(function(member){if(typeof member.lat!=='number'||typeof member.lng!=='number'){var uk=member.url||member.uid||member.name;if(uk&&!unlocatedKeys[uk]){unlocatedKeys[uk]=1;unlocatedMembers.push(member);refreshSummary()}return;}if(member.uid&&seenUids[member.uid])return;if(member.uid)seenUids[member.uid]=1;var link=document.createElement('a'),label=hoverText(member)||'Profile';link.className='mapMarker';link.href=member.url||('/app/p/'+encodeURIComponent(member.uid||''));link.title=label;link.setAttribute('aria-label',label);link.addEventListener('pointerenter',function(){showTip(link,member)});link.addEventListener('pointerleave',hideTip);link.addEventListener('focus',function(){showTip(link,member)});link.addEventListener('blur',hideTip);if(member.image){var img=document.createElement('img');img.src=member.image;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',function(){var fb=document.createElement('span');fb.className='mapAvatar';fb.textContent=initials(member.name);img.replaceWith(fb)});link.appendChild(img)}else{var fb=document.createElement('span');fb.className='mapAvatar';fb.textContent=initials(member.name);link.appendChild(fb)}layer.appendChild(link);var lat=Number(member.lat)*Math.PI/180,lon=Number(member.lng)*Math.PI/180,anchor=new THREE.Object3D();anchor.position.set(radius*Math.cos(lat)*Math.cos(lon),radius*Math.sin(lat),-radius*Math.cos(lat)*Math.sin(lon));globeGroup.add(anchor);markers.push({el:link,anchor:anchor})});refreshSummary()};
function labelText(l){return l.count>1?l.text+' · '+l.count:l.text}
appendLabels=function(rows){(rows||[]).forEach(function(l){if(!l||typeof l.lat!=='number'||typeof l.lng!=='number'||!l.text)return;var key=(l.kind||'city')+':'+l.text+':'+Number(l.lat).toFixed(2)+':'+Number(l.lng).toFixed(2),existing=seenLabels[key];if(existing){existing.count+=l.count||1;existing.el.textContent=labelText(existing);return}var el=document.createElement('div');el.className='mapLabel'+(l.kind==='country'?' country':'');var entry={count:l.count||1,text:l.text,kind:l.kind||'city'};el.textContent=labelText(entry);layer.appendChild(el);var la=Number(l.lat)*Math.PI/180,lo=Number(l.lng)*Math.PI/180,an=new THREE.Object3D();an.position.set(radius*1.02*Math.cos(la)*Math.cos(lo),radius*1.02*Math.sin(la),-radius*1.02*Math.cos(la)*Math.sin(lo));globeGroup.add(an);entry.el=el;entry.anchor=an;seenLabels[key]=entry;labelMarkers.push(entry)});refreshBorders()};
appendLabels(labels);
var borderData=null,borderObjs=[],borderHiKey='__',borderGroup=new THREE.Group();globeGroup.add(borderGroup);
function normName(t){return String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'')}
var COUNTRY_ALIASES={uk:'unitedkingdom',uae:'unitedarabemirates',usa:'unitedstatesofamerica',america:'unitedstatesofamerica',unitedstates:'unitedstatesofamerica',indian:'india',ind:'india',drc:'demrepcongo',ivorycoast:'cotedivoire',swaziland:'eswatini',czechrepublic:'czechia',italia:'italy'};
function surfPoint(latDeg,lngDeg,r){var la=latDeg*Math.PI/180,lo=lngDeg*Math.PI/180;return[r*Math.cos(la)*Math.cos(lo),r*Math.sin(la),-r*Math.cos(la)*Math.sin(lo)]}
function refreshBorders(){if(!borderData)return;var hi={};Object.keys(seenLabels).forEach(function(k){var e=seenLabels[k];if(e&&e.kind==='country'){var n=normName(e.text);hi[COUNTRY_ALIASES[n]||n]=1}});var hiKey=Object.keys(hi).sort().join('|');if(hiKey===borderHiKey&&borderObjs.length)return;borderHiKey=hiKey;borderObjs.forEach(function(o){borderGroup.remove(o);o.geometry.dispose();o.material.dispose()});borderObjs=[];var faint=[],amber=[],hiNames=Object.keys(hi);borderData.forEach(function(c){var nn=normName(c[0]),isHi=!!hi[nn]||(nn.length>=4&&hiNames.some(function(h){return h.length>=4&&(nn.indexOf(h)===0||h.indexOf(nn)===0)}));var target=isHi?amber:faint;c[1].forEach(function(ring){for(var j=0;j+3<ring.length;j+=2){var a=surfPoint(ring[j+1],ring[j],radius*1.003),b=surfPoint(ring[j+3],ring[j+2],radius*1.003);target.push(a[0],a[1],a[2],b[0],b[1],b[2])}})});[[faint,0xdfeaff,0.38],[amber,0xfbe618,0.95]].forEach(function(spec){if(!spec[0].length)return;var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(spec[0]),3));var l=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:spec[1],transparent:true,opacity:spec[2]}));borderGroup.add(l);borderObjs.push(l)})}
fetch('/app/assets/countries-50m.json').then(function(r){return r.ok?r.json():null}).then(function(d){if(!d||!Array.isArray(d.countries))return;borderData=d.countries.map(function(c){return[c[0],c[1].map(function(r){var out=[],x=0,y=0;for(var i=0;i<r.length;i+=2){x+=r[i];y+=r[i+1];out.push(x/100,y/100)}return out})]});borderHiKey='__';refreshBorders()}).catch(function(){});
appendMembers(members);
(async function loadRemaining(){var cursor=nextCursor;while(cursor){try{var endpoints=['/app/api/publicSeo','/api/publicSeo'],page=null;for(var ei=0;ei<endpoints.length;ei++){var res=await fetch(endpoints[ei]+'?mode=search-data&after='+encodeURIComponent(cursor),{headers:{Accept:'application/json'}});if(res.ok&&(res.headers.get('content-type')||'').indexOf('json')!==-1){page=await res.json();break}}if(!page)break;appendMembers(Array.isArray(page.members)?page.members:[]);appendLabels(page.labels||[]);cursor=page.nextCursor||''}catch(_){break}}})();
function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}var observer=new ResizeObserver(resize);observer.observe(host);resize();
function positionMarkers(){globeGroup.updateMatrixWorld();var rect=renderer.domElement.getBoundingClientRect();markers.concat(labelMarkers).forEach(function(m){var world=m.anchor.getWorldPosition(new THREE.Vector3()),normal=world.clone().normalize(),toCamera=camera.position.clone().sub(world).normalize(),front=normal.dot(toCamera)>.03;if(!front){m.el.classList.add('hidden');return}var projected=world.clone().project(camera),inside=projected.z<1&&Math.abs(projected.x)<1.1&&Math.abs(projected.y)<1.1;if(!inside){m.el.classList.add('hidden');return}m.el.classList.remove('hidden');m.el.style.left=((projected.x+1)*.5*rect.width)+'px';m.el.style.top=((-projected.y+1)*.5*rect.height)+'px'})}
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);positionMarkers()}animate();
}catch(_){/* Keep the page as a clean, full-screen space scene if WebGL is unavailable. */}
})();
</script></body></html>`;
}
