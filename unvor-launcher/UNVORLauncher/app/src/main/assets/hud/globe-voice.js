'use strict';
/* Orthographic projection of a sphere rotating around its own vertical axis.
   Decorative low-resolution continent outlines; not a geographical atlas. */
(()=>{
 const canvas=document.getElementById('voice-globe'),ctx=canvas.getContext('2d');
 const home=document.getElementById('home'),label=document.getElementById('voice-label');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const lands=[
 [[-17,37],[-5,36],[10,37],[32,31],[35,22],[43,12],[51,11],[45,2],[40,-12],[35,-24],[19,-35],[12,-18],[8,-3],[-4,5],[-16,14],[-17,28],[-17,37]],
 [[-10,36],[-9,44],[-2,49],[8,54],[5,60],[20,71],[30,70],[28,59],[41,56],[35,46],[42,42],[30,40],[23,40],[24,35],[18,41],[13,45],[16,38],[12,37],[9,43],[0,43],[-10,36]],
 [[30,70],[60,73],[100,77],[140,70],[178,65],[170,58],[150,60],[143,50],[135,45],[130,40],[125,32],[120,25],[110,21],[108,10],[104,1],[99,7],[99,20],[92,22],[86,21],[80,8],[74,17],[68,25],[58,25],[50,30],[44,12],[39,15],[34,29],[41,42],[35,46],[41,56],[28,59],[30,70]],
 [[-165,60],[-150,70],[-130,70],[-110,72],[-90,73],[-77,65],[-65,61],[-58,51],[-65,44],[-70,42],[-80,27],[-82,25],[-83,30],[-97,26],[-99,18],[-88,15],[-83,9],[-78,8],[-86,16],[-106,23],[-115,31],[-124,42],[-128,51],[-145,59],[-165,55],[-165,60]],
 [[-81,12],[-70,10],[-60,8],[-50,1],[-35,-7],[-38,-16],[-48,-27],[-54,-34],[-65,-55],[-72,-51],[-75,-35],[-70,-18],[-78,-5],[-81,12]],
 [[112,-22],[122,-15],[131,-12],[137,-16],[141,-11],[146,-20],[153,-26],[150,-37],[139,-39],[131,-32],[115,-34],[112,-22]],
 [[-54,60],[-43,60],[-22,70],[-20,80],[-45,83],[-60,77],[-54,60]],
 [[48,-13],[50,-17],[47,-25],[44,-24],[45,-17],[48,-13]],
 [[129,31],[135,34],[140,40],[145,45],[142,46],[136,38],[129,31]],
 [[-8,50],[-5,59],[0,58],[2,52],[-8,50]],[[166,-35],[178,-38],[172,-46],[167,-47],[166,-35]]
 ];
 const rad=Math.PI/180,period=55000;let phase='idle',raf=0,angle=0,last=0,previous=0;
 function project(lon,lat,a){const p=lat*rad,l=lon*rad+a;return {x:160+114*Math.cos(p)*Math.sin(l),y:138-114*Math.sin(p),z:Math.cos(p)*Math.cos(l)};}
 function line(points,a,color,width){ctx.beginPath();let open=false;for(const [lon,lat]of points){const p=project(lon,lat,a);if(p.z<.01){open=false;continue;}if(open)ctx.lineTo(p.x,p.y);else{ctx.moveTo(p.x,p.y);open=true;}}ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
 function draw(a){ctx.clearRect(0,0,320,260);const bg=ctx.createRadialGradient(145,110,0,160,138,114);bg.addColorStop(0,'#002d40');bg.addColorStop(.75,'#00101c');bg.addColorStop(1,'#002639');ctx.fillStyle=bg;ctx.beginPath();ctx.arc(160,138,114,0,Math.PI*2);ctx.fill();
  for(let lat=-75;lat<=75;lat+=15){const p=[];for(let lon=-180;lon<=180;lon+=3)p.push([lon,lat]);line(p,a,'#1686a9',.48);}
  for(let lon=-180;lon<180;lon+=20){const p=[];for(let lat=-90;lat<=90;lat+=3)p.push([lon,lat]);line(p,a,'#1686a9',.48);}
  for(const land of lands){const pts=[];for(let i=0;i<land.length-1;i++){const u=land[i],v=land[i+1],steps=Math.ceil(Math.max(Math.abs(v[0]-u[0]),Math.abs(v[1]-u[1]))/2);for(let j=0;j<=steps;j++)pts.push([u[0]+(v[0]-u[0])*j/steps,u[1]+(v[1]-u[1])*j/steps]);}ctx.shadowColor='#00ccff';ctx.shadowBlur=4;line(pts,a,'#7cf1ff',.9);ctx.shadowBlur=0;}
  ctx.shadowColor='#00dcff';ctx.shadowBlur=9;ctx.strokeStyle='#61ebff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(160,138,114,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
 }
 function allowed(){return (phase==='listening'||phase==='speaking')&&!document.hidden&&!home.inert&&!reduce.matches&&!document.body.classList.contains('no-motion');}
 function tick(t){raf=0;if(!allowed()){previous=0;return;}if(!previous)previous=t;if(t-last>=1000/24){angle+=(Math.min(100,t-previous)/period)*Math.PI*2;draw(angle);last=t;previous=t;}raf=requestAnimationFrame(tick);}
 function sync(){if(raf){cancelAnimationFrame(raf);raf=0;}previous=0;const active=phase==='listening'||phase==='speaking';if(document.body.classList.contains('voice-active')!==active)document.body.classList.toggle('voice-active',active);label.textContent=phase==='listening'?'UNVOR · IN ASCOLTO':phase==='speaking'?'UNVOR · RISPOSTA VOCALE':phase==='processing'?'UNVOR · ELABORAZIONE':'TOCCA PER PARLARE';if(active)draw(angle);if(allowed())raf=requestAnimationFrame(tick);}
 window.UnvorGlobe={setPhase(value){phase=['idle','listening','processing','speaking'].includes(value)?value:'idle';sync();},pause(){phase='idle';sync();}};
 new MutationObserver(sync).observe(home,{attributes:true,attributeFilter:['inert']});
 new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('visibilitychange',sync);reduce.addEventListener('change',sync);
})();
