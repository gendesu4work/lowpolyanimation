/* ---------- sound: everything is synthesized live with Web Audio ---------- */
const AU={on:false,ctx:null,lastT:null,lastSi:-1};
const midiF=m=>440*Math.pow(2,(m-69)/12);
const CHORDS=[[38,45,53,64],[38,45,53,57],[34,41,50,57],[41,48,57,60],[43,50,58,62],[45,52,57,64],[38,50,57,66],[34,46,53,57],[26,38,45,53]];
function loopNoise(type,freq,q){
  const c=AU.ctx, s=c.createBufferSource(); s.buffer=AU.noise; s.loop=true;
  const f=c.createBiquadFilter(); f.type=type; f.frequency.value=freq; f.Q.value=q;
  const g=c.createGain(); g.gain.value=0; s.connect(f); f.connect(g); g.connect(AU.master); g.connect(AU.rev); s.start();
  return {f,g};
}
function initAudio(){
  const c=new (window.AudioContext||window.webkitAudioContext)(); AU.ctx=c;
  AU.master=c.createGain(); AU.master.gain.value=0;
  const comp=c.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=4;
  AU.master.connect(comp); comp.connect(c.destination);
  const len=Math.floor(c.sampleRate*2.6), ir=c.createBuffer(2,len,c.sampleRate);
  for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3)}
  AU.rev=c.createConvolver(); AU.rev.buffer=ir;
  const wet=c.createGain(); wet.gain.value=0.32; AU.rev.connect(wet); wet.connect(AU.master);
  const nb=c.createBuffer(1,c.sampleRate*2,c.sampleRate), nd=nb.getChannelData(0);
  for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
  AU.noise=nb;
  AU.padF=c.createBiquadFilter(); AU.padF.type='lowpass'; AU.padF.frequency.value=700; AU.padF.Q.value=0.7;
  AU.padG=c.createGain(); AU.padG.gain.value=0; AU.padF.connect(AU.padG); AU.padG.connect(AU.master); AU.padG.connect(AU.rev);
  AU.voices=CHORDS[0].map((m,i)=>[-7,7].map(cents=>{
    const o=c.createOscillator(); o.type=i===0?'triangle':'sawtooth'; o.frequency.value=midiF(m); o.detune.value=cents;
    const g=c.createGain(); g.gain.value=i===0?0.5:0.14; o.connect(g); g.connect(AU.padF); o.start(); return o;
  }));
  AU.rumble=loopNoise('lowpass',110,0.8);
  AU.wind=loopNoise('bandpass',500,0.6);
  AU.riser=loopNoise('bandpass',300,5);
  AU.riserOsc=c.createOscillator(); AU.riserOsc.type='sawtooth';
  AU.riserOscG=c.createGain(); AU.riserOscG.gain.value=0; AU.riserOsc.connect(AU.riserOscG); AU.riserOscG.connect(AU.master); AU.riserOscG.connect(AU.rev); AU.riserOsc.start();
}
function env(g,t0,a,peak,dur){g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(peak,t0+a);g.gain.exponentialRampToValueAtTime(0.0001,t0+dur)}
function tone(freq,dur,o={}){
  const c=AU.ctx, t0=c.currentTime+(o.delay||0);
  const osc=c.createOscillator(); osc.type=o.type||'sine'; osc.frequency.setValueAtTime(freq,t0);
  if(o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide,t0+dur);
  const g=c.createGain(); env(g,t0,o.attack||0.005,o.gain||0.2,dur);
  osc.connect(g); g.connect(AU.master); if(o.wet!==false) g.connect(AU.rev);
  osc.start(t0); osc.stop(t0+dur+0.05);
}
function noise(dur,o={}){
  const c=AU.ctx, t0=c.currentTime+(o.delay||0);
  const s=c.createBufferSource(); s.buffer=AU.noise;
  const f=c.createBiquadFilter(); f.type=o.type||'bandpass'; f.Q.value=o.q||1; f.frequency.setValueAtTime(o.f0||1000,t0);
  if(o.f1) f.frequency.exponentialRampToValueAtTime(o.f1,t0+dur);
  const g=c.createGain(); env(g,t0,o.attack||0.005,o.gain||0.2,dur);
  s.connect(f); f.connect(g); g.connect(AU.master); if(o.wet!==false) g.connect(AU.rev);
  s.start(t0); s.stop(t0+dur+0.05);
}
const SFX={
  rewind(){noise(2.3,{f0:4000,f1:250,q:2,gain:0.35,attack:0.5});tone(1400,2.3,{gain:0.07,glide:120,attack:0.4})},
  flash(){tone(90,1.6,{gain:0.7,glide:32,wet:false});noise(1.2,{type:'highpass',f0:3000,gain:0.14})},
  appear(){[0,3,7,12,15,19].forEach((st,i)=>tone(midiF(74+st),0.5,{gain:0.06,delay:i*0.07}))},
  vanish(){[19,15,12,7,3,0].forEach((st,i)=>tone(midiF(74+st),0.6,{gain:0.06,delay:i*0.08}))},
  scrape(){
    const c=AU.ctx, t0=c.currentTime, s=c.createBufferSource(); s.buffer=AU.noise;
    const f=c.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1100; f.Q.value=4;
    const g=c.createGain(); g.gain.value=0.07; const lfo=c.createOscillator(); lfo.frequency.value=11;
    const lg=c.createGain(); lg.gain.value=0.07; lfo.connect(lg); lg.connect(g.gain);
    const e=c.createGain(); env(e,t0,0.15,1,2);
    s.connect(f); f.connect(g); g.connect(e); e.connect(AU.master);
    s.start(t0); lfo.start(t0); s.stop(t0+2.05); lfo.stop(t0+2.05);
  },
  step(){noise(0.07,{f0:600,q:1.2,gain:0.14,wet:false});tone(85,0.09,{gain:0.2,wet:false})},
  bump(){tone(70,0.35,{gain:0.6,glide:45,wet:false});tone(220,0.15,{type:'triangle',gain:0.2,wet:false});noise(0.18,{f0:900,q:0.8,gain:0.25,wet:false})},
  bell(){[0,0.38].forEach(d=>[1318,2637,3950].forEach((f,i)=>tone(f,1.4,{gain:[0.11,0.045,0.02][i],delay:d})))},
  tick(){tone(2400,0.03,{gain:0.045,wet:false})},
  heart(){tone(55,0.16,{gain:0.55,wet:false});tone(48,0.16,{gain:0.4,delay:0.2,wet:false})},
  swell(){tone(midiF(38),3,{type:'sawtooth',gain:0.09,attack:1.2});noise(3,{type:'lowpass',f0:200,f1:2500,gain:0.1,attack:1.4})},
  sad(){[62,58,55].forEach((m,i)=>tone(midiF(m),1.6,{type:'triangle',gain:0.07,delay:i*0.28}))},
  note(m){tone(midiF(m),2.4,{type:'triangle',gain:0.13});tone(midiF(m+12),1.6,{gain:0.035})},
  hit(){tone(60,3,{gain:0.8,glide:28});[50,53,57].forEach(m=>tone(midiF(m),3.5,{type:'triangle',gain:0.06,attack:0.02}))}
};
const EV=[[0.3,'rewind'],[2.45,'flash'],[2.6,'appear'],[7.5,'scrape'],[10.6,'vanish'],[BUMP,'bump'],[21.0,'bell'],
  [26.6,'vanish'],[26.9,'sad'],[38.6,'swell'],[47.6,'vanish'],[51.6,['note',62]],[53.0,['note',57]],[55.0,'hit']];
