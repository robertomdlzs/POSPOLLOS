import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MONTO_MAXIMO } from '../common/dinero';

const TIPOS_IMPUESTO = ['impoconsumo', 'iva', 'exento'] as const;
const precio = { message: 'El precio debe ser un número con máximo dos decimales' };

// -------------------------------------------------------------- categorías

export class CrearCategoriaDto {
  @IsString()
  @Length(2, 40, { message: 'El nombre de la categoría debe tener entre 2 y 40 caracteres' })
  nombre: string;
}

export class ActualizarCategoriaDto {
  @IsOptional()
  @IsString()
  @Length(2, 40, { message: 'El nombre de la categoría debe tener entre 2 y 40 caracteres' })
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

/** El orden completo: los ids en el orden en que deben quedar */
export class OrdenDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true, message: 'Hay un id que no es válido' })
  ids: string[];
}

// --------------------------------------------------------------- productos

export class FiltroProductosDto {
  @IsOptional()
  @IsUUID('all', { message: 'La categoría no es válida' })
  categoriaId?: string;
}

export class CrearProductoDto {
  @IsUUID('all', { message: 'Escoge una categoría' })
  categoriaId: string;

  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres' })
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'La descripción no puede pasar de 300 caracteres' })
  descripcion?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, precio)
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(MONTO_MAXIMO, { message: 'El precio es demasiado alto' })
  precio: number;

  @IsIn(TIPOS_IMPUESTO, { message: 'El impuesto debe ser impoconsumo, IVA o exento' })
  tipoImpuesto: (typeof TIPOS_IMPUESTO)[number];

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'La tasa del impuesto debe ser un número' })
  @Min(0, { message: 'La tasa no puede ser negativa' })
  @Max(100, { message: 'La tasa no puede pasar de 100 %' })
  tasaImpuesto: number;

  /** null: ninguna estación (no sale en la pantalla de cocina por estación) */
  @IsOptional()
  @IsUUID('all', { message: 'La estación no es válida' })
  estacionId?: string | null;

  @IsOptional()
  @IsBoolean()
  controlaStock?: boolean;

  /** Grupos de modificadores, en el orden en que se ofrecen */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true, message: 'Hay un grupo de modificadores que no es válido' })
  grupoIds?: string[];
}

export class ActualizarProductoDto {
  @IsOptional()
  @IsUUID('all', { message: 'Escoge una categoría' })
  categoriaId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres' })
  nombre?: string;

  /** null para quitar la descripción */
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'La descripción no puede pasar de 300 caracteres' })
  descripcion?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, precio)
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(MONTO_MAXIMO, { message: 'El precio es demasiado alto' })
  precio?: number;

  @IsOptional()
  @IsIn(TIPOS_IMPUESTO, { message: 'El impuesto debe ser impoconsumo, IVA o exento' })
  tipoImpuesto?: (typeof TIPOS_IMPUESTO)[number];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'La tasa del impuesto debe ser un número' })
  @Min(0, { message: 'La tasa no puede ser negativa' })
  @Max(100, { message: 'La tasa no puede pasar de 100 %' })
  tasaImpuesto?: number;

  @IsOptional()
  @IsUUID('all', { message: 'La estación no es válida' })
  estacionId?: string | null;

  @IsOptional()
  @IsBoolean()
  controlaStock?: boolean;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true, message: 'Hay un grupo de modificadores que no es válido' })
  grupoIds?: string[];
}

export class OrdenProductosDto extends OrdenDto {
  @IsUUID('all', { message: 'La categoría no es válida' })
  categoriaId: string;
}

/** Lo que cambia en una sede: precio propio (null = el general) y si se vende ahí */
export class ProductoSedeDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, precio)
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(MONTO_MAXIMO, { message: 'El precio es demasiado alto' })
  precio?: number | null;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;
}

export class AgotadoDto {
  @IsBoolean({ message: 'Indica si está agotado' })
  agotado: boolean;
}

// ----------------------------------------------------------- modificadores

export class OpcionDto {
  @IsString()
  @Length(1, 60, { message: 'El nombre de la opción debe tener entre 1 y 60 caracteres' })
  nombre: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio extra debe ser un número' })
  @Min(0, { message: 'El precio extra no puede ser negativo' })
  @Max(MONTO_MAXIMO, { message: 'El precio extra es demasiado alto' })
  precioExtra: number;
}

export class CrearGrupoDto {
  @IsString()
  @Length(2, 60, { message: 'El nombre del grupo debe tener entre 2 y 60 caracteres' })
  nombre: string;

  @IsInt({ message: 'El mínimo debe ser un número entero' })
  @Min(0, { message: 'El mínimo no puede ser negativo' })
  @Max(20)
  min: number;

  @IsInt({ message: 'El máximo debe ser un número entero' })
  @Min(1, { message: 'El máximo debe ser al menos 1' })
  @Max(20, { message: 'El máximo no puede pasar de 20' })
  max: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OpcionDto)
  opciones: OpcionDto[];
}

export class ActualizarGrupoDto {
  @IsOptional()
  @IsString()
  @Length(2, 60, { message: 'El nombre del grupo debe tener entre 2 y 60 caracteres' })
  nombre?: string;

  @IsOptional()
  @IsInt({ message: 'El mínimo debe ser un número entero' })
  @Min(0, { message: 'El mínimo no puede ser negativo' })
  @Max(20)
  min?: number;

  @IsOptional()
  @IsInt({ message: 'El máximo debe ser un número entero' })
  @Min(1, { message: 'El máximo debe ser al menos 1' })
  @Max(20, { message: 'El máximo no puede pasar de 20' })
  max?: number;
}

export class ActualizarOpcionDto {
  @IsOptional()
  @IsString()
  @Length(1, 60, { message: 'El nombre de la opción debe tener entre 1 y 60 caracteres' })
  nombre?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio extra debe ser un número' })
  @Min(0, { message: 'El precio extra no puede ser negativo' })
  @Max(MONTO_MAXIMO, { message: 'El precio extra es demasiado alto' })
  precioExtra?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
