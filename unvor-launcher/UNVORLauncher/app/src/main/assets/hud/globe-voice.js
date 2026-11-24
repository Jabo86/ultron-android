'use strict';
(() => {
  const canvas = document.getElementById('voice-globe');
  const ctx = canvas.getContext('2d');
  const home = document.getElementById('home');
  const label = document.getElementById('voice-label');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const names = {idle:'', armed:'', listening:'IN ASCOLTO', processing:'UN MOMENTO', speaking:'UNVOR PARLA'};
  const count = 2400;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const points = Array.from({length:count}, (_,i) => {
    const y = 1 - 2 * (i + .5) / count;
    const r = Math.sqrt(1 - y*y), a = i*goldenAngle;
    const side = i % 2 ? 1 : -1, u = (i + .5) / count;
    return {x:r*Math.cos(a), y, z:r*Math.sin(a), a,
      logoX:side*(.045+.57*u+.028*Math.cos(a)), logoY:.37-1.06*u+.06*Math.sin(a)};
  });
  let phase='idle', mix=0, rotation=0, energy=0, last=0, frame=0;
  const active=()=>['listening','speaking','processing'].includes(phase);
  function paint() {
    const w=canvas.width, c=w/2, radius=w*.442;
    ctx.clearRect(0,0,w,w);
    const halo=ctx.createRadialGradient(c,c,0,c,c,radius*1.11);
    halo.addColorStop(0,'#032237');halo.addColorStop(.73,'#00101eff');halo.addColorStop(.92,'#07364c');halo.addColorStop(1,'#00111a00');
    ctx.fillStyle=halo;ctx.fillRect(0,0,w,w);
    const co=Math.cos(rotation),si=Math.sin(rotation), t=mix*mix*(3-2*mix);
    for(const p of points){
      const x=p.x*co+p.z*si, z=p.z*co-p.x*si;
      const ripple=1+(.012+.075*energy)*Math.sin(6*p.y+4*x+rotation*8);
      const depth=(z+1)/2, scale=ripple*(.95+.06*depth);
      const px=c+radius*((1-t)*p.logoX+t*x*scale);
      const py=c+radius*((1-t)*p.logoY+t*p.y*scale);
      const edge=Math.pow(1-Math.abs(z),2);
      ctx.globalAlpha=.18+.56*depth+.24*edge;
      ctx.fillStyle=(energy>.17 && depth>.64)||edge>.85?'#e8fcff':depth>.45?'#60e4ff':'#198dee';
      const size=.65+1.15*depth+.8*edge+energy*.8;
      ctx.fillRect(px,py,size,size);
    }
    ctx.globalAlpha=1;
  }
  function tick(now){
    frame=0;if(document.hidden||home.inert)return;
    const dt=last?Math.min(.08,(now-last)/1000):0;
    if(!last||dt>=1/30){
      last=now;mix=Math.max(0,Math.min(1,mix+(active()?1:-1)*dt*1.65));
      rotation+=dt*(phase==='processing'?.48:.23);energy*=Math.exp(-dt*5);
      paint();
    }
    if(active()||mix>0)frame=requestAnimationFrame(tick);
  }
  function sync(){
    cancelAnimationFrame(frame);last=0;
    if(document.hidden||home.inert)return;
    if(reduced.matches||document.body.classList.contains('no-motion')){mix=active()?1:0;energy=0;paint();return;}
    if(active()||mix>0)frame=requestAnimationFrame(tick);
  }
  window.UnvorGlobe={
    setPhase(next){
      if(!Object.hasOwn(names,next))next='idle';
      if(next===phase)return;
      phase=next;document.body.classList.toggle('voice-active',active());
      label.textContent=names[phase];sync();
    },
    beat(){if(phase==='speaking')energy=1;},
    pause(){this.setPhase('idle');}
  };
  new MutationObserver(sync).observe(home,{attributes:true,attributeFilter:['inert']});
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
})();
