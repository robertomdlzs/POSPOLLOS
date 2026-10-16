import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditoriaModule } from './auditoria/auditoria.service';
import { AuthModule } from './auth/auth.module';
import { CajaModule } from './caja/caja.module';
import { CocinaModule } from './cocina/cocina.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { LIMITES } from './common/limites';
import { opcionesLogs } from './common/logs';
import { RevocacionModule } from './common/revocacion';
import { config } from './config';
import { DatabaseModule } from './database/database.module';
import { MenuModule } from './menu/menu.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { VentasModule } from './ventas/ventas.module';

@Module({
  imports: [
    LoggerModule.forRoot(opcionesLogs),
    // Límite general por IP, y uno por usuario en las rutas de ingreso
    ThrottlerModule.forRoot(LIMITES),
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: config.accessTtlSegundos },
    }),
    DatabaseModule,
    RevocacionModule,
    AuditoriaModule,
    AuthModule,
    MenuModule,
    CocinaModule,
    PedidosModule,
    CajaModule,
    VentasModule,
  ],
  providers: [
    // Orden: límite de peticiones → autenticación → roles. Todo es privado salvo @Publico()
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
