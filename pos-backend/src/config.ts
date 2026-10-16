import 'dotenv/config';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

/**
 * Cuántos proxies hay delante (Nginx, Caddy, balanceador). Sin esto, detrás de
 * un proxy todas las peticiones parecen venir de la misma IP y comparten el
 * límite. Acepta "true", un número de saltos o una lista de IP/subredes.
 */
function leerTrustProxy(valor: string | undefined): boolean | number | string {
  if (!valor || valor === 'false') return false;
  if (valor === 'true') return true;
  return /^\d+$/.test(valor) ? Number(valor) : valor;
}

const jwtSecret = requerida('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  jwtSecret,
  /** Vida del access token, en segundos (15 min por defecto) */
  accessTtlSegundos: Number(process.env.ACCESS_TTL_SECONDS ?? 900),
  /** Vida del refresh token, en días */
  refreshTtlDias: Number(process.env.REFRESH_TTL_DAYS ?? 7),
  trustProxy: leerTrustProxy(process.env.TRUST_PROXY),
  /** Documentación OpenAPI en /api/docs. Apagada en producción salvo que se pida */
  docsApi: (process.env.DOCS_API ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  /** trace, debug, info, warn, error */
  logNivel: process.env.LOG_NIVEL ?? 'info',
  /** Logs legibles en la terminal (pino-pretty, solo desarrollo) en vez de JSON */
  logBonito: (process.env.LOG_BONITO ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
