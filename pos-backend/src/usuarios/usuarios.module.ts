import { Module } from '@nestjs/common';
import { RolesController, UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [UsuariosController, RolesController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
