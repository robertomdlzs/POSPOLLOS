import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { TODOS_LOS_PERMISOS, type Permiso } from '../common/permisos';

export class LoginPinDto {
  @IsUUID()
  usuarioId: string;

  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'El PIN solo lleva números' })
  pin: string;

  @IsOptional()
  @IsUUID()
  sedeId?: string;
}

export class LoginPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 128)
  password: string;

  @IsOptional()
  @IsUUID()
  sedeId?: string;
}

/** PIN del propio usuario para volver a la pantalla bloqueada por inactividad */
export class DesbloquearDto {
  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'El PIN solo lleva números' })
  pin: string;
}

export class AutorizadoresDto {
  @IsIn(TODOS_LOS_PERMISOS, { message: 'Permiso desconocido' })
  permiso: Permiso;
}

export class RefreshDto {
  @IsString()
  @MaxLength(200)
  refreshToken: string;
}
