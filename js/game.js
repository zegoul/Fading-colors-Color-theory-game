// Fading Colors — responsive full-screen exploration prototype
// Quest content is loaded from data/quest-pool.json so the pool can be expanded without editing game logic.
const MAP_W=1312, MAP_H=1199, DURATION=240, PLAYER_RADIUS=8, PLAYER_SPEED=145;
const $=selector=>document.querySelector(selector);
const canvas=$('#world'),ctx=canvas.getContext('2d');
const mapImage=new Image();mapImage.src='assets/aquarium-map.png';
const asset=path=>{const im=new Image();im.src=path;return im};
const art={main:asset('assets/icon-main.png'),side:asset('assets/icon-side.png'),hint:asset('assets/icon-hint.png')};
const sprites={
  front:asset('assets/sprites/front.png'),back:asset('assets/sprites/back.png'),left:asset('assets/sprites/left.png'),right:asset('assets/sprites/right.png'),blink:asset('assets/sprites/blink.png')
};
const sounds={
  music:new Audio('assets/bg-music.mp3'),
  walking:new Audio('assets/walking-sound-effect.mp3'),
  hint:new Audio('assets/opening-closing-hints-sound.mp3'),
  quest:new Audio('assets/opening-closing-quest-sound.mp3'),
  fail:new Audio('assets/failing-task-sound.mp3'),
  complete:new Audio('assets/task-completion-sound.mp3')
};
Object.values(sounds).forEach(audio=>{audio.preload='auto';audio.load()});
sounds.music.loop=true;sounds.music.volume=.29;
sounds.walking.loop=true;sounds.walking.volume=.26;sounds.walking.playbackRate=1.12;
sounds.hint.volume=.95;sounds.quest.volume=.68;sounds.fail.volume=.8;sounds.complete.volume=.78;
let audioUnlocked=false,walkingAudioOn=false,toastTimer=0;
function unlockAudio(){
  if(audioUnlocked)return;
  audioUnlocked=true;
  sounds.music.play().catch(()=>{audioUnlocked=false});
}
function playSound(key){
  unlockAudio();
  const audio=sounds[key];if(!audio||key==='music')return;
  audio.pause();audio.currentTime=0;
  audio.play().catch(()=>{});
}
function updateWalkingAudio(moving){
  if(!audioUnlocked)return;
  if(moving&&!walkingAudioOn){walkingAudioOn=true;sounds.walking.currentTime=0;sounds.walking.play().catch(()=>{});}
  else if(!moving&&walkingAudioOn){walkingAudioOn=false;sounds.walking.pause();sounds.walking.currentTime=0;}
}

let mapReady=false,viewW=innerWidth,viewH=innerHeight,dpr=1,mapScale=1,mapOffsetX=0,mapOffsetY=0;
let seed=1,elapsed=0,last=0,ended=false,gameActive=false,activeTask=null,activeClue=null,step=0,answerLocked=false,flashUntil=0,fadeRate=1,pauseChoiceOpen=false,loopStarted=false;
let player,quests=[],clues=[],ambientFish=[],ambientBubbles=[];
let roomTimers={A:{remaining:DURATION,pausedUntil:0,completed:false,failed:false},B:{remaining:DURATION,pausedUntil:0,completed:false,failed:false},C:{remaining:DURATION,pausedUntil:0,completed:false,failed:false}};
const keys={};
const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const shuffle=array=>{const out=array.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out};
let questionPool=null,questionPoolLoadError=null,startingRun=false;
function validateQuestionPool(data){
 if(!data||!Array.isArray(data.main)||data.main.length<3||!Array.isArray(data.side)||data.side.length<3)throw new Error('The pool must contain at least three main and three side quest packs.');
 for(const [type,packs,expectedClues] of [['main',data.main,2],['side',data.side,1]]){
  const names=new Set();
  for(const pack of packs){
   if(!pack.name||!Array.isArray(pack.clues)||pack.clues.length!==expectedClues||!Array.isArray(pack.stages)||pack.stages.length<3)throw new Error('Invalid '+type+' quest pack: '+(pack.name||'unnamed'));
   if(names.has(pack.name))throw new Error('Quest names must be unique within the '+type+' pool: '+pack.name);names.add(pack.name);
   for(const stage of pack.stages){
    if(!stage.question||!Array.isArray(stage.options)||stage.options.length!==3||new Set(stage.options).size!==3||!stage.options.includes(stage.answer))throw new Error('Invalid answer options in '+pack.name);
   }
  }
 }
 return data;
}
const questionPoolPromise=fetch('data/quest-pool.json').then(response=>{if(!response.ok)throw new Error('HTTP '+response.status+' while loading data/quest-pool.json');return response.json()}).then(data=>{questionPool=validateQuestionPool(data);return questionPool}).catch(error=>{questionPoolLoadError=error;console.error('Fading Colors question pool failed to load:',error);return null});
function prepareQuestPack(pack){
 // Each quest uses all three answer positions once, in a random order. This keeps answer A from becoming the predictable correct choice.
 const correctPositions=shuffle([0,1,2]);
 const stages=pack.stages.map((stage,index)=>{
  const correct=stage.answer;
  const distractors=shuffle(stage.options.filter(option=>option!==correct));
  const options=distractors.slice();
  options.splice(correctPositions[index],0,correct);
  return [stage.question,options,correctPositions[index],stage.feedback||'Correct!'];
 });
 return {...pack,clues:pack.clues.map(item=>[item.title,item.text]),stages};
}

