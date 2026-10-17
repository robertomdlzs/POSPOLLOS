import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, mensajeError } from '../../api';
import { useAvisar } from '../../componentes/Avisos';
import { CargaImagen } from '../../componentes/CargaImagen';
import { Confirmar } from '../../componentes/Confirmar';
import { EstadoVacio } from '../../componentes/EstadoVacio';
import { Campo, Interruptor, Selector } from '../../componentes/Formulario';
import { CLAVES, invalidar, useDatos } from '../../datos';
import type { CategoriaAdmin, Estacion, GrupoAdmin, ProductoAdmin, Sede, TipoImpuesto } from '../../tipos';
import { leerPesos, pesos } from '../../util';

const cargarCategorias = () => api<CategoriaAdmin[]>('GET', '/categorias');
const cargarProductos = () => api<ProductoAdmin[]>('GET', '/productos');
const cargarGrupos = () => api<GrupoAdmin[]>('GET', '/grupos-modificadores');

/** Intercambia un elemento con su vecino y devuelve los ids en el orden nuevo */
function mover<T extends { id: string }>(lista: T[], i: number, paso: -1 | 1) {
  const ids = lista.map((x) => x.id);
  [ids[i], ids[i + paso]] = [ids[i + paso], ids[i]];
  return ids;
}

export function Menu() {
  return (
    <div className="admin-seccion">
      <nav className="admin-nav fila-chips" aria-label="Menú">
        <NavLink to="/admin/menu/productos" className={({ isActive }) => `chip ${isActive ? 'activo' : ''}`}>
          Productos
        </NavLink>
        <NavLink to="/admin/menu/modificadores" className={({ isActive }) => `chip ${isActive ? 'activo' : ''}`}>
          Modificadores
        </NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="/admin/menu/productos" replace />} />
        <Route path="productos" element={<Productos />} />
        <Route path="productos/:id" element={<FichaProducto />} />
        <Route path="modificadores" element={<Modificadores />} />
      </Routes>
    </div>
  );
}

// ================================================================ productos

