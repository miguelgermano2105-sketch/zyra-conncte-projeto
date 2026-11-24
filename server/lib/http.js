export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg, code = 'bad_request') => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Sessão inválida ou expirada.', code = 'unauthorized') =>
  new HttpError(401, code, msg);
export const forbidden = (msg = 'Você não tem permissão para isso.', code = 'forbidden') =>
  new HttpError(403, code, msg);
export const notFound = (msg = 'Não encontrado.', code = 'not_found') => new HttpError(404, code, msg);
export const conflict = (msg, code = 'conflict') => new HttpError(409, code, msg);
export const tooMany = (msg = 'Muitas tentativas. Aguarde um instante.', code = 'rate_limited') =>
  new HttpError(429, code, msg);

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function assert(cond, error) {
  if (!cond) throw error;
  return cond;
}
