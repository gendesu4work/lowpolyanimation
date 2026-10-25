/* ---------- narration: one take in the Desmond voice, cut into phrases and placed on the timeline ---------- */
const PHRASES=[ // [line, start in the take, end in the take, words]
  [0,0.51,3.04,'You go back exactly one hundred years.'],
  [0,3.70,5.01,'To 1925.'],
  [1,6.00,7.38,'You do one tiny thing.'],
  [1,8.19,10.67,'You slide a chair thirty centimeters.'],
  [1,11.45,12.28,'Then you leave.'],
  [2,13.36,15.57,'The next morning, a man walks through.'],
  [2,16.17,16.94,'He doesn’t trip.'],
  [2,17.58,19.22,'He saves four seconds.'],
  [3,19.93,21.32,'Four seconds is enough.'],
  [3,22.22,25.30,'He catches the 8:15 tram he always used to miss.'],
  [4,26.27,28.18,'So he never takes the later tram,'],
  [4,28.81,30.66,'where he would have met your great-grandmother.'],
  [5,31.84,33.35,'Their children are different people.'],
  [5,33.92,35.63,'So are their children’s children.'],
  [5,36.46,39.13,'The ripple spreads through every family it touches.'],
  [6,40.12,42.48,'By 2025, the cities are different,'],
  [6,43.10,44.40,'the inventions are different,'],
  [6,44.94,47.56,'and almost everyone alive is someone else.'],
  [7,48.48,50.36,'Your great-grandparents never met.'],
  [7,51.19,52.44,'So you were never born.'],
  [8,53.46,55.07,'All because of one chair.'],
  [9,55.99,57.40,'Would you still be here?']
];
const LINE_T=[0.3,6.2,12.3,18.2,24.2,30.3,38.2,45.3,51.7,55.0];
const SEGS=[];
{
  let cur=0, line=-1;
  for(const [l,s,e,text] of PHRASES){
    if(l!==line){line=l;cur=LINE_T[l]}
    const src0=Math.max(0,s-0.05), d=e+0.08-src0, words=text.split(' ');
    const chars=words.map(w=>w.length+1), tot=chars.reduce((a,b)=>a+b,0);
    let acc=0; const wt=chars.map(c=>{const v=cur+0.05+(acc/tot)*(d-0.13);acc+=c;return v});
    SEGS.push({T0:cur,T1:cur+d,src0,d,words,wt});
    cur+=d+0.22;
  }
}
let narrBuf=null, narrLoading=false, narrSrcs=[], narrLast=null;
function loadNarration(){
  if(narrBuf||narrLoading||!window.NARRATION_MP3) return;
  narrLoading=true;
  AU.narrG=AU.ctx.createGain(); AU.narrG.gain.value=1.1; AU.narrG.connect(AU.master);
  const bin=atob(window.NARRATION_MP3), u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  AU.ctx.decodeAudioData(u8.buffer,b=>{narrBuf=b;narrLast=null},()=>{narrLoading=false});
}
function hush(){narrSrcs.forEach(s=>{try{s.stop()}catch(e){}});narrSrcs=[]}
function scheduleNarration(t){
  hush(); if(!narrBuf) return;
  const now=AU.ctx.currentTime+0.02;
  for(const g of SEGS){
    if(g.T1<=t) continue;
    const into=Math.max(0,t-g.T0), s=AU.ctx.createBufferSource();
    s.buffer=narrBuf; s.connect(AU.narrG);
    s.start(now+Math.max(0,g.T0-t),g.src0+into,g.d-into);
    narrSrcs.push(s);
  }
}
const narrActive=t=>!!narrBuf&&SEGS.some(g=>t>=g.T0&&t<g.T1);
function narrTick(t){
  if(!AU.ctx) return;
  if(!AU.on||!playing){if(narrSrcs.length) hush();narrLast=null;return}
  loadNarration();
  const last=narrLast; narrLast=t;
  if(narrBuf&&!(last!==null&&t>=last&&t-last<0.3)) scheduleNarration(t);
}
const capEl=$('caption'); let capKey='';
function captionTick(t){
  let html='', key='';
  const g=t<51&&SEGS.find(g=>t>=g.T0&&t<g.T1+0.3);
  if(g){
    let wi=0; while(wi<g.words.length-1&&g.wt[wi+1]<=t) wi++;
    const c0=Math.floor(wi/3)*3;
    key=g.T0+':'+wi;
    html=g.words.slice(c0,c0+3).map((w,i)=>c0+i===wi?'<span class="on">'+w+'</span>':w).join(' ');
  }
  if(key!==capKey){capKey=key;capEl.innerHTML=html}
}

