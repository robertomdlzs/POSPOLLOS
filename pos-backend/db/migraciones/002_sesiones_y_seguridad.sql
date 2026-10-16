-- Sesiones con refresh token rotativo y bloqueo por intentos fallidos

ALTER TABLE usuario
    ADD COLUMN intentos_fallidos int NOT NULL DEFAULT 0,
    ADD COLUMN bloqueado_hasta   timestamptz;

CREATE TABLE sesion (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      uuid NOT NULL REFERENCES usuario(id),
    sede_id         uuid NOT NULL REFERENCES sede(id),
    token_hash      text NOT NULL,           -- sha256 del secreto; el secreto nunca se guarda
    expira_en       timestamptz NOT NULL,
    revocada_en     timestamptz,
    dispositivo     text,
    creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sesion_usuario ON sesion (usuario_id) WHERE revocada_en IS NULL;

-- Un pedido solo puede tener una venta vigente
CREATE UNIQUE INDEX venta_unica_pagada ON venta (pedido_id) WHERE estado = 'pagada';
