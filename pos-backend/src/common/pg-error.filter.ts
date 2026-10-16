import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** Traduce errores de PostgreSQL a respuestas HTTP claras en vez de un 500 */
const MAPA: Record<string, [number, string]> = {
  '23505': [409, 'El registro ya existe o está duplicado'],
  '23503': [400, 'Referencia a un registro que no existe'],
  '23514': [400, 'Los datos no cumplen las reglas del sistema'],
  '22P02': [400, 'Formato de dato inválido'],
};

@Catch()
export class PgErrorFilter extends BaseExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    if (!(error instanceof HttpException) && typeof error?.code === 'string' && MAPA[error.code]) {
      const [status, mensaje] = MAPA[error.code];
      return super.catch(new HttpException(mensaje, status), host);
    }
    return super.catch(error, host);
  }
}
