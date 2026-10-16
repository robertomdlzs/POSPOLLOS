import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';
import { TODOS_LOS_PERMISOS, type Permiso } from '../common/permisos';

// Las reglas de fondo del PIN y la contraseña (repetidos, secuencias, letras y
// números) están en common/credenciales.ts y se revisan en el servicio.

export class AsignacionRolDto {
  @IsUUID('all', { message: 'La sede no es válida' })
  sedeId: string;

  @IsUUID('all', { message: 'El rol no es válido' })
  rolId: string;
}

export class CrearUsuarioDto {
  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres' })
  nombre: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  pin?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AsignacionRolDto)
  roles: AsignacionRolDto[];
}

export class ActualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres' })
  nombre?: string;

  /** null para quitar el correo */
  @IsOptional()
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(120)
  email?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CambiarPinDto {
  @IsString()
  pin: string;
}

export class CambiarContrasenaDto {
  @IsString()
  password: string;
}

export class RolesUsuarioDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AsignacionRolDto)
  roles: AsignacionRolDto[];
}

export class FiltroUsuariosDto extends PaginacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  buscar?: string;
}

export class GuardarRolDto {
  @IsString()
  @Length(2, 40, { message: 'El nombre del rol debe tener entre 2 y 40 caracteres' })
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descripcion?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(TODOS_LOS_PERMISOS, { each: true, message: 'Hay un permiso que no existe' })
  permisos: Permiso[];
}

export class ActualizarRolDto {
  @IsOptional()
  @IsString()
  @Length(2, 40, { message: 'El nombre del rol debe tener entre 2 y 40 caracteres' })
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descripcion?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(TODOS_LOS_PERMISOS, { each: true, message: 'Hay un permiso que no existe' })
  permisos?: Permiso[];
}
