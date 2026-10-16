import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Rol, UsuarioToken } from './tipos';

export const ES_PUBLICO = 'esPublico';
/** La ruta no exige token */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export const ROLES_PERMITIDOS = 'rolesPermitidos';
/** Roles que pueden usar la ruta (admin siempre puede) */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES_PERMITIDOS, roles);

export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioToken => ctx.switchToHttp().getRequest().user,
);
