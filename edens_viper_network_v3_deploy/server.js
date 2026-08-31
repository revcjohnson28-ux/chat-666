const express=require('express');
const http=require('http');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const {Server}=require('socket.io');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:true,credentials:true}});
const PORT=Number(process.env.PORT||3000);
const HOST='0.0.0.0';
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
const STORE_FILE=path.join(DATA_DIR,'store.json');
const SESSION_SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const OWNER_USERNAME=(process.env.OWNER_USERNAME||"Eden's Viper").trim();
const OWNER_PASSWORD=process.env.OWNER_PASSWORD||'';

app.use(express.json({limit:'100kb'}));
app.use(express.static(path.join(__dirname,'public')));

function baseStore(){return {users:{},rooms:{},messages:{},privateMessages:{},bans:[]};}
let store=baseStore();
function ensureData(){fs.mkdirSync(DATA_DIR,{recursive:true});if(fs.existsSync(STORE_FILE)){try{store={...baseStore(),...JSON.parse(fs.readFileSync(STORE_FILE,'utf8'))};}catch(e){console.error('Could not read store:',e.message);}}}
function save(){fs.mkdirSync(DATA_DIR,{recursive:true});const tmp=STORE_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(store,null,2));fs.renameSync(tmp,STORE_FILE);}
function clean(s,max=1000){return String(s??'').replace(/[<>]/g,'').trim().slice(0,max);}
function key(s){return clean(s,24).toLowerCase();}
function id(){return crypto.randomUUID();}
function now(){return new Date().toISOString();}
function timeLabel(ts=Date.now()){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){const hash=crypto.scryptSync(String(password),salt,64).toString('hex');return `${salt}:${hash}`;}
function verifyPassword(password,stored){try{const [salt,oldHash]=stored.split(':');const hash=crypto.scryptSync(String(password),salt,64);return crypto.timingSafeEqual(hash,Buffer.from(oldHash,'hex'));}catch{return false;}}
function signToken(username){const payload=Buffer.from(JSON.stringify({u:username,iat:Date.now(),n:crypto.randomBytes(8).toString('hex')})).toString('base64url');const sig=crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest('base64url');return `${payload}.${sig}`;}
function verifyToken(token){try{const [payload,sig]=String(token||'').split('.');const expected=crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest('base64url');if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const data=JSON.parse(Buffer.from(payload,'base64url').toString());return store.users[key(data.u)]?data.u:null;}catch{return null;}}
function publicUser(u,online=false,socketId=null,media={audio:false,video:false}){return {username:u.username,role:u.role,avatar:u.avatar,bio:u.bio||'',online,socketId,media:{audio:!!media.audio,video:!!media.video}};}
function ensureDefaults(){
  const defaults=[['The Crypt','Goth • Darkwave • Occult • Vampire Rock','Featured'],['Vampirism','Vampire culture, literature, music & discussion','Occult'],['Goth Music','Goth Rock • Death Rock • Darkwave • Post-Punk','Music'],['The Coven','Occultism, magick, mythology & esoterica','Occult']];
  for(const [name,topic,category] of defaults){if(!store.rooms[name])store.rooms[name]={name,topic,category,createdAt:now()};if(!store.messages[name])store.messages[name]=[];}
  if(OWNER_PASSWORD){const k=key(OWNER_USERNAME);if(!store.users[k])store.users[k]={username:OWNER_USERNAME,passwordHash:hashPassword(OWNER_PASSWORD),role:'owner',avatar:OWNER_USERNAME.slice(0,2).toUpperCase(),bio:'Network owner',createdAt:now()};else if(store.users[k].role!=='owner')store.users[k].role='owner';}
  save();
}
ensureData();ensureDefaults();

