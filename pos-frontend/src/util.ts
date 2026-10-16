import { useCallback, useEffect, useRef, useState } from 'react';
import { mensajeError } from './api';
import type { Rol, TipoServicio } from './tipos';

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const pesos = (v: string | number) => cop.format(Number(v));

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

/** Carga datos con estado de carga/error y una función para recargar */
export function useDatos<T>(cargar: () => Promise<T>, deps: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const fn = useRef(cargar);
  fn.current = cargar;

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await fn.current());
      setError(null);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { datos, error, cargando, recargar, setDatos };
}

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
