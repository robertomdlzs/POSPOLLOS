import { Module } from '@nestjs/common';
import { RolesController, SedesController, UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [UsuariosController, RolesController, SedesController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