const online=new Map(); // socket.id -> {username,room}
function roomInfo(){return Object.values(store.rooms).map(r=>({...r,count:[...online.values()].filter(u=>u.room===r.name).length}));}
function usersInRoom(room){return [...online.entries()].filter(([,v])=>v.room===room).map(([sid,v])=>publicUser(store.users[key(v.username)],true,sid,v.media));}
function broadcastUsers(room){io.to(room).emit('room_users',usersInRoom(room));}
function emitCounts(){io.emit('room_counts',roomInfo());}
function isBanned(username){return store.bans.some(b=>b.username===key(username));}
function canModerate(role){return role==='owner'||role==='moderator';}
function addRoomHistory(room,payload){const a=store.messages[room]||(store.messages[room]=[]);a.push(payload);if(a.length>200)a.splice(0,a.length-200);save();}
function pmKey(a,b){return [key(a),key(b)].sort().join('::');}
function addPm(a,b,payload){const k=pmKey(a,b);const arr=store.privateMessages[k]||(store.privateMessages[k]=[]);arr.push(payload);if(arr.length>200)arr.splice(0,arr.length-200);save();}
function authReq(req){const h=req.headers.authorization||'';return verifyToken(h.startsWith('Bearer ')?h.slice(7):'');}

app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/api/config',(req,res)=>res.json({ownerConfigured:!!OWNER_PASSWORD,ownerUsername:OWNER_USERNAME}));
app.post('/api/register',(req,res)=>{
  const username=clean(req.body?.username,24), password=String(req.body?.password||'');
  if(username.length<3)return res.status(400).json({error:'Username must be at least 3 characters.'});
  if(password.length<8)return res.status(400).json({error:'Password must be at least 8 characters.'});
  const k=key(username);if(k===key(OWNER_USERNAME))return res.status(403).json({error:'That username is reserved.'});
  if(store.users[k])return res.status(409).json({error:'Username already exists.'});
  store.users[k]={username,passwordHash:hashPassword(password),role:'member',avatar:username.slice(0,2).toUpperCase(),bio:'',createdAt:now()};save();
  res.json({token:signToken(username),user:publicUser(store.users[k])});
});
app.post('/api/login',(req,res)=>{
  const username=clean(req.body?.username,24), password=String(req.body?.password||'');const u=store.users[key(username)];
  if(!u||!verifyPassword(password,u.passwordHash))return res.status(401).json({error:'Incorrect username or password.'});
  if(isBanned(u.username))return res.status(403).json({error:'This account is banned.'});
  res.json({token:signToken(u.username),user:publicUser(u)});
});
app.get('/api/me',(req,res)=>{const username=authReq(req);if(!username)return res.status(401).json({error:'Not signed in.'});res.json({user:publicUser(store.users[key(username)])});});

