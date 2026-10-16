import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequierePermiso, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { InventarioService } from './inventario.service';

@ApiTags('Inventario')
@Controller('inventario')
@RequierePermiso('inventario.ver')
export class InventarioController {
  constructor(private readonly inventario: InventarioService) {}

  @Get('stock')
  stock(@UsuarioActual() u: UsuarioToken) {
    return this.inventario.stock(u);
  }
}
