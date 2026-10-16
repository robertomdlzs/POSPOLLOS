import { useMemo, useState, type ReactNode } from 'react';
import { EstadoVacio } from './EstadoVacio';

export interface Columna<T> {
  clave: string;
  titulo: string;
  celda: (fila: T) => ReactNode;
  /** Valor por el que se ordena; sin él, la columna no se puede ordenar */
  orden?: (fila: T) => string | number;
  alinear?: 'izquierda' | 'derecha';
}

interface Props<T> {
  columnas: Columna<T>[];
  filas: T[];
  claveFila: (fila: T) => string;
  /** Texto en el que busca el filtro; sin él, no hay buscador */
  buscarEn?: (fila: T) => string;
  onFila?: (fila: T) => void;
  cargando?: boolean;
  /** Paginación por cursor del servidor: hay más filas por traer */
  hayMas?: boolean;
  onMas?: () => void;
  vacio?: ReactNode;
  titulo?: string;
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Tabla del panel de administración: ordena al tocar el encabezado, filtra
 * mientras se escribe (sin distinguir tildes ni mayúsculas) y trae más filas
 * del servidor con "Cargar más". Ordena y filtra lo que ya está cargado.
 */
export function Tabla<T>({ columnas, filas, claveFila, buscarEn, onFila, cargando, hayMas, onMas, vacio, titulo }: Props<T>) {
  const [filtro, setFiltro] = useState('');
  const [orden, setOrden] = useState<{ clave: string; asc: boolean } | null>(null);

  const visibles = useMemo(() => {
    const f = normalizar(filtro.trim());
    let r = f && buscarEn ? filas.filter((x) => normalizar(buscarEn(x)).includes(f)) : filas;
    const col = orden && columnas.find((c) => c.clave === orden.clave);
    if (col?.orden) {
      const valor = col.orden;
      r = [...r].sort((a, b) => {
        const va = valor(a);
        const vb = valor(b);
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
        return orden!.asc ? c : -c;
      });
    }
    return r;
  }, [filas, filtro, orden, columnas, buscarEn]);

  function ordenarPor(clave: string) {
    setOrden((o) => (o?.clave === clave ? (o.asc ? { clave, asc: false } : null) : { clave, asc: true }));
  }

  return (
    <div className="tabla-admin">
      {buscarEn && (
        <input
          className="tabla-buscar"
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar…"
          aria-label={titulo ? `Buscar en ${titulo.toLowerCase()}` : 'Buscar'}
        />
      )}
      <div className="tabla-marco">
        <table>
          {titulo && <caption className="solo-lector">{titulo}</caption>}
          <thead>
            <tr>
              {columnas.map((c) => {
                const activa = orden?.clave === c.clave;
                return (
                  <th
                    key={c.clave}
                    className={c.alinear === 'derecha' ? 'derecha' : undefined}
                    aria-sort={activa ? (orden!.asc ? 'ascending' : 'descending') : undefined}
                  >
                    {c.orden ? (
                      <button type="button" className="tabla-orden" onClick={() => ordenarPor(c.clave)}>
                        {c.titulo}
                        <span aria-hidden="true">{activa ? (orden!.asc ? ' ▲' : ' ▼') : ' ↕'}</span>
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibles.map((fila) => (
              <tr
                key={claveFila(fila)}
                className={onFila ? 'clicable' : undefined}
                onClick={onFila ? () => onFila(fila) : undefined}
                tabIndex={onFila ? 0 : undefined}
                onKeyDown={onFila ? (e) => e.key === 'Enter' && onFila(fila) : undefined}
              >
                {columnas.map((c) => (
                  <td key={c.clave} className={c.alinear === 'derecha' ? 'derecha' : undefined}>
                    {c.celda(fila)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!cargando && visibles.length === 0 &&
          (filtro ? <EstadoVacio titulo="Nada coincide" texto={`No hay resultados para «${filtro}».`} /> : vacio ?? <EstadoVacio titulo="Todavía no hay nada aquí" />)}
        {cargando && <p className="tabla-cargando nota">Cargando…</p>}
      </div>
      {hayMas && onMas && (
        <button type="button" className="boton boton-suave tabla-mas" onClick={onMas} disabled={cargando}>
          Cargar más
        </button>
      )}
    </div>
  );
}
