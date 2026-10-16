import { describe, expect, it } from 'vitest';
import { exigeContrasena, PERMISOS_DE_ADMINISTRACION, problemaContrasena, problemaPin } from './credenciales';

describe('problemaPin', () => {
  it('acepta PIN comunes que no son triviales', () => {
    for (const pin of ['2580', '7391', '104729', '19870311']) expect(problemaPin(pin)).toBeNull();
  });

  it('rechaza repetidos, secuencias, alternados y formatos inválidos', () => {
    for (const pin of ['0000', '1111', '99999999', '1234', '4321', '0123', '9876', '345678', '1212', '2525', '123', '123456789', '12a4', ''])
      expect(problemaPin(pin), pin).not.toBeNull();
  });
});

describe('problemaContrasena', () => {
  it('exige 10 caracteres con letras y números', () => {
    expect(problemaContrasena('CambiaEsto123!')).toBeNull();
    expect(problemaContrasena('corta1')).not.toBeNull();
    expect(problemaContrasena('solamenteletras')).not.toBeNull();
    expect(problemaContrasena('1234567890123')).not.toBeNull();
  });
});

describe('exigeContrasena', () => {
  it('los permisos de administración exigen contraseña; los de operación, no', () => {
    expect(PERMISOS_DE_ADMINISTRACION).toEqual(['menu.editar', 'salon.editar', 'usuario.editar', 'rol.editar', 'config.editar']);
    expect(exigeContrasena(['pedido.tomar', 'venta.descuento', 'reporte.ver'])).toBe(false);
    expect(exigeContrasena(['pedido.tomar', 'usuario.editar'])).toBe(true);
  });
});
