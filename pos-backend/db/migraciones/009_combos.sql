-- Combos y menú del día (tarea 1.3.6).
--
-- Un combo es un producto de tipo 'combo' con secciones ("Plato fuerte",
-- "Bebida"), cada una con un mínimo, un máximo y sus opciones, que son otros
-- productos (con un precio extra opcional). Al pedirlo, el combo queda como un
-- ítem con su precio y cada componente elegido como un ítem hijo
-- (combo_item_id) de precio 0 más su extra: así cada componente va a su
-- estación de cocina y descuenta su receta del inventario como cualquier otro.

ALTER TABLE producto ADD COLUMN tipo text NOT NULL DEFAULT 'simple' CHECK (tipo IN ('simple', 'combo'));

CREATE TABLE combo_seccion (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    combo_id        uuid NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
    nombre          text NOT NULL,
    min_seleccion   int NOT NULL DEFAULT 1,
    max_seleccion   int NOT NULL DEFAULT 1,
    orden           int NOT NULL DEFAULT 0,
    CHECK (min_seleccion >= 0 AND max_seleccion >= 1 AND max_seleccion >= min_seleccion)
);
CREATE INDEX combo_seccion_combo ON combo_seccion (combo_id);

CREATE TABLE combo_opcion (
    seccion_id      uuid NOT NULL REFERENCES combo_seccion(id) ON DELETE CASCADE,
    producto_id     uuid NOT NULL REFERENCES producto(id),
    precio_extra    numeric(14,2) NOT NULL DEFAULT 0 CHECK (precio_extra >= 0),
    orden           int NOT NULL DEFAULT 0,
    PRIMARY KEY (seccion_id, producto_id)
);

-- Componentes de un combo dentro de un pedido
ALTER TABLE pedido_item
    ADD COLUMN combo_item_id  uuid REFERENCES pedido_item(id) ON DELETE CASCADE,
    ADD COLUMN combo_seccion  text;
CREATE INDEX pedido_item_combo ON pedido_item (combo_item_id) WHERE combo_item_id IS NOT NULL;
