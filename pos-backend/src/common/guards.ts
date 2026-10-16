import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ES_PUBLICO, PERMISOS_REQUERIDOS } from './decoradores';
import { esPermiso, type Permiso } from './permisos';
import { emitidoEn, RevocacionService } from './revocacion';
import type { UsuarioToken } from './tipos';

export function tokenAUsuario(p: any): UsuarioToken {
  return {
    id: p.sub,
    nombre: p.nombre,
    rolId: p.rolId,
    rol: p.rol,
    // Un token sin permisos (emitido antes de la migración 006) no puede hacer nada
    permisos: Array.isArray(p.permisos) ? p.permisos.filter(esPermiso) : [],
    empresaId: p.empresaId,
    sedeId: p.sedeId,
    sesionId: p.sid,
  };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly revocacion: RevocacionService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const [tipo, token] = String(req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Token requerido');
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }
    if (this.revocacion.estaRevocado(payload.sub, payload.sid, emitidoEn(payload))) {
      throw new UnauthorizedException('La sesión se cerró');
    }
    req.user = tokenAUsuario(payload);
    return true;
  }
}

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const requeridos = this.reflector.getAllAndOverride<Permiso[]>(PERMISOS_REQUERIDOS, [ctx.getHandler(), ctx.getClass()]);
    if (!requeridos?.length) return true;
    const usuario: UsuarioToken | undefined = ctx.switchToHttp().getRequest().user;
    if (!usuario) return true; // ruta pública
    if (requeridos.some((p) => usuario.permisos.includes(p))) return true;
    throw new ForbiddenException('Tu rol no tiene permiso para esta acción');
  }
}
