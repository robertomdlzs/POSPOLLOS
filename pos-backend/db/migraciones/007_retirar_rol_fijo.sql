-- El código ya autoriza solo con permisos (migración 006): se retira el rol fijo.

-- El mesero no veía la pantalla de cocina antes de los permisos; con
-- cocina.operar la vería. Se le quita para conservar lo de siempre. Un
-- restaurante que la quiera para sus meseros la agrega desde el editor de roles.
DELETE FROM rol_permiso rp
 USING rol r
 WHERE rp.rol_id = r.id AND r.clave = 'mesero' AND rp.permiso = 'cocina.operar';

-- Las empresas nuevas también arrancan con el mesero sin cocina
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
                      'reporte.ver', 'auditoria.ver']),
            ('cajero',     'Caja',           'Pedidos, cobro y caja',
                ARRAY['pedido.tomar', 'caja.operar', 'venta.cobrar', 'inventario.ver']),
            ('mesero',     'Salón',          'Mesas y pedidos',
                ARRAY['pedido.tomar']),
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

ALTER TABLE usuario DROP COLUMN rol;
DROP TYPE rol_usuario;
