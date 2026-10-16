import { useState } from 'react';
import { ApiError } from '../../api';
import { useAvisar } from '../../componentes/Avisos';
import { CargaImagen } from '../../componentes/CargaImagen';
import { Confirmar } from '../../componentes/Confirmar';
import { EstadoVacio } from '../../componentes/EstadoVacio';
import { Campo, Interruptor, Selector, useFormulario } from '../../componentes/Formulario';
import { Tabla, type Columna } from '../../componentes/Tabla';
import { leerPesos, pesos } from '../../util';

/**
 * Muestrario de los componentes del panel de administración, con datos de
 * ejemplo. Sirve para verlos y probarlos mientras se construyen las pantallas
 * reales de la fase 1. Solo lo ve el admin, en /admin/muestra.
 */

interface ProductoEjemplo {
  id: string;
  nombre: string;
  categoria: string;
  precio: number;
  activo: boolean;
}

const NOMBRES = ['Hamburguesa clásica', 'Hamburguesa doble', 'Pollo apanado', 'Ensalada César', 'Limonada natural', 'Gaseosa', 'Jugo de lulo', 'Papas a la francesa', 'Arepa con queso', 'Brownie con helado'];
const CATEGORIAS = ['Hamburguesas', 'Hamburguesas', 'Platos', 'Platos', 'Bebidas', 'Bebidas', 'Bebidas', 'Acompañantes', 'Acompañantes', 'Postres'];
const PRECIOS = [25000, 32000, 28000, 22000, 8000, 5000, 7500, 9000, 6500, 12000];
const TODOS: ProductoEjemplo[] = NOMBRES.map((nombre, i) => ({
  id: String(i + 1),
  nombre,
  categoria: CATEGORIAS[i],
  precio: PRECIOS[i],
  activo: i !== 3,
}));

const COLUMNAS: Columna<ProductoEjemplo>[] = [
  { clave: 'nombre', titulo: 'Producto', celda: (p) => p.nombre, orden: (p) => p.nombre },
  { clave: 'categoria', titulo: 'Categoría', celda: (p) => p.categoria, orden: (p) => p.categoria },
  { clave: 'precio', titulo: 'Precio', celda: (p) => pesos(p.precio), orden: (p) => p.precio, alinear: 'derecha' },
  {
    clave: 'estado',
    titulo: 'Estado',
    celda: (p) => <span className={`etiqueta ${p.activo ? 'etiqueta-verde' : 'etiqueta-gris'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span>,
    orden: (p) => (p.activo ? 0 : 1),
  },
];

interface FormProducto extends Record<string, unknown> {
  nombre: string;
  categoria: string;
  precio: string;
  activo: boolean;
}

export function Muestra() {
  const avisar = useAvisar();
  const [cargadas, setCargadas] = useState(6);
  const [confirmando, setConfirmando] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);

  const f = useFormulario<FormProducto>({ nombre: '', categoria: '', precio: '', activo: true }, (v) => ({
    nombre: v.nombre.trim().length < 2 ? 'Escribe el nombre del producto' : undefined,
    categoria: v.categoria ? undefined : 'Escoge una categoría',
    precio: leerPesos(v.precio) > 0 ? undefined : 'El precio debe ser mayor que cero',
  }));

  return (
    <div className="admin-seccion">
      <header className="seccion-cabeza">
        <div>
          <h1>Componentes del panel</h1>
          <p className="nota">Muestrario con datos de ejemplo. Nada de esto se guarda.</p>
        </div>
      </header>

      <section className="tarjeta admin-bloque">
        <h2>Tabla</h2>
        <p className="nota">Toca un encabezado para ordenar; busca sin importar tildes. Se cargan de a 6, como haría el servidor.</p>
        <Tabla
          titulo="Productos"
          columnas={COLUMNAS}
          filas={TODOS.slice(0, cargadas)}
          claveFila={(p) => p.id}
          buscarEn={(p) => `${p.nombre} ${p.categoria}`}
          onFila={(p) => avisar(`Abrirías ${p.nombre}`, 'info')}
          hayMas={cargadas < TODOS.length}
          onMas={() => setCargadas((n) => n + 6)}
        />
      </section>

      <section className="tarjeta admin-bloque">
        <h2>Formulario</h2>
        <p className="nota">
          Valida en el navegador antes de enviar. "Simular error del servidor" muestra cómo un 400 de la API cae en su campo.
        </p>
        <form
          className="formulario admin-formulario"
          onSubmit={(e) => {
            e.preventDefault();
            f.enviar(async () => avisar(`Se guardaría ${f.valores.nombre}${foto ? ' con foto' : ''}`, 'exito'));
          }}
        >
          <Campo etiqueta="Nombre" value={f.valores.nombre} onCambio={f.cambiar('nombre')} error={f.errores.nombre} maxLength={120} />
          <Selector
            etiqueta="Categoría"
            value={f.valores.categoria}
            onCambio={f.cambiar('categoria')}
            error={f.errores.categoria}
            vacio="Escoge una…"
            opciones={[...new Set(CATEGORIAS)].map((c) => ({ valor: c, texto: c }))}
          />
          <Campo
            etiqueta="Precio al público"
            inputMode="decimal"
            value={f.valores.precio}
            onCambio={f.cambiar('precio')}
            error={f.errores.precio}
            ayuda="Con el impuesto incluido."
            placeholder="$0"
          />
          <Interruptor etiqueta="Disponible para la venta" ayuda="Si lo apagas, deja de salir en las tablets." activo={f.valores.activo} onCambio={f.cambiar('activo')} />
          <CargaImagen etiqueta="Foto" onCambio={setFoto} />
          {f.general && <p className="error">{f.general}</p>}
          <div className="fila-botones">
            <button className="boton boton-primario" disabled={f.enviando}>
              Guardar
            </button>
            <button
              type="button"
              className="boton"
              onClick={() =>
                f.enviar(async () => {
                  throw new ApiError(400, 'precio must not be less than 0. La categoría ya no existe');
                })
              }
            >
              Simular error del servidor
            </button>
          </div>
        </form>
      </section>

      <section className="tarjeta admin-bloque">
        <h2>Confirmación y estado vacío</h2>
        <div className="fila-botones">
          <button className="boton boton-peligro" onClick={() => setConfirmando(true)}>
            Desactivar producto
          </button>
        </div>
        <EstadoVacio
          titulo="Todavía no hay modificadores"
          texto="Los modificadores son las opciones de un producto: término de la carne, adiciones, tamaño."
          accion={<button className="boton boton-primario">Crear el primero</button>}
        />
      </section>

      {confirmando && (
        <Confirmar
          titulo="Desactivar producto"
          mensaje="Hamburguesa doble deja de salir en las tablets. Las ventas anteriores no cambian y lo puedes volver a activar."
          textoConfirmar="Desactivar"
          onCerrar={() => setConfirmando(false)}
          onConfirmar={async () => {
            await new Promise((r) => setTimeout(r, 600));
            setConfirmando(false);
            avisar('Producto desactivado (de ejemplo)', 'info');
          }}
        />
      )}
    </div>
  );
}
