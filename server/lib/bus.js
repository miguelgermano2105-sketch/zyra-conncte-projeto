let io = null;

export const setIO = (server) => { io = server; };
export const getIO = () => io;

const room = (type, id) => `${type}:${id}`;

export function toUser(userId, event, payload) {
  io?.to(room('user', userId)).emit(event, payload);
}
export function toServer(serverId, event, payload) {
  io?.to(room('server', serverId)).emit(event, payload);
}
export function toScope(scopeType, scopeId, event, payload) {
  io?.to(room(scopeType, scopeId)).emit(event, payload);
}
export function toChannel(channelId, event, payload) {
  io?.to(room('channel', channelId)).emit(event, payload);
}
export function toDm(dmId, event, payload) {
  io?.to(room('dm', dmId)).emit(event, payload);
}
export function toAll(event, payload) {
  io?.emit(event, payload);
}
export function socketsOfUser(userId) {
  return io?.sockets.adapter.rooms.get(room('user', userId))?.size || 0;
}
export const roomName = room;
