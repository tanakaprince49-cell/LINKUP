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

export function renderSearchPage() {
  const canonical = `${SITE}/search`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>LINKUP — Earth</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${e(canonical)}">
<meta name="theme-color" content="#03070d"><style>
*{box-sizing:border-box}html,body{position:fixed;inset:0;width:100%;height:100%;margin:0;overflow:hidden;background:#03070d}#earthScene{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:radial-gradient(ellipse at 50% 52%,#10263b 0%,#07111c 45%,#03070d 83%)}#globe{position:absolute;inset:0;width:100%;height:100%;touch-action:none}#globe canvas{display:block;width:100%;height:100%;outline:none}
</style></head><body>
<main id="earthScene" aria-label="Earth from space">
  <div id="globe" role="img" aria-label="A rotating Earth globe in space"></div>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js" crossorigin="anonymous"></script>
<script>
(function(){
'use strict';
var host=document.getElementById('globe');
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
function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}var observer=new ResizeObserver(resize);observer.observe(host);resize();function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}animate();
}catch(_){/* Keep the page as a clean, full-screen space scene if WebGL is unavailable. */}
})();
</script></body></html>`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
