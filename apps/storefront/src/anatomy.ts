import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { storyState, clamp, chapterProgress } from './scroll-story.js';
export function mountAnatomy(){
 const section=document.querySelector<HTMLElement>('#anatomy')!;
 const host=section.querySelector<HTMLElement>('.anatomy-canvas')!;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let motionOverride:boolean|null=null;
 const isReduced=()=>motionOverride??reduced.matches;
 const motionButton=section.querySelector<HTMLButtonElement>('#motion-toggle')!;
 function syncMotion(){document.documentElement.classList.toggle('motion-enabled',!isReduced());document.documentElement.classList.toggle('motion-reduced',isReduced());motionButton.textContent=isReduced()?'Play scroll experience ↗':'Reduce motion';motionButton.setAttribute('aria-pressed',String(!isReduced()));}
 syncMotion();
 const panels=Array.from(section.querySelectorAll<HTMLElement>('.story-chapter'));
 const nav=Array.from(section.querySelectorAll<HTMLButtonElement>('[data-chapter]'));
 let renderer:THREE.WebGLRenderer;
 try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{section.classList.add('story-fallback');return;}
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setClearColor(0x000000,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
 renderer.domElement.setAttribute('aria-hidden','true');host.appendChild(renderer.domElement);section.classList.add('story-ready');
 const scene=new THREE.Scene();scene.environmentIntensity=.55;
 const camera=new THREE.PerspectiveCamera(31,1,.1,70);camera.position.set(6,4.5,8.6);camera.lookAt(0,.6,0);
 const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
 scene.add(new THREE.HemisphereLight(0xf4e7ce,0x34382b,1));
 const key=new THREE.DirectionalLight(0xffe8ba,5);key.position.set(-3,7,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-7;key.shadow.camera.right=7;key.shadow.camera.top=7;key.shadow.camera.bottom=-7;key.shadow.normalBias=.025;scene.add(key);
 const rim=new THREE.DirectionalLight(0xd9be80,3);rim.position.set(4,4,-4);scene.add(rim);
 const root=new THREE.Group();scene.add(root);
 const charcoal=new THREE.MeshStandardMaterial({color:0x262921,roughness:.85,metalness:.07});
 const edge=new THREE.MeshStandardMaterial({color:0x8d7957,roughness:.35,metalness:.65});
 const ivory=new THREE.MeshStandardMaterial({color:0xe9dec1,roughness:.48,metalness:.08});
 const paper=new THREE.MeshStandardMaterial({color:0xd6c8a7,roughness:.96});
 const green=new THREE.MeshStandardMaterial({color:0x344538,roughness:.8});
 const amber=new THREE.MeshPhysicalMaterial({color:0x9d6220,roughness:.2,metalness:.14,clearcoat:1,transparent:true,opacity:.9});
 const gold=new THREE.MeshStandardMaterial({color:0xb8985c,roughness:.23,metalness:.8});
 const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D,x=0,y=0,z=0)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
 const box=(w:number,h:number,d:number,mat:THREE.Material,parent:THREE.Object3D,x=0,y=0,z=0)=>mesh(new RoundedBoxGeometry(w,h,d,3,.025),mat,parent,x,y,z);
 const base=new THREE.Group();root.add(base);
 box(3,.12,2.3,charcoal,base,0,-.46,0);box(3,.92,.1,charcoal,base,0,0,1.1);box(3,.92,.1,charcoal,base,0,0,-1.1);box(.1,.92,2.3,charcoal,base,-1.45,0,0);box(.1,.92,2.3,charcoal,base,1.45,0,0);
 box(2.78,.035,2.08,paper,base,0,-.37,0);
 const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3,.96,2.3)),new THREE.LineBasicMaterial({color:0xb9a073,transparent:true,opacity:.75}));root.add(outline);
 const lid=new THREE.Group();root.add(lid);box(3.12,.2,2.42,charcoal,lid);
 box(3.13,.012,.012,edge,lid,0,-.06,1.215);box(3.13,.012,.012,edge,lid,0,-.06,-1.215);
 const ribbon=new THREE.Group();lid.add(ribbon);box(.22,.025,2.45,ivory,ribbon,0,.12,0);box(3.14,.026,.22,ivory,ribbon,0,.12,0);
 const loop=(sign:number)=>{const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.16,0),new THREE.Vector3(sign*.52,.47,.08),new THREE.Vector3(sign*.63,.24,.12),new THREE.Vector3(0,.17,.02)]);const m=mesh(new THREE.TubeGeometry(curve,40,.065,8,false),ivory,ribbon);m.scale.z=.55;};loop(1);loop(-1);box(.18,.13,.18,ivory,ribbon,0,.19,.01);
 const objects=new THREE.Group();root.add(objects);
 const bottle=new THREE.Group();objects.add(bottle);box(.62,.76,.48,amber,bottle,0,.2,0);mesh(new THREE.CylinderGeometry(.17,.17,.1,32),gold,bottle,0,.63,0);mesh(new THREE.SphereGeometry(.17,32,16),gold,bottle,0,.77,0);box(.39,.29,.008,paper,bottle,0,.18,.244);
 const cup=new THREE.Group();objects.add(cup);const cupShape=[new THREE.Vector2(0,0),new THREE.Vector2(.28,0),new THREE.Vector2(.36,.07),new THREE.Vector2(.38,.61),new THREE.Vector2(.33,.62),new THREE.Vector2(.31,.12),new THREE.Vector2(0,.12)];mesh(new THREE.LatheGeometry(cupShape,48),ivory,cup);const handle=mesh(new THREE.TorusGeometry(.23,.055,12,40),ivory,cup,.42,.34,0);handle.rotation.y=0;
 const journal=new THREE.Group();objects.add(journal);box(.83,.1,1.12,paper,journal,0,0,0);box(.88,.025,1.17,green,journal,0,.06,0);box(.88,.025,1.17,green,journal,0,-.06,0);box(.035,.13,1.18,green,journal,-.43,0,0);box(.32,.005,.015,gold,journal,0,.078,-.26);
 const card=new THREE.Group();root.add(card);box(1.05,.022,.71,paper,card);
 for(let i=0;i<3;i++)box(.57-i*.07,.002,.008,edge,card,-.05,.014,-.1+i*.09);
 const seal=mesh(new THREE.CylinderGeometry(.075,.075,.008,24),gold,card,.31,.019,.17);seal.rotation.y=.4;
 const platform=mesh(new THREE.CylinderGeometry(2.5,2.65,.13,96),new THREE.MeshStandardMaterial({color:0x292922,roughness:.95}),scene,0,-.6,0);
 platform.receiveShadow=true;
 const floor=mesh(new THREE.PlaneGeometry(80,80),new THREE.ShadowMaterial({opacity:.33}),scene,0,-.68,0);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;
 let progress=0;let chapter=-1;let visible=true;let pending=0;
 function render(){pending=0;if(!visible)return;
  const rect=section.getBoundingClientRect();progress=isReduced()?1:clamp(-rect.top/Math.max(1,section.offsetHeight-innerHeight));
  const s=storyState(progress);root.rotation.y=s.rotation;root.position.y=-.04;
  base.scale.setScalar(.985+s.material*.015);base.visible=s.material>.04;outline.visible=s.material<.99;(outline.material as THREE.LineBasicMaterial).opacity=(1-s.material)*.65;
  const spread=s.objects*(1-s.settle);
  bottle.position.set(-.67-spread*.22,-.26+spread*1.53,0);bottle.rotation.z=-spread*.16;bottle.rotation.y=spread*.35;
  cup.position.set(.63+spread*.38,-.28+spread*.94,.38);cup.rotation.z=spread*.09;
  journal.position.set(.49+spread*.33,-.17+spread*1.65,-.45);journal.rotation.x=spread*.65;journal.rotation.z=-spread*.19;
  objects.visible=s.objects>.01;objects.scale.setScalar((.5+s.objects*.5)*(1-s.settle*.25));
  const noteRise=s.note*(1-s.settle);card.position.set(-.25-noteRise*.6,.2+noteRise*2.1,.2);card.rotation.set(.1+noteRise*.55,0,-noteRise*.13);card.visible=s.note>.01;
  lid.position.set(s.seal===1?0:(1-s.seal)*.15,.61+(1-s.seal)*2.4,-(1-s.seal)*.25);lid.rotation.z=(1-s.seal)*-.1;lid.visible=s.material>.6;
  ribbon.visible=s.seal>.01;ribbon.scale.setScalar(.65+s.seal*.35);
  if(s.chapter!==chapter){chapter=s.chapter;panels.forEach((el,i)=>{el.classList.toggle('active',i===chapter);el.setAttribute('aria-hidden',String(!isReduced() && i!==chapter));});nav.forEach((el,i)=>{el.classList.toggle('active',i===chapter);if(i===chapter)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});}
  section.style.setProperty('--story-progress',String(progress));renderer.render(scene,camera);
 }
 function requestRender(){if(!pending)pending=requestAnimationFrame(render);}
 function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;const mobile=section.clientWidth<760;camera.position.set(7,5.2,mobile?12.5:10);camera.lookAt(0,mobile?.85:.8,0);camera.updateProjectionMatrix();requestRender();}
 const observer=new ResizeObserver(resize);observer.observe(host);
 const visibility=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)requestRender();},{rootMargin:'150px'});visibility.observe(section);
 window.addEventListener('scroll',requestRender,{passive:true});const preferenceChange=()=>{syncMotion();chapter=-1;requestRender();};reduced.addEventListener('change',preferenceChange);
 motionButton.addEventListener('click',()=>{motionOverride=!isReduced();syncMotion();chapter=-1;resize();});
 nav.forEach((button,i)=>button.addEventListener('click',()=>{const y=scrollY+section.getBoundingClientRect().top+(section.offsetHeight-innerHeight)*chapterProgress[i];window.scrollTo({top:y,behavior:isReduced()?'instant':'smooth'});}));
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();section.classList.add('story-fallback');section.classList.remove('story-ready');panels.forEach(el=>el.setAttribute('aria-hidden','false'));});
 resize();
 return ()=>{cancelAnimationFrame(pending);observer.disconnect();visibility.disconnect();window.removeEventListener('scroll',requestRender);reduced.removeEventListener('change',preferenceChange);scene.traverse(o=>{if(o instanceof THREE.Mesh || o instanceof THREE.LineSegments){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});env.dispose();renderer.dispose();};
}