function Productos() {
  const navegar = useNavigate();
  const avisar = useAvisar();
  const [params, setParams] = useSearchParams();
  const categorias = useDatos(CLAVES.admin.categorias, cargarCategorias);
  const productos = useDatos(CLAVES.admin.productos, cargarProductos);
  const [nueva, setNueva] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<CategoriaAdmin | null>(null);

  const cats = categorias.datos ?? [];
  const elegida = cats.find((c) => c.id === params.get('categoria')) ?? cats[0];
  const deLaCategoria = (productos.datos ?? []).filter((p) => p.categoriaId === elegida?.id);

  async function hacer(accion: () => Promise<unknown>, aviso?: string) {
    setError(null);
    try {
      await accion();
      await invalidar(CLAVES.admin.categorias, CLAVES.admin.productos, CLAVES.menu);
      if (aviso) avisar(aviso, 'exito');
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <div className="menu-admin">
      <section className="tarjeta admin-bloque menu-categorias">
        <h2>Categorías</h2>
        {error && <p className="error">{error}</p>}
        <ol className="lista-ordenable">
          {cats.map((c, i) => (
            <li key={c.id} className={`${c.id === elegida?.id ? 'elegida' : ''} ${c.activa ? '' : 'inactiva'}`}>
              <button className="lista-nombre" onClick={() => setParams({ categoria: c.id })} aria-current={c.id === elegida?.id}>
                <span>
                  {c.nombre}
                  <span className="nota">{c.activa ? `${c.productos} ${c.productos === 1 ? 'producto' : 'productos'}` : 'Oculta en las tablets'}</span>
                </span>
              </button>
              <span className="lista-acciones">
                <button className="boton-icono" aria-label={`Subir ${c.nombre}`} disabled={i === 0} onClick={() => hacer(() => api('PUT', '/categorias/orden', { ids: mover(cats, i, -1) }))}>
                  ▲
                </button>
                <button
                  className="boton-icono"
                  aria-label={`Bajar ${c.nombre}`}
                  disabled={i === cats.length - 1}
                  onClick={() => hacer(() => api('PUT', '/categorias/orden', { ids: mover(cats, i, 1) }))}
                >
                  ▼
                </button>
              </span>
            </li>
          ))}
        </ol>
        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault();
            hacer(() => api('POST', '/categorias', { nombre: nueva.trim() }), `Categoría ${nueva.trim()} creada`).then(() => setNueva(''));
          }}
        >
          <Campo etiqueta="Nueva categoría" value={nueva} onCambio={setNueva} maxLength={40} placeholder="Por ejemplo: Postres" />
          <button className="boton" disabled={nueva.trim().length < 2}>
            Crear
          </button>
        </form>
        {elegida && (
          <div className="formulario">
            <Interruptor
              etiqueta={`${elegida.nombre} se ve en las tablets`}
              activo={elegida.activa}
              onCambio={(v) => hacer(() => api('PATCH', `/categorias/${elegida.id}`, { activa: v }), v ? 'Categoría visible' : 'Categoría oculta')}
            />
            {elegida.productos === 0 && (
              <button className="boton boton-peligro" onClick={() => setBorrando(elegida)}>
                Borrar categoría
              </button>
            )}
          </div>
        )}
      </section>

      <section className="tarjeta admin-bloque">
        <header className="seccion-cabeza">
          <div>
            <h1>{elegida?.nombre ?? 'Productos'}</h1>
            <p className="nota">El orden de esta lista es el de las tablets.</p>
          </div>
          {elegida && (
            <button className="boton boton-primario" onClick={() => navegar(`/admin/menu/productos/nuevo?categoria=${elegida.id}`)}>
              Nuevo producto
            </button>
          )}
        </header>
        {!cats.length && !categorias.cargando && <EstadoVacio titulo="Todavía no hay categorías" texto="Crea la primera a la izquierda." />}
        {elegida && !deLaCategoria.length && !productos.cargando && <EstadoVacio titulo="Esta categoría no tiene productos" />}
        <ol className="lista-ordenable lista-productos">
          {deLaCategoria.map((p, i) => (
            <li key={p.id} className={p.activo ? '' : 'inactiva'}>
              <button className="lista-nombre" onClick={() => navegar(`/admin/menu/productos/${p.id}`)}>
                <span className="miniatura" aria-hidden="true">
                  {p.imagenUrl ? <img src={p.imagenUrl} alt="" loading="lazy" /> : p.nombre.charAt(0)}
                </span>
                <span>
                  {p.nombre}
                  <span className="nota">
                    {pesos(p.precioSede ?? p.precio)}
                    {p.precioSede && ' (precio de esta sede)'}
                    {!p.activo && ' · Inactivo'}
                    {!p.disponible && ' · No se vende en esta sede'}
                    {p.agotado && ' · Agotado'}
                  </span>
                </span>
              </button>
              <span className="lista-acciones">
                <button
                  className="boton-icono"
                  aria-label={`Subir ${p.nombre}`}
                  disabled={i === 0}
                  onClick={() => hacer(() => api('PUT', '/productos/orden', { categoriaId: elegida!.id, ids: mover(deLaCategoria, i, -1) }))}
                >
                  ▲
                </button>
                <button
                  className="boton-icono"
                  aria-label={`Bajar ${p.nombre}`}
                  disabled={i === deLaCategoria.length - 1}
                  onClick={() => hacer(() => api('PUT', '/productos/orden', { categoriaId: elegida!.id, ids: mover(deLaCategoria, i, 1) }))}
                >
                  ▼
                </button>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {borrando && (
        <Confirmar
          titulo={`Borrar ${borrando.nombre}`}
          mensaje="La categoría está vacía, así que no afecta a ningún producto."
          textoConfirmar="Borrar"
          onCerrar={() => setBorrando(null)}
          onConfirmar={async () => {
            await api('DELETE', `/categorias/${borrando.id}`);
            await invalidar(CLAVES.admin.categorias, CLAVES.menu);
            setBorrando(null);
            setParams({});
          }}
        />
      )}
    </div>
  );
}

// ======================================================== ficha de producto

const IMPUESTOS: { valor: string; texto: string }[] = [
  { valor: 'impoconsumo:8', texto: 'Impoconsumo 8 %' },
  { valor: 'iva:19', texto: 'IVA 19 %' },
  { valor: 'iva:5', texto: 'IVA 5 %' },
  { valor: 'exento:0', texto: 'Exento' },
];

function FichaProducto() {
  const { id = 'nuevo' } = useParams();
  const nuevo = id === 'nuevo';
  const productos = useDatos(CLAVES.admin.productos, cargarProductos);
  const categorias = useDatos(CLAVES.admin.categorias, cargarCategorias);
  const grupos = useDatos(CLAVES.admin.grupos, cargarGrupos);
  const estaciones = useDatos(CLAVES.admin.estaciones, () => api<Estacion[]>('GET', '/estaciones'));
  const sedes = useDatos(CLAVES.admin.sedes, () => api<Sede[]>('GET', '/sedes'));

  const listos = productos.datos && categorias.datos && grupos.datos && estaciones.datos && sedes.datos;
  if (!listos) return <p className="nota">Cargando…</p>;
  const producto = nuevo ? null : productos.datos!.find((p) => p.id === id);
  if (!nuevo && !producto) return <p className="error">Ese producto no existe.</p>;
  return (
    <EditorProducto
      key={id}
      producto={producto ?? null}
      categorias={categorias.datos!}
      grupos={grupos.datos!}
      estaciones={estaciones.datos!}
      sedes={sedes.datos!}
    />
  );
}

function EditorProducto({
  producto,
  categorias,
  grupos,
  estaciones,
  sedes,
}: {
  producto: ProductoAdmin | null;
  categorias: CategoriaAdmin[];
  grupos: GrupoAdmin[];
  estaciones: Estacion[];
  sedes: Sede[];
}) {
  const navegar = useNavigate();
  const avisar = useAvisar();
  const [params] = useSearchParams();
  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? '');
  const [categoriaId, setCategoriaId] = useState(producto?.categoriaId ?? params.get('categoria') ?? categorias[0]?.id ?? '');
  const [precio, setPrecio] = useState(producto ? String(Number(producto.precio)) : '');
  const [impuesto, setImpuesto] = useState(producto ? `${producto.tipoImpuesto}:${Number(producto.tasaImpuesto)}` : 'impoconsumo:8');
  const [estacionId, setEstacionId] = useState(producto?.estacionId ?? '');
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [grupoIds, setGrupoIds] = useState<string[]>(producto?.grupoIds ?? []);
  const [foto, setFoto] = useState<File | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [borrando, setBorrando] = useState(false);

  // Si el producto tiene un impuesto que no está en la lista, se ofrece tal cual
  const opcionesImpuesto = IMPUESTOS.some((i) => i.valor === impuesto) ? IMPUESTOS : [...IMPUESTOS, { valor: impuesto, texto: impuesto.replace(':', ' ') + ' %' }];

  async function guardar() {
    setEnviando(true);
    setError(null);
    const [tipoImpuesto, tasa] = impuesto.split(':');
    const cuerpo = {
      categoriaId,
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || (producto ? null : undefined),
      precio: leerPesos(precio),
      tipoImpuesto: tipoImpuesto as TipoImpuesto,
      tasaImpuesto: Number(tasa),
      estacionId: estacionId || null,
      grupoIds,
      ...(producto ? { activo } : {}),
    };
    try {
      const guardado = await api<ProductoAdmin>(producto ? 'PATCH' : 'POST', producto ? `/productos/${producto.id}` : '/productos', cuerpo);
      if (foto) {
        const form = new FormData();
        form.append('foto', foto);
        await api('POST', `/productos/${guardado.id}/foto`, form);
      } else if (foto === null && producto?.imagenUrl) {
        await api('DELETE', `/productos/${guardado.id}/foto`);
      }
      await invalidar(CLAVES.admin.productos, CLAVES.admin.categorias, CLAVES.menu);
      avisar(producto ? 'Producto guardado' : `${guardado.nombre} ya está en el menú`, 'exito');
      navegar(`/admin/menu/productos?categoria=${guardado.categoriaId}`);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="admin-columna">
      <section className="tarjeta admin-bloque">
        <header className="seccion-cabeza">
          <h1>{producto ? producto.nombre : 'Nuevo producto'}</h1>
          <button className="boton boton-volver" onClick={() => navegar(-1)}>
            ‹ Volver
          </button>
        </header>
        <form
          className="formulario admin-formulario"
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
        >
          <Campo etiqueta="Nombre" value={nombre} onCambio={setNombre} maxLength={80} required />
          <Campo etiqueta="Descripción" value={descripcion} onCambio={setDescripcion} maxLength={300} placeholder="Opcional: lo que trae" />
          <Selector etiqueta="Categoría" value={categoriaId} onCambio={setCategoriaId} opciones={categorias.map((c) => ({ valor: c.id, texto: c.nombre }))} />
          <Campo
            etiqueta="Precio al público"
            inputMode="decimal"
            value={precio}
            onCambio={setPrecio}
            ayuda={`Con el impuesto incluido. ${leerPesos(precio) ? pesos(leerPesos(precio)) : ''}`}
            placeholder="$0"
            required
          />
          <Selector etiqueta="Impuesto" value={impuesto} onCambio={setImpuesto} opciones={opcionesImpuesto} ayuda="Confírmalo con tu contador." />
          <Selector
            etiqueta="Estación de cocina"
            value={estacionId}
            onCambio={setEstacionId}
            vacio="Ninguna"
            opciones={estaciones.map((e) => ({ valor: e.id, texto: e.nombre }))}
            ayuda="Dónde se prepara: separa las comandas en la pantalla de cocina."
          />
          <fieldset className="permisos-grupo">
            <legend>Modificadores que se ofrecen</legend>
            {grupos.length === 0 && <p className="nota">Todavía no hay grupos de modificadores.</p>}
            {grupos.map((g) => (
              <Interruptor
                key={g.id}
                etiqueta={g.nombre}
                ayuda={`${g.min > 0 ? `Obligatorio, ${g.min === g.max ? g.min : `de ${g.min} a ${g.max}`}` : `Opcional, hasta ${g.max}`}: ${g.opciones
                  .filter((o) => o.activo)
                  .map((o) => o.nombre)
                  .join(', ')}`}
                activo={grupoIds.includes(g.id)}
                onCambio={(v) => setGrupoIds((ids) => (v ? [...ids, g.id] : ids.filter((x) => x !== g.id)))}
              />
            ))}
          </fieldset>
          <CargaImagen etiqueta="Foto" actual={foto === null ? null : producto?.imagenUrl} onCambio={setFoto} maximoMb={8} />
          {producto && (
            <Interruptor etiqueta="Activo" ayuda="Si lo apagas, desaparece de las tablets de todas las sedes." activo={activo} onCambio={setActivo} />
          )}
          {error && <p className="error">{error}</p>}
          <div className="fila-botones">
            <button className="boton boton-primario" disabled={enviando || nombre.trim().length < 2 || !categoriaId}>
              {enviando ? 'Guardando…' : producto ? 'Guardar cambios' : 'Crear producto'}
            </button>
            {producto && !producto.vendido && (
              <button type="button" className="boton boton-peligro" onClick={() => setBorrando(true)}>
                Borrar producto
              </button>
            )}
          </div>
          {producto?.vendido && <p className="nota">Este producto ya se vendió: no se puede borrar, pero sí desactivar.</p>}
        </form>
      </section>

      {producto && sedes.length > 0 && <PrecioPorSede producto={producto} sedes={sedes} />}

      {borrando && producto && (
        <Confirmar
          titulo={`Borrar ${producto.nombre}`}
          mensaje="Nunca se ha vendido, así que se borra del todo, con su foto."
          textoConfirmar="Borrar"
          onCerrar={() => setBorrando(false)}
          onConfirmar={async () => {
            await api('DELETE', `/productos/${producto.id}`);
            await invalidar(CLAVES.admin.productos, CLAVES.admin.categorias, CLAVES.menu);
            avisar(`${producto.nombre} borrado`, 'info');
            navegar(`/admin/menu/productos?categoria=${producto.categoriaId}`);
          }}
        />
      )}
    </div>
  );
}

/**
 * Precio propio y disponibilidad por sede. El listado de productos trae lo de
 * la sede de la sesión; para las demás, lo que se guarda aquí aplica al momento.
 */
function PrecioPorSede({ producto, sedes }: { producto: ProductoAdmin; sedes: Sede[] }) {
  const avisar = useAvisar();
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function guardar(sede: Sede, cuerpo: { precio?: number | null; disponible?: boolean }, aviso: string) {
    setError(null);
    try {
      await api('PUT', `/productos/${producto.id}/sedes/${sede.id}`, cuerpo);
      await invalidar(CLAVES.admin.productos, CLAVES.menu);
      avisar(aviso, 'exito');
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <section className="tarjeta admin-bloque">
      <h2>Por sede</h2>
      <p className="nota">Precio general: {pesos(producto.precio)}. Deja el precio vacío para usar el general.</p>
      {error && <p className="error">{error}</p>}
      {sedes.map((s) => (
        <div key={s.id} className="formulario">
          <form
            className="fila-campo"
            onSubmit={(e) => {
              e.preventDefault();
              const texto = precios[s.id] ?? '';
              guardar(s, { precio: texto.trim() ? leerPesos(texto) : null }, texto.trim() ? `Precio en ${s.nombre}: ${pesos(leerPesos(texto))}` : `${s.nombre} usa el precio general`);
            }}
          >
            <Campo
              etiqueta={`Precio en ${s.nombre}`}
              inputMode="decimal"
              value={precios[s.id] ?? (producto.precioSede && sedes.length === 1 ? String(Number(producto.precioSede)) : '')}
              onCambio={(v) => setPrecios((p) => ({ ...p, [s.id]: v }))}
              placeholder={pesos(producto.precio)}
            />
            <button className="boton">Guardar precio</button>
          </form>
          {sedes.length === 1 && (
            <Interruptor
              etiqueta="Se vende en esta sede"
              activo={producto.disponible}
              onCambio={(v) => guardar(s, { disponible: v }, v ? 'Disponible en la sede' : 'Ya no se vende en la sede')}
            />
          )}
        </div>
      ))}
    </section>
  );
}

// ============================================================ modificadores

function Modificadores() {
  const avisar = useAvisar();
  const grupos = useDatos(CLAVES.admin.grupos, cargarGrupos);
  const [creando, setCreando] = useState(false);

  return (
    <div className="admin-columna">
      <section className="tarjeta admin-bloque">
        <header className="seccion-cabeza">
          <div>
            <h1>Modificadores</h1>
            <p className="nota">Las opciones de un producto: término de la carne, adiciones, tamaño. Se asignan en la ficha de cada producto.</p>
          </div>
          <button className="boton boton-primario" onClick={() => setCreando(true)}>
            Nuevo grupo
          </button>
        </header>
        {grupos.error && <p className="error">{grupos.error}</p>}
        {!grupos.cargando && !grupos.datos?.length && <EstadoVacio titulo="Todavía no hay modificadores" />}
      </section>
      {creando && <NuevoGrupo onListo={() => setCreando(false)} />}
      {grupos.datos?.map((g) => (
        <EditorGrupo key={g.id} grupo={g} onAviso={(t) => avisar(t, 'exito')} />
      ))}
    </div>
  );
}

function NuevoGrupo({ onListo }: { onListo: () => void }) {
  const [nombre, setNombre] = useState('');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('1');
  const [opciones, setOpciones] = useState([{ nombre: '', precio: '' }]);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="tarjeta admin-bloque">
      <h2>Nuevo grupo</h2>
      <form
        className="formulario admin-formulario"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api('POST', '/grupos-modificadores', {
              nombre: nombre.trim(),
              min: Number(min),
              max: Number(max),
              opciones: opciones.filter((o) => o.nombre.trim()).map((o) => ({ nombre: o.nombre.trim(), precioExtra: leerPesos(o.precio) })),
            });
            await invalidar(CLAVES.admin.grupos);
            onListo();
          } catch (err) {
            setError(mensajeError(err));
          }
        }}
      >
        <Campo etiqueta="Nombre" value={nombre} onCambio={setNombre} maxLength={60} placeholder="Por ejemplo: Término de la carne" required />
        <div className="fila-campo">
          <Campo etiqueta="Mínimo" inputMode="numeric" value={min} onCambio={(v) => setMin(v.replace(/\D/g, ''))} ayuda="0 si es opcional" />
          <Campo etiqueta="Máximo" inputMode="numeric" value={max} onCambio={(v) => setMax(v.replace(/\D/g, ''))} />
        </div>
        {opciones.map((o, i) => (
          <div key={i} className="fila-campo">
            <Campo etiqueta={`Opción ${i + 1}`} value={o.nombre} onCambio={(v) => setOpciones((os) => os.map((x, j) => (j === i ? { ...x, nombre: v } : x)))} />
            <Campo
              etiqueta="Precio extra"
              inputMode="decimal"
              value={o.precio}
              placeholder="$0"
              onCambio={(v) => setOpciones((os) => os.map((x, j) => (j === i ? { ...x, precio: v } : x)))}
            />
          </div>
        ))}
        <button type="button" className="boton boton-suave" onClick={() => setOpciones((os) => [...os, { nombre: '', precio: '' }])}>
          Otra opción
        </button>
        {error && <p className="error">{error}</p>}
        <div className="fila-botones">
          <button className="boton boton-primario" disabled={nombre.trim().length < 2}>
            Crear grupo
          </button>
          <button type="button" className="boton" onClick={onListo}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}

