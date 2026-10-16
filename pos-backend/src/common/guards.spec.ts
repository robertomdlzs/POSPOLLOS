import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { ES_PUBLICO, ROLES_PERMITIDOS } from './decoradores';
import { JwtAuthGuard, RolesGuard } from './guards';
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

const firmar = () => jwt.sign({ sub: 'u1', nombre: 'Ana', rol: 'cajero', empresaId: 'e1', sedeId: 'sd1', sid: 's1' });
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
    expect(req.user).toEqual({ id: 'u1', nombre: 'Ana', rol: 'cajero', empresaId: 'e1', sedeId: 'sd1', sesionId: 's1' });
  });

  it('rechaza el token de una sesión revocada', () => {
    const revocacion = new RevocacionService();
    const token = firmar();
    revocacion.revocar({ tipo: 'sesion', id: 's1' });
    expect(() => nuevo(revocacion).canActivate(contexto(conToken(token)))).toThrow('La sesión se cerró');
  });
});

describe('RolesGuard', () => {
  const g = new RolesGuard(new Reflector());
  const con = (rol: string, permitidos?: string[]) =>
    contexto({ user: { rol } }, permitidos ? { [ROLES_PERMITIDOS]: permitidos } : {});

  it('sin roles declarados deja pasar a cualquiera con sesión', () => {
    expect(g.canActivate(con('cocina'))).toBe(true);
  });

  it('deja pasar los roles permitidos y al admin', () => {
    expect(g.canActivate(con('cajero', ['cajero', 'supervisor']))).toBe(true);
    expect(g.canActivate(con('admin', ['cajero']))).toBe(true);
  });

  it('rechaza los demás roles con 403', () => {
    expect(() => g.canActivate(con('mesero', ['cajero']))).toThrow(ForbiddenException);
  });
});
