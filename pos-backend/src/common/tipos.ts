import type { Permiso } from './permisos';

/** Lo que viaja dentro del access token y queda en req.user */
export interface UsuarioToken {
  id: string;
  nombre: string;
  rolId: string;
  /** Nombre del rol en la sede, para mostrar y para los logs */
  rol: string;
  /** Lo que puede hacer en la sede: es lo único que se revisa para autorizar */
  permisos: Permiso[];
  empresaId: string;
  sedeId: string;
  /** Sesión (refresh token) de la que salió el token; sirve para revocarla al cerrar sesión */
  sesionId?: string;
}

export const TIPOS_SERVICIO = ['mesa', 'mostrador', 'domicilio', 'para_llevar'] as const;
export const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata', 'otro'] as const;
export const ESTADOS_ITEM_COCINA = ['preparando', 'listo', 'entregado'] as const;
