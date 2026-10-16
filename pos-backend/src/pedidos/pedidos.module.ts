import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CocinaModule } from '../cocina/cocina.module';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';

@Module({
  imports: [AuthModule, CocinaModule],
  controllers: [PedidosController],
  providers: [PedidosService],
  exports: [PedidosService],
})
export class PedidosModule {}
