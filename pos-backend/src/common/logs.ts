import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { config } from '../config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Logs en JSON, una línea por petición, con un id que se devuelve en el
 * encabezado x-request-id para cruzar lo que ve el cliente con lo del servidor.
 * Nunca se escriben cuerpos de petición (ahí viajan PIN y contraseñas) ni tokens.
 */
export const opcionesLogs: Params = {
  pinoHttp: {
    level: config.logNivel,
    // En desarrollo, legible en la terminal; en producción, JSON para el monitoreo
    transport: config.logBonito ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } } : undefined,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const recibido = req.headers['x-request-id'];
      const id = typeof recibido === 'string' && UUID_RE.test(recibido) ? recibido : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // req.user lo pone el guard después de este middleware; al cerrar la petición ya está
    customProps: (req: any) =>
      req.user ? { usuario: req.user.id, rol: req.user.rol, sede: req.user.sedeId } : {},
    customLogLevel: (_req, res, error) =>
      error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    serializers: {
      req: (req: any) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress }),
      res: (res: any) => ({ statusCode: res.statusCode }),
    },
    // Por si algún día se agrega un serializador con encabezados o cuerpo
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.pin', '*.password', '*.refreshToken', '*.accessToken'],
      censor: '[oculto]',
    },
  },
};