// Walkable floor masks inset from walls, plus every connecting stair.
const walkablePolygons=[
 {name:'room-a',points:[[408,48],[874,48],[879,72],[879,287],[859,306],[422,306],[403,289],[403,73]]},
 {name:'upper-stairs',points:[[559,298],[689,298],[689,357],[559,357]]},
 {name:'central-hall',points:[[270,354],[1021,354],[1048,379],[1060,416],[1060,626],[1016,666],[298,666],[258,628],[258,432],[264,400]]},
 {name:'stairs-to-b',points:[[350,650],[391,650],[391,779],[350,779]]},
 {name:'stairs-to-c',points:[[922,650],[963,650],[963,779],[922,779]]},
 {name:'room-b',points:[[51,759],[493,759],[493,1056],[473,1080],[310,1080],[218,1080],[51,1080],[42,1062],[42,788]]},
 {name:'room-c',points:[[788,759],[1258,759],[1267,788],[1264,1058],[1246,1080],[1055,1080],[951,1080],[788,1080],[777,1062],[777,789]]}
];
const roomShapes={
 A:[[389,64],[414,42],[468,22],[817,22],[870,44],[891,76],[891,292],[866,324],[414,324],[387,294]],
 B:[[25,758],[42,729],[71,708],[268,708],[332,734],[421,734],[491,751],[515,780],[515,1080],[491,1110],[280,1110],[241,1092],[44,1092],[24,1071]],
 C:[[768,751],[812,734],[900,734],[965,708],[1209,708],[1240,729],[1264,758],[1264,1071],[1244,1092],[1065,1092],[1025,1110],[810,1110],[787,1080]]
};
const centralShapes=[
 [[270,354],[1021,354],[1048,379],[1060,416],[1060,626],[1016,666],[298,666],[258,628],[258,432],[264,400]],
 [[559,298],[689,298],[689,357],[559,357]],
 [[350,650],[391,650],[391,779],[350,779]],
 [[922,650],[963,650],[963,779],[922,779]]
];
const playableRooms=[
 {id:'A',name:'PEARL SANCTUM',main:{x:641,y:211,markerX:641,markerY:168,collision:42},side:{x:850,y:242,markerX:835,markerY:198},timerName:'PEARL SANCTUM'},
 {id:'B',name:'AMBER GROTTO',main:{x:267,y:919,markerX:267,markerY:858,collision:55},side:{x:130,y:941,markerX:94,markerY:905},timerName:'AMBER GROTTO'},
 {id:'C',name:'VIOLET GROTTO',main:{x:1003,y:919,markerX:1005,markerY:858,collision:56},side:{x:1153,y:889,markerX:1177,markerY:837},timerName:'VIOLET GROTTO'}
];
const tableColliders=playableRooms.map(r=>({x:r.main.x,y:r.main.y,r:r.main.collision}));
const PLAYER_START={x:650,y:558};
const proximityRadius=49,questRadius=87;
const waterZones=[
 {x1:20,x2:175,y1:75,y2:700},
 {x1:1136,x2:1296,y1:75,y2:700},
 {x1:540,x2:770,y1:790,y2:1170},
 {x1:18,x2:38,y1:785,y2:1065},
 {x1:1271,x2:1303,y1:785,y2:1065}
];
const seaPlants=[
 {x:45,y:590,h:69,phase:.4},{x:68,y:494,h:52,phase:1.3},{x:109,y:333,h:64,phase:2.2},{x:146,y:407,h:49,phase:1.9},
 {x:1243,y:484,h:65,phase:2.8},{x:1205,y:566,h:57,phase:1.1},{x:1170,y:622,h:75,phase:2.5},{x:1264,y:330,h:46,phase:.6},
 {x:555,y:880,h:68,phase:2.2},{x:588,y:1008,h:83,phase:.8},{x:620,y:1136,h:57,phase:1.6},{x:677,y:1025,h:73,phase:2.9},
 {x:726,y:1110,h:88,phase:1.9},{x:756,y:935,h:61,phase:2.4},{x:35,y:850,h:42,phase:1.1},{x:1285,y:914,h:51,phase:2.7}
];

