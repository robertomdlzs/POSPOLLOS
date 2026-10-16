import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { MenuService } from './menu.service';

@ApiTags('Menú y mesas')
@Controller()
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('menu')
  menu(@UsuarioActual() u: UsuarioToken) {
    return this.menuService.menu(u);
  }

  @Get('mesas')
  mesas(@UsuarioActual() u: UsuarioToken) {
    return this.menuService.mesas(u);
  }
}
