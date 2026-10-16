import 'dotenv/config';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
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
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
