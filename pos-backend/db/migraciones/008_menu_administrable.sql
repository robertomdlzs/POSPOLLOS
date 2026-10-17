-- Menú administrable desde el panel (tareas 1.3.1, 1.3.3, 1.3.4 y 1.3.5).

-- Orden por arrastre en productos y modificadores (las categorías ya lo tienen)
ALTER TABLE producto ADD COLUMN orden int NOT NULL DEFAULT 0;
ALTER TABLE grupo_modificador ADD COLUMN orden int NOT NULL DEFAULT 0;
ALTER TABLE modificador ADD COLUMN orden int NOT NULL DEFAULT 0;
ALTER TABLE producto_grupo_modificador ADD COLUMN orden int NOT NULL DEFAULT 0;

-- Los productos existentes quedan en orden alfabético dentro de su categoría
UPDATE producto p SET orden = x.n
  FROM (SELECT id, row_number() OVER (PARTITION BY categoria_id ORDER BY nombre) AS n FROM producto) x
 WHERE x.id = p.id;
UPDATE modificador m SET orden = x.n
  FROM (SELECT id, row_number() OVER (PARTITION BY grupo_id ORDER BY nombre) AS n FROM modificador) x
 WHERE x.id = m.id;

-- Dos categorías o dos grupos con el mismo nombre confunden en la tablet
CREATE UNIQUE INDEX categoria_nombre_unico ON categoria (empresa_id, lower(nombre));
CREATE UNIQUE INDEX grupo_modificador_nombre_unico ON grupo_modificador (empresa_id, lower(nombre));

-- Lo que cambia de una sede a otra. Sin fila, el producto se vende en la sede
-- al precio general y no está agotado.
CREATE TABLE producto_sede (
    producto_id     uuid NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
    sede_id         uuid NOT NULL REFERENCES sede(id),
    -- null: el precio general del producto
    precio          numeric(14,2) CHECK (precio >= 0),
    -- false: no se vende en esta sede (no aparece en sus tablets)
    disponible      boolean NOT NULL DEFAULT true,
    -- Se acabó durante el servicio: aparece tachado y no se puede pedir
    agotado         boolean NOT NULL DEFAULT false,
    actualizado_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (producto_id, sede_id)
);

-- Marcar agotados durante el servicio, sin poder editar el menú
INSERT INTO rol_permiso (rol_id, permiso)
SELECT id, 'menu.agotar' FROM rol WHERE clave IN ('supervisor', 'cocina')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION crear_roles_sistema(p_empresa uuid) RETURNS void AS $$
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
                      'menu.agotar', 'reporte.ver', 'auditoria.ver']),
            ('cajero',     'Caja',           'Pedidos, cobro y caja',
                ARRAY['pedido.tomar', 'caja.operar', 'venta.cobrar', 'inventario.ver']),
            ('mesero',     'Salón',          'Mesas y pedidos',
                ARRAY['pedido.tomar']),
            ('cocina',     'Cocina',         'Pantalla de cocina',
                ARRAY['cocina.operar', 'menu.agotar'])
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
