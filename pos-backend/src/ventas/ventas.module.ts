import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  imports: [AuthModule, PedidosModule],
  controllers: [VentasController],
  providers: [VentasService],
})
export class VentasModule {}
