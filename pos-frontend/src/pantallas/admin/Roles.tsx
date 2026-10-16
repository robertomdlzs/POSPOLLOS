import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, mensajeError } from '../../api';
import { useAvisar } from '../../componentes/Avisos';
import { Confirmar } from '../../componentes/Confirmar';
import { Campo, Interruptor } from '../../componentes/Formulario';
import { Tabla, type Columna } from '../../componentes/Tabla';
import { CLAVES, invalidar, useDatos } from '../../datos';
import { usePuede, type Permiso } from '../../permisos';
import type { PermisoCatalogo, RolAdmin } from '../../tipos';

const COLUMNAS: Columna<RolAdmin>[] = [
  {
    clave: 'nombre',
    titulo: 'Rol',
    celda: (r) => (
      <>
        <strong>{r.nombre}</strong>
        {r.descripcion && <span className="nota celda-sub">{r.descripcion}</span>}
      </>
    ),
    orden: (r) => r.nombre,
  },
  { clave: 'tipo', titulo: 'Tipo', celda: (r) => (r.clave ? 'De fábrica' : 'Del restaurante'), orden: (r) => (r.clave ? 0 : 1) },
  { clave: 'permisos', titulo: 'Permisos', celda: (r) => r.permisos.length, orden: (r) => r.permisos.length, alinear: 'derecha' },
  { clave: 'usuarios', titulo: 'Usuarios', celda: (r) => r.usuarios, orden: (r) => r.usuarios, alinear: 'derecha' },
];

export function Roles() {
  const navegar = useNavigate();
  const puede = usePuede();
  const roles = useDatos(CLAVES.admin.roles, () => api<RolAdmin[]>('GET', '/roles'));

  return (
    <section className="tarjeta admin-bloque">
      <header className="seccion-cabeza">
        <div>
          <h1>Roles y permisos</h1>
          <p className="nota">Cada rol es una lista de lo que se puede hacer. Un usuario tiene un rol en cada sede.</p>
        </div>
        {puede('rol.editar') && (
          <button className="boton boton-primario" onClick={() => navegar('nuevo')}>
            Nuevo rol
          </button>
        )}
      </header>
      {roles.error && <p className="error">{roles.error}</p>}
      <Tabla titulo="Roles" columnas={COLUMNAS} filas={roles.datos ?? []} claveFila={(r) => r.id} onFila={(r) => navegar(r.id)} cargando={roles.cargando} />
    </section>
  );
}

// ---------------------------------------------------------------------------

/** /admin/roles/nuevo o /admin/roles/:id */
export function FichaRol() {
  const { id = 'nuevo' } = useParams();
  const roles = useDatos(CLAVES.admin.roles, () => api<RolAdmin[]>('GET', '/roles'));
  const catalogo = useDatos(CLAVES.admin.permisos, () => api<PermisoCatalogo[]>('GET', '/roles/permisos'), { frescura: Infinity });

  if (roles.error || catalogo.error) return <p className="error">{roles.error ?? catalogo.error}</p>;
  if (!roles.datos || !catalogo.datos) return <p className="nota">Cargando…</p>;
  const rol = id === 'nuevo' ? null : roles.datos.find((r) => r.id === id);
  if (id !== 'nuevo' && !rol) return <p className="error">Ese rol no existe.</p>;
  return <EditorRol key={id} rol={rol ?? null} catalogo={catalogo.datos} />;
}

