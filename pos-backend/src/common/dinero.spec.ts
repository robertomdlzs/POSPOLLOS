import { describe, expect, it } from 'vitest';
import { aCentavos, aPesos, calcularTotales } from './dinero';

const linea = (precio: string, cantidad: string, tasa: string, extras = '0') => ({
  precio_unitario: precio,
  extras,
  cantidad,
  tasa_impuesto: tasa,
});

describe('aCentavos y aPesos', () => {
  it('convierte sin perder centavos por la coma flotante', () => {
    expect(aCentavos('0.29')).toBe(29);
    expect(aCentavos('25000.00')).toBe(2_500_000);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(aPesos(2_500_050)).toBe('25000.50');
  });

  it('todos los montos de dos decimales hasta $1.000 van y vuelven igual', () => {
    for (let c = 0; c <= 100_000; c++) expect(aCentavos(aPesos(c))).toBe(c);
  });
});

describe('calcularTotales', () => {
  it('desglosa el impoconsumo de un precio final', () => {
    // 25.000 con 8 % incluido: base 23.148,15
    const t = calcularTotales([linea('25000', '1', '8')]);
    expect(t.bruto).toBe(2_500_000);
    expect(t.subtotal).toBe(2_314_815);
    expect(t.impuestos).toBe(185_185);
  });

  it('suma los extras por unidad y multiplica por la cantidad', () => {
    // El pedido de la prueba de flujo: 2 × (25.000 + 3.000) + 8.000 = 64.000
    const t = calcularTotales([linea('25000', '2', '8', '3000'), linea('8000', '1', '8')]);
    expect(t.bruto).toBe(6_400_000);
    expect(t.subtotal + t.impuestos).toBe(t.bruto);
  });

  it('acepta cantidades fraccionadas', () => {
    const t = calcularTotales([linea('30000', '0.5', '0')]);
    expect(t.bruto).toBe(1_500_000);
    expect(t.impuestos).toBe(0);
  });

  it('los productos exentos no generan impuesto', () => {
    expect(calcularTotales([linea('5000', '3', '0')])).toEqual({ subtotal: 1_500_000, impuestos: 0, bruto: 1_500_000 });
  });

  it('el subtotal más los impuestos siempre da el bruto exacto', () => {
    for (const tasa of ['0', '8', '19']) {
      for (let precio = 100; precio <= 100_000; precio += 997) {
        const t = calcularTotales([linea(String(precio), '3', tasa, '150'), linea('1234.5', '0.25', tasa)]);
        expect(t.subtotal + t.impuestos).toBe(t.bruto);
      }
    }
  });

  it('sin líneas da cero', () => {
    expect(calcularTotales([])).toEqual({ subtotal: 0, impuestos: 0, bruto: 0 });
  });
});
