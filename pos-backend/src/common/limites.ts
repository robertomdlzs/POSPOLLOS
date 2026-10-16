import { SetMetadata } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';

const ES_INGRESO = 'esIngreso';
/** Ruta de ingreso (PIN o contraseña): además del límite por IP, lleva uno por usuario */
export const RutaIngreso = () => SetMetadata(ES_INGRESO, true);

const ipDe = (req: any): string => (req.ips?.length ? req.ips[0] : req.ip) ?? '';

/** Intentos de ingreso permitidos por minuto desde una IP, sumando todos los usuarios */
export const INGRESOS_POR_IP = 60;

export const LIMITES: ThrottlerOptions[] = [
  // General por IP. Detrás de un NAT esa IP es todo el restaurante, por eso es holgado
  { name: 'default', ttl: 60_000, limit: 300 },
  // 10 intentos por minuto para cada usuario desde una misma IP. Así el cambio de
  // turno, con todo el personal entrando a la vez, no se frena; y cada cuenta sigue
  // protegida por el bloqueo tras 5 PIN errados.
  {
    name: 'ingreso',
    ttl: 60_000,
    limit: 10,
    skipIf: (ctx) => !Reflect.getMetadata(ES_INGRESO, ctx.getHandler()),
    getTracker: (req: any) => `${ipDe(req)}|${String(req.body?.usuarioId ?? req.body?.email ?? '').toLowerCase()}`,
  },
];
