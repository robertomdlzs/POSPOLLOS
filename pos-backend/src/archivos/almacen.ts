import { Global, Injectable, Module } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { config } from '../config';

/** Prefijo con el que se sirven los archivos guardados (ver main.ts) */
export const PREFIJO_ARCHIVOS = '/api/archivos/';

/**
 * Dónde se guardan las fotos y demás archivos subidos. Hoy, en el disco del
 * servidor (ARCHIVOS_DIR). En producción con varias instancias hará falta un
 * almacenamiento S3-compatible: basta con otra clase con estos dos métodos.
 */
@Injectable()
export class AlmacenArchivos {
  private readonly raiz = resolve(config.archivosDir);

  /** Guarda el archivo y devuelve la URL pública con que se sirve */
  async guardar(ruta: string, contenido: Buffer): Promise<string> {
    const destino = this.dentro(ruta);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, contenido);
    return PREFIJO_ARCHIVOS + ruta;
  }

  /** Borra un archivo a partir de su URL pública; ignora URLs ajenas (fotos externas) */
  async borrar(url: string | null | undefined) {
    if (!url?.startsWith(PREFIJO_ARCHIVOS)) return;
    await unlink(this.dentro(url.slice(PREFIJO_ARCHIVOS.length))).catch(() => undefined);
  }

  /** Ruta absoluta dentro de la raíz; nunca afuera, aunque la ruta traiga "..". */
  private dentro(ruta: string) {
    const destino = normalize(join(this.raiz, ruta));
    if (!destino.startsWith(this.raiz)) throw new Error(`Ruta fuera del almacén: ${ruta}`);
    return destino;
  }
}

@Global()
@Module({ providers: [AlmacenArchivos], exports: [AlmacenArchivos] })
export class AlmacenModule {}
