import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
} from 'react';
import { io } from 'socket.io-client';
import { api, getToken, setToken } from './lib/api.js';

const Ctx = createContext(null);
const scopeKey = (type, id) => `${type}:${id}`;

const initialState = {
  ready: false,
  connected: false,
  user: null,
  servers: [],
  dms: [],
  friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
  notifications: [],
  unread: {},
  view: { kind: 'home', id: null },
  channelId: null,
  messages: {},
  members: {},
  online: [],
  typing: {},
  voice: { channelId: null, participants: [] },
  voiceStates: {},
  toasts: [],
  modal: null,
  drawer: false,
  memberListOpen: true,
};

let toastSeq = 0;

function reducer(state, action) {
  switch (action.type) {
    case 'boot':
      return {
        ...state, ready: true, ...action.payload,
        view: action.payload.servers?.length
          ? { kind: 'server', id: action.payload.servers[0].id }
          : { kind: 'home', id: null },
        channelId: action.payload.servers?.[0]?.channels?.find((c) => c.type === 'text')?.id || null,
      };
    case 'ready':
      return { ...state, ready: true };
    case 'reset':
      return { ...initialState, ready: true };
    case 'connected':
      return { ...state, connected: action.value };
    case 'user':
      return { ...state, user: action.user };
    case 'servers':
      return { ...state, servers: action.servers };
    case 'server:upsert': {
      const exists = state.servers.some((s) => s.id === action.server.id);
      return {
        ...state,
        servers: exists
          ? state.servers.map((s) => (s.id === action.server.id ? action.server : s))
          : [...state.servers, action.server],
      };
    }
    case 'server:remove':
      return {
        ...state,
        servers: state.servers.filter((s) => s.id !== action.id),
        view: state.view.id === action.id ? { kind: 'home', id: null } : state.view,
        channelId: state.view.id === action.id ? null : state.channelId,
      };
    case 'dms':
      return { ...state, dms: action.dms };
    case 'dm:upsert': {
      const exists = state.dms.some((d) => d.id === action.dm.id);
      return {
        ...state,
        dms: exists ? state.dms.map((d) => (d.id === action.dm.id ? action.dm : d)) : [action.dm, ...state.dms],
      };
    }
    case 'dm:remove':
      return { ...state, dms: state.dms.filter((d) => d.id !== action.id) };
    case 'friends':
      return { ...state, friends: action.friends };
    case 'notifications':
      return { ...state, notifications: action.notifications };
    case 'unread':
      return { ...state, unread: { ...state.unread, ...action.unread } };
    case 'unread:clear': {
      const unread = { ...state.unread };
      delete unread[scopeKey(action.scopeType, action.scopeId)];
      return { ...state, unread };
    }
    case 'online':
      return { ...state, online: action.online };
    case 'presence': {
      const set = new Set(state.online);
      if (action.status === 'offline') set.delete(action.userId);
      else set.add(action.userId);
      return { ...state, online: [...set] };
    }
    case 'view':
      return { ...state, view: action.view, channelId: action.channelId ?? state.channelId, drawer: false };
    case 'channel':
      return { ...state, channelId: action.channelId, drawer: false };
    case 'messages': {
      const key = scopeKey(action.scopeType, action.scopeId);
      const current = state.messages[key]?.items || [];
      const items = action.prepend ? [...action.items, ...current] : action.items;
      return {
        ...state,
        messages: {
          ...state.messages,
          [key]: { items, hasMore: action.hasMore, loadedAt: Date.now() },
        },
      };
    }
    case 'message:add': {
      const { message } = action;
      const key = scopeKey(message.scopeType, message.scopeId);
      const bucket = state.messages[key];
      if (!bucket) return state;
      if (bucket.items.some((m) => m.id === message.id)) return state;
      return { ...state, messages: { ...state.messages, [key]: { ...bucket, items: [...bucket.items, message] } } };
    }
    case 'message:update': {
      const { message } = action;
      const key = scopeKey(message.scopeType, message.scopeId);
      const bucket = state.messages[key];
      if (!bucket) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [key]: { ...bucket, items: bucket.items.map((m) => (m.id === message.id ? message : m)) },
        },
      };
    }
    case 'message:delete': {
      const key = scopeKey(action.scopeType, action.scopeId);
      const bucket = state.messages[key];
      if (!bucket) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [key]: { ...bucket, items: bucket.items.filter((m) => m.id !== action.id) },
        },
      };
    }
    case 'members':
      return { ...state, members: { ...state.members, [action.serverId]: action.members } };
    case 'typing': {
      const key = scopeKey(action.scopeType, action.scopeId);
      return { ...state, typing: { ...state.typing, [key]: action.users } };
    }
    case 'voice': {
      const voiceStates = action.channelId
        ? { ...state.voiceStates, [action.channelId]: action.participants }
        : state.voiceStates;
      return {
        ...state,
        voiceStates,
        voice: action.channelId && action.channelId === state.voice.channelId
          ? { channelId: action.channelId, participants: action.participants }
          : state.voice,
      };
    }
    case 'voice:join':
      return { ...state, voice: { channelId: action.channelId, participants: action.participants || [] } };
    case 'voice:leave':
      return { ...state, voice: { channelId: null, participants: [] } };
    case 'toast': {
      const toast = { id: ++toastSeq, text: action.text, tone: action.tone || 'info' };
      return { ...state, toasts: [...state.toasts, toast].slice(-4) };
    }
    case 'toast:drop':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'modal':
      return { ...state, modal: action.modal };
    case 'drawer':
      return { ...state, drawer: action.open };
    case 'members:toggle':
      return { ...state, memberListOpen: !state.memberListOpen };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef(null);
  const typingTimers = useRef(new Map());

  const toast = useCallback((text, tone = 'info') => dispatch({ type: 'toast', text, tone }), []);
  const openModal = useCallback((modal) => dispatch({ type: 'modal', modal }), []);
  const closeModal = useCallback(() => dispatch({ type: 'modal', modal: null }), []);

  const refreshBootstrap = useCallback(async () => {
    const data = await api('/me');
    dispatch({ type: 'servers', servers: data.servers });
    dispatch({ type: 'dms', dms: data.dms });
    dispatch({ type: 'friends', friends: data.friends });
    dispatch({ type: 'notifications', notifications: data.notifications });
    dispatch({ type: 'unread', unread: data.unread });
    dispatch({ type: 'user', user: data.user });
    return data;
  }, []);

  const signOut = useCallback(async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* sessão já expirada */ }
    setToken('');
    socketRef.current?.disconnect();
    socketRef.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const handleUnauthorized = useCallback((error) => {
    if (error?.status === 401) {
      setToken('');
      socketRef.current?.disconnect();
      socketRef.current = null;
      dispatch({ type: 'reset' });
      return true;
    }
    return false;
  }, []);

  const request = useCallback(async (path, options) => {
    try {
      return await api(path, options);
    } catch (error) {
      if (!handleUnauthorized(error)) throw error;
      return null;
    }
  }, [handleUnauthorized]);

  /* ------------------------------ tempo real ------------------------------ */
  useEffect(() => {
    if (!state.user) return undefined;
    const token = getToken();
    if (!token) return undefined;

    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => dispatch({ type: 'connected', value: true }));
    socket.on('disconnect', () => dispatch({ type: 'connected', value: false }));

    socket.on('presence:list', ({ online }) => dispatch({ type: 'online', online }));
    socket.on('presence:update', ({ userId, status }) => dispatch({ type: 'presence', userId, status }));

    socket.on('message:create', ({ message }) => {
      dispatch({ type: 'message:add', message });
      const key = scopeKey(message.scopeType, message.scopeId);
      const isOpen = state.view.kind === 'dm'
        ? state.view.id === message.scopeId && message.scopeType === 'dm'
        : state.channelId === message.scopeId && message.scopeType === 'channel';
      if (!isOpen && message.author.id !== state.user?.id) {
        dispatch({
          type: 'unread',
          unread: { [key]: (state.unread[key] || 0) + 1 },
        });
      }
    });
    socket.on('message:update', ({ message }) => dispatch({ type: 'message:update', message }));
    socket.on('message:delete', ({ id, scopeType, scopeId }) =>
      dispatch({ type: 'message:delete', id, scopeType, scopeId }));

    socket.on('server:update', ({ server }) => {
      if (!server) return;
      dispatch({ type: 'server:upsert', server });
      socket.emit('rooms:refresh');
    });
    socket.on('server:created', ({ server }) => {
      dispatch({ type: 'server:upsert', server });
      socket.emit('rooms:refresh');
    });
    socket.on('server:deleted', ({ serverId, reason }) => {
      dispatch({ type: 'server:remove', id: serverId });
      if (reason) toast(reason, 'warn');
    });
    socket.on('member:add', ({ serverId, members }) => dispatch({ type: 'members', serverId, members }));
    socket.on('member:update', ({ serverId, members }) => dispatch({ type: 'members', serverId, members }));
    socket.on('member:remove', ({ serverId, userId }) => {
      dispatch({ type: 'members', serverId, members: (state.members[serverId] || []).filter((m) => m.id !== userId) });
    });

    socket.on('dm:create', ({ dm }) => dispatch({ type: 'dm:upsert', dm }));
    socket.on('dm:update', ({ dm }) => dispatch({ type: 'dm:upsert', dm }));
    socket.on('dm:remove', ({ dmId }) => dispatch({ type: 'dm:remove', id: dmId }));

    socket.on('friends:changed', async () => {
      const data = await api('/friends').catch(() => null);
      if (data) dispatch({ type: 'friends', friends: data });
    });

    socket.on('notification', ({ notification }) => {
      dispatch({ type: 'notifications', notifications: [notification, ...state.notifications].slice(0, 30) });
      if (notification?.title) toast(notification.title, 'info');
    });

    socket.on('typing:start', ({ scopeType, scopeId, userId, username }) => {
      const key = scopeKey(scopeType, scopeId);
      const current = state.typing[key] || [];
      if (current.includes(username)) return;
      dispatch({ type: 'typing', scopeType, scopeId, users: [...current, username].slice(-3) });
      clearTimeout(typingTimers.current.get(`${key}:${username}`));
      typingTimers.current.set(`${key}:${username}`, setTimeout(() => {
        const latest = (state.typing[key] || []).filter((u) => u !== username);
        dispatch({ type: 'typing', scopeType, scopeId, users: latest });
      }, 4000));
    });

    socket.on('voice:list', ({ channels }) => {
      for (const channel of channels || []) {
        dispatch({ type: 'voice', channelId: channel.channelId, participants: channel.participants });
      }
    });
    socket.on('voice:state', ({ channelId, participants }) => {
      dispatch({ type: 'voice', channelId, participants });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.user?.id]);

  /* ------------------------------ dados ------------------------------ */
  const loadMessages = useCallback(async (scopeType, scopeId, { before } = {}) => {
    if (!scopeType || !scopeId) return null;
    const path = scopeType === 'channel'
      ? `/channels/${scopeId}/messages?limit=50${before ? `&before=${before}` : ''}`
      : `/dms/${scopeId}/messages?limit=50${before ? `&before=${before}` : ''}`;
    const data = await request(path);
    if (!data) return null;
    dispatch({
      type: 'messages', scopeType, scopeId, items: data.messages, prepend: Boolean(before),
      hasMore: data.messages.length === 50,
    });
    const last = data.messages[data.messages.length - 1];
    if (last && !before) {
      socketRef.current?.emit('read:update', { scopeType, scopeId, lastRead: last.id });
      request('/read', { method: 'POST', body: { scopeType, scopeId, lastRead: last.id } }).catch(() => {});
      dispatch({ type: 'unread:clear', scopeType, scopeId });
    }
    return data;
  }, [request]);

  const loadMembers = useCallback(async (serverId) => {
    if (!serverId) return;
    const data = await request(`/servers/${serverId}/members`);
    if (data) dispatch({ type: 'members', serverId, members: data.members });
  }, [request]);

  const selectServer = useCallback(async (serverId) => {
    const server = state.servers.find((s) => s.id === serverId);
    const first = server?.channels?.find((c) => c.type === 'text');
    dispatch({ type: 'view', view: { kind: 'server', id: serverId }, channelId: first?.id || null });
    loadMembers(serverId);
    if (first) loadMessages('channel', first.id);
  }, [state.servers, loadMembers, loadMessages]);

  const selectChannel = useCallback(async (channel) => {
    if (channel.type === 'voice') {
      dispatch({ type: 'channel', channelId: channel.id });
      return;
    }
    dispatch({ type: 'channel', channelId: channel.id });
    loadMessages('channel', channel.id);
  }, [loadMessages]);

  const selectDm = useCallback(async (dmId) => {
    dispatch({ type: 'view', view: { kind: 'dm', id: dmId } });
    loadMessages('dm', dmId);
  }, [loadMessages]);

  const sendMessage = useCallback(async ({ content, attachments, replyTo, stickerId }) => {
    const view = state.view;
    const path = view.kind === 'dm' ? `/dms/${view.id}/messages` : `/channels/${state.channelId}/messages`;
    const data = await request(path, {
      method: 'POST',
      body: { content, attachments, replyTo, stickerId },
    });
    if (data?.message) dispatch({ type: 'message:add', message: data.message });
    return data?.message;
  }, [state.view, state.channelId, request]);

  const reactTo = useCallback(async (message, emoji) => {
    const data = await request(`/messages/${message.id}/reactions`, { method: 'POST', body: { emoji } });
    if (data?.message) dispatch({ type: 'message:update', message: data.message });
  }, [request]);

  const editMessage = useCallback(async (messageId, content) => {
    const data = await request(`/messages/${messageId}`, { method: 'PATCH', body: { content } });
    if (data?.message) dispatch({ type: 'message:update', message: data.message });
  }, [request]);

  const deleteMessage = useCallback(async (message) => {
    await request(`/messages/${message.id}`, { method: 'DELETE' });
    dispatch({ type: 'message:delete', id: message.id, scopeType: message.scopeType, scopeId: message.scopeId });
  }, [request]);

  const notifyTyping = useCallback(() => {
    const scopeType = state.view.kind === 'dm' ? 'dm' : 'channel';
    const scopeId = state.view.kind === 'dm' ? state.view.id : state.channelId;
    if (!scopeId) return;
    socketRef.current?.emit('typing:start', { scopeType, scopeId });
  }, [state.view, state.channelId]);

  const value = useMemo(() => ({
    ...state,
    dispatch, toast, openModal, closeModal, request, refreshBootstrap, signOut,
    loadMessages, loadMembers, selectServer, selectChannel, selectDm,
    sendMessage, reactTo, editMessage, deleteMessage, notifyTyping,
    socket: socketRef,
  }), [
    state, toast, openModal, closeModal, request, refreshBootstrap, signOut, loadMessages,
    loadMembers, selectServer, selectChannel, selectDm, sendMessage, reactTo, editMessage,
    deleteMessage, notifyTyping,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp precisa estar dentro de AppProvider');
  return ctx;
}

export function useToast() {
  return useApp().toast;
}

export const bootWithToken = async (token) => {
  setToken(token);
  const data = await api('/me');
  return data;
};
