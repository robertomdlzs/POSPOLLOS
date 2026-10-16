-- Los PIN de supervisor errados cuentan contra quien pide la autorización,
-- no contra el supervisor: así un cajero no puede dejarlo bloqueado.
ALTER TABLE usuario
    ADD COLUMN intentos_autorizacion        int NOT NULL DEFAULT 0,
    ADD COLUMN autorizacion_bloqueada_hasta timestamptz;
