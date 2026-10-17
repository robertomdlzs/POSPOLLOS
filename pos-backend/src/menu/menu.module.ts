import { Module } from '@nestjs/common';
import { CocinaModule } from '../cocina/cocina.module';
import { CategoriasController, ModificadoresController, ProductosController } from './menu-admin.controller';
import { MenuAdminService } from './menu-admin.service';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
  imports: [CocinaModule],
  controllers: [MenuController, CategoriasController, ProductosController, ModificadoresController],
  providers: [MenuService, MenuAdminService],
  exports: [MenuService],
})
export class MenuModule {}
