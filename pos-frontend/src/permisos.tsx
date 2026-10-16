import { createContext, useContext, type ReactNode } from 'react';

/**
 * Códigos de permiso; los mismos de pos-backend/src/common/permisos.ts, que es
 * donde se decide de verdad. Aquí solo sirven para mostrar u ocultar lo que
 * cada quien puede usar.
 */
export type Permiso =
  | 'pedido.tomar'
  | 'pedido.anular_enviado'
  | 'cocina.operar'
  | 'caja.operar'
  | 'caja.retiro'
  | 'caja.ver_esperado'
  | 'venta.cobrar'
  | 'venta.descuento'
  | 'venta.anular'
  | 'inventario.ver'
  | 'menu.editar'
  | 'salon.editar'
  | 'usuario.editar'
  | 'rol.editar'
  | 'config.editar'
  | 'reporte.ver'
  | 'auditoria.ver';

const Contexto = createContext<readonly Permiso[]>([]);

export function ProveedorPermisos({ permisos, children }: { permisos: readonly Permiso[]; children: ReactNode }) {
  return <Contexto.Provider value={permisos}>{children}</Contexto.Provider>;
}

/** `puede('venta.cobrar')`: ¿la sesión actual tiene ese permiso? */
export function usePuede() {
  const permisos = useContext(Contexto);
  return (p: Permiso) => permisos.includes(p);
}
