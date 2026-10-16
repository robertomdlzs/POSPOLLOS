/**
 * Todo el dinero se calcula en centavos (enteros) para evitar errores de
 * punto flotante. PostgreSQL devuelve numeric como string.
 */
export const aCentavos = (v: string | number): number => Math.round(Number(v) * 100);
export const aPesos = (c: number): string => (c / 100).toFixed(2);

export interface LineaCobrable {
  precio_unitario: string;
  extras: string;
  cantidad: string;
  tasa_impuesto: string;
}

/**
 * Los precios del menú son finales (impuesto incluido), así que se
 * desglosa: base = bruto / (1 + tasa).
 */
export function calcularTotales(lineas: LineaCobrable[]) {
  let subtotal = 0;
  let impuestos = 0;
  for (const l of lineas) {
    const bruto = Math.round((aCentavos(l.precio_unitario) + aCentavos(l.extras)) * Number(l.cantidad));
    const base = Math.round(bruto / (1 + Number(l.tasa_impuesto) / 100));
    subtotal += base;
    impuestos += bruto - base;
  }
  return { subtotal, impuestos, bruto: subtotal + impuestos };
}
