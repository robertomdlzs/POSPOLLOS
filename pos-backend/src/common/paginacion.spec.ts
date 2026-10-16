import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { codificarCursor, condicionCursor, leerCursor, limiteConsulta, paginar } from './paginacion';

const ID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const FECHA = '2026-10-16 12:00:00.123456-05';
const fila = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, cursor_fecha: FECHA, n });

describe('cursor', () => {
  it('va y vuelve sin perder los microsegundos', () => {
    expect(leerCursor(codificarCursor({ fecha: FECHA, id: ID }))).toEqual({ fecha: FECHA, id: ID });
  });

  it('rechaza con 400 un cursor manipulado', () => {
    for (const malo of ['basura', codificarCursor({ fecha: 'ayer', id: ID }), codificarCursor({ fecha: FECHA, id: "x'; DROP" })]) {
      expect(() => leerCursor(malo)).toThrow(BadRequestException);
    }
  });
});

describe('condicionCursor', () => {
  it('en la primera página no agrega nada', () => {
    const params: unknown[] = ['sede'];
    expect(condicionCursor(undefined, 'v.creado_en', 'v.id', params)).toBe('');
    expect(params).toEqual(['sede']);
  });

  it('agrega la condición con parámetros numerados, nunca el valor en el SQL', () => {
    const params: unknown[] = ['sede'];
    const sql = condicionCursor(codificarCursor({ fecha: FECHA, id: ID }), 'v.creado_en', 'v.id', params);
    expect(sql).toBe('AND (v.creado_en, v.id) < ($2::timestamptz, $3::uuid)');
    expect(params).toEqual(['sede', FECHA, ID]);
  });
});

describe('paginar', () => {
  it('pide una fila de más y usa 50 por defecto', () => {
    expect(limiteConsulta({})).toBe(51);
    expect(limiteConsulta({ limite: 10 })).toBe(11);
  });

  it('con una fila de más, corta y da el cursor de la última de la página', () => {
    const p = paginar([fila(1), fila(2), fila(3)], { limite: 2 });
    expect(p.datos.map((d) => d.n)).toEqual([1, 2]);
    expect(p.datos[0]).not.toHaveProperty('cursor_fecha');
    expect(leerCursor(p.siguiente!)).toEqual({ fecha: FECHA, id: fila(2).id });
  });

  it('sin fila de más, es la última página', () => {
    expect(paginar([fila(1), fila(2)], { limite: 2 }).siguiente).toBeNull();
    expect(paginar([], { limite: 2 })).toEqual({ datos: [], siguiente: null });
  });
});
