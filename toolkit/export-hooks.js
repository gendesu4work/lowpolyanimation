/* ---------- export mode: 1080x1920 frames with the overlay drawn into the image, plus an offline soundtrack ---------- */
const EXW=1080, EXH=1920, U=EXW/100;
$('hint').hidden=true;
stage.style.width=EXW+'px'; stage.style.height=EXH+'px'; W=EXW; H=EXH;
renderer.setPixelRatio(1); renderer.setSize(EXW,EXH,false); camera.aspect=EXW/EXH; camera.updateProjectionMatrix();
const out=document.createElement('canvas'); out.width=EXW; out.height=EXH; const g2=out.getContext('2d');
const SERIF='Newsreader, Georgia, serif', MONO='"IBM Plex Mono", Consolas, monospace', CAPF='Archivo, "Arial Black", sans-serif';
function rr(el){const a=el.getBoundingClientRect(), s=stage.getBoundingClientRect();return {x:a.left-s.left,y:a.top-s.top,w:a.width,h:a.height}}
function txt(str,x,y,font,color,o={}){
  g2.save(); g2.globalAlpha=o.alpha==null?1:o.alpha; g2.font=font; g2.letterSpacing=(o.ls||0)+'px';
  g2.fillStyle=color; g2.textAlign=o.align||'left'; g2.textBaseline='middle';
  if(o.shadow!==false){g2.shadowColor='rgba(0,0,0,.6)';g2.shadowBlur=10;g2.shadowOffsetY=2}
  g2.fillText(str,x,y); g2.restore();
}
function wrap(str,font,maxW){
  g2.font=font; const words=str.split(' '); const lines=[]; let cur='';
  for(const w of words){const tryS=cur?cur+' '+w:w; if(g2.measureText(tryS).width>maxW&&cur){lines.push(cur);cur=w}else cur=tryS}
  if(cur) lines.push(cur);
  if(lines.length===2){ // balance two lines the way text-wrap: balance does
    const all=str.split(' '); let best=null;
    for(let i=1;i<all.length;i++){const a=all.slice(0,i).join(' '),b=all.slice(i).join(' '),m=Math.max(g2.measureText(a).width,g2.measureText(b).width);if(m<=maxW&&(!best||m<best[0]))best=[m,a,b]}
    if(best) return [best[1],best[2]];
  }
  return lines;
}
const op=el=>{const v=parseFloat(el.style.opacity);return isNaN(v)?1:v};
function drawOverlay(){
  g2.globalAlpha=1; g2.drawImage(renderer.domElement,0,0,EXW,EXH);
  const gr=g2.createLinearGradient(0,0,0,EXH*0.48); gr.addColorStop(0,'rgba(5,7,11,.42)'); gr.addColorStop(1,'rgba(5,7,11,0)');
  g2.fillStyle=gr; g2.fillRect(0,0,EXW,EXH*0.48);
  // headline
  const ha=op(headline);
  if(ha>0.01){
    const hr=rr(headline), fs=6.2*U, lh=fs*1.16, f='400 '+fs+'px '+SERIF;
    txt('What if you went back in time',EXW/2,hr.y+lh*0.5,f,'#eef0f2',{align:'center',alpha:ha});
    g2.font=f; const p1='and moved a single ', p2='chair', p3='?';
    const w1=g2.measureText(p1).width,w2=g2.measureText(p2).width,w3=g2.measureText(p3).width; let x=EXW/2-(w1+w2+w3)/2;
    txt(p1,x,hr.y+lh*1.5,f,'#eef0f2',{alpha:ha}); x+=w1; txt(p2,x,hr.y+lh*1.5,f,'#e5483d',{alpha:ha}); x+=w2; txt(p3,x,hr.y+lh*1.5,f,'#eef0f2',{alpha:ha});
  }
  // stat block
  const sa=op(statEl);
  if(sa>0.01){
    const parts=[[lab,'500 '+2.3*U+'px '+MONO,0.16*2.3*U,1,true],[val,'400 '+10.5*U+'px '+SERIF,0,1,false],[sub,'400 '+2.3*U+'px '+MONO,0.1*2.3*U,1,true],[statEl.querySelector('.note'),'400 '+1.8*U+'px '+MONO,0.12*1.8*U,0.62,true]];
    for(const [el,f,ls,a,up] of parts){const r=rr(el);txt(up?el.textContent.toUpperCase():el.textContent,r.x,r.y+r.h/2,f,'#eef0f2',{ls,alpha:a*sa})}
  }
  // tags
  for(const el of [$('tagGhost'),$('tagGran'),$('tagYou')]){
    if(el.hidden) continue;
    const r=rr(el); g2.save();
    g2.fillStyle=el.classList.contains('red')?'#e5483d':'rgba(10,12,18,.78)';
    g2.beginPath(); g2.roundRect(r.x,r.y,r.w,r.h,4); g2.fill();
    g2.fillStyle='rgba(238,240,242,.7)'; g2.fillRect(r.x+r.w/2-1.5,r.y+r.h,3,3.2*U); g2.restore();
    txt(el.textContent.toUpperCase(),r.x+r.w/2,r.y+r.h/2,'500 '+2.1*U+'px '+MONO,'#eef0f2',{align:'center',ls:0.14*2.1*U,shadow:false});
  }
  // white flash
  const fa=op(flash); if(fa>0.002){g2.save();g2.globalAlpha=fa;g2.fillStyle='#fff';g2.fillRect(0,0,EXW,EXH);g2.restore()}
  // end card
  const m=/rgba\([^)]*,\s*([\d.]+)\)/.exec(card.style.background||''); const ca=m?parseFloat(m[1]):0;
  if(ca>0.002){g2.fillStyle='rgba(7,9,14,'+ca+')';g2.fillRect(0,0,EXW,EXH)}
  // lay the card out here so wrapped lines never overlap
  const blocks=C.map(([el])=>{const red=el.classList.contains('red'),fs=(red?7.6:6.6)*U,f=(red?'500 ':'400 ')+fs+'px '+SERIF;return {el,red,f,lh:fs*1.2,lines:wrap(el.textContent,f,EXW*0.8)}});
  const gap=3*U, totalH=blocks.reduce((s,b)=>s+b.lines.length*b.lh,0)+gap*(blocks.length-1);
  let cy=EXH/2-totalH/2;
  for(const b of blocks){
    const a=op(b.el);
    for(const l of b.lines){if(a>=0.01) txt(l,EXW/2,cy+b.lh/2,b.f,b.red?'#e5483d':'#eef0f2',{align:'center',alpha:a});cy+=b.lh}
    cy+=gap;
  }
  // captions
  if(capEl.textContent.trim()){
    const words=[]; capEl.childNodes.forEach(n=>{if(n.nodeType===3) n.textContent.split(' ').filter(Boolean).forEach(w=>words.push([w,false])); else words.push([n.textContent,true])});
    // shrink long chunks to fit, and sit above TikTok's caption and button area
    let fs=6.6*U; g2.font='800 '+fs+'px '+CAPF;
    const raw=words.reduce((a,[w])=>a+g2.measureText(w).width,0)+g2.measureText(' ').width*(words.length-1);
    if(raw>EXW*0.86) fs*=EXW*0.86/raw;
    const f='800 '+fs+'px '+CAPF; g2.font=f;
    const sp=g2.measureText(' ').width, ws=words.map(([w])=>g2.measureText(w).width), total=ws.reduce((a,b)=>a+b,0)+sp*(words.length-1);
    const y=EXH*0.74; let x=EXW/2-total/2;
    g2.save(); g2.font=f; g2.textBaseline='middle'; g2.lineJoin='round'; g2.lineWidth=fs/6; g2.strokeStyle='#07090e';
    g2.shadowColor='rgba(0,0,0,.45)'; g2.shadowBlur=1.6*U; g2.shadowOffsetY=0.6*U;
    let xx=x; words.forEach(([w],i)=>{g2.strokeText(w,xx,y);xx+=ws[i]+sp});
    g2.shadowColor='transparent'; xx=x;
    words.forEach(([w,on],i)=>{g2.fillStyle=on?'#e5483d':'#ffffff';g2.fillText(w,xx,y);xx+=ws[i]+sp});
    g2.restore();
  }
}
window.__exportFrame=async(tt)=>{
  const r=update(tt); renderer.render(scene,camera); overlay(tt,r.si,r.s); captionTick(tt); drawOverlay();
  return await new Promise(res=>out.toBlob(res,'image/jpeg',0.93));
};
window.__exportAll=async(from=0)=>{
  await Promise.all(['400 40px Newsreader','500 40px Newsreader','400 20px "IBM Plex Mono"','500 20px "IBM Plex Mono"','800 40px Archivo'].map(f=>document.fonts.load(f)));
  window.__prog=0; window.__done=false;
  const N=Math.round(DUR*30);
  for(let i=from;i<N;i++){
    const blob=await window.__exportFrame(i/30);
    await fetch('/frame/'+i,{method:'POST',body:blob});
    window.__prog=i+1;
  }
  window.__done=true;
};
function wavBytes(buf){
  const ch=buf.numberOfChannels, n=buf.length, sr=buf.sampleRate, dv=new DataView(new ArrayBuffer(44+n*ch*2));
  const ws=(o,s)=>{for(let i=0;i<s.length;i++) dv.setUint8(o+i,s.charCodeAt(i))};
  ws(0,'RIFF');dv.setUint32(4,36+n*ch*2,true);ws(8,'WAVE');ws(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,ch,true);
  dv.setUint32(24,sr,true);dv.setUint32(28,sr*ch*2,true);dv.setUint16(32,ch*2,true);dv.setUint16(34,16,true);ws(36,'data');dv.setUint32(40,n*ch*2,true);
  const data=[...Array(ch)].map((_,c)=>buf.getChannelData(c)); let o=44;
  for(let i=0;i<n;i++) for(let c=0;c<ch;c++){const v=Math.max(-1,Math.min(1,data[c][i]));dv.setInt16(o,v<0?v*0x8000:v*0x7fff,true);o+=2}
  return dv.buffer;
}
window.__exportAudio=async()=>{
  const SR=48000; AU.offline=new OfflineAudioContext(2,SR*DUR,SR);
  initAudio(); AU.master.gain.value=0.85; AU.on=true; playing=true; AU.lastT=null; AU.lastSi=-1;
  loadNarration(); await new Promise(res=>{const chk=()=>narrBuf?res():setTimeout(chk,50);chk()});
  scheduleNarration(0);
  for(let k=0;k<=Math.round(DUR*30);k++){
    const tt=k/30; AU.at=tt; let si=SC.findIndex(s=>tt>=s.t0&&tt<s.t1); if(si<0) si=SC.length-1; audioTick(tt,si);
  }
  AU.at=null;
  const buf=await AU.offline.startRendering();
  await fetch('/audio',{method:'POST',body:wavBytes(buf)});
  return 'audio '+buf.duration.toFixed(2)+'s';
};
window.__exportReady=true;
})();
