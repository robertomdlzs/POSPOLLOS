import type { Rol, TipoServicio } from './tipos';

const formato = (decimales: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const copEnteros = formato(0);
const copCentavos = formato(2);

/** $ 25.000 sin centavos; si los hay, siempre con dos cifras: $ 25.000,50 */
export const pesos = (v: string | number) => {
  const n = Number(v);
  return (Number.isInteger(Math.round(n * 100) / 100) ? copEnteros : copCentavos).format(n);
};

/**
 * Lee un monto escrito a mano en formato colombiano y lo deja con dos decimales
 * como máximo: "25.000" y "25000" son 25000; "25.000,50", "25000,5" y "25000.5"
 * son 25000,50. Un punto seguido de grupos de tres cifras es separador de miles;
 * cualquier otro punto, o una coma, es la parte decimal. Lo que no sea número da 0.
 */
export function leerPesos(texto: string): number {
  let t = texto.replace(/[^\d.,]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.').replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Diferencia exacta entre dos montos, sin el ruido de los decimales en coma flotante */
export const restarPesos = (a: number, b: number) => (Math.round(a * 100) - Math.round(b * 100)) / 100;

export const cant = (v: string | number) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-CO', { maximumFractionDigits: 3 });
};

export const minutosDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

/**
 * crypto.randomUUID solo existe en contextos seguros (https o localhost).
 * Una tablet que entra por la IP de la red local no lo tiene, así que
 * se arma el UUID v4 a mano con getRandomValues, que sí está disponible.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const NOMBRE_ROL: Record<Rol, string> = {
  admin: 'Administración',
  supervisor: 'Supervisión',
  cajero: 'Caja',
  mesero: 'Salón',
  cocina: 'Cocina',
};

export const NOMBRE_SERVICIO: Record<TipoServicio, string> = {
  mesa: 'Mesa',
  mostrador: 'Mostrador',
  domicilio: 'Domicilio',
  para_llevar: 'Para llevar',
};

export const puedeCobrar = (rol: Rol) => rol === 'cajero' || rol === 'supervisor' || rol === 'admin';
export const esSupervisor = (rol: Rol) => rol === 'supervisor' || rol === 'admin';

/** Pitido corto para avisar una comanda nueva en cocina */
export function pitar() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gan = ctx.createGain();
    osc.frequency.value = 880;
    gan.gain.setValueAtTime(0.25, ctx.currentTime);
    gan.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gan).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    /* sin audio disponible */
  }
}
