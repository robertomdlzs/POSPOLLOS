import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ES_PUBLICO, ROLES_PERMITIDOS } from './decoradores';
import { Rol, UsuarioToken } from './tipos';

export function tokenAUsuario(p: any): UsuarioToken {
  return { id: p.sub, nombre: p.nombre, rol: p.rol, empresaId: p.empresaId, sedeId: p.sedeId };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const [tipo, token] = String(req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Token requerido');
    try {
      req.user = tokenAUsuario(this.jwt.verify(token));
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const roles = this.reflector.getAllAndOverride<Rol[]>(ROLES_PERMITIDOS, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const usuario: UsuarioToken | undefined = ctx.switchToHttp().getRequest().user;
    if (!usuario) return true; // ruta pública
    if (usuario.rol === 'admin' || roles.includes(usuario.rol)) return true;
    throw new ForbiddenException('Tu rol no tiene permiso para esta acción');
  }
}
