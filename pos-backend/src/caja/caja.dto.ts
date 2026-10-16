import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AutorizacionDto } from '../common/dto';

export class AbrirTurnoDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  caja?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montoInicial: number;
}

export class MovimientoCajaDto {
  @IsIn(['ingreso', 'egreso'])
  tipo: 'ingreso' | 'egreso';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
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
  montoContado: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacion?: string;
}
