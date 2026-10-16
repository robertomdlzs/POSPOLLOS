import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, mensajeError, obtenerSesion } from '../../api';
import { useAvisar } from '../../componentes/Avisos';
import { Confirmar } from '../../componentes/Confirmar';
import { EstadoVacio } from '../../componentes/EstadoVacio';
import { Campo, Interruptor, Selector } from '../../componentes/Formulario';
import { Tabla, type Columna } from '../../componentes/Tabla';
import { CLAVES, invalidar, useDatos } from '../../datos';
import { usePuede } from '../../permisos';
import type { Pagina, RolAdmin, Sede, UsuarioAdmin } from '../../tipos';

const COLUMNAS: Columna<UsuarioAdmin>[] = [
  {
    clave: 'nombre',
    titulo: 'Nombre',
    celda: (u) => (
      <>
        <strong>{u.nombre}</strong>
        {u.email && <span className="nota celda-sub">{u.email}</span>}
      </>
    ),
    orden: (u) => u.nombre,
  },
  {
    clave: 'rol',
    titulo: 'Rol',
    celda: (u) =>
      u.roles.length === 0 ? (
        <span className="nota">Sin rol</span>
      ) : (
        u.roles.map((r) => (
          <span key={r.sedeId} className="celda-linea">
            {r.rol}
            {u.roles.length > 1 && <span className="nota"> · {r.sede}</span>}
          </span>
        ))
      ),
    orden: (u) => u.roles[0]?.rol ?? '',
  },
  {
    clave: 'acceso',
    titulo: 'Entra con',
    celda: (u) => [u.tienePin && 'PIN', u.tieneContrasena && 'Contraseña'].filter(Boolean).join(' y ') || '—',
  },
  {
    clave: 'estado',
    titulo: 'Estado',
    celda: (u) => <span className={`etiqueta ${u.activo ? 'etiqueta-verde' : 'etiqueta-gris'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span>,
    orden: (u) => (u.activo ? 0 : 1),
  },
];

export function Usuarios() {
  const navegar = useNavigate();
  const q = useInfiniteQuery({
    queryKey: CLAVES.admin.usuarios,
    queryFn: ({ pageParam }) =>
      api<Pagina<UsuarioAdmin>>('GET', `/usuarios?limite=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (p) => p.siguiente ?? undefined,
  });
  const filas = q.data?.pages.flatMap((p) => p.datos) ?? [];

  return (
    <section className="tarjeta admin-bloque">
      <header className="seccion-cabeza">
        <div>
          <h1>Usuarios</h1>
          <p className="nota">Quién trabaja en el restaurante, con qué rol y cómo entra.</p>
        </div>
        <button className="boton boton-primario" onClick={() => navegar('nuevo')}>
          Nuevo usuario
        </button>
      </header>
      {q.error && <p className="error">{mensajeError(q.error)}</p>}
      <Tabla
        titulo="Usuarios"
        columnas={COLUMNAS}
        filas={filas}
        claveFila={(u) => u.id}
        buscarEn={(u) => `${u.nombre} ${u.email ?? ''} ${u.roles.map((r) => r.rol).join(' ')}`}
        onFila={(u) => navegar(u.id)}
        cargando={q.isPending || q.isFetchingNextPage}
        hayMas={q.hasNextPage}
        onMas={() => q.fetchNextPage()}
        vacio={<EstadoVacio titulo="Todavía no hay usuarios" />}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

/** /admin/usuarios/nuevo o /admin/usuarios/:id */
export function FichaUsuario() {
  const { id = 'nuevo' } = useParams();
  const nuevo = id === 'nuevo';
  const usuario = useDatos(CLAVES.admin.usuario(id), () => api<UsuarioAdmin>('GET', `/usuarios/${id}`), { habilitado: !nuevo });
  const roles = useDatos(CLAVES.admin.roles, () => api<RolAdmin[]>('GET', '/roles'));
  const sedes = useDatos(CLAVES.admin.sedes, () => api<Sede[]>('GET', '/sedes'));

  if (usuario.error) return <p className="error">{usuario.error}</p>;
  if ((!nuevo && !usuario.datos) || !roles.datos || !sedes.datos) return <p className="nota">Cargando…</p>;
  return nuevo ? (
    <AltaUsuario roles={roles.datos} sedes={sedes.datos} />
  ) : (
    <EdicionUsuario key={usuario.datos!.id} usuario={usuario.datos!} roles={roles.datos} sedes={sedes.datos} />
  );
}

/** Un selector de rol por sede; "Sin rol" deja la sede sin acceso */
function RolesPorSede({
  sedes,
  roles,
  valor,
  onCambio,
  deshabilitado,
}: {
  sedes: Sede[];
  roles: RolAdmin[];
  valor: Record<string, string>;
  onCambio: (v: Record<string, string>) => void;
  deshabilitado?: boolean;
}) {
  const puede = usePuede();
  // Como en el servidor: solo se ofrecen los roles cuyos permisos tiene uno mismo, más el que ya tenga
  const opciones = (actual: string) =>
    roles.filter((r) => r.permisos.every(puede) || r.id === actual).map((r) => ({ valor: r.id, texto: r.nombre }));
  return (
    <>
      {sedes.map((s) => (
        <Selector
          key={s.id}
          etiqueta={sedes.length > 1 ? `Rol en ${s.nombre}` : 'Rol'}
          value={valor[s.id] ?? ''}
          vacio="Sin rol"
          opciones={opciones(valor[s.id] ?? '')}
          onCambio={(v) => onCambio({ ...valor, [s.id]: v })}
          disabled={deshabilitado}
          ayuda={roles.find((r) => r.id === valor[s.id])?.descripcion ?? undefined}
        />
      ))}
    </>
  );
}

const aAsignaciones = (v: Record<string, string>) =>
  Object.entries(v)
    .filter(([, rolId]) => rolId)
    .map(([sedeId, rolId]) => ({ sedeId, rolId }));

function AltaUsuario({ roles, sedes }: { roles: RolAdmin[]; sedes: Sede[] }) {
  const navegar = useNavigate();
  const avisar = useAvisar();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [rolPorSede, setRolPorSede] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  return (
    <section className="tarjeta admin-bloque">
      <header className="seccion-cabeza">
        <h1>Nuevo usuario</h1>
        <button className="boton boton-volver" onClick={() => navegar('..', { relative: 'path' })}>
          ‹ Usuarios
        </button>
      </header>
      <form
        className="formulario admin-formulario"
        onSubmit={async (e) => {
          e.preventDefault();
          setEnviando(true);
          setError(null);
          try {
            const creado = await api<UsuarioAdmin>('POST', '/usuarios', {
              nombre: nombre.trim(),
              email: email.trim() || undefined,
              pin: pin || undefined,
              password: password || undefined,
              roles: aAsignaciones(rolPorSede),
            });
            await invalidar(CLAVES.admin.usuarios, CLAVES.admin.roles, CLAVES.usuarios);
            avisar(`${creado.nombre} ya puede entrar`, 'exito');
            navegar(`../${creado.id}`, { relative: 'path', replace: true });
          } catch (err) {
            setError(mensajeError(err));
          } finally {
            setEnviando(false);
          }
        }}
      >
        <Campo etiqueta="Nombre" value={nombre} onCambio={setNombre} maxLength={80} required data-autofoco />
        <RolesPorSede sedes={sedes} roles={roles} valor={rolPorSede} onCambio={setRolPorSede} />
        <Campo
          etiqueta="PIN"
          inputMode="numeric"
          value={pin}
          onCambio={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
          ayuda="De 4 a 8 números. No sirven repetidos ni secuencias como 1234."
          autoComplete="off"
        />
        <Campo etiqueta="Correo" type="email" value={email} onCambio={setEmail} ayuda="Solo hace falta para entrar con contraseña." />
        <Campo
          etiqueta="Contraseña"
          type="password"
          value={password}
          onCambio={setPassword}
          ayuda="Para los roles que administran. Al menos 10 caracteres, con letras y números."
          autoComplete="new-password"
        />
        {error && <p className="error">{error}</p>}
        <button className="boton boton-primario" disabled={enviando || nombre.trim().length < 2}>
          {enviando ? 'Creando…' : 'Crear usuario'}
        </button>
      </form>
    </section>
  );
}

function EdicionUsuario({ usuario, roles, sedes }: { usuario: UsuarioAdmin; roles: RolAdmin[]; sedes: Sede[] }) {
  const navegar = useNavigate();
  const avisar = useAvisar();
  const esUnoMismo = obtenerSesion()?.usuario.id === usuario.id;
  const [nombre, setNombre] = useState(usuario.nombre);
  const [email, setEmail] = useState(usuario.email ?? '');
  const [rolPorSede, setRolPorSede] = useState<Record<string, string>>(Object.fromEntries(usuario.roles.map((r) => [r.sedeId, r.rolId])));
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [confirmando, setConfirmando] = useState<'desactivar' | 'sesiones' | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Corre una acción, avisa y refresca lo que cambió */
  async function hacer(cual: string, accion: () => Promise<unknown>, aviso: string) {
    setOcupado(cual);
    setError(null);
    try {
      await accion();
      await invalidar(CLAVES.admin.usuarios, CLAVES.admin.roles, CLAVES.usuarios);
      avisar(aviso, 'exito');
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    } finally {
      setOcupado(null);
    }
  }

  const datosCambiaron = nombre.trim() !== usuario.nombre || (email.trim() || null) !== usuario.email;
  const rolesCambiaron =
    JSON.stringify(aAsignaciones(rolPorSede).sort((a, b) => a.sedeId.localeCompare(b.sedeId))) !==
    JSON.stringify(usuario.roles.map((r) => ({ sedeId: r.sedeId, rolId: r.rolId })).sort((a, b) => a.sedeId.localeCompare(b.sedeId)));

  return (
    <div className="admin-columna">
      <section className="tarjeta admin-bloque">
        <header className="seccion-cabeza">
          <div>
            <h1>{usuario.nombre}</h1>
            <p className="nota">{usuario.activo ? 'Activo' : 'Inactivo: no puede entrar'}</p>
          </div>
          <button className="boton boton-volver" onClick={() => navegar('..', { relative: 'path' })}>
            ‹ Usuarios
          </button>
        </header>
        {error && <p className="error-bloque">{error}</p>}

        <form
          className="formulario admin-formulario"
          onSubmit={(e) => {
            e.preventDefault();
            hacer('datos', () => api('PATCH', `/usuarios/${usuario.id}`, { nombre: nombre.trim(), email: email.trim() || null }), 'Datos guardados');
          }}
        >
          <h2>Datos</h2>
          <Campo etiqueta="Nombre" value={nombre} onCambio={setNombre} maxLength={80} />
          <Campo etiqueta="Correo" type="email" value={email} onCambio={setEmail} />
          <button className="boton boton-primario" disabled={!datosCambiaron || !!ocupado}>
            Guardar datos
          </button>
        </form>
      </section>

      <section className="tarjeta admin-bloque">
        <form
          className="formulario admin-formulario"
          onSubmit={(e) => {
            e.preventDefault();
            hacer('roles', () => api('PUT', `/usuarios/${usuario.id}/roles`, { roles: aAsignaciones(rolPorSede) }), 'Rol actualizado: se aplica de inmediato');
          }}
        >
          <h2>Rol</h2>
          {esUnoMismo && <p className="nota">No puedes cambiar tu propio rol.</p>}
          <RolesPorSede sedes={sedes} roles={roles} valor={rolPorSede} onCambio={setRolPorSede} deshabilitado={esUnoMismo} />
          <button className="boton boton-primario" disabled={!rolesCambiaron || !!ocupado || esUnoMismo}>
            Guardar rol
          </button>
        </form>
      </section>

      <section className="tarjeta admin-bloque">
        <h2>Acceso</h2>
        <form
          className="fila-campo"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await hacer('pin', () => api('PUT', `/usuarios/${usuario.id}/pin`, { pin }), 'PIN cambiado')) setPin('');
          }}
        >
          <Campo
            etiqueta={usuario.tienePin ? 'PIN nuevo' : 'Asignar PIN'}
            inputMode="numeric"
            value={pin}
            onCambio={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
            autoComplete="off"
          />
          <button className="boton" disabled={pin.length < 4 || !!ocupado}>
            {usuario.tienePin ? 'Cambiar PIN' : 'Asignar PIN'}
          </button>
        </form>
        <form
          className="fila-campo"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await hacer('clave', () => api('PUT', `/usuarios/${usuario.id}/contrasena`, { password }), 'Contraseña cambiada')) setPassword('');
          }}
        >
          <Campo
            etiqueta={usuario.tieneContrasena ? 'Contraseña nueva' : 'Asignar contraseña'}
            type="password"
            value={password}
            onCambio={setPassword}
            autoComplete="new-password"
            ayuda={usuario.email ? 'Al menos 10 caracteres, con letras y números.' : 'Primero guárdale un correo.'}
          />
          <button className="boton" disabled={password.length < 10 || !usuario.email || !!ocupado}>
            {usuario.tieneContrasena ? 'Cambiar contraseña' : 'Asignar contraseña'}
          </button>
        </form>
      </section>

      <section className="tarjeta admin-bloque">
        <h2>Cuenta</h2>
        <Interruptor
          etiqueta="Puede entrar"
          ayuda={esUnoMismo ? 'No te puedes desactivar a ti mismo.' : 'Si lo apagas, sus sesiones abiertas se cierran al momento.'}
          activo={usuario.activo}
          disabled={esUnoMismo || !!ocupado}
          onCambio={(v) =>
            v ? hacer('activo', () => api('PATCH', `/usuarios/${usuario.id}`, { activo: true }), `${usuario.nombre} puede entrar otra vez`) : setConfirmando('desactivar')
          }
        />
        <div className="fila-botones">
          <button className="boton" disabled={!!ocupado} onClick={() => setConfirmando('sesiones')}>
            Cerrar sus sesiones abiertas
          </button>
        </div>
      </section>

      {confirmando === 'desactivar' && (
        <Confirmar
          titulo={`Desactivar a ${usuario.nombre}`}
          mensaje="No podrá entrar y se cierran sus sesiones abiertas en todas las tablets. Su historial de ventas y pedidos no cambia, y lo puedes volver a activar."
          textoConfirmar="Desactivar"
          onCerrar={() => setConfirmando(null)}
          onConfirmar={async () => {
            await api('PATCH', `/usuarios/${usuario.id}`, { activo: false });
            await invalidar(CLAVES.admin.usuarios, CLAVES.usuarios);
            setConfirmando(null);
            avisar(`${usuario.nombre} desactivado`, 'info');
          }}
        />
      )}
      {confirmando === 'sesiones' && (
        <Confirmar
          titulo="Cerrar sus sesiones"
          mensaje={`${usuario.nombre} tendrá que volver a entrar en todas las tablets donde tenga la sesión abierta.`}
          textoConfirmar="Cerrar sesiones"
          onCerrar={() => setConfirmando(null)}
          onConfirmar={async () => {
            await api('POST', `/usuarios/${usuario.id}/cerrar-sesiones`);
            setConfirmando(null);
            avisar('Sesiones cerradas', 'info');
          }}
        />
      )}
    </div>
  );
}
