import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AutorizacionDto } from '../common/dto';
import { METODOS_PAGO } from '../common/tipos';

export class PagoDto {
  @IsIn(METODOS_PAGO)
  metodo: (typeof METODOS_PAGO)[number];

  /** Lo que se abona a la cuenta con este método */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;

  /** Solo efectivo: lo que entregó el cliente, para calcular el cambio */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  recibido?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referencia?: string;
}

export class CobrarDto {
  @IsUUID()
  idempotencyKey: string;

  @IsUUID()
  pedidoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  caja?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  descuento?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  propina?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PagoDto)
  pagos: PagoDto[];

  /** Obligatoria si hay descuento */
  @IsOptional()
  @ValidateNested()
  @Type(() => AutorizacionDto)
  autorizacion?: AutorizacionDto;
}

export class AnularVentaDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  motivo: string;

  @IsDefined({ message: 'Anular una venta requiere autorización de un supervisor' })
  @ValidateNested()
  @Type(() => AutorizacionDto)
  autorizacion: AutorizacionDto;
}
