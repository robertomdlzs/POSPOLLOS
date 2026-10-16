import { IsString, IsUUID, Length, Matches } from 'class-validator';

/** PIN de un supervisor para autorizar una acción sensible */
export class AutorizacionDto {
  @IsUUID()
  supervisorId: string;

  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'El PIN solo lleva números' })
  pin: string;
}
