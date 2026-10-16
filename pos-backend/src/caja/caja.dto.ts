import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { MONTO_MAXIMO } from '../common/dinero';
import { AutorizacionDto } from '../common/dto';

export class AbrirTurnoDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  caja?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MONTO_MAXIMO, { message: '$property supera el máximo permitido' })
  montoInicial: number;
}

export class MovimientoCajaDto {
  @IsIn(['ingreso', 'egreso'])
  tipo: 'ingreso' | 'egreso';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MONTO_MAXIMO, { message: '$property supera el máximo permitido' })
  monto: number;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  motivo: string;

  /** Los retiros de efectivo de un cajero requieren PIN de supervisor */
  @IsOptional()
  @ValidateNested()
  @Type(() => AutorizacionDto)
  autorizacion?: AutorizacionDto;
}

export class CerrarTurnoDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MONTO_MAXIMO, { message: '$property supera el máximo permitido' })
  montoContado: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacion?: string;
}
