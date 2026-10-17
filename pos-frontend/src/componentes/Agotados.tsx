import { useState } from 'react';
import { api, mensajeError } from '../api';
import { CLAVES, invalidar, useDatos } from '../datos';
import type { ProductoAdmin } from '../tipos';
import { useAvisar } from './Avisos';
import { Interruptor } from './Formulario';
import { Modal } from './Modal';

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Marcar lo que se acabó durante el servicio. El cambio llega al momento a
 * las tablets de la sede, que lo muestran tachado y no lo dejan pedir.
 */
export function Agotados({ onCerrar }: { onCerrar: () => void }) {
  const avisar = useAvisar();
  const productos = useDatos(CLAVES.admin.productos, () => api<ProductoAdmin[]>('GET', '/productos'));
  const [buscar, setBuscar] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const f = normalizar(buscar.trim());
  const activos = (productos.datos ?? []).filter((p) => p.activo && p.disponible && (!f || normalizar(p.nombre).includes(f)));
  const agotados = activos.filter((p) => p.agotado).length;
  const categorias = [...new Set(activos.map((p) => p.categoria))];

  async function cambiar(p: ProductoAdmin, agotado: boolean) {
    setOcupado(p.id);
    try {
      await api('PUT', `/productos/${p.id}/agotado`, { agotado });
      await invalidar(CLAVES.admin.productos, CLAVES.menu);
      avisar(agotado ? `${p.nombre}: agotado` : `${p.nombre}: disponible otra vez`, agotado ? 'error' : 'exito');
    } catch (e) {
      avisar(mensajeError(e), 'error');
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Modal titulo={agotados ? `Agotados (${agotados})` : 'Agotados'} onCerrar={onCerrar} ancho="ancho">
      <div className="formulario">
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto" data-autofoco />
        {productos.error && <p className="error">{productos.error}</p>}
        {categorias.map((c) => (
          <fieldset key={c} className="permisos-grupo">
            <legend>{c}</legend>
            {activos
              .filter((p) => p.categoria === c)
              .map((p) => (
                <Interruptor
                  key={p.id}
                  etiqueta={p.nombre}
                  ayuda={p.agotado ? 'Agotado: no se puede pedir' : undefined}
                  activo={p.agotado}
                  disabled={ocupado === p.id}
                  onCambio={(v) => cambiar(p, v)}
                />
              ))}
          </fieldset>
        ))}
        {!productos.cargando && !activos.length && <p className="nota">No hay productos que coincidan.</p>}
      </div>
    </Modal>
  );
}