function pointInPolygon(point,polygon){let inside=false;const {x,y}=point;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const xi=polygon[i][0],yi=polygon[i][1],xj=polygon[j][0],yj=polygon[j][1];const crosses=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi);if(crosses)inside=!inside}return inside}
function inWalkable(x,y){return walkablePolygons.some(poly=>pointInPolygon({x,y},poly.points))}
function collidesWithTable(x,y){return tableColliders.some(o=>Math.hypot(x-o.x,y-o.y)<o.r+PLAYER_RADIUS)}
function canStand(x,y){if(collidesWithTable(x,y))return false;const r=PLAYER_RADIUS;const samples=[[0,0],[r,0],[-r,0],[0,r],[0,-r],[r*.7,r*.7],[r*.7,-r*.7],[-r*.7,r*.7],[-r*.7,-r*.7]];return samples.every(([sx,sy])=>inWalkable(x+sx,y+sy))}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function say(message){const region=$('#notice');if(region)region.textContent=message}
function showToast(message,type='danger'){
 const toast=$('#game-toast');toast.textContent=message;toast.className='game-toast '+type;toast.hidden=false;
 if(toastTimer)clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{toast.hidden=true;},3100);
}
function resizeCanvas(){const rect=canvas.getBoundingClientRect();viewW=Math.max(1,rect.width||innerWidth);viewH=Math.max(1,rect.height||innerHeight);dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(viewW*dpr);canvas.height=Math.round(viewH*dpr);mapScale=Math.max(viewW/MAP_W,viewH/MAP_H);ctx.setTransform(dpr,0,0,dpr,0,0);draw()}
function timerText(seconds){const s=Math.max(0,Math.ceil(seconds));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
function renderHUD(){
 let done=0;quests.forEach(q=>{if(q.done)done++});
 $('#progress').textContent=done+' / 6';
 $('#hint-count').textContent=clues.filter(c=>c.readForUnlock).length+' / 9 NOTES READ';
 const now=performance.now()/1000;
 for(const id of ['A','B','C']){
  const t=roomTimers[id],ratio=Math.max(0,t.remaining/DURATION);
  const card=document.querySelector(`.room-timer[data-room="${id}"]`);
  // A failed room is fully faded and no longer has a timer in the HUD.
  card.hidden=Boolean(t.failed);
  const taskPause=Boolean(activeTask&&activeTask.type==='SIDE'&&activeTask.roomId!==id);
  const paused=now<t.pausedUntil||taskPause||pauseChoiceOpen||t.completed;
  $('#timer-'+id).textContent=timerText(t.remaining);
  $('#timebar-'+id).style.width=(ratio*100)+'%';
  $('#state-'+id).textContent=t.completed?'STABLE':paused?'PAUSED':t.remaining<=0?'FADED':ratio>.65?'FULL COLOR':ratio>.3?'FADING':'NEAR GREY';
  $('#timebar-'+id).style.background=t.completed?'#91e8c1':ratio>.65?'#e9ce86':ratio>.3?'#f0a36e':'#e47e7d';
  card.classList.toggle('is-paused',paused);card.classList.toggle('is-stable',t.completed);
 }
}
function randomWaterPoint(zone){
 for(let i=0;i<60;i++){const x=zone.x1+rand()*(zone.x2-zone.x1),y=zone.y1+rand()*(zone.y2-zone.y1);if(!inWalkable(x,y))return{x,y}}
 return{x:(zone.x1+zone.x2)/2,y:(zone.y1+zone.y2)/2};
}
function initAmbient(){
 ambientFish=[];ambientBubbles=[];
 // Different fish sizes and speeds create a few clearly visible foreground swimmers and many small distant fish.
 for(let i=0;i<22;i++){
  const zone=waterZones[Math.floor(rand()*waterZones.length)],p=randomWaterPoint(zone);
  const large=i<6;
  ambientFish.push({...p,zone,vx:(rand()>.5?1:-1)*(large?10+rand()*17:7+rand()*14),
   scale:large?1.25+rand()*.85:.62+rand()*.62,phase:rand()*Math.PI*2,
   alpha:large?.34+rand()*.18:.22+rand()*.22,color:rand()>.55?'#2d86a4':'#246b89'});
 }
 // Several larger bubbles mix with fine bubbles and tiny rising particles.
 for(let i=0;i<68;i++){
  const zone=waterZones[Math.floor(rand()*waterZones.length)],p=randomWaterPoint(zone);
  const large=i<15;
  ambientBubbles.push({...p,zone,speed:large?9+rand()*18:7+rand()*18,
   radius:large?3.4+rand()*4.2:.9+rand()*2.6,phase:rand()*Math.PI*2,alpha:large?.3+rand()*.17:.18+rand()*.17});
 }
}
function drawBackdrop(){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,viewW,viewH);ctx.fillStyle='#06151d';ctx.fillRect(0,0,viewW,viewH)}
function imageReady(im){return im&&im.complete&&im.naturalWidth>0}
function tracePolygon(points){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath()}
function drawMapRegion(points,saturation){ctx.save();tracePolygon(points.map(([x,y])=>[mapOffsetX+x*mapScale,mapOffsetY+y*mapScale]));ctx.clip();ctx.filter='grayscale(1)';ctx.globalAlpha=1-Math.max(0,Math.min(1,saturation));ctx.drawImage(mapImage,mapOffsetX,mapOffsetY,MAP_W*mapScale,MAP_H*mapScale);ctx.restore()}
function timerForRoom(id){return roomTimers[id]?.remaining??DURATION}
function drawHallLeak(){
 const maxFade=Math.max(...['A','B','C'].map(id=>1-timerForRoom(id)/DURATION));
 if(maxFade<=0)return;
 const screenHall=centralShapes.flatMap((points,index)=>index===0?[points]:[])[0].map(([x,y])=>[mapOffsetX+x*mapScale,mapOffsetY+y*mapScale]);
 ctx.save();tracePolygon(screenHall);ctx.clip();ctx.filter='grayscale(1)';ctx.globalAlpha=maxFade*.16;ctx.drawImage(mapImage,mapOffsetX,mapOffsetY,MAP_W*mapScale,MAP_H*mapScale);ctx.restore();
 // The neutral color wash spreads out from each room's doorway like fading color leaking into the lobby.
 const entrances=[{id:'A',x:641,y:329},{id:'B',x:371,y:694},{id:'C',x:943,y:694}];
 for(const entry of entrances){
  const fade=Math.max(0,1-timerForRoom(entry.id)/DURATION);if(fade<=0)continue;
  const sx=mapOffsetX+entry.x*mapScale,sy=mapOffsetY+entry.y*mapScale;
  ctx.save();tracePolygon(screenHall);ctx.clip();
  const radius=205*mapScale,gradient=ctx.createRadialGradient(sx,sy,3*mapScale,sx,sy,radius);
  gradient.addColorStop(0,`rgba(151,163,151,${fade*.25})`);gradient.addColorStop(.42,`rgba(151,163,151,${fade*.13})`);gradient.addColorStop(1,'rgba(151,163,151,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,viewW,viewH);ctx.restore();
 }
}
function updateAmbient(delta){
 for(const fish of ambientFish){
  fish.x+=fish.vx*delta;fish.y+=Math.sin(elapsed*.9+fish.phase)*delta*1.8;
  if(fish.x<fish.zone.x1+6){fish.x=fish.zone.x1+6;fish.vx=Math.abs(fish.vx)}
  if(fish.x>fish.zone.x2-6){fish.x=fish.zone.x2-6;fish.vx=-Math.abs(fish.vx)}
 }
 for(const bubble of ambientBubbles){
  bubble.y-=bubble.speed*delta;
  if(bubble.y<bubble.zone.y1){const p=randomWaterPoint(bubble.zone);bubble.x=p.x;bubble.y=bubble.zone.y2;bubble.phase=rand()*Math.PI*2}
 }
}
function drawAmbientWater(){
 // The aquarium's non-walkable water has a richer but still soft layer of wildlife motion.
 for(const fish of ambientFish){
  const bob=Math.sin(elapsed*1.15+fish.phase)*3.8;
  ctx.save();ctx.translate(fish.x,fish.y+bob);if(fish.vx<0)ctx.scale(-1,1);ctx.scale(fish.scale,fish.scale);ctx.globalAlpha=fish.alpha;
  ctx.fillStyle=fish.color;ctx.beginPath();ctx.ellipse(0,0,10.2,4.5,0,0,Math.PI*2);ctx.fill();
  // Tail flicks side to side to keep even the larger fish from looking static.
  const tail=Math.sin(elapsed*7+fish.phase)*1.8;
  ctx.beginPath();ctx.moveTo(-7,0);ctx.lineTo(-14,-4.5+tail);ctx.lineTo(-13,tail);ctx.lineTo(-14,4.5+tail);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(3,-3.8);ctx.lineTo(5,0);ctx.closePath();ctx.fill();
  ctx.fillStyle='#9ce0e9';ctx.beginPath();ctx.arc(5,-1.2,.85,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#08202c';ctx.beginPath();ctx.arc(5.2,-1.2,.34,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 for(const bubble of ambientBubbles){
  const pulse=.64+.36*Math.sin(elapsed*2.9+bubble.phase),drift=Math.sin(elapsed*1.25+bubble.phase)*2.3;
  ctx.save();ctx.translate(bubble.x+drift,bubble.y);ctx.globalAlpha=bubble.alpha*pulse;
  ctx.shadowColor='#65dff0';ctx.shadowBlur=bubble.radius*1.45;ctx.strokeStyle='#83d9e4';ctx.lineWidth=bubble.radius>4.5?1.35:1;
  ctx.beginPath();ctx.arc(0,0,bubble.radius,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
  ctx.fillStyle='#c4f6f5';ctx.globalAlpha=bubble.alpha*pulse*.8;ctx.beginPath();ctx.arc(-bubble.radius*.32,-bubble.radius*.34,Math.max(.7,bubble.radius*.22),0,Math.PI*2);ctx.fill();
  if(bubble.radius>5){ctx.globalAlpha=bubble.alpha*.35;ctx.strokeStyle='#b3f7fc';ctx.beginPath();ctx.arc(0,0,bubble.radius+2.4,0,Math.PI*2);ctx.stroke()}
  ctx.restore();
 }
 for(const plant of seaPlants){
  const sway=Math.sin(elapsed*1.75+plant.phase)*10.5,tipY=plant.y-plant.h;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='rgba(73,191,176,.56)';ctx.lineWidth=2.4;
  ctx.beginPath();ctx.moveTo(plant.x,plant.y);ctx.bezierCurveTo(plant.x-sway*.45,plant.y-plant.h*.26,plant.x+sway*.95,plant.y-plant.h*.68,plant.x+sway,tipY);ctx.stroke();
  // Long leaf blades flex independently from the stalk, like sea grass in a current.
  for(let i=0;i<6;i++){
   const t=.18+i*.125,yy=plant.y-plant.h*t,side=i%2?1:-1,off=sway*t,leafMove=Math.sin(elapsed*2.15+plant.phase+i)*3.7;
   ctx.beginPath();ctx.moveTo(plant.x+off,yy);ctx.quadraticCurveTo(plant.x+off+side*(7+leafMove),yy-7,plant.x+off+side*(15+leafMove),yy-16-(i%3)*2);ctx.stroke();
  }
  ctx.globalAlpha=.45;ctx.strokeStyle='rgba(113,218,192,.42)';ctx.lineWidth=1.1;
  ctx.beginPath();ctx.moveTo(plant.x+2,plant.y);ctx.quadraticCurveTo(plant.x+sway*.5,plant.y-plant.h*.38,plant.x+sway*.75,tipY+7);ctx.stroke();ctx.restore();
 }
 // Fine suspended plankton drifts at different speeds between the larger fish and bubbles.
 for(let i=0;i<28;i++){
  const zone=waterZones[i%waterZones.length];
  const px=zone.x1+((i*27+elapsed*(5+(i%4)*2))%(zone.x2-zone.x1));
  const py=zone.y1+((i*41+Math.abs(Math.sin(elapsed*.7+i))*35)%(zone.y2-zone.y1));
  if(inWalkable(px,py))continue;
  ctx.save();ctx.globalAlpha=.22+.14*Math.sin(elapsed*2+i);ctx.fillStyle=i%3?'#8edfe7':'#d5f5ed';ctx.beginPath();ctx.arc(px,py,1+(i%3)*.35,0,Math.PI*2);ctx.fill();ctx.restore();
 }
}
function drawPlayer(){
 // Keep the earlier directional character presentation: one sprite for each direction plus the original front idle blink.
 let sprite=sprites[player.dir]||sprites.front;
 if(!player.isMoving&&player.dir==='front'&&Math.floor(elapsed*.7)%8===0)sprite=sprites.blink;
 ctx.save();ctx.translate(player.x,player.y);const bob=player.isMoving?Math.sin(player.walk*13)*1.2:Math.sin(elapsed*2.5)*.45;
 ctx.fillStyle='rgba(4,14,20,.42)';ctx.beginPath();ctx.ellipse(0,2,17,6,0,0,Math.PI*2);ctx.fill();ctx.translate(0,bob);
 if(imageReady(sprite)){const w=50,h=74;ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,-w/2,-h+4,w,h);ctx.imageSmoothingEnabled=true}
 else{ctx.fillStyle='#df342c';ctx.beginPath();ctx.roundRect(-10,-31,20,28,7);ctx.fill()}
 ctx.restore();
}
function drawQuestIcon(q){
 const x=q.marker.x,y=q.marker.y,pulse=(Math.sin(elapsed*4)+1)/2,unlocked=q.unlocked&&!q.done&&!q.failed,done=q.done,failed=q.failed;
 const im=q.type==='MAIN'?art.main:art.side,size=q.type==='MAIN'?43:36;
 ctx.save();ctx.globalAlpha=failed?.62:done?.48:1;
 ctx.shadowBlur=failed?17:unlocked?25:13;ctx.shadowColor=failed?'#ff5c68':done?'#a3ffd0':q.type==='MAIN'?'#ffcf66':'#7be6ff';
 ctx.beginPath();ctx.ellipse(x,y+1,size*.64,size*.7,0,0,Math.PI*2);
 ctx.fillStyle=failed?'rgba(255,65,83,.26)':done?'rgba(118,255,188,.15)':q.type==='MAIN'?'rgba(255,208,102,'+(.12+pulse*.17)+')':'rgba(91,218,255,'+(.12+pulse*.17)+')';ctx.fill();ctx.shadowBlur=0;
 // The pearl is above the icon's full-height center; align the orb itself on the map pearl, not the icon's pedestal.
 const iconTop=q.type==='MAIN'?y-size*.35:y-size/2;
 if(imageReady(im))ctx.drawImage(im,x-size/2,iconTop,size,size);
 ctx.strokeStyle=failed?'rgba(255,92,104,.98)':done?'#9cfac0':q.type==='MAIN'?'rgba(255,218,120,.92)':'rgba(91,228,255,.94)';ctx.lineWidth=unlocked||failed?2.4:1.3;ctx.beginPath();ctx.arc(x,y,size*.54+pulse*2,0,Math.PI*2);ctx.stroke();
 if(done){ctx.fillStyle='#9cfac0';ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.fillText('✓',x+size*.34,y-size*.35)}
 else if(failed){ctx.fillStyle='#ff9ca2';ctx.font='900 19px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('×',x+size*.42,y-size*.42);ctx.fillStyle='#401a20';ctx.beginPath();ctx.arc(x+size*.33,y-size*.30,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffd5d6';ctx.font='900 8px system-ui';ctx.fillText('L',x+size*.33,y-size*.30)}
 else if(!unlocked){ctx.fillStyle='rgba(7,18,23,.85)';ctx.beginPath();ctx.arc(x+size*.31,y-size*.3,5.3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f3e5bd';ctx.font='bold 7px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(q.need-q.found,x+size*.31,y-size*.3)}
 ctx.restore();
}
function drawHintIcon(clue){
 const x=clue.x,y=clue.y,near=distance(player,clue)<=proximityRadius,pulse=(Math.sin(elapsed*5+clue.phase)+1)/2;
 ctx.save();ctx.translate(x,y);ctx.shadowBlur=Date.now()<flashUntil?24:near?18:10;ctx.shadowColor='#fff0a1';
 const im=art.hint;if(imageReady(im))ctx.drawImage(im,-11,-13,22,26);else{ctx.fillStyle='#f7e6bd';ctx.fillRect(-7,-10,14,20)}
 ctx.globalAlpha=.55+pulse*.45;ctx.strokeStyle='#fff1a8';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,16+pulse*3,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
 if(near){ctx.fillStyle='#15221f';ctx.fillRect(-33,19,66,15);ctx.strokeStyle='#f8e7aa';ctx.strokeRect(-33,19,66,15);ctx.fillStyle='#ffe6a4';ctx.font='900 8px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('E  READ NOTE',0,26.5)}ctx.restore();
}
function updatePrompt(){
 if(activeClue){$('#canvas-prompt').textContent='READ THE FIELD NOTE · STAY NEARBY';return}
 if(activeTask){$('#canvas-prompt').textContent='TASK TERMINAL OPEN';return}
 if(pauseChoiceOpen){$('#canvas-prompt').textContent='CHOOSE A ROOM TO PAUSE';return}
 const closeClue=clues.some(c=>distance(player,c)<=proximityRadius),closeQuest=quests.some(q=>distance(player,q.anchor)<=questRadius);
 $('#canvas-prompt').textContent=closeClue?'E · READ FIELD NOTE':closeQuest?'E · INTERACT WITH QUEST':'WASD / ARROWS · EXPLORE';
}
function drawWorld(){
 drawBackdrop();if(!mapReady||!gameActive)return;
 const worldViewW=viewW/mapScale,worldViewH=viewH/mapScale;
 const topSafeWorld=Math.min(108,viewH*.12)/mapScale;
 const cameraX=Math.max(0,Math.min(MAP_W-worldViewW,player.x-worldViewW/2));
 // Allow a little negative camera y so the world shifts down when the player reaches the upper edge, clear of the HUD.
 const cameraY=Math.max(-topSafeWorld,Math.min(MAP_H-worldViewH,player.y-worldViewH*.58));
 mapOffsetX=-cameraX*mapScale;mapOffsetY=-cameraY*mapScale;
 ctx.drawImage(mapImage,mapOffsetX,mapOffsetY,MAP_W*mapScale,MAP_H*mapScale);
 const sat=id=>roomTimers[id]?.failed?0:Math.max(0,Math.min(1,timerForRoom(id)/DURATION));
 drawMapRegion(roomShapes.A,sat('A'));drawMapRegion(roomShapes.B,sat('B'));drawMapRegion(roomShapes.C,sat('C'));
 for(const id of ['A','B','C']){const rem=timerForRoom(id);if(rem<DURATION){ctx.save();tracePolygon(roomShapes[id].map(([x,y])=>[mapOffsetX+x*mapScale,mapOffsetY+y*mapScale]));ctx.clip();ctx.fillStyle=`rgba(80,82,88,${(1-rem/DURATION)*.15})`;ctx.fillRect(0,0,viewW,viewH);ctx.restore()}}
 drawHallLeak();
 ctx.save();ctx.translate(mapOffsetX,mapOffsetY);ctx.scale(mapScale,mapScale);
 drawAmbientWater();clues.forEach(drawHintIcon);quests.forEach(drawQuestIcon);drawPlayer();ctx.restore();
 const current=playableRooms.find(r=>{const p=walkablePolygons.find(p=>p.name===`room-${r.id.toLowerCase()}`);return p&&pointInPolygon(player,p.points)});
 $('#room-label').textContent=current?'ROOM '+current.id+' · '+current.name:'CENTRAL HALL / CONNECTING STAIRS';updatePrompt();
}
function draw(){if(ctx&&canvas)drawWorld()}
function openHint(clue){
 if(!clue)return;
 activeClue=clue;
 const quest=quests[clue.qid];
 // Reading begins as soon as the field note opens. The note remains at its map location.
 if(!clue.readForUnlock){
  clue.readForUnlock=true;
  quest.found=clues.filter(c=>c.qid===clue.qid&&c.readForUnlock).length;
  quest.unlocked=quest.found>=quest.need;
 }
 playSound('hint');
 $('#lesson-kicker').textContent=quest.concept.toUpperCase()+' · ROOM '+quest.roomId;
 $('#lesson-title').textContent='COLOR THEORY FIELD NOTE';
 $('#lesson-body').textContent=quest.clues[clue.index][0]+': '+quest.clues[clue.index][1];
 $('#hint-window').hidden=false;
 renderHUD();
 say('FIELD NOTE OPEN • Press E to close. This note stays here so you can return to it later.');draw();
}
function closeHint(message='FIELD NOTE CLOSED • The note remains where it is.'){
 if(activeClue)playSound('hint');
 activeClue=null;$('#hint-window').hidden=true;
 if(message)say(message);draw();
}
function openQuest(quest){
 if(roomTimers[quest.roomId]?.failed){showToast('ROOM LOST • Its quests can no longer be completed.');return}
 if(quest.failed){showToast('MAIN TASK LOCKED • This terminal failed earlier in this run.');return}
 if(quest.done){say('QUEST COMPLETE • This terminal is already restored.');return}
 if(!quest.unlocked){say('TERMINAL LOCKED • '+quest.found+' / '+quest.need+' notes studied for '+quest.name+'.');return}
 activeTask=quest;step=quest.stage;playSound('quest');$('#task').hidden=false;$('#task-title').textContent=quest.name;
 $('#task-story').textContent='Room '+quest.roomId+' · '+quest.roomName+'. Apply what the field notes taught you to clear all three stages.';loadStage();
}
function interact(){
 if(ended)return;unlockAudio();
 if(activeTask){say('Complete the current stage or close the terminal.');return}
 if(activeClue){closeHint('FIELD NOTE CLOSED • It stays in the room, ready to read again.');return}
 const nearbyClues=clues.filter(c=>distance(player,c)<=proximityRadius).sort((a,b)=>distance(player,a)-distance(player,b));
 const nearbyQuests=quests.filter(q=>distance(player,q.anchor)<=questRadius).sort((a,b)=>distance(player,a.anchor)-distance(player,b.anchor));
 const clue=nearbyClues[0],quest=nearbyQuests[0];
 if(clue&&(!quest||distance(player,clue)<=distance(player,quest.anchor)+12)){openHint(clue);return}
 if(quest){if(quest.failed){showToast('MAIN TASK LOCKED • This terminal cannot be attempted again this run.');return}openQuest(quest);return}
 say('NO INTERACTION IN RANGE • Look for the glowing paper, pearl, and S.T scroll icons.');
}
function loadStage(){
 const quest=activeTask,stageData=quest.stages[step];
 $('#task-step').textContent=quest.type+' QUEST · STAGE '+(step+1)+' OF '+quest.stages.length;
 $('#task-question').textContent=stageData[0];$('#options').innerHTML='';$('#task-feedback').textContent='';$('#task-continue').hidden=true;
 stageData[1].forEach((option,index)=>{const button=document.createElement('button');button.textContent=option;button.dataset.letter=String.fromCharCode(65+index);button.addEventListener('click',()=>answer(index,button));$('#options').appendChild(button)});
}
function failMainTask(quest){
 quest.failed=true;quest.unlocked=false;
 const failedRoom=roomTimers[quest.roomId];
 if(failedRoom){failedRoom.failed=true;failedRoom.remaining=0;failedRoom.pausedUntil=0;}
 // Penalty accelerates every other active room. The failed room stays fully desaturated and has no timer.
 fadeRate=Math.min(4,fadeRate+.25);
 activeTask=null;answerLocked=false;$('#task').hidden=true;playSound('fail');playSound('quest');renderHUD();
 const speed=fadeRate.toFixed(2).replace(/0$/,'');
 const message=`MAIN TASK FAILED • ROOM ${quest.roomId} IS LOST • OTHER ACTIVE ROOMS NOW FADE ${speed}× FASTER.`;
 say(message);showToast(message,'danger');draw();
 if(allMainOutcomesResolved())concludeRun();
}
function answer(index,button){
 if(answerLocked||!activeTask)return;
 const quest=activeTask,stageData=quest.stages[step],buttons=$('#options').querySelectorAll('button');
 if(index!==stageData[2]&&quest.type==='MAIN'){failMainTask(quest);return}
 answerLocked=true;buttons.forEach((element,position)=>{element.disabled=true;if(position===stageData[2])element.classList.add('correct')});
 if(index===stageData[2]){$('#task-feedback').textContent='Correct. '+stageData[3];$('#task-continue').textContent=step<quest.stages.length-1?'CORRECT · PRESS ENTER FOR THE NEXT STAGE':'CORRECT · PRESS ENTER TO COMPLETE';$('#task-continue').hidden=false;}
 else{if(button)button.classList.add('wrong');$('#task-feedback').textContent='Not quite. '+stageData[3]+' Try another answer; side tasks do not apply the main-task penalty.';answerLocked=false;buttons.forEach(element=>element.disabled=false);}
}
function allMainOutcomesResolved(){
 return ['A','B','C'].every(id=>roomTimers[id].completed||roomTimers[id].failed);
}
function concludeRun(){
 if(ended)return;
 ended=true;activeTask=null;activeClue=null;pauseChoiceOpen=false;answerLocked=false;
 $('#task').hidden=true;$('#hint-window').hidden=true;$('#pause-choice').hidden=true;
 updateWalkingAudio(false);
 const roomsSaved=['A','B','C'].filter(id=>roomTimers[id].completed).length;
 const mainDone=quests.filter(q=>q.type==='MAIN'&&q.done).length;
 const sideDone=quests.filter(q=>q.type==='SIDE'&&q.done).length;
 const notesRead=clues.filter(c=>c.readForUnlock).length;
 let endingClass,title,message,symbol;
 if(roomsSaved<=1){endingClass='ending-loss';title='The colors have faded';message=roomsSaved===0?'The aquarium could not keep its color. Study the clues and try another run.':'Only one room survived in full color. The remaining spectrum slipped away.';symbol='×';}
 else if(roomsSaved===2){endingClass='ending-two';title='Two lights remain';message='Two rooms held on to their color. One part of the aquarium has been lost, but much of its palette survives.';symbol='◐';}
 else if(sideDone===3){endingClass='ending-perfect';title='Chromatic keeper';message='All three rooms were saved, and every optional side task was completed before the final main quest. A perfect restoration!';symbol='✦';}
 else{endingClass='ending-three';title='The spectrum restored';message='All three main quests succeeded and the aquarium’s rooms kept their colors. Some optional side work remains unexplored.';symbol='✧';}
 const end=$('#end-screen');end.className='end-screen '+endingClass;end.hidden=false;
 $('#ending-kicker').textContent=roomsSaved<=1?'AQUARIUM LOST':roomsSaved===2?'PARTIAL RESTORATION':'AQUARIUM RUN COMPLETE';
 $('#ending-title').textContent=title;$('#ending-message').textContent=message;$('#ending-symbol').textContent=symbol;
 $('#score-rooms').textContent=roomsSaved+' / 3';$('#score-main').textContent=mainDone+' / 3';$('#score-side').textContent=sideDone+' / 3';$('#score-clues').textContent=notesRead+' / '+clues.length;
 say('RUN COMPLETE • '+roomsSaved+' ROOMS SAVED • '+mainDone+' MAIN QUESTS • '+sideDone+' SIDE QUESTS');draw();
}
function loseRoomToFading(id){
 const room=roomTimers[id];if(!room||room.completed||room.failed)return;
 room.failed=true;room.remaining=0;room.pausedUntil=0;
 const mainQuest=quests.find(q=>q.type==='MAIN'&&q.roomId===id);
 if(mainQuest&&!mainQuest.done){mainQuest.failed=true;mainQuest.unlocked=false;}
 if(activeTask&&activeTask.roomId===id){activeTask=null;answerLocked=false;$('#task').hidden=true;playSound('quest');}
 const clueQuest=activeClue?quests[activeClue.qid]:null;
 if(clueQuest&&clueQuest.roomId===id){activeClue=null;$('#hint-window').hidden=true;}
 showToast('ROOM '+id+' HAS COMPLETELY FADED • Its timer and quests are now locked.','danger');
 renderHUD();draw();
}
function advance(){
 if(!activeTask||!answerLocked)return;
 const quest=activeTask;
 if(step<quest.stages.length-1){step++;quest.stage=step;answerLocked=false;loadStage();return}
 quest.done=true;const name=quest.name,type=quest.type;
 if(type==='MAIN')roomTimers[quest.roomId].completed=true;
 activeTask=null;answerLocked=false;$('#task').hidden=true;playSound('complete');playSound('quest');renderHUD();
 say((type==='MAIN'?'MAIN TASK':'SIDE TASK')+' COMPLETE • '+name);
 showToast((type==='MAIN'?'MAIN TASK COMPLETE':'SIDE TASK COMPLETE')+' • '+name,'success');
 // The ending triggers immediately when all three main-room outcomes are settled. Never offer extra side-task time afterward.
 if(allMainOutcomesResolved()){
  concludeRun();return;
 }
 if(type==='SIDE'){
  for(const id of ['A','B','C']){
   const room=roomTimers[id],button=document.querySelector(`[data-pause-room="${id}"]`);
   $('#choice-'+id).textContent=room.failed?'LOST':room.completed?'STABLE':timerText(room.remaining);
   button.disabled=room.failed||room.completed||room.remaining<=0;
  }
  const hasActiveClock=['A','B','C'].some(id=>!roomTimers[id].failed&&!roomTimers[id].completed&&roomTimers[id].remaining>0);
  if(hasActiveClock){pauseChoiceOpen=true;$('#pause-choice').hidden=false;say('SIDE TASK SUCCESS • Choose an active room to pause for 12 seconds. Press 1, 2, or 3.');}
  else{pauseChoiceOpen=false;$('#pause-choice').hidden=true;say('SIDE TASK SUCCESS • No active room clocks remain to pause.');}
 }
 draw();
}
function choosePauseRoom(id){if(!pauseChoiceOpen)return;const room=roomTimers[id];if(!room||room.failed||room.completed)return;room.pausedUntil=performance.now()/1000+12;pauseChoiceOpen=false;$('#pause-choice').hidden=true;document.querySelectorAll('[data-pause-room]').forEach(button=>button.disabled=false);say('TIME PRESERVED • Room '+id+' timer paused for 12 seconds.');draw()}
function frame(timestamp){
 if(!last)last=timestamp;const delta=Math.min(.05,(timestamp-last)/1000);last=timestamp;const now=timestamp/1000;
 if(gameActive){
  elapsed+=delta;updateAmbient(delta);
  if(!ended){
   if(!pauseChoiceOpen){
    for(const id of ['A','B','C']){
     const room=roomTimers[id];if(room.completed||room.failed)continue;
     if(now<room.pausedUntil)continue;
     if(activeTask&&activeTask.type==='SIDE'&&activeTask.roomId!==id)continue;
     room.remaining=Math.max(0,room.remaining-delta*fadeRate);
     if(room.remaining<=0)loseRoomToFading(id);
    }
   }
   if(allMainOutcomesResolved()&&!ended)concludeRun();
   if(!activeTask&&!pauseChoiceOpen&&!ended){
    let dx=0,dy=0;if(keys.ArrowLeft||keys.a||keys.A)dx--;if(keys.ArrowRight||keys.d||keys.D)dx++;if(keys.ArrowUp||keys.w||keys.W)dy--;if(keys.ArrowDown||keys.s||keys.S)dy++;
    let moved=false;
    if(dx||dy){const magnitude=Math.hypot(dx,dy);dx/=magnitude;dy/=magnitude;const mx=dx*PLAYER_SPEED*delta,my=dy*PLAYER_SPEED*delta;
     if(canStand(player.x+mx,player.y)){player.x+=mx;moved=true}if(canStand(player.x,player.y+my)){player.y+=my;moved=true}
     if(Math.abs(dx)>Math.abs(dy))player.dir=dx<0?'left':'right';else if(dy<0)player.dir='back';else player.dir='front';if(moved)player.walk+=delta;
    }
    player.isMoving=moved;updateWalkingAudio(moved);
    if(activeClue&&distance(player,activeClue)>proximityRadius)closeHint('NOTE CLOSED • You moved away. Return to the note to read it again.');
   }else{if(player){player.isMoving=false}updateWalkingAudio(false)}
  }else{
   if(player)player.isMoving=false;updateWalkingAudio(false);
  }
  renderHUD();draw();
 }
 if(gameActive)requestAnimationFrame(frame);else{loopStarted=false;last=0;}
}
function ensureGameLoop(){if(gameActive&&mapReady&&!loopStarted){loopStarted=true;last=0;requestAnimationFrame(frame)}}
function showInstructions(){
 unlockAudio();$('#instructions').hidden=false;
}
async function startRun(){
 if(startingRun)return;startingRun=true;unlockAudio();
 if(!questionPool)questionPool=await questionPoolPromise;
 if(!questionPool){startingRun=false;window.alert('The quest question pool could not load. Please run the game with python -m http.server 8000 and open http://localhost:8000.');return;}
 startingRun=false;
 gameActive=true;document.body.classList.add('playing');
 $('#home-screen').hidden=true;$('#instructions').hidden=true;$('#game-screen').hidden=false;$('#end-screen').hidden=true;$('#quit-message').hidden=true;
 unlockAudio();
 seed=(Date.now()^Math.floor(Math.random()*4294967295))>>>0;elapsed=0;ended=false;activeTask=null;activeClue=null;answerLocked=false;fadeRate=1;pauseChoiceOpen=false;flashUntil=0;
 roomTimers={A:{remaining:DURATION,pausedUntil:0,completed:false,failed:false},B:{remaining:DURATION,pausedUntil:0,completed:false,failed:false},C:{remaining:DURATION,pausedUntil:0,completed:false,failed:false}};
 $('#task').hidden=true;$('#hint-window').hidden=true;$('#pause-choice').hidden=true;$('#game-toast').hidden=true;document.querySelectorAll('[data-pause-room]').forEach(button=>button.disabled=false);
 player={x:PLAYER_START.x,y:PLAYER_START.y,walk:0,dir:'front',isMoving:false};updateWalkingAudio(false);
 const chosenMain=shuffle(questionPool.main).slice(0,3).map(prepareQuestPack);
 const chosenSide=shuffle(questionPool.side).slice(0,3).map(prepareQuestPack);
 quests=[];
 playableRooms.forEach((room,index)=>{
  const mainQuest=chosenMain[index],sideQuest=chosenSide[index];
  quests.push({...mainQuest,type:'MAIN',need:2,found:0,done:false,failed:false,unlocked:false,roomId:room.id,roomName:room.name,anchor:{x:room.main.x,y:room.main.y},marker:{x:room.main.markerX,y:room.main.markerY},collision:room.main.collision,stage:0});
  quests.push({...sideQuest,type:'SIDE',need:1,found:0,done:false,failed:false,unlocked:false,roomId:room.id,roomName:room.name,anchor:{x:room.side.x,y:room.side.y},marker:{x:room.side.markerX,y:room.side.markerY},stage:0});
 });
 clues=[];const used=[];
 quests.forEach((quest,qid)=>{for(let index=0;index<quest.need;index++){
  let point;
  for(let attempt=0;attempt<2000;attempt++){
   const candidate={x:35+rand()*(MAP_W-70),y:35+rand()*(MAP_H-70)};
   if(!canStand(candidate.x,candidate.y))continue;
   if(used.some(other=>Math.hypot(candidate.x-other.x,candidate.y-other.y)<70))continue;
   if(playableRooms.some(room=>Math.hypot(candidate.x-room.side.markerX,candidate.y-room.side.markerY)<52))continue;
   if(playableRooms.some(room=>Math.hypot(candidate.x-room.main.x,candidate.y-room.main.y)<94))continue;
   point=candidate;break;
  }
  if(!point)point={x:610+rand()*95,y:455+rand()*150};
  used.push(point);clues.push({...point,qid,index,readForUnlock:false,phase:rand()*Math.PI*2,hue:Math.floor(rand()*360)});
 }});
 initAmbient();
 resizeCanvas();
 $('#canvas-prompt').textContent='WASD / ARROWS · EXPLORE';renderHUD();say('RUN STARTED • Read field notes in place to unlock each room terminal. Press E to interact.');draw();
 ensureGameLoop();
}
function returnToMenu(){
 gameActive=false;ended=false;document.body.classList.remove('playing');
 $('#game-screen').hidden=true;$('#end-screen').hidden=true;$('#instructions').hidden=true;$('#home-screen').hidden=false;
 updateWalkingAudio(false);Object.keys(keys).forEach(key=>keys[key]=false);
}
function quitGame(){
 try{window.close()}catch(_){}
 setTimeout(()=>{if(!window.closed){$('#quit-message').hidden=false;}},80);
}
function answerFromKey(index){
 if(!activeTask||answerLocked)return;
 const button=$('#options').querySelectorAll('button')[index];if(button&&!button.disabled)answer(index,button);
}
function shimmer(){
 if(!gameActive||ended)return;flashUntil=Date.now()+4300;say('SHIMMER ACTIVE • Field notes sparkle briefly across walkable floors.');draw();
}
function handleGameKeydown(event){
 const key=event.key.toLowerCase();
 if(!gameActive){
  if(!$('#instructions').hidden&&event.key==='Enter'){event.preventDefault();startRun();}
  else if(!$('#instructions').hidden&&event.key==='Escape'){$('#instructions').hidden=true;$('#home-screen').hidden=false;}
  return;
 }
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key))event.preventDefault();
 keys[event.key]=true;
 if(event.repeat)return;
 unlockAudio();
 if(ended){
  if(key==='enter')startRun();else if(key==='escape')returnToMenu();
  return;
 }
 if(activeTask){
  if(['1','2','3'].includes(event.key)){event.preventDefault();answerFromKey(Number(event.key)-1);return;}
  if(event.key==='Enter'){event.preventDefault();if(!$('#task-continue').hidden)advance();return;}
  if(event.key==='Escape'){event.preventDefault();playSound('quest');activeTask=null;answerLocked=false;$('#task').hidden=true;say('TERMINAL CLOSED • Progress saved for this run.');draw();return;}
  return;
 }
 if(pauseChoiceOpen){if(['1','2','3'].includes(event.key)){choosePauseRoom(['A','B','C'][Number(event.key)-1]);}return;}
 if(key==='e'){event.preventDefault();interact();return;}
 if(key==='f'){event.preventDefault();shimmer();return;}
 if(key==='r'){event.preventDefault();startRun();return;}
}
$('#home-play').addEventListener('click',showInstructions);
$('#home-quit').addEventListener('click',quitGame);
$('#start-dive').addEventListener('click',startRun);
$('#end-menu').addEventListener('click',returnToMenu);
$('#end-replay').addEventListener('click',startRun);
document.querySelectorAll('[data-pause-room]').forEach(button=>button.addEventListener('click',()=>choosePauseRoom(button.dataset.pauseRoom)));
window.addEventListener('pointerdown',unlockAudio,{capture:true});
window.addEventListener('keydown',handleGameKeydown);
window.addEventListener('keyup',event=>keys[event.key]=false);
window.addEventListener('blur',()=>{Object.keys(keys).forEach(key=>keys[key]=false);updateWalkingAudio(false)});
window.addEventListener('resize',()=>{if(gameActive)resizeCanvas()});
mapImage.onload=()=>{mapReady=true;if(gameActive)resizeCanvas();ensureGameLoop()};
mapImage.onerror=()=>say('MAP FAILED TO LOAD • Keep assets/aquarium-map.png beside the game files.');

