import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { AgregarItemsDto, AnularItemDto, CrearPedidoDto } from './pedidos.dto';
import { PedidosService } from './pedidos.service';

@Controller('pedidos')
@Roles('mesero', 'cajero', 'supervisor')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Post()
  crear(@Body() dto: CrearPedidoDto, @UsuarioActual() u: UsuarioToken) {
    return this.pedidos.crear(dto, u);
  }

  @Get()
  abiertos(@UsuarioActual() u: UsuarioToken) {
    return this.pedidos.listarAbiertos(u);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.pedidos.obtener(id, u);
  }

  @Post(':id/items')
  agregarItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgregarItemsDto,
    @UsuarioActual() u: UsuarioToken,
  ) {
    return this.pedidos.agregarItems(id, dto, u);
  }

  @Post(':id/enviar-cocina')
  @HttpCode(200)
  enviarACocina(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.pedidos.enviarACocina(id, u);
  }

  @Post(':id/cerrar-vacio')
  @HttpCode(200)
  cerrarVacio(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.pedidos.cerrarVacio(id, u);
  }

  @Post(':id/items/:itemId/anular')
  @HttpCode(200)
  anularItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: AnularItemDto,
    @UsuarioActual() u: UsuarioToken,
  ) {
    return this.pedidos.anularItem(id, itemId, dto, u);
  }
}