io.use((socket,next)=>{const username=verifyToken(socket.handshake.auth?.token);if(!username)return next(new Error('AUTH_REQUIRED'));if(isBanned(username))return next(new Error('BANNED'));socket.username=username;next();});
io.on('connection',socket=>{
  const u=store.users[key(socket.username)];
  socket.on('join',data=>{
    if(isBanned(u.username))return socket.emit('kicked','This account is banned.');
    const roomName=store.rooms[data?.room]?data.room:'The Crypt';
    const old=online.get(socket.id);if(old?.room){socket.leave(old.room);}
    online.set(socket.id,{username:u.username,room:roomName,media:old?.media||{audio:false,video:false}});socket.join(roomName);
    socket.emit('state',{me:publicUser(u,true,socket.id,online.get(socket.id).media),room:store.rooms[roomName],rooms:roomInfo(),history:store.messages[roomName]||[]});
    socket.to(roomName).emit('system',`${u.username} entered the room.`);broadcastUsers(roomName);emitCounts();
  });
  socket.on('message',raw=>{const state=online.get(socket.id);if(!state)return;const text=clean(raw,1000);if(!text)return;const payload={id:id(),username:u.username,role:u.role,text,ts:Date.now(),time:timeLabel()};addRoomHistory(state.room,payload);io.to(state.room).emit('message',payload);});
  socket.on('typing',on=>{const state=online.get(socket.id);if(state)socket.to(state.room).emit('typing',{username:u.username,on:!!on});});
  socket.on('switch_room',room=>{const state=online.get(socket.id);if(!state||!store.rooms[room]||room===state.room)return;const old=state.room;socket.to(old).emit('rtc_peer_left',{socketId:socket.id});socket.emit('rtc_reset');socket.leave(old);state.room=room;socket.join(room);socket.emit('state',{me:publicUser(u,true,socket.id,state.media),room:store.rooms[room],rooms:roomInfo(),history:store.messages[room]||[]});socket.to(old).emit('system',`${u.username} left the room.`);socket.to(room).emit('system',`${u.username} entered the room.`);broadcastUsers(old);broadcastUsers(room);emitCounts();});

  // WebRTC signaling stays room-scoped. Audio/video flows peer-to-peer, not through this server.
  socket.on('rtc_signal',data=>{
    const state=online.get(socket.id), targetState=online.get(data?.to);
    if(!state||!targetState||state.room!==targetState.room)return;
    const payload={from:socket.id};
    if(data?.description)payload.description=data.description;
    if(data?.candidate)payload.candidate=data.candidate;
    io.to(data.to).emit('rtc_signal',payload);
  });
  socket.on('media_state',data=>{
    const state=online.get(socket.id);if(!state)return;
    state.media={audio:!!data?.audio,video:!!data?.video};
    io.to(state.room).emit('media_state',{socketId:socket.id,username:u.username,...state.media});
    broadcastUsers(state.room);
  });
  socket.on('media_moderate',data=>{
    if(!canModerate(u.role))return;
    const state=online.get(socket.id), targetState=online.get(data?.socketId), target=targetState&&store.users[key(targetState.username)];
    if(!state||!targetState||state.room!==targetState.room||!target)return;
    if(target.role==='owner'||(u.role==='moderator'&&target.role==='moderator'))return socket.emit('error_msg','You cannot moderate that user.');
    if(data.action==='mute'||data.action==='camera_off')io.to(data.socketId).emit('media_moderated',{action:data.action,by:u.username});
  });
  socket.on('create_room',data=>{if(!canModerate(u.role))return;const name=clean(data?.name,32),topic=clean(data?.topic,100);if(!name||store.rooms[name])return socket.emit('error_msg','Room name unavailable.');store.rooms[name]={name,topic:topic||'Community room',category:'Community',createdAt:now()};store.messages[name]=[];save();io.emit('rooms_updated',roomInfo());});
  socket.on('private_history',targetName=>{const t=store.users[key(targetName)];if(!t)return;socket.emit('private_history',{with:t.username,messages:store.privateMessages[pmKey(u.username,t.username)]||[]});});
  socket.on('private_message',data=>{const target=store.users[key(data?.to)],text=clean(data?.text,1000);if(!target||!text)return;const payload={id:id(),from:u.username,to:target.username,text,ts:Date.now(),time:timeLabel()};addPm(u.username,target.username,payload);socket.emit('private_message',payload);for(const [sid,state] of online.entries())if(key(state.username)===key(target.username))io.to(sid).emit('private_message',payload);});
  socket.on('update_profile',data=>{u.bio=clean(data?.bio,160);save();const state=online.get(socket.id);if(state)broadcastUsers(state.room);socket.emit('profile_updated',publicUser(u,true,socket.id));});
  socket.on('moderate',data=>{if(!canModerate(u.role))return;const targetSocket=io.sockets.sockets.get(data?.socketId);const targetState=online.get(data?.socketId);if(!targetSocket||!targetState)return;const target=store.users[key(targetState.username)];if(!target||target.role==='owner'||(u.role==='moderator'&&target.role==='moderator'))return socket.emit('error_msg','You cannot moderate that user.');if(data.action==='kick'){targetSocket.emit('kicked','You were removed from the room.');targetSocket.disconnect(true);}if(data.action==='ban'){store.bans.push({username:key(target.username),by:u.username,at:now()});save();targetSocket.emit('kicked','You were banned from this chat.');targetSocket.disconnect(true);}});
  socket.on('set_role',data=>{if(u.role!=='owner')return;const target=store.users[key(data?.username)];if(!target||target.role==='owner')return;target.role=data?.role==='moderator'?'moderator':'member';save();io.emit('role_changed',{username:target.username,role:target.role});for(const [sid,state] of online.entries())if(key(state.username)===key(target.username))io.to(sid).emit('refresh_me',publicUser(target,true,sid));const state=online.get(socket.id);if(state)broadcastUsers(state.room);});
  socket.on('disconnect',()=>{const state=online.get(socket.id);if(!state)return;online.delete(socket.id);socket.to(state.room).emit('rtc_peer_left',{socketId:socket.id});socket.to(state.room).emit('system',`${u.username} disconnected.`);broadcastUsers(state.room);emitCounts();});
});

server.listen(PORT,HOST,()=>console.log(`Eden's Viper Network v4 voice/video listening on http://${HOST}:${PORT}`));
