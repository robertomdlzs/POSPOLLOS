import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { AbrirTurnoDto, CerrarTurnoDto, MovimientoCajaDto } from './caja.dto';
import { CajaService } from './caja.service';

class FiltroCajaDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  caja?: string;
}

@ApiTags('Caja')
@Controller('caja')
@Roles('cajero', 'supervisor')
export class CajaController {
  constructor(private readonly caja: CajaService) {}

  @Post('turnos')
  abrir(@Body() dto: AbrirTurnoDto, @UsuarioActual() u: UsuarioToken) {
    return this.caja.abrir(dto, u);
  }

  @Get('turnos/actual')
  actual(@Query() f: FiltroCajaDto, @UsuarioActual() u: UsuarioToken) {
    return this.caja.actual(u, f.caja);
  }

  @Post('turnos/:id/movimientos')
  movimiento(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MovimientoCajaDto,
    @UsuarioActual() u: UsuarioToken,
  ) {
    return this.caja.movimiento(id, dto, u);
  }

  @Post('turnos/:id/cerrar')
  @HttpCode(200)
  cerrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CerrarTurnoDto,
    @UsuarioActual() u: UsuarioToken,
  ) {
    return this.caja.cerrar(id, dto, u);
  }
}
