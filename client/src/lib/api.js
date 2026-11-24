const KEY = 'zyra.session';

export function getToken() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch { /* modo privado */ }
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: payload, signal });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua rede.', 'network_error', 0);
  }

  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  if (!response.ok) {
    const message = data?.error?.message || `Falha na requisição (${response.status}).`;
    throw new ApiError(message, data?.error?.code || 'request_failed', response.status);
  }
  return data;
}

export async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  return api('/uploads', { method: 'POST', body: form });
}

export const isAdmin = (user) => Boolean(user?.isAdmin);
