import { Navigate, NavLink, Route, Routes } from 'react-router';
import { usePuede, type Permiso } from '../../permisos';
import { Menu } from './Menu';
import { Muestra } from './Muestra';
import { FichaRol, Roles } from './Roles';
import { FichaUsuario, Usuarios } from './Usuarios';

/** Áreas del panel; cada una aparece si se tiene alguno de sus permisos */
const AREAS: { ruta: string; nombre: string; permisos: Permiso[] }[] = [
  { ruta: 'menu', nombre: 'Menú', permisos: ['menu.editar'] },
  { ruta: 'usuarios', nombre: 'Usuarios', permisos: ['usuario.editar'] },
  { ruta: 'roles', nombre: 'Roles y permisos', permisos: ['rol.editar', 'usuario.editar'] },
];

export function Admin() {
  const puede = usePuede();
  const areas = AREAS.filter((a) => a.permisos.some(puede));
  const inicio = areas[0]?.ruta ?? 'muestra';

  return (
    <div className="admin-pantalla">
      <nav className="admin-nav fila-chips" aria-label="Administración">
        {areas.map((a) => (
          // Absoluta: dentro de una ruta con * un enlace relativo se resuelve desde la URL completa
          <NavLink key={a.ruta} to={`/admin/${a.ruta}`} className={({ isActive }) => `chip ${isActive ? 'activo' : ''}`}>
            {a.nombre}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to={`/admin/${inicio}`} replace />} />
        {puede('menu.editar') && <Route path="menu/*" element={<Menu />} />}
        {puede('usuario.editar') && (
          <>
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="usuarios/:id" element={<FichaUsuario />} />
          </>
        )}
        {(puede('rol.editar') || puede('usuario.editar')) && (
          <>
            <Route path="roles" element={<Roles />} />
            <Route path="roles/:id" element={<FichaRol />} />
          </>
        )}
        <Route path="muestra" element={<Muestra />} />
        <Route path="*" element={<Navigate to={`/admin/${inicio}`} replace />} />
      </Routes>
    </div>
  );
}
