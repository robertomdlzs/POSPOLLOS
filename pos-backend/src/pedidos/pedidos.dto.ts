import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AutorizacionDto } from '../common/dto';
import { TIPOS_SERVICIO } from '../common/tipos';

export class ItemPedidoDto {
  @IsUUID()
  productoId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999)
  cantidad: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notas?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  modificadorIds?: string[];
}

export class CrearPedidoDto {
  /** Lo genera el cliente (crypto.randomUUID) para que un reintento no duplique el pedido */
  @IsUUID()
  idempotencyKey: string;

  @IsIn(TIPOS_SERVICIO)
  tipoServicio: (typeof TIPOS_SERVICIO)[number];

  @ValidateIf((o) => o.tipoServicio === 'mesa' || o.mesaId !== undefined)
  @IsUUID()
  mesaId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  clienteNombre?: string;

  @IsOptional() @IsString() @MaxLength(30)
  clienteTelefono?: string;

  @ValidateIf((o) => o.tipoServicio === 'domicilio' || o.direccionEntrega !== undefined)
  @IsString()
  @MaxLength(250)
  direccionEntrega?: string;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  personas?: number;

  @IsOptional() @IsString() @MaxLength(300)
  notas?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  items: ItemPedidoDto[];
}

export class AgregarItemsDto {
  /** Una por tanda de productos; se conserva en los reintentos para no duplicar */
  @IsUUID()
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  items: ItemPedidoDto[];
}

export class AnularItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  motivo: string;

  /** Obligatoria si el ítem ya se envió a cocina */
  @IsOptional()
  @ValidateNested()
  @Type(() => AutorizacionDto)
  autorizacion?: AutorizacionDto;
}
