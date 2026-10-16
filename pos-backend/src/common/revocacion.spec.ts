import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitidoEn, RevocacionService } from './revocacion';

const ahora = () => Date.now();

describe('RevocacionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('una sesión cerrada invalida sus tokens, no los de otras sesiones', () => {
    const r = new RevocacionService();
    const emitido = ahora();
    r.revocar({ tipo: 'sesion', id: 's1' });
    expect(r.estaRevocado('u1', 's1', emitido)).toBe(true);
    expect(r.estaRevocado('u1', 's2', emitido)).toBe(false);
  });

  it('revocar al usuario invalida todas sus sesiones, no las de otros', () => {
    const r = new RevocacionService();
    const emitido = ahora();
    r.revocar({ tipo: 'usuario', id: 'u1' });
    expect(r.estaRevocado('u1', 's1', emitido)).toBe(true);
    expect(r.estaRevocado('u1', undefined, emitido)).toBe(true);
    expect(r.estaRevocado('u2', 's9', emitido)).toBe(false);
  });

  it('un token emitido después de la revocación sí sirve', () => {
    vi.useFakeTimers();
    const r = new RevocacionService();
    r.revocar({ tipo: 'usuario', id: 'u1' });
    vi.advanceTimersByTime(5_000);
    expect(r.estaRevocado('u1', 's1', ahora())).toBe(false);
  });

  it('avisa a quien escucha', () => {
    const r = new RevocacionService();
    const oyente = vi.fn();
    r.alRevocar(oyente);
    r.revocar({ tipo: 'sesion', id: 's1' });
    expect(oyente).toHaveBeenCalledWith({ tipo: 'sesion', id: 's1' });
  });

  it('quien vuelve a entrar en el mismo segundo de la revocación no queda revocado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00.100Z'));
    const r = new RevocacionService();
    r.revocar({ tipo: 'usuario', id: 'u1' });
    vi.setSystemTime(new Date('2026-10-16T12:00:00.400Z'));
    expect(r.estaRevocado('u1', 's2', ahora())).toBe(false);
  });

  it('los tokens viejos sin emi se comparan por iat', () => {
    expect(emitidoEn({ iat: 1_700_000_000 })).toBe(1_700_000_000_000);
    expect(emitidoEn({ emi: 1_700_000_000_123, iat: 1_700_000_000 })).toBe(1_700_000_000_123);
  });

  it('olvida las revocaciones más viejas que un access token', () => {
    vi.useFakeTimers();
    const r = new RevocacionService();
    const emitidoViejo = ahora();
    r.revocar({ tipo: 'usuario', id: 'u1' });
    vi.advanceTimersByTime((900 + 120) * 1000);
    r.revocar({ tipo: 'usuario', id: 'u2' }); // la limpieza ocurre al escribir
    // u1 ya salió de la lista; su token viejo de todas formas venció por su exp
    expect(r.estaRevocado('u1', 's1', emitidoViejo)).toBe(false);
  });
});