function EditorGrupo({ grupo, onAviso }: { grupo: GrupoAdmin; onAviso: (t: string) => void }) {
  const [nombre, setNombre] = useState(grupo.nombre);
  const [min, setMin] = useState(String(grupo.min));
  const [max, setMax] = useState(String(grupo.max));
  const [opcion, setOpcion] = useState({ nombre: '', precio: '' });
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);
  const cambiado = nombre.trim() !== grupo.nombre || Number(min) !== grupo.min || Number(max) !== grupo.max;

  async function hacer(accion: () => Promise<unknown>, aviso: string) {
    setError(null);
    try {
      await accion();
      await invalidar(CLAVES.admin.grupos, CLAVES.menu);
      onAviso(aviso);
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    }
  }

  return (
    <section className="tarjeta admin-bloque">
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          hacer(() => api('PATCH', `/grupos-modificadores/${grupo.id}`, { nombre: nombre.trim(), min: Number(min), max: Number(max) }), 'Grupo guardado');
        }}
      >
        <header className="seccion-cabeza">
          <div>
            <h2>{grupo.nombre}</h2>
            <p className="nota">{grupo.productos === 1 ? 'Lo usa 1 producto' : `Lo usan ${grupo.productos} productos`}</p>
          </div>
          <button type="button" className="boton boton-peligro" onClick={() => setBorrando(true)}>
            Borrar grupo
          </button>
        </header>
        <div className="fila-campo">
          <Campo etiqueta="Nombre" value={nombre} onCambio={setNombre} maxLength={60} />
          <Campo etiqueta="Mínimo" inputMode="numeric" value={min} onCambio={(v) => setMin(v.replace(/\D/g, ''))} />
          <Campo etiqueta="Máximo" inputMode="numeric" value={max} onCambio={(v) => setMax(v.replace(/\D/g, ''))} />
          <button className="boton" disabled={!cambiado}>
            Guardar
          </button>
        </div>
      </form>

      <ul className="opciones-admin">
        {grupo.opciones.map((o) => (
          <li key={o.id} className={o.activo ? '' : 'inactiva'}>
            <span>
              {o.nombre}
              <span className="nota">{Number(o.precioExtra) > 0 ? ` +${pesos(o.precioExtra)}` : ' sin costo'}</span>
            </span>
            <Interruptor
              etiqueta={o.activo ? 'Se ofrece' : 'No se ofrece'}
              activo={o.activo}
              onCambio={(v) => hacer(() => api('PATCH', `/modificadores/${o.id}`, { activo: v }), v ? `${o.nombre} se ofrece otra vez` : `${o.nombre} ya no se ofrece`)}
            />
          </li>
        ))}
      </ul>
      <form
        className="fila-campo"
        onSubmit={async (e) => {
          e.preventDefault();
          const listo = await hacer(
            () => api('POST', `/grupos-modificadores/${grupo.id}/opciones`, { nombre: opcion.nombre.trim(), precioExtra: leerPesos(opcion.precio) }),
            `${opcion.nombre.trim()} agregada`,
          );
          if (listo) setOpcion({ nombre: '', precio: '' });
        }}
      >
        <Campo etiqueta="Nueva opción" value={opcion.nombre} onCambio={(v) => setOpcion((x) => ({ ...x, nombre: v }))} maxLength={60} />
        <Campo etiqueta="Precio extra" inputMode="decimal" value={opcion.precio} placeholder="$0" onCambio={(v) => setOpcion((x) => ({ ...x, precio: v }))} />
        <button className="boton" disabled={!opcion.nombre.trim()}>
          Agregar
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {borrando && (
        <Confirmar
          titulo={`Borrar ${grupo.nombre}`}
          mensaje={
            grupo.productos
              ? `Se quita de los ${grupo.productos} productos que lo usan. Si ya se vendió alguna de sus opciones, no se puede borrar: desactívalas.`
              : 'Ningún producto lo usa.'
          }
          textoConfirmar="Borrar"
          onCerrar={() => setBorrando(false)}
          onConfirmar={async () => {
            await api('DELETE', `/grupos-modificadores/${grupo.id}`);
            await invalidar(CLAVES.admin.grupos, CLAVES.admin.productos, CLAVES.menu);
            setBorrando(false);
          }}
        />
      )}
    </section>
  );
}
