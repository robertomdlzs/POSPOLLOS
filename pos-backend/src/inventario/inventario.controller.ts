import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { InventarioService } from './inventario.service';

@ApiTags('Inventario')
@Controller('inventario')
@Roles('supervisor', 'cajero')
export class InventarioController {
  constructor(private readonly inventario: InventarioService) {}

  @Get('stock')
  stock(@UsuarioActual() u: UsuarioToken) {
    return this.inventario.stock(u);
  }
}
