-- =====================================================================
-- POS Restaurante - Esquema base (MVP, un solo restaurante)
-- PostgreSQL 14+
--
-- Nota de escalabilidad: las tablas raíz llevan empresa_id / sede_id
-- aunque hoy exista una sola empresa y una sola sede. Agregarlos
-- después obliga a migrar todos los datos; tenerlos desde ya cuesta poco.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
CREATE TYPE rol_usuario      AS ENUM ('admin', 'supervisor', 'cajero', 'mesero', 'cocina');
CREATE TYPE estado_mesa      AS ENUM ('libre', 'ocupada', 'reservada', 'inactiva');
CREATE TYPE tipo_servicio    AS ENUM ('mesa', 'mostrador', 'domicilio', 'para_llevar');
CREATE TYPE estado_pedido    AS ENUM ('abierto', 'en_cocina', 'servido', 'pagado', 'anulado');
CREATE TYPE estado_item      AS ENUM ('pendiente', 'preparando', 'listo', 'entregado', 'anulado');
CREATE TYPE tipo_impuesto    AS ENUM ('impoconsumo', 'iva', 'exento');
CREATE TYPE estado_turno     AS ENUM ('abierto', 'cerrado');
CREATE TYPE estado_venta     AS ENUM ('pagada', 'anulada');
CREATE TYPE metodo_pago      AS ENUM ('efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata', 'otro');
CREATE TYPE tipo_mov_caja    AS ENUM ('ingreso', 'egreso');
CREATE TYPE unidad_medida    AS ENUM ('g', 'kg', 'ml', 'l', 'und');
CREATE TYPE tipo_mov_inv     AS ENUM ('compra', 'venta', 'ajuste', 'merma', 'devolucion');

