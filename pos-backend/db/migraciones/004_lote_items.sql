-- Idempotencia al agregar productos a un pedido ya abierto: cada tanda
-- lleva una clave, y un reintento con la misma clave no vuelve a insertar.
CREATE TABLE pedido_lote (
    idempotency_key uuid PRIMARY KEY,
    pedido_id       uuid NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
    usuario_id      uuid NOT NULL REFERENCES usuario(id),
    creado_en       timestamptz NOT NULL DEFAULT now()
);
