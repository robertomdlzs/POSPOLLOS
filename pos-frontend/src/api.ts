import type { Sesion } from './tipos';

/** En producción se puede apuntar a otro servidor con VITE_API_URL */
export const BASE = import.meta.env.VITE_API_URL ?? '';
const CLAVE = 'pos.sesion';

export class ApiError extends Error {
  constructor(
    public status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

// ---------------------------------------------------------------------------
// Sesión: el refresh token se guarda en este dispositivo para sobrevivir a
// una recarga; el access token dura 15 minutos y se renueva solo.
// ---------------------------------------------------------------------------

function leerGuardada(): Sesion | null {
  try {
    const t = localStorage.getItem(CLAVE);
    return t ? (JSON.parse(t) as Sesion) : null;
  } catch {
    return null;
  }
}

let sesion: Sesion | null = leerGuardada();
const oyentes = new Set<(s: Sesion | null) => void>();

export const obtenerSesion = () => sesion;

export function fijarSesion(s: Sesion | null) {
  sesion = s;
  try {
    if (s) localStorage.setItem(CLAVE, JSON.stringify(s));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* almacenamiento no disponible: la sesión vive solo en memoria */
  }
  oyentes.forEach((f) => f(s));
}

export function alCambiarSesion(f: (s: Sesion | null) => void) {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

// ---------------------------------------------------------------------------

async function pedir(metodo: string, ruta: string, body: unknown, token?: string) {
  try {
    return await fetch(`${BASE}/api${ruta}`, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor');
  }
}

let refrescando: Promise<boolean> | null = null;

/** Renueva los tokens. Varias peticiones simultáneas comparten un solo refresh. */
export function refrescar(): Promise<boolean> {
  if (!refrescando) {
    refrescando = (async () => {
      const actual = sesion;
      if (!actual) return false;
      try {
        const r = await pedir('POST', '/auth/refresh', { refreshToken: actual.refreshToken });
        if (!r.ok) {
          fijarSesion(null);
          return false;
        }
        fijarSesion((await r.json()) as Sesion);
        return true;
      } catch {
        return false; // sin red: se conserva la sesión para reintentar
      }
    })().finally(() => {
      refrescando = null;
    });
  }
  return refrescando;
}

export async function api<T = unknown>(metodo: string, ruta: string, body?: unknown): Promise<T> {
  let r = await pedir(metodo, ruta, body, sesion?.accessToken);
  if (r.status === 401 && sesion && !ruta.startsWith('/auth/')) {
    if (await refrescar()) r = await pedir(metodo, ruta, body, sesion?.accessToken);
  }
  const texto = await r.text();
  let datos: any = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }
  if (!r.ok) {
    const m = datos?.message;
    throw new ApiError(r.status, Array.isArray(m) ? m.join('. ') : (m ?? `El servidor respondió ${r.status}`));
  }
  return datos as T;
}

export function mensajeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Demasiados intentos seguidos. Espera un minuto.';
    return e.message;
  }
  return 'Ocurrió un error inesperado';
}

export async function cerrarSesion() {
  const s = sesion;
  fijarSesion(null);
  if (s) await pedir('POST', '/auth/logout', { refreshToken: s.refreshToken }).catch(() => undefined);
}
