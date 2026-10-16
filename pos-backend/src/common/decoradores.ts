import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permiso } from './permisos';
import type { UsuarioToken } from './tipos';

export const ES_PUBLICO = 'esPublico';
/** La ruta no exige token */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export const PERMISOS_REQUERIDOS = 'permisosRequeridos';
/** La ruta exige alguno de estos permisos (el admin los tiene todos) */
export const RequierePermiso = (...permisos: Permiso[]) => SetMetadata(PERMISOS_REQUERIDOS, permisos);

export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioToken => ctx.switchToHttp().getRequest().user,
);
