import { Global, Injectable, Module } from '@nestjs/common';
import { config } from '../config';

export type Revocacion = { tipo: 'usuario' | 'sesion'; id: string };

/**
 * Lista de usuarios y sesiones revocados, para que un access token deje de
 * servir al momento y no hasta que venza (15 minutos). Basta con recordar cada
 * revocación lo que dura un access token: pasado ese tiempo, cualquier token
 * emitido antes ya venció solo.
 *
 * Vive en memoria: con varias instancias del backend habrá que pasarla a Redis
 * (fase 10 del plan).
 */
@Injectable()
export class RevocacionService {
  /** clave "usuario:<id>" o "sesion:<id>" → momento de la revocación, en ms */
  private readonly revocados = new Map<string, number>();
  private readonly oyentes = new Set<(r: Revocacion) => void>();

  revocar(r: Revocacion) {
    this.limpiar();
    this.revocados.set(`${r.tipo}:${r.id}`, Date.now());
    this.oyentes.forEach((f) => f(r));
  }

  /** ¿El token de este usuario y esta sesión, emitido en `iat` (segundos), quedó revocado? */
  estaRevocado(usuarioId: string, sesionId: string | undefined, iat: number): boolean {
    // iat va en segundos: un token emitido en el mismo segundo de la revocación
    // también cae, que es el lado seguro
    const emitido = iat * 1000;
    const antesDe = (clave: string) => {
      const t = this.revocados.get(clave);
      return t !== undefined && emitido <= t;
    };
    return antesDe(`usuario:${usuarioId}`) || (!!sesionId && antesDe(`sesion:${sesionId}`));
  }

  /** Avisa cada revocación, para cortar las conexiones en tiempo real abiertas */
  alRevocar(f: (r: Revocacion) => void) {
    this.oyentes.add(f);
  }

  private limpiar() {
    const limite = Date.now() - (config.accessTtlSegundos + 60) * 1000;
    for (const [clave, t] of this.revocados) if (t < limite) this.revocados.delete(clave);
  }
}

@Global()
@Module({ providers: [RevocacionService], exports: [RevocacionService] })
export class RevocacionModule {}
