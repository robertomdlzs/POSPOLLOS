import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { ES_PUBLICO, PERMISOS_REQUERIDOS } from './decoradores';
import { JwtAuthGuard, PermisosGuard } from './guards';
import { RevocacionService } from './revocacion';

const jwt = new JwtService({ secret: 'secreto-solo-para-pruebas-unitarias-0123456789' });

function contexto(req: any, metadatos: Record<string, unknown> = {}): ExecutionContext {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(metadatos)) Reflect.defineMetadata(k, v, handler);
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const firmar = (extra: object = {}) =>
  jwt.sign({ sub: 'u1', nombre: 'Ana', rolId: 'r1', rol: 'Caja', permisos: ['venta.cobrar'], empresaId: 'e1', sedeId: 'sd1', sid: 's1', ...extra });
const conToken = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe('JwtAuthGuard', () => {
  const nuevo = (revocacion = new RevocacionService()) => new JwtAuthGuard(new Reflector(), jwt, revocacion);

  it('deja pasar las rutas públicas sin token', () => {
    expect(nuevo().canActivate(contexto({ headers: {} }, { [ES_PUBLICO]: true }))).toBe(true);
  });

  it('rechaza sin token, con otro esquema o con un token firmado con otro secreto', () => {
    const g = nuevo();
    expect(() => g.canActivate(contexto({ headers: {} }))).toThrow(UnauthorizedException);
    expect(() => g.canActivate(contexto({ headers: { authorization: `Basic ${firmar()}` } }))).toThrow(UnauthorizedException);
    const ajeno = new JwtService({ secret: 'otro-secreto-de-mas-de-treinta-y-dos-caracteres' }).sign({ sub: 'u1' });
    expect(() => g.canActivate(contexto(conToken(ajeno)))).toThrow(UnauthorizedException);
  });

  it('deja el usuario del token en req.user', () => {
    const req: any = conToken(firmar());
    expect(nuevo().canActivate(contexto(req))).toBe(true);
    expect(req.user).toEqual({
      id: 'u1',
      nombre: 'Ana',
      rolId: 'r1',
      rol: 'Caja',
      permisos: ['venta.cobrar'],
      empresaId: 'e1',
      sedeId: 'sd1',
      sesionId: 's1',
    });
  });

  it('descarta permisos que no existen en el catálogo y un token viejo sin permisos no tiene ninguno', () => {
    const req: any = conToken(firmar({ permisos: ['venta.cobrar', 'todo.poderoso'] }));
    nuevo().canActivate(contexto(req));
    expect(req.user.permisos).toEqual(['venta.cobrar']);
    const viejo: any = conToken(firmar({ permisos: undefined }));
    nuevo().canActivate(contexto(viejo));
    expect(viejo.user.permisos).toEqual([]);
  });

  it('rechaza el token de una sesión revocada', () => {
    const revocacion = new RevocacionService();
    const token = firmar();
    revocacion.revocar({ tipo: 'sesion', id: 's1' });
    expect(() => nuevo(revocacion).canActivate(contexto(conToken(token)))).toThrow('La sesión se cerró');
  });
});

describe('PermisosGuard', () => {
  const g = new PermisosGuard(new Reflector());
  const con = (permisos: string[], requeridos?: string[]) =>
    contexto({ user: { permisos } }, requeridos ? { [PERMISOS_REQUERIDOS]: requeridos } : {});

  it('sin permisos declarados deja pasar a cualquiera con sesión', () => {
    expect(g.canActivate(con([]))).toBe(true);
  });

  it('deja pasar a quien tiene alguno de los permisos pedidos', () => {
    expect(g.canActivate(con(['caja.operar', 'venta.cobrar'], ['venta.cobrar']))).toBe(true);
    expect(g.canActivate(con(['pedido.tomar'], ['venta.cobrar', 'pedido.tomar']))).toBe(true);
  });

  it('rechaza con 403 a quien no tiene ninguno', () => {
    expect(() => g.canActivate(con(['pedido.tomar'], ['caja.operar']))).toThrow(ForbiddenException);
  });
});
