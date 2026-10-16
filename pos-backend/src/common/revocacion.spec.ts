import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevocacionService } from './revocacion';

const segundos = () => Math.floor(Date.now() / 1000);

describe('RevocacionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('una sesión cerrada invalida sus tokens, no los de otras sesiones', () => {
    const r = new RevocacionService();
    const iat = segundos();
    r.revocar({ tipo: 'sesion', id: 's1' });
    expect(r.estaRevocado('u1', 's1', iat)).toBe(true);
    expect(r.estaRevocado('u1', 's2', iat)).toBe(false);
  });

  it('revocar al usuario invalida todas sus sesiones, no las de otros', () => {
    const r = new RevocacionService();
    const iat = segundos();
    r.revocar({ tipo: 'usuario', id: 'u1' });
    expect(r.estaRevocado('u1', 's1', iat)).toBe(true);
    expect(r.estaRevocado('u1', undefined, iat)).toBe(true);
    expect(r.estaRevocado('u2', 's9', iat)).toBe(false);
  });

  it('un token emitido después de la revocación sí sirve', () => {
    vi.useFakeTimers();
    const r = new RevocacionService();
    r.revocar({ tipo: 'usuario', id: 'u1' });
    vi.advanceTimersByTime(5_000);
    expect(r.estaRevocado('u1', 's1', segundos())).toBe(false);
  });

  it('avisa a quien escucha', () => {
    const r = new RevocacionService();
    const oyente = vi.fn();
    r.alRevocar(oyente);
    r.revocar({ tipo: 'sesion', id: 's1' });
    expect(oyente).toHaveBeenCalledWith({ tipo: 'sesion', id: 's1' });
  });

  it('olvida las revocaciones más viejas que un access token', () => {
    vi.useFakeTimers();
    const r = new RevocacionService();
    const iatViejo = segundos();
    r.revocar({ tipo: 'usuario', id: 'u1' });
    vi.advanceTimersByTime((900 + 120) * 1000);
    r.revocar({ tipo: 'usuario', id: 'u2' }); // la limpieza ocurre al escribir
    // u1 ya salió de la lista; su token viejo de todas formas venció por su exp
    expect(r.estaRevocado('u1', 's1', iatViejo)).toBe(false);
  });
});
