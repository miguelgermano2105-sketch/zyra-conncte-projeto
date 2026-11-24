import { all, get, run, now } from './db.js';
import { userFromToken } from './lib/auth.js';
import { setIO } from './lib/bus.js';
import { basePerms, channelPerms, has, PERM } from './lib/perms.js';

const presence = new Map();      // userId -> Set<socketId>
const voiceStates = new Map();   // channelId -> Map<userId, state>

function roomsFor(userId) {
  const rooms = [`user:${userId}`];
  for (const { server_id: serverId } of all('SELECT server_id FROM server_members WHERE user_id = ?', userId)) {
    rooms.push(`server:${serverId}`);
    for (const channel of all('SELECT * FROM channels WHERE server_id = ?', serverId)) {
      if (has(channelPerms(channel, userId).perms, PERM.VIEW_CHANNELS)) rooms.push(`channel:${channel.id}`);
    }
  }
  for (const { dm_id: dmId } of all('SELECT dm_id FROM dm_members WHERE user_id = ?', userId)) {
    rooms.push(`dm:${dmId}`);
  }
  return rooms;
}

function serverRoomsOf(userId) {
  return all('SELECT server_id FROM server_members WHERE user_id = ?', userId).map((r) => `server:${r.server_id}`);
}

function broadcastPresence(io, userId, status) {
  const payload = { userId, status, at: now() };
  io.to(`user:${userId}`).emit('presence:self', payload);
  for (const room of serverRoomsOf(userId)) io.to(room).emit('presence:update', payload);
}

function voicePayload(channelId) {
  const states = voiceStates.get(channelId);
  if (!states) return { channelId, participants: [] };
  return {
    channelId,
    participants: [...states.entries()].map(([userId, state]) => ({ userId, ...state })),
  };
}

function broadcastVoice(io, channelId) {
  const channel = get('SELECT * FROM channels WHERE id = ?', channelId);
  const payload = voicePayload(channelId);
  io.to(`voice:${channelId}`).emit('voice:state', payload);
  if (channel) io.to(`server:${channel.server_id}`).emit('voice:state', payload);
}

function removeFromVoice(io, socket, userId) {
  for (const [channelId, states] of voiceStates) {
    if (states.has(userId) && states.get(userId).socketId === socket.id) {
      states.delete(userId);
      socket.leave(`voice:${channelId}`);
      if (states.size === 0) voiceStates.delete(channelId);
      broadcastVoice(io, channelId);
    }
  }
}

export function attachRealtime(io) {
  setIO(io);

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('unauthorized'));
      const { user } = userFromToken(String(token));
      socket.data.userId = user.id;
      socket.data.username = user.username;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId;

    for (const room of roomsFor(userId)) await socket.join(room);

    if (!presence.has(userId)) presence.set(userId, new Set());
    presence.get(userId).add(socket.id);
    run('UPDATE users SET status = ?, last_seen = ? WHERE id = ? AND status != ?', 'online', now(), userId, 'invisible');
    if (presence.get(userId).size === 1) broadcastPresence(io, userId, 'online');

    const onlineIds = [...presence.keys()];
    socket.emit('presence:list', { online: onlineIds });
    socket.emit('voice:list', {
      channels: [...voiceStates.keys()].map((channelId) => voicePayload(channelId)),
    });

    socket.on('rooms:refresh', async (ack) => {
      for (const room of roomsFor(userId)) await socket.join(room);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('typing:start', ({ scopeType, scopeId } = {}) => {
      if (!scopeType || !scopeId) return;
      const type = scopeType === 'dm' ? 'dm' : 'channel';
      socket.to(`${type}:${scopeId}`).emit('typing:start', {
        scopeType: type, scopeId, userId, username: socket.data.username,
      });
    });

    socket.on('read:update', ({ scopeType, scopeId, lastRead } = {}) => {
      if (!scopeType || !scopeId) return;
      run('INSERT OR REPLACE INTO read_states (user_id, scope_type, scope_id, last_read) VALUES (?, ?, ?, ?)',
        userId, scopeType, scopeId, Number(lastRead || 0));
      socket.to(`user:${userId}`).emit('read:update', { scopeType, scopeId, lastRead: Number(lastRead || 0) });
    });

    /* ------------------------------ voz / WebRTC ------------------------------ */
    socket.on('voice:join', ({ channelId } = {}, ack) => {
      try {
        const channel = get('SELECT * FROM channels WHERE id = ? AND type = ?', String(channelId || ''), 'voice');
        if (!channel) throw new Error('Canal de voz inválido.');
        const perms = channelPerms(channel, userId).perms;
        if (!has(perms, PERM.VOICE_CONNECT)) throw new Error('Sem permissão para entrar neste canal.');
        if (channel.user_limit > 0) {
          const current = voiceStates.get(channel.id)?.size || 0;
          if (current >= channel.user_limit) throw new Error('Canal de voz cheio.');
        }
        removeFromVoice(io, socket, userId);
        if (!voiceStates.has(channel.id)) voiceStates.set(channel.id, new Map());
        const existing = [...voiceStates.get(channel.id).keys()];
        voiceStates.get(channel.id).set(userId, {
          socketId: socket.id, muted: false, deafened: false, video: false, screen: false,
          username: socket.data.username, joinedAt: now(),
        });
        socket.join(`voice:${channel.id}`);
        socket.data.voiceChannelId = channel.id;
        broadcastVoice(io, channel.id);
        if (typeof ack === 'function') ack({ ok: true, peers: existing.filter((id) => id !== userId) });
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });

    socket.on('voice:leave', ({ channelId } = {}) => {
      const id = String(channelId || socket.data.voiceChannelId || '');
      const states = voiceStates.get(id);
      if (states) {
        states.delete(userId);
        socket.leave(`voice:${id}`);
        if (states.size === 0) voiceStates.delete(id);
        broadcastVoice(io, id);
      }
      socket.data.voiceChannelId = null;
    });

    socket.on('voice:update', ({ channelId, muted, deafened, video, screen } = {}) => {
      const id = String(channelId || socket.data.voiceChannelId || '');
      const states = voiceStates.get(id);
      if (!states?.has(userId)) return;
      const state = states.get(userId);
      if (typeof muted === 'boolean') state.muted = muted;
      if (typeof deafened === 'boolean') state.deafened = deafened;
      if (typeof video === 'boolean') state.video = video;
      if (typeof screen === 'boolean') state.screen = screen;
      broadcastVoice(io, id);
    });

    socket.on('webrtc:signal', ({ channelId, targetId, data } = {}) => {
      const id = String(channelId || '');
      const states = voiceStates.get(id);
      if (!states?.has(userId) || !targetId) return;
      io.to(`user:${targetId}`).emit('webrtc:signal', {
        channelId: id, fromId: userId, fromUsername: socket.data.username, data,
      });
    });

    socket.on('status:set', ({ status } = {}) => {
      if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) return;
      run('UPDATE users SET status = ? WHERE id = ?', status, userId);
      broadcastPresence(io, userId, status === 'invisible' ? 'offline' : status);
    });

    socket.on('disconnect', () => {
      removeFromVoice(io, socket, userId);
      const sockets = presence.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          presence.delete(userId);
          run('UPDATE users SET status = ?, last_seen = ? WHERE id = ?', 'offline', now(), userId);
          broadcastPresence(io, userId, 'offline');
        }
      }
    });
  });

  return io;
}
