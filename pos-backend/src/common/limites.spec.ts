import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { LIMITES, RutaIngreso } from './limites';

const ingreso = LIMITES.find((l) => l.name === 'ingreso')!;
const ctx = {} as ExecutionContext;

function contextoDe(...decoradores: MethodDecorator[]) {
  class C {
    metodo() {}
  }
  const d = Object.getOwnPropertyDescriptor(C.prototype, 'metodo')!;
  for (const dec of decoradores) dec(C.prototype, 'metodo', d);
  return { getHandler: () => d.value } as unknown as ExecutionContext;
}

describe('límite de ingreso', () => {
  it('solo aplica a las rutas marcadas con @RutaIngreso', () => {
    expect(ingreso.skipIf!(contextoDe(RutaIngreso()))).toBe(false);
    expect(ingreso.skipIf!(contextoDe())).toBe(true);
  });

  it('cuenta por IP y usuario, sin distinguir mayúsculas en el correo', async () => {
    const tracker = ingreso.getTracker!;
    expect(await tracker({ ip: '10.0.0.5', ips: [], body: { usuarioId: 'abc' } }, ctx)).toBe('10.0.0.5|abc');
    expect(await tracker({ ip: '127.0.0.1', ips: ['190.1.2.3'], body: { email: 'Admin@Demo.co' } }, ctx)).toBe(
      '190.1.2.3|admin@demo.co',
    );
  });

  it('dos usuarios desde la misma IP no comparten el contador', async () => {
    const tracker = ingreso.getTracker!;
    const a = await tracker({ ip: '10.0.0.5', body: { usuarioId: 'a' } }, ctx);
    const b = await tracker({ ip: '10.0.0.5', body: { usuarioId: 'b' } }, ctx);
    expect(a).not.toBe(b);
  });
});
