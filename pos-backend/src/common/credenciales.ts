import { PERMISOS, type Permiso } from './permisos';

/**
 * Reglas para los PIN y contraseñas que se asignan. No se revisa que un PIN
 * sea único en la sede: responder "ese PIN ya lo usa alguien" le diría a quien
 * administra el PIN de otra persona. El ingreso por PIN no lo necesita, porque
 * primero se toca el nombre.
 */

/** Motivo por el que el PIN no sirve, o null si sirve */
export function problemaPin(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return 'El PIN debe tener entre 4 y 8 números';
  if (/^(\d)\1+$/.test(pin)) return 'El PIN no puede ser el mismo número repetido';
  const d = [...pin].map(Number);
  const pasos = d.slice(1).map((x, i) => x - d[i]);
  if (pasos.every((p) => p === 1) || pasos.every((p) => p === -1)) return 'El PIN no puede ser una secuencia como 1234 o 4321';
  // 1212, 252525…: dos cifras que se alternan
  if (pin.length >= 4 && [...pin].every((c, i) => c === pin[i % 2])) return 'El PIN no puede ser dos números que se alternan';
  return null;
}

/** Motivo por el que la contraseña no sirve, o null si sirve */
export function problemaContrasena(clave: string): string | null {
  if (clave.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (clave.length > 128) return 'La contraseña es demasiado larga';
  if (!/[a-zA-ZñÑáéíóúÁÉÍÓÚ]/.test(clave) || !/\d/.test(clave)) return 'La contraseña debe tener letras y números';
  return null;
}

/**
 * Permisos con los que se configura el restaurante. Quien tenga alguno entra
 * con correo y contraseña: un PIN de 4 cifras es poco para tanto poder.
 */
export const PERMISOS_DE_ADMINISTRACION = (Object.keys(PERMISOS) as Permiso[]).filter((p) => PERMISOS[p].grupo === 'Administración');

export const exigeContrasena = (permisos: readonly string[]) => PERMISOS_DE_ADMINISTRACION.some((p) => permisos.includes(p));