const every=(a,b,dt,name)=>{for(let x=a;x<b;x+=dt) EV.push([x,name])};
every(6.3,7.4,0.4,'step'); every(12.4,17.6,0.42,'step'); every(18.2,20.7,0.42,'step'); every(21.65,22.1,0.22,'step');
every(0.4,2.6,0.11,'tick'); every(7.5,9.5,0.2,'tick'); every(13.5,15.1,0.14,'tick'); every(47.4,49.4,0.2,'tick');
for(let x=30.8;x<37.2;x+=0.35-0.29*livesK(x)) EV.push([x,'tick']);
for(let x=45.3,gap=0.85;x<47.6;x+=gap,gap+=0.12) EV.push([x,'heart']);
EV.sort((a,b)=>a[0]-b[0]);
function fire(e){Array.isArray(e)?SFX[e[0]](e[1]):SFX[e]()}
function audioTick(t,si){
  if(!AU.ctx) return;
  const c=AU.ctx;
  if(!AU.on||!playing){if(c.state==='running') c.suspend();AU.lastT=t;return}
  if(c.state==='suspended') c.resume();
  const last=AU.lastT; AU.lastT=t;
  if(last!==null){
    const wrapped=t<last&&last>DUR-0.6;
    if((t>last&&t-last<0.3)||wrapped){const from=wrapped?-1:last;for(const e of EV) if(e[0]>from&&e[0]<=t) fire(e[1])}
  }
  const now=c.currentTime;
  if(si!==AU.lastSi){AU.lastSi=si;CHORDS[si].forEach((m,i)=>AU.voices[i].forEach(o=>o.frequency.setTargetAtTime(midiF(m),now,0.35)))}
  AU.padG.gain.setTargetAtTime(si===8?0.3*(1-sm((t-56)/2)):0.24,now,0.3);
  AU.padF.frequency.setTargetAtTime(si===6?1500:si===5?500+900*livesK(t):si===8?450:700,now,0.3);
  let rl=0;
  if(si===3) rl=t<21?0.5*(1-clamp01((t-18)/3))+0.12:t<22.6?0.06:0.3;
  else if(si===4) rl=0.3*Math.max(0,1-(t-24)/3);
  AU.rumble.g.gain.setTargetAtTime(rl,now,0.15); AU.rumble.f.frequency.setTargetAtTime(70+200*rl,now,0.15);
  AU.wind.g.gain.setTargetAtTime(si===3||si===4?0.04:si===5||si===6?0.07:si===8?0.05:0,now,0.4);
  const lk=si===5?livesK(t):0;
  AU.riser.g.gain.setTargetAtTime(0.12*Math.pow(lk,1.5),now,0.1); AU.riser.f.frequency.setTargetAtTime(300+3000*lk,now,0.1);
  AU.riserOscG.gain.setTargetAtTime(0.025*lk,now,0.1); AU.riserOsc.frequency.setTargetAtTime(110*Math.pow(2,2*lk),now,0.1);
}
function setSound(on){
  if(!AU.ctx) initAudio();
  AU.on=on; AU.lastT=t;
  AU.master.gain.setTargetAtTime(on?0.85:0,AU.ctx.currentTime,0.05);
  if(on){AU.ctx.resume(); if(!playing){playing=true;syncBtn()}}
  sndBtn.textContent=on?'Sound on':'Sound off'; sndBtn.setAttribute('aria-pressed',on);
  $('hint').hidden=on;
}