-- ---------------------------------------------------------------------
-- Organización
-- ---------------------------------------------------------------------
CREATE TABLE empresa (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          text NOT NULL,
    nit             text NOT NULL UNIQUE,
    config          jsonb NOT NULL DEFAULT '{}',   -- propina sugerida, modos de servicio activos, etc.
    creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sede (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    nombre          text NOT NULL,
    direccion       text,
    telefono        text,
    activa          boolean NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    nombre          text NOT NULL,
    email           text,
    password_hash   text,                -- para admin/supervisor (login completo)
    pin_hash        text,                -- PIN corto para cambio rápido en caja/meseros
    rol             rol_usuario NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT usuario_credencial CHECK (password_hash IS NOT NULL OR pin_hash IS NOT NULL),
    UNIQUE (empresa_id, email)
);

-- ---------------------------------------------------------------------
-- Salón
-- ---------------------------------------------------------------------
CREATE TABLE zona (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sede_id         uuid NOT NULL REFERENCES sede(id),
    nombre          text NOT NULL,        -- Terraza, Salón principal, Barra
    orden           int NOT NULL DEFAULT 0
);

CREATE TABLE mesa (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sede_id         uuid NOT NULL REFERENCES sede(id),
    zona_id         uuid REFERENCES zona(id),
    numero          text NOT NULL,
    capacidad       int NOT NULL DEFAULT 4 CHECK (capacidad > 0),
    estado          estado_mesa NOT NULL DEFAULT 'libre',
    pos_x           int,                  -- posición en el plano del salón
    pos_y           int,
    UNIQUE (sede_id, numero)
);

-- ---------------------------------------------------------------------
-- Menú
-- ---------------------------------------------------------------------
CREATE TABLE estacion_cocina (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sede_id         uuid NOT NULL REFERENCES sede(id),
    nombre          text NOT NULL,        -- Parrilla, Bar, Fríos
    impresora       text                  -- identificador para el agente local
);

CREATE TABLE categoria (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    nombre          text NOT NULL,
    orden           int NOT NULL DEFAULT 0,
    activa          boolean NOT NULL DEFAULT true
);

CREATE TABLE producto (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    categoria_id    uuid NOT NULL REFERENCES categoria(id),
    estacion_id     uuid REFERENCES estacion_cocina(id),
    nombre          text NOT NULL,
    descripcion     text,
    precio          numeric(14,2) NOT NULL CHECK (precio >= 0),   -- precio final al público
    tipo_impuesto   tipo_impuesto NOT NULL DEFAULT 'impoconsumo',
    tasa_impuesto   numeric(5,2) NOT NULL DEFAULT 0 CHECK (tasa_impuesto >= 0),
    controla_stock  boolean NOT NULL DEFAULT false,
    activo          boolean NOT NULL DEFAULT true,
    creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grupo_modificador (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    nombre          text NOT NULL,        -- "Término de la carne", "Adiciones"
    min_seleccion   int NOT NULL DEFAULT 0,
    max_seleccion   int NOT NULL DEFAULT 1,
    CHECK (min_seleccion >= 0 AND max_seleccion >= min_seleccion)
);

CREATE TABLE modificador (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_id        uuid NOT NULL REFERENCES grupo_modificador(id) ON DELETE CASCADE,
    nombre          text NOT NULL,        -- "Tres cuartos", "Extra queso"
    precio_extra    numeric(14,2) NOT NULL DEFAULT 0,
    activo          boolean NOT NULL DEFAULT true
);

CREATE TABLE producto_grupo_modificador (
    producto_id     uuid NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
    grupo_id        uuid NOT NULL REFERENCES grupo_modificador(id) ON DELETE CASCADE,
    PRIMARY KEY (producto_id, grupo_id)
);

-- ---------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------
CREATE TABLE turno_caja (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sede_id             uuid NOT NULL REFERENCES sede(id),
    caja                text NOT NULL DEFAULT 'Caja 1',
    abierto_por         uuid NOT NULL REFERENCES usuario(id),
    abierto_en          timestamptz NOT NULL DEFAULT now(),
    monto_inicial       numeric(14,2) NOT NULL DEFAULT 0,
    cerrado_por         uuid REFERENCES usuario(id),
    cerrado_en          timestamptz,
    monto_esperado      numeric(14,2),
    monto_contado       numeric(14,2),
    estado              estado_turno NOT NULL DEFAULT 'abierto'
);
-- Solo un turno abierto por caja
CREATE UNIQUE INDEX turno_unico_abierto ON turno_caja (sede_id, caja) WHERE estado = 'abierto';

CREATE TABLE movimiento_caja (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turno_id        uuid NOT NULL REFERENCES turno_caja(id),
    tipo            tipo_mov_caja NOT NULL,
    monto           numeric(14,2) NOT NULL CHECK (monto > 0),
    motivo          text NOT NULL,
    usuario_id      uuid NOT NULL REFERENCES usuario(id),
    creado_en       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
CREATE TABLE pedido (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sede_id             uuid NOT NULL REFERENCES sede(id),
    numero              bigint GENERATED ALWAYS AS IDENTITY,
    tipo_servicio       tipo_servicio NOT NULL,
    mesa_id             uuid REFERENCES mesa(id),
    mesero_id           uuid REFERENCES usuario(id),
    cliente_nombre      text,
    cliente_telefono    text,
    direccion_entrega   text,
    personas            int,
    notas               text,
    estado              estado_pedido NOT NULL DEFAULT 'abierto',
    idempotency_key     uuid NOT NULL UNIQUE,   -- evita duplicados al sincronizar offline
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pedido_mesa_requerida CHECK (tipo_servicio <> 'mesa' OR mesa_id IS NOT NULL)
);
CREATE INDEX pedido_abiertos ON pedido (sede_id, estado) WHERE estado NOT IN ('pagado', 'anulado');

CREATE TABLE pedido_item (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id           uuid NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
    producto_id         uuid NOT NULL REFERENCES producto(id),
    -- Copias del momento de la venta: si el precio cambia mañana, el histórico no se altera
    nombre_producto     text NOT NULL,
    precio_unitario     numeric(14,2) NOT NULL,
    tipo_impuesto       tipo_impuesto NOT NULL,
    tasa_impuesto       numeric(5,2) NOT NULL,
    cantidad            numeric(10,3) NOT NULL CHECK (cantidad > 0),
    notas               text,                 -- "sin cebolla"
    estado              estado_item NOT NULL DEFAULT 'pendiente',
    enviado_cocina_en   timestamptz,
    anulado_por         uuid REFERENCES usuario(id),
    motivo_anulacion    text,
    creado_en           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pedido_item_pedido ON pedido_item (pedido_id);

CREATE TABLE pedido_item_modificador (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_item_id      uuid NOT NULL REFERENCES pedido_item(id) ON DELETE CASCADE,
    modificador_id      uuid NOT NULL REFERENCES modificador(id),
    nombre              text NOT NULL,
    precio_extra        numeric(14,2) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Ventas y pagos
-- ---------------------------------------------------------------------
CREATE TABLE venta (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id           uuid NOT NULL REFERENCES pedido(id),
    turno_id            uuid NOT NULL REFERENCES turno_caja(id),
    cajero_id           uuid NOT NULL REFERENCES usuario(id),
    subtotal            numeric(14,2) NOT NULL,
    impuestos           numeric(14,2) NOT NULL DEFAULT 0,
    descuento           numeric(14,2) NOT NULL DEFAULT 0,
    descuento_autorizado_por uuid REFERENCES usuario(id),
    propina             numeric(14,2) NOT NULL DEFAULT 0,
    total               numeric(14,2) NOT NULL,
    estado              estado_venta NOT NULL DEFAULT 'pagada',
    -- Facturación electrónica (la llena la integración con el proveedor DIAN)
    factura_numero      text,
    factura_cufe        text,
    factura_estado      text,
    anulada_por         uuid REFERENCES usuario(id),
    motivo_anulacion    text,
    idempotency_key     uuid NOT NULL UNIQUE,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT venta_total_ok CHECK (total = subtotal + impuestos - descuento + propina),
    CONSTRAINT venta_descuento_autorizado CHECK (descuento = 0 OR descuento_autorizado_por IS NOT NULL)
);
CREATE INDEX venta_turno ON venta (turno_id);
CREATE INDEX venta_fecha ON venta (creado_en);

CREATE TABLE pago (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id        uuid NOT NULL REFERENCES venta(id),
    metodo          metodo_pago NOT NULL,
    monto           numeric(14,2) NOT NULL CHECK (monto > 0),
    recibido        numeric(14,2),           -- efectivo entregado por el cliente
    referencia      text,                    -- voucher, # transferencia
    creado_en       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
CREATE TABLE insumo (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    nombre          text NOT NULL,
    unidad          unidad_medida NOT NULL,
    costo_unitario  numeric(14,4) NOT NULL DEFAULT 0,
    stock_minimo    numeric(14,3) NOT NULL DEFAULT 0,
    activo          boolean NOT NULL DEFAULT true
);

-- Receta: cuánto de cada insumo consume una unidad de producto
CREATE TABLE receta (
    producto_id     uuid NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
    insumo_id       uuid NOT NULL REFERENCES insumo(id),
    cantidad        numeric(14,3) NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (producto_id, insumo_id)
);

-- Stock actual por sede (se mantiene con trigger desde los movimientos)
CREATE TABLE stock_insumo (
    sede_id         uuid NOT NULL REFERENCES sede(id),
    insumo_id       uuid NOT NULL REFERENCES insumo(id),
    cantidad        numeric(14,3) NOT NULL DEFAULT 0,
    actualizado_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sede_id, insumo_id)
);

-- Kardex: cada entrada y salida queda registrada; el stock es la suma
CREATE TABLE movimiento_inventario (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sede_id         uuid NOT NULL REFERENCES sede(id),
    insumo_id       uuid NOT NULL REFERENCES insumo(id),
    tipo            tipo_mov_inv NOT NULL,
    cantidad        numeric(14,3) NOT NULL CHECK (cantidad <> 0),  -- positivo entra, negativo sale
    costo_unitario  numeric(14,4),
    referencia_id   uuid,                    -- venta, compra, etc.
    usuario_id      uuid REFERENCES usuario(id),
    nota            text,
    creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mov_inv_insumo ON movimiento_inventario (sede_id, insumo_id, creado_en);

CREATE FUNCTION fn_aplicar_movimiento_inventario() RETURNS trigger AS $$
BEGIN
    INSERT INTO stock_insumo (sede_id, insumo_id, cantidad, actualizado_en)
    VALUES (NEW.sede_id, NEW.insumo_id, NEW.cantidad, now())
    ON CONFLICT (sede_id, insumo_id)
    DO UPDATE SET cantidad = stock_insumo.cantidad + EXCLUDED.cantidad,
                  actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movimiento_inventario
AFTER INSERT ON movimiento_inventario
FOR EACH ROW EXECUTE FUNCTION fn_aplicar_movimiento_inventario();

-- ---------------------------------------------------------------------
-- Auditoría (solo inserción: no se puede editar ni borrar)
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id      uuid REFERENCES usuario(id),
    autorizado_por  uuid REFERENCES usuario(id),
    accion          text NOT NULL,           -- 'anular_item', 'aplicar_descuento', 'abrir_cajon'...
    entidad         text NOT NULL,
    entidad_id      uuid,
    datos           jsonb,
    dispositivo     text,
    creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_entidad ON auditoria (entidad, entidad_id);

CREATE FUNCTION fn_auditoria_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'La auditoría no se puede modificar ni eliminar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_inmutable
BEFORE UPDATE OR DELETE ON auditoria
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_inmutable();