function EditorRol({ rol, catalogo }: { rol: RolAdmin | null; catalogo: PermisoCatalogo[] }) {
  const navegar = useNavigate();
  const avisar = useAvisar();
  const puede = usePuede();
  const editable = puede('rol.editar') && (rol ? rol.editable : true);
  const [nombre, setNombre] = useState(rol?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? '');
  const [permisos, setPermisos] = useState<Set<Permiso>>(new Set(rol?.permisos ?? []));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const grupos = [...new Set(catalogo.map((p) => p.grupo))];
  const alternar = (p: Permiso, activo: boolean) =>
    setPermisos((s) => {
      const n = new Set(s);
      if (activo) n.add(p);
      else n.delete(p);
      return n;
    });

  async function guardar() {
    setEnviando(true);
    setError(null);
    try {
      const cuerpo = { nombre: nombre.trim(), descripcion: descripcion.trim() || undefined, permisos: [...permisos] };
      const guardado = await api<RolAdmin>(rol ? 'PATCH' : 'POST', rol ? `/roles/${rol.id}` : '/roles', cuerpo);
      await invalidar(CLAVES.admin.roles, CLAVES.admin.usuarios);
      avisar(rol ? `Rol guardado. ${rol.usuarios ? 'Se aplica de inmediato a quienes lo tienen.' : ''}` : `Rol ${guardado.nombre} creado`, 'exito');
      if (!rol) navegar(`../${guardado.id}`, { relative: 'path', replace: true });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="tarjeta admin-bloque">
      <header className="seccion-cabeza">
        <div>
          <h1>{rol ? rol.nombre : 'Nuevo rol'}</h1>
          <p className="nota">
            {rol?.clave === 'admin'
              ? 'El rol de administración tiene siempre todos los permisos y no se edita.'
              : !editable
                ? 'Este rol tiene permisos que tú no tienes: lo puedes ver, no cambiar.'
                : rol
                  ? `${rol.usuarios} ${rol.usuarios === 1 ? 'usuario lo tiene' : 'usuarios lo tienen'}.`
                  : 'Escoge lo que podrá hacer quien tenga este rol.'}
          </p>
        </div>
        <button className="boton boton-volver" onClick={() => navegar('..', { relative: 'path' })}>
          ‹ Roles
        </button>
      </header>

      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          guardar();
        }}
      >
        <div className="admin-formulario formulario">
          <Campo etiqueta="Nombre" value={nombre} onCambio={setNombre} maxLength={40} disabled={!editable} required />
          <Campo etiqueta="Descripción" value={descripcion} onCambio={setDescripcion} maxLength={200} disabled={!editable} placeholder="Opcional" />
        </div>

        <div className="permisos-grupos">
          {grupos.map((g) => (
            <fieldset key={g} className="permisos-grupo">
              <legend>{g}</legend>
              {catalogo
                .filter((p) => p.grupo === g)
                .map((p) => (
                  <Interruptor
                    key={p.codigo}
                    etiqueta={p.descripcion}
                    ayuda={puede(p.codigo) ? undefined : 'No lo tienes, así que no lo puedes dar'}
                    activo={permisos.has(p.codigo)}
                    // Se puede quitar o poner solo lo que uno mismo tiene
                    disabled={!editable || !puede(p.codigo)}
                    onCambio={(v) => alternar(p.codigo, v)}
                  />
                ))}
            </fieldset>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
        {editable && (
          <div className="fila-botones">
            <button className="boton boton-primario" disabled={enviando || nombre.trim().length < 2}>
              {enviando ? 'Guardando…' : rol ? 'Guardar cambios' : 'Crear rol'}
            </button>
            {rol && !rol.clave && (
              <button
                type="button"
                className="boton boton-peligro"
                disabled={rol.usuarios > 0}
                title={rol.usuarios > 0 ? 'Asígnales otro rol a sus usuarios antes de borrarlo' : undefined}
                onClick={() => setBorrando(true)}
              >
                Borrar rol
              </button>
            )}
          </div>
        )}
      </form>

      {borrando && rol && (
        <Confirmar
          titulo={`Borrar ${rol.nombre}`}
          mensaje="El rol desaparece de la lista. Nadie lo tiene asignado, así que no afecta a ningún usuario."
          textoConfirmar="Borrar"
          onCerrar={() => setBorrando(false)}
          onConfirmar={async () => {
            await api('DELETE', `/roles/${rol.id}`);
            await invalidar(CLAVES.admin.roles);
            avisar(`Rol ${rol.nombre} borrado`, 'info');
            navegar('..', { relative: 'path' });
          }}
        />
      )}
    </section>
  );
}
