import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { AnularVentaDto, CobrarDto } from './ventas.dto';
import { VentasService } from './ventas.service';

@ApiTags('Ventas')
@Controller('ventas')
@Roles('cajero', 'supervisor')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Post('cobrar')
  cobrar(@Body() dto: CobrarDto, @UsuarioActual() u: UsuarioToken) {
    return this.ventas.cobrar(dto, u);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.ventas.obtener(id, u);
  }

  @Post(':id/anular')
  @HttpCode(200)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularVentaDto,
    @UsuarioActual() u: UsuarioToken,
  ) {
    return this.ventas.anular(id, dto, u);
  }
}
