import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Roles, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { PedidosModule } from '../pedidos/pedidos.module';
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

@Module({
  imports: [AuthModule, PedidosModule],
  controllers: [VentasController],
  providers: [VentasService],
})
export class VentasModule {}
