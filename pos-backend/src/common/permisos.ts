/**
 * Catálogo de permisos: qué acciones existen en el sistema. Un rol es una
 * lista de estos códigos (tabla rol_permiso). La descripción y el grupo son
 * los que ve el administrador al editar un rol.
 *
 * Agregar un permiso aquí no se lo da a nadie salvo al admin, que siempre
 * tiene todos. Para dárselo a un rol de fábrica, hace falta una migración.
 */
export const PERMISOS = {
  'pedido.tomar': {
    grupo: 'Salón',
    descripcion: 'Ver las mesas, tomar pedidos, enviarlos a cocina y quitar lo que aún no sale a cocina',
  },
  'pedido.anular_enviado': {
    grupo: 'Salón',
    descripcion: 'Anular productos que ya están en cocina, o aprobar con su PIN que otro lo haga',
  },
  'cocina.operar': {
    grupo: 'Cocina',
    descripcion: 'Ver la pantalla de cocina y marcar los platos en preparación, listos o entregados',
  },
  'caja.operar': {
    grupo: 'Caja',
    descripcion: 'Abrir y cerrar turnos de caja y registrar ingresos de efectivo',
  },
  'caja.retiro': {
    grupo: 'Caja',
    descripcion: 'Retirar efectivo de la caja, o aprobar con su PIN que otro lo haga',
  },
  'caja.ver_esperado': {
    grupo: 'Caja',
    descripcion: 'Ver cuánto efectivo debería haber antes de cerrar (sin esto, el cierre es a ciegas)',
  },
  'venta.cobrar': {
    grupo: 'Caja',
    descripcion: 'Cobrar pedidos',
  },
  'venta.descuento': {
    grupo: 'Caja',
    descripcion: 'Aplicar descuentos, o aprobar con su PIN que otro los aplique',
  },
  'venta.anular': {
    grupo: 'Caja',
    descripcion: 'Aprobar con su PIN la anulación de una venta',
  },
  'inventario.ver': {
    grupo: 'Inventario',
    descripcion: 'Ver el stock de insumos',
  },
  'menu.editar': {
    grupo: 'Administración',
    descripcion: 'Crear y editar productos, categorías, modificadores y precios',
  },
  'salon.editar': {
    grupo: 'Administración',
    descripcion: 'Configurar zonas, mesas, cajas y estaciones de cocina',
  },
  'usuario.editar': {
    grupo: 'Administración',
    descripcion: 'Crear usuarios, cambiar su PIN y asignarles un rol',
  },
  'rol.editar': {
    grupo: 'Administración',
    descripcion: 'Crear roles y decidir qué puede hacer cada uno',
  },
  'config.editar': {
    grupo: 'Administración',
    descripcion: 'Cambiar la configuración del restaurante',
  },
  'reporte.ver': {
    grupo: 'Reportes',
    descripcion: 'Ver reportes de ventas y el cierre del día',
  },
  'auditoria.ver': {
    grupo: 'Reportes',
    descripcion: 'Consultar la bitácora de auditoría',
  },
} as const satisfies Record<string, { grupo: string; descripcion: string }>;

export type Permiso = keyof typeof PERMISOS;

export const TODOS_LOS_PERMISOS = Object.keys(PERMISOS) as Permiso[];

export const esPermiso = (p: string): p is Permiso => p in PERMISOS;

/** Clave del rol de fábrica que tiene todos los permisos */
export const CLAVE_ADMIN = 'admin';

/**
 * Permisos efectivos de un rol: todos si es el admin; si no, los guardados que
 * sigan existiendo en el catálogo (un permiso retirado del código deja de valer).
 */
export function permisosDeRol(clave: string | null, guardados: string[]): Permiso[] {
  if (clave === CLAVE_ADMIN) return [...TODOS_LOS_PERMISOS];
  return guardados.filter(esPermiso);
}
