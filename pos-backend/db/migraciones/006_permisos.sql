-- Permisos por acción y roles que define cada restaurante.
--
-- Hasta aquí los roles eran un ENUM fijo en usuario.rol. Ahora:
--   rol               roles de cada empresa; los cinco de fábrica llevan `clave`
--   rol_permiso       qué puede hacer cada rol (códigos de src/common/permisos.ts)
--   usuario_sede_rol  qué rol tiene cada usuario en cada sede
--
-- El rol de fábrica 'admin' no guarda permisos: el código le da todos, también
-- los que se agreguen en el futuro. usuario.rol se conserva mientras el código
-- termina de pasarse a permisos y se retira en una migración posterior.

CREATE TABLE rol (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    nombre          text NOT NULL,
    descripcion     text,
    -- Identifica los roles de fábrica ('admin', 'supervisor', ...); null en los creados por el restaurante
    clave           text,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, nombre),
    UNIQUE (empresa_id, clave)
);

CREATE TABLE rol_permiso (
    rol_id          uuid NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
    permiso         text NOT NULL,
    PRIMARY KEY (rol_id, permiso)
);

CREATE TABLE usuario_sede_rol (
    usuario_id      uuid NOT NULL REFERENCES usuario(id),
    sede_id         uuid NOT NULL REFERENCES sede(id),
    rol_id          uuid NOT NULL REFERENCES rol(id),
    PRIMARY KEY (usuario_id, sede_id)
);
CREATE INDEX usuario_sede_rol_rol ON usuario_sede_rol (rol_id);

-- Crea los cinco roles de fábrica de una empresa con los permisos que tenían
-- como roles fijos. La usan esta migración, la semilla y el alta de empresas.
CREATE FUNCTION crear_roles_sistema(p_empresa uuid) RETURNS void AS $$
DECLARE
    r record;
    v_rol uuid;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('admin',      'Administración', 'Todo, incluida la configuración del restaurante', ARRAY[]::text[]),
            ('supervisor', 'Supervisión',    'Operación completa y aprobación de descuentos, anulaciones y retiros',
                ARRAY['pedido.tomar', 'pedido.anular_enviado', 'cocina.operar', 'caja.operar', 'caja.retiro',
                      'caja.ver_esperado', 'venta.cobrar', 'venta.descuento', 'venta.anular', 'inventario.ver',
                      'reporte.ver', 'auditoria.ver']),
            ('cajero',     'Caja',           'Pedidos, cobro y caja',
                ARRAY['pedido.tomar', 'caja.operar', 'venta.cobrar', 'inventario.ver']),
            ('mesero',     'Salón',          'Mesas y pedidos',
                ARRAY['pedido.tomar', 'cocina.operar']),
            ('cocina',     'Cocina',         'Pantalla de cocina',
                ARRAY['cocina.operar'])
        ) AS t(clave, nombre, descripcion, permisos)
    LOOP
        INSERT INTO rol (empresa_id, nombre, descripcion, clave)
        VALUES (p_empresa, r.nombre, r.descripcion, r.clave)
        ON CONFLICT (empresa_id, clave) DO NOTHING
        RETURNING id INTO v_rol;
        IF v_rol IS NOT NULL THEN
            INSERT INTO rol_permiso (rol_id, permiso) SELECT v_rol, unnest(r.permisos);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Datos existentes: roles de fábrica para cada empresa, y a cada usuario su
-- rol de siempre en todas las sedes activas de su empresa
SELECT crear_roles_sistema(id) FROM empresa;

INSERT INTO usuario_sede_rol (usuario_id, sede_id, rol_id)
SELECT u.id, s.id, r.id
  FROM usuario u
  JOIN sede s ON s.empresa_id = u.empresa_id AND s.activa
  JOIN rol r ON r.empresa_id = u.empresa_id AND r.clave = u.rol::text;
