import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISOS, TODOS_LOS_PERMISOS, permisosDeRol } from './permisos';

const MIGRACIONES = join(__dirname, '..', '..', 'db', 'migraciones');

describe('catálogo de permisos', () => {
  it('cada permiso tiene grupo y descripción', () => {
    for (const [codigo, p] of Object.entries(PERMISOS)) {
      expect(codigo).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(p.grupo.length).toBeGreaterThan(0);
      expect(p.descripcion.length).toBeGreaterThan(10);
    }
  });

  it('todo permiso que las migraciones dan a un rol existe en el catálogo', () => {
    const sql = readdirSync(MIGRACIONES)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(MIGRACIONES, f), 'utf8'))
      .join('\n');
    const usados = [...sql.matchAll(/ARRAY\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((x) => x[1]));
    expect(usados.length).toBeGreaterThan(0);
    expect(usados.filter((p) => !(p in PERMISOS))).toEqual([]);
  });
});

describe('catálogo del frontend', () => {
  it('tiene exactamente los mismos permisos que el del backend', () => {
    const fuente = readFileSync(join(__dirname, '..', '..', '..', 'pos-frontend', 'src', 'permisos.tsx'), 'utf8');
    const tipo = fuente.slice(fuente.indexOf('export type Permiso'), fuente.indexOf(';', fuente.indexOf('export type Permiso')));
    const delFrontend = [...tipo.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(delFrontend).toEqual([...TODOS_LOS_PERMISOS].sort());
  });
});

describe('permisosDeRol', () => {
  it('el admin tiene todos, también los que no estén guardados', () => {
    expect(permisosDeRol('admin', [])).toEqual(TODOS_LOS_PERMISOS);
  });

  it('los demás tienen solo los guardados que sigan en el catálogo', () => {
    expect(permisosDeRol('cajero', ['venta.cobrar', 'permiso.retirado'])).toEqual(['venta.cobrar']);
    expect(permisosDeRol(null, [])).toEqual([]);
  });
});
