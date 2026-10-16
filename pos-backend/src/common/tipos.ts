export const ROLES = ['admin', 'supervisor', 'cajero', 'mesero', 'cocina'] as const;
export type Rol = (typeof ROLES)[number];

/** Lo que viaja dentro del access token y queda en req.user */
export interface UsuarioToken {
  id: string;
  nombre: string;
  rol: Rol;
  empresaId: string;
  sedeId: string;
}

export const TIPOS_SERVICIO = ['mesa', 'mostrador', 'domicilio', 'para_llevar'] as const;
export const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata', 'otro'] as const;
export const ESTADOS_ITEM_COCINA = ['preparando', 'listo', 'entregado'] as const;
