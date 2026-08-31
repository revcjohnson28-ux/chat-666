const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 10 * 1024 * 1024 });
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "Eden's Viper").trim();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const ROOM_KICK_MINUTES = Math.max(1, Number(process.env.ROOM_KICK_MINUTES || 10));
const MAX_UPLOAD_MB = Math.min(10, Math.max(1, Number(process.env.MAX_UPLOAD_MB || 5)));

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR, { index: false, fallthrough: false }));

function baseStore() { return { users: {}, rooms: {}, messages: {}, privateMessages: {}, bans: [], roomKicks: [], files: {} }; }
let store = baseStore();
function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STORE_FILE)) {
    try { store = { ...baseStore(), ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }; }
    catch (e) { console.error('Could not read store:', e.message); }
  }
  for (const user of Object.values(store.users || {})) if (!Array.isArray(user.blocked)) user.blocked = [];
}
function save() { fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = STORE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(store, null, 2)); fs.renameSync(tmp, STORE_FILE); }
function clean(s, max = 1000) { return String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max); }
function key(s) { return clean(s, 24).toLowerCase(); }
function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function timeLabel(ts = Date.now()) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { const hash = crypto.scryptSync(String(password), salt, 64).toString('hex'); return `${salt}:${hash}`; }
function verifyPassword(password, stored) { try { const [salt, oldHash] = stored.split(':'); const hash = crypto.scryptSync(String(password), salt, 64); return crypto.timingSafeEqual(hash, Buffer.from(oldHash, 'hex')); } catch { return false; } }
function signToken(username) { const payload = Buffer.from(JSON.stringify({ u: username, iat: Date.now(), n: crypto.randomBytes(8).toString('hex') })).toString('base64url'); const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url'); return `${payload}.${sig}`; }
function verifyToken(token) { try { const [payload, sig] = String(token || '').split('.'); const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url'); if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null; const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return store.users[key(data.u)] ? data.u : null; } catch { return null; } }
function isOwnerName(name) { return key(name) === key(OWNER_USERNAME); }
function publicUser(u, online = false, socketId = null, media = { audio: false, video: false }, locks = { audio: false, video: false }, self = false) {
  const out = { username: u.username, role: u.role, avatar: u.avatar, bio: u.bio || '', online, socketId, media: { audio: !!media.audio, video: !!media.video }, locks: { audio: !!locks.audio, video: !!locks.video } };
  if (self) out.blocked = Array.isArray(u.blocked) ? u.blocked : [];
  return out;
}
function ensureDefaults() {
  const defaults = [
    ['The Crypt', 'Goth • Darkwave • Occult • Vampire Rock', 'Featured'],
    ['Vampirism', 'Vampire culture, literature, music & discussion', 'Occult'],
    ['Goth Music', 'Goth Rock • Death Rock • Darkwave • Post-Punk', 'Music'],
    ['The Coven', 'Occultism, magick, mythology & esoterica', 'Occult']
  ];
  for (const [name, topic, category] of defaults) { if (!store.rooms[name]) store.rooms[name] = { name, topic, category, createdAt: now() }; if (!store.messages[name]) store.messages[name] = []; }
  // Always restore the configured owner's role when that account already
  // exists on a persistent disk. OWNER_PASSWORD is only needed to create the
  // account for the first time; existing owners keep their current password.
  const ownerKey = key(OWNER_USERNAME), existingOwner = store.users[ownerKey];
  if (existingOwner) {
    existingOwner.role = 'owner';
    if (!Array.isArray(existingOwner.blocked)) existingOwner.blocked = [];
  } else if (OWNER_PASSWORD) {
    store.users[ownerKey] = { username: OWNER_USERNAME, passwordHash: hashPassword(OWNER_PASSWORD), role: 'owner', avatar: OWNER_USERNAME.slice(0, 2).toUpperCase(), bio: 'Network owner', blocked: [], createdAt: now() };
  }
  save();
}
ensureData(); ensureDefaults();

const online = new Map(); // socket.id -> {username,room,media,locks}
function getUser(name) { return store.users[key(name)]; }
function roomInfo() { return Object.values(store.rooms).map(r => ({ ...r, count: [...online.values()].filter(u => u.room === r.name).length })); }
function usersInRoom(room) { return [...online.entries()].filter(([, v]) => v.room === room).map(([sid, v]) => publicUser(getUser(v.username), true, sid, v.media, v.locks)); }
function broadcastUsers(room) { io.to(room).emit('room_users', usersInRoom(room)); }
function emitCounts() { io.emit('room_counts', roomInfo()); }
function isBanned(username) { return store.bans.some(b => b.username === key(username)); }
function canRoomModerate(role) { return role === 'owner' || role === 'moderator'; }
function addRoomHistory(room, payload) { const a = store.messages[room] || (store.messages[room] = []); a.push(payload); if (a.length > 300) a.splice(0, a.length - 300); save(); }
function pmKey(a, b) { return [key(a), key(b)].sort().join('::'); }
function addPm(a, b, payload) { const k = pmKey(a, b); const arr = store.privateMessages[k] || (store.privateMessages[k] = []); arr.push(payload); if (arr.length > 500) arr.splice(0, arr.length - 500); save(); }
function authReq(req) { const h = req.headers.authorization || ''; return verifyToken(h.startsWith('Bearer ') ? h.slice(7) : ''); }
function blockedBy(viewer, sender) { if (isOwnerName(viewer) || isOwnerName(sender)) return false; const u = getUser(viewer); return !!u?.blocked?.includes(key(sender)); }
function dmBlocked(a, b) { if (isOwnerName(a) || isOwnerName(b)) return false; return blockedBy(a, b) || blockedBy(b, a); }
function historyFor(viewer, room) { return (store.messages[room] || []).filter(m => !blockedBy(viewer, m.username)); }
function pruneRoomKicks() { const t = Date.now(); store.roomKicks = (store.roomKicks || []).filter(k => Number(k.until) > t); }
function roomKick(username, room) { pruneRoomKicks(); return store.roomKicks.find(k => k.username === key(username) && k.room === room); }
function fallbackRoom(exclude) { return Object.keys(store.rooms).find(r => r !== exclude) || 'The Crypt'; }
function allSocketsFor(name) { return [...online.entries()].filter(([, s]) => key(s.username) === key(name)).map(([sid]) => sid); }
function sendToUser(name, event, payload) { for (const sid of allSocketsFor(name)) io.to(sid).emit(event, payload); }
function disconnectPeerBetween(a, b) {
  const aIds = allSocketsFor(a), bIds = allSocketsFor(b);
  for (const sid of aIds) for (const bid of bIds) { io.to(sid).emit('rtc_peer_left', { socketId: bid }); io.to(bid).emit('rtc_peer_left', { socketId: sid }); }
}
function deliverRoomMessage(room, payload) {
  for (const [sid, state] of online.entries()) if (state.room === room && !blockedBy(state.username, payload.username)) io.to(sid).emit('message', payload);
}
function deliverPm(payload) {
  sendToUser(payload.from, 'private_message', payload);
  if (key(payload.to) !== key(payload.from)) sendToUser(payload.to, 'private_message', payload);
}
function moveSocketToRoom(socket, roomName, announce = true) {
  const state = online.get(socket.id); if (!state || !store.rooms[roomName]) return;
  const u = getUser(state.username), old = state.room;
  if (old) { socket.to(old).emit('rtc_peer_left', { socketId: socket.id }); socket.leave(old); }
  state.room = roomName; socket.join(roomName);
  socket.emit('rtc_reset');
  socket.emit('state', { me: publicUser(u, true, socket.id, state.media, state.locks, true), room: store.rooms[roomName], rooms: roomInfo(), history: historyFor(u.username, roomName) });
  if (announce && old && old !== roomName) socket.to(old).emit('system', `${u.username} left the room.`);
  if (announce) socket.to(roomName).emit('system', `${u.username} entered the room.`);
  if (old) broadcastUsers(old); broadcastUsers(roomName); emitCounts();
}
function serviceBan(username, by) {
  const k = key(username); if (!k || isOwnerName(username)) return false;
  if (!store.bans.some(b => b.username === k)) store.bans.push({ username: k, display: getUser(username)?.username || username, by, at: now() });
  save();
  for (const sid of allSocketsFor(username)) { io.to(sid).emit('kicked', 'You were banned from this service.'); io.sockets.sockets.get(sid)?.disconnect(true); }
  return true;
}
function serviceUnban(username) { const k = key(username); const before = store.bans.length; store.bans = store.bans.filter(b => b.username !== k); if (store.bans.length !== before) save(); }

app.get('/health', (req, res) => res.json({ ok: true, version: 6 }));
app.get('/api/config', (req, res) => res.json({ version: 6, ownerConfigured: !!getUser(OWNER_USERNAME), ownerUsername: OWNER_USERNAME, maxUploadMb: MAX_UPLOAD_MB }));
app.post('/api/register', (req, res) => {
  if (req.body?.eulaAccepted !== true) return res.status(400).json({ error: 'You must agree to the EULA before creating an account.' });
  const username = clean(req.body?.username, 24), password = String(req.body?.password || '');
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const k = key(username); if (k === key(OWNER_USERNAME)) return res.status(403).json({ error: 'That username is reserved.' });
  if (store.users[k]) return res.status(409).json({ error: 'Username already exists.' });
  store.users[k] = { username, passwordHash: hashPassword(password), role: 'member', avatar: username.slice(0, 2).toUpperCase(), bio: '', blocked: [], eulaAcceptedAt: now(), createdAt: now() }; save();
  res.json({ token: signToken(username), user: publicUser(store.users[k], false, null, undefined, undefined, true) });
});
app.post('/api/login', (req, res) => {
  if (req.body?.eulaAccepted !== true) return res.status(400).json({ error: 'You must agree to the EULA before entering the network.' });
  const username = clean(req.body?.username, 24), password = String(req.body?.password || ''), u = getUser(username);
  if (!u || !verifyPassword(password, u.passwordHash)) return res.status(401).json({ error: 'Incorrect username or password.' });
  if (isBanned(u.username)) return res.status(403).json({ error: 'This account is banned.' });
  res.json({ token: signToken(u.username), user: publicUser(u, false, null, undefined, undefined, true) });
});
app.get('/api/me', (req, res) => { const username = authReq(req); if (!username) return res.status(401).json({ error: 'Not signed in.' }); res.json({ user: publicUser(getUser(username), false, null, undefined, undefined, true) }); });
app.get('/api/users', (req, res) => {
  const username = authReq(req); if (!username) return res.status(401).json({ error: 'Not signed in.' });
  const users = Object.values(store.users).map(u => ({ username: u.username, role: u.role, avatar: u.avatar, bio: u.bio || '', online: allSocketsFor(u.username).length > 0 })).sort((a, b) => a.username.localeCompare(b.username));
  res.json({ users });
});
app.get('/api/admin/users', (req, res) => {
  const username = authReq(req), u = getUser(username); if (!u || u.role !== 'owner') return res.status(403).json({ error: 'Owner access required.' });
  const users = Object.values(store.users).map(x => ({ username: x.username, role: x.role, banned: isBanned(x.username), online: allSocketsFor(x.username).length > 0, createdAt: x.createdAt })).sort((a, b) => a.username.localeCompare(b.username));
  res.json({ users });
});

const allowedMime = new Set(['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/ogg','audio/wav','application/pdf','text/plain','application/zip','application/x-zip-compressed']);

io.use((socket, next) => { const username = verifyToken(socket.handshake.auth?.token); if (!username) return next(new Error('AUTH_REQUIRED')); if (isBanned(username)) return next(new Error('BANNED')); socket.username = username; next(); });
io.on('connection', socket => {
  const u = getUser(socket.username);
  online.set(socket.id, { username: u.username, room: '', media: { audio: false, video: false }, locks: { audio: false, video: false } });

  socket.on('join', data => {
    if (isBanned(u.username)) return socket.emit('kicked', 'This account is banned.');
    const requested = store.rooms[data?.room] ? data.room : 'The Crypt';
    const kicked = roomKick(u.username, requested), roomName = kicked ? fallbackRoom(requested) : requested;
    if (kicked) socket.emit('error_msg', `You are temporarily kicked from ${requested}.`);
    moveSocketToRoom(socket, roomName, false);
  });
  socket.on('message', raw => {
    const state = online.get(socket.id); if (!state?.room) return; const text = clean(raw, 1000); if (!text) return;
    const payload = { id: id(), username: u.username, role: u.role, text, ts: Date.now(), time: timeLabel() }; addRoomHistory(state.room, payload); deliverRoomMessage(state.room, payload);
  });
  socket.on('typing', on => { const state = online.get(socket.id); if (!state?.room) return; for (const [sid, s] of online.entries()) if (s.room === state.room && sid !== socket.id && !blockedBy(s.username, u.username)) io.to(sid).emit('typing', { username: u.username, on: !!on }); });
  socket.on('switch_room', room => {
    const state = online.get(socket.id); if (!state || !store.rooms[room] || room === state.room) return;
    const kicked = roomKick(u.username, room); if (kicked) return socket.emit('error_msg', `You are temporarily kicked from ${room}.`);
    moveSocketToRoom(socket, room, true);
  });

  socket.on('rtc_signal', data => {
    const state = online.get(socket.id), targetState = online.get(data?.to); if (!state || !targetState || state.room !== targetState.room || dmBlocked(state.username, targetState.username)) return;
    const payload = { from: socket.id }; if (data?.description) payload.description = data.description; if (data?.candidate) payload.candidate = data.candidate; io.to(data.to).emit('rtc_signal', payload);
  });
  socket.on('media_state', data => {
    const state = online.get(socket.id); if (!state?.room) return;
    state.media = { audio: state.locks.audio ? false : !!data?.audio, video: state.locks.video ? false : !!data?.video };
    io.to(state.room).emit('media_state', { socketId: socket.id, username: u.username, ...state.media, locks: state.locks }); broadcastUsers(state.room);
  });
  socket.on('media_moderate', data => {
    if (!canRoomModerate(u.role)) return;
    const state = online.get(socket.id), targetState = online.get(data?.socketId), target = targetState && getUser(targetState.username);
    if (!state || !targetState || state.room !== targetState.room || !target) return;
    if (target.role === 'owner' || (u.role === 'moderator' && target.role === 'moderator')) return socket.emit('error_msg', 'You cannot moderate that user.');
    const action = data.action;
    if (action === 'audio_lock') { targetState.locks.audio = true; targetState.media.audio = false; }
    else if (action === 'audio_unlock') targetState.locks.audio = false;
    else if (action === 'video_lock') { targetState.locks.video = true; targetState.media.video = false; }
    else if (action === 'video_unlock') targetState.locks.video = false;
    else return;
    io.to(data.socketId).emit('media_moderated', { action, by: u.username });
    broadcastUsers(state.room);
  });

  socket.on('create_room', data => { if (!canRoomModerate(u.role)) return; const name = clean(data?.name, 32), topic = clean(data?.topic, 100); if (!name || store.rooms[name]) return socket.emit('error_msg', 'Room name unavailable.'); store.rooms[name] = { name, topic: topic || 'Community room', category: 'Community', createdAt: now() }; store.messages[name] = []; save(); io.emit('rooms_updated', roomInfo()); });

  socket.on('private_history', targetName => { const t = getUser(targetName); if (!t) return; if (dmBlocked(u.username, t.username)) return socket.emit('error_msg', 'Direct messages are blocked between these accounts.'); socket.emit('private_history', { with: t.username, messages: store.privateMessages[pmKey(u.username, t.username)] || [] }); });
  socket.on('private_message', data => {
    const target = getUser(data?.to), text = clean(data?.text, 1000); if (!target || !text) return; if (dmBlocked(u.username, target.username)) return socket.emit('error_msg', 'Direct messages are blocked between these accounts.');
    const payload = { id: id(), from: u.username, to: target.username, text, ts: Date.now(), time: timeLabel() }; addPm(u.username, target.username, payload); deliverPm(payload);
  });
  socket.on('private_file', data => {
    const target = getUser(data?.to); if (!target) return socket.emit('file_error', 'User not found.');
    if (dmBlocked(u.username, target.username)) return socket.emit('file_error', 'Direct messages are blocked between these accounts.');
    const mime = String(data?.mime || ''), originalName = clean(data?.name, 120), encoded = String(data?.data || '');
    if (!allowedMime.has(mime)) return socket.emit('file_error', 'That file type is not allowed.');
    let buffer; try { buffer = Buffer.from(encoded, 'base64'); } catch { return socket.emit('file_error', 'Could not read that file.'); }
    if (!buffer.length || buffer.length > MAX_UPLOAD_MB * 1024 * 1024) return socket.emit('file_error', `File too large. Maximum ${MAX_UPLOAD_MB} MB.`);
    const extMap = { 'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','audio/mpeg':'.mp3','audio/mp4':'.m4a','audio/ogg':'.ogg','audio/wav':'.wav','application/pdf':'.pdf','text/plain':'.txt','application/zip':'.zip','application/x-zip-compressed':'.zip' };
    const fileId = id(), ext = extMap[mime] || '', diskName = `${fileId}${ext}`; fs.writeFileSync(path.join(UPLOAD_DIR, diskName), buffer);
    const attachment = { id: fileId, url: `/uploads/${diskName}`, name: originalName || `attachment${ext}`, mime, size: buffer.length };
    store.files[fileId] = { ...attachment, diskName, from: u.username, to: target.username, at: now() };
    const payload = { id: id(), from: u.username, to: target.username, text: clean(data?.caption, 1000), attachment, ts: Date.now(), time: timeLabel() }; addPm(u.username, target.username, payload); deliverPm(payload); socket.emit('file_shared', { id: payload.id });
  });
  socket.on('block_user', targetName => {
    const target = getUser(targetName); if (!target || key(target.username) === key(u.username)) return; if (target.role === 'owner' || isOwnerName(target.username)) return socket.emit('error_msg', 'The network owner cannot be blocked.');
    if (!u.blocked.includes(key(target.username))) u.blocked.push(key(target.username)); save();
    disconnectPeerBetween(u.username, target.username); socket.emit('block_state', { blocked: u.blocked, username: target.username, on: true });
  });
  socket.on('unblock_user', targetName => { const target = getUser(targetName); if (!target) return; u.blocked = u.blocked.filter(x => x !== key(target.username)); save(); socket.emit('block_state', { blocked: u.blocked, username: target.username, on: false }); });

  socket.on('update_profile', data => { u.bio = clean(data?.bio, 160); save(); const state = online.get(socket.id); if (state?.room) broadcastUsers(state.room); socket.emit('profile_updated', publicUser(u, true, socket.id, state?.media, state?.locks, true)); });

  socket.on('moderate', data => {
    if (!canRoomModerate(u.role)) return;
    const targetSocket = io.sockets.sockets.get(data?.socketId), targetState = online.get(data?.socketId); if (!targetSocket || !targetState) return; const target = getUser(targetState.username);
    if (!target || target.role === 'owner' || (u.role === 'moderator' && target.role === 'moderator')) return socket.emit('error_msg', 'You cannot moderate that user.');
    if (data.action === 'kick_room') {
      const oldRoom = targetState.room; pruneRoomKicks(); store.roomKicks.push({ username: key(target.username), room: oldRoom, by: u.username, until: Date.now() + ROOM_KICK_MINUTES * 60 * 1000 }); save();
      const dest = fallbackRoom(oldRoom); io.to(data.socketId).emit('room_kicked', { room: oldRoom, by: u.username, minutes: ROOM_KICK_MINUTES, destination: dest }); moveSocketToRoom(targetSocket, dest, true);
    }
    if (data.action === 'ban_service') { if (u.role !== 'owner') return socket.emit('error_msg', 'Only the owner can ban from the entire service.'); serviceBan(target.username, u.username); }
  });
  socket.on('admin_ban', targetName => { if (u.role !== 'owner') return; const target = getUser(targetName); if (!target || target.role === 'owner') return; serviceBan(target.username, u.username); socket.emit('admin_changed'); });
  socket.on('admin_unban', targetName => { if (u.role !== 'owner') return; serviceUnban(targetName); socket.emit('admin_changed'); });
  socket.on('set_role', data => { if (u.role !== 'owner') return; const target = getUser(data?.username); if (!target || target.role === 'owner') return; target.role = data?.role === 'moderator' ? 'moderator' : 'member'; save(); io.emit('role_changed', { username: target.username, role: target.role }); for (const sid of allSocketsFor(target.username)) io.to(sid).emit('refresh_me', publicUser(target, true, sid, online.get(sid)?.media, online.get(sid)?.locks, true)); for (const r of Object.keys(store.rooms)) broadcastUsers(r); socket.emit('admin_changed'); });

  socket.on('disconnect', () => { const state = online.get(socket.id); if (!state) return; online.delete(socket.id); if (state.room) { socket.to(state.room).emit('rtc_peer_left', { socketId: socket.id }); socket.to(state.room).emit('system', `${u.username} disconnected.`); broadcastUsers(state.room); } emitCounts(); });
});

server.listen(PORT, HOST, () => console.log(`Eden's Viper Network v6 listening on http://${HOST}:${PORT}`));
