import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Publico, UsuarioActual } from '../common/decoradores';
import { INGRESOS_POR_IP, RutaIngreso } from '../common/limites';
import type { UsuarioToken } from '../common/tipos';
import { DesbloquearDto, LoginPasswordDto, LoginPinDto, RefreshDto } from './auth.dto';
import { AuthService } from './auth.service';

// Contra fuerza bruta: tope por IP para todos los usuarios juntos, más el límite
// por usuario que aplica @RutaIngreso (ver common/limites.ts)
const LIMITE_LOGIN = { default: { limit: INGRESOS_POR_IP, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Get('usuarios')
  usuarios() {
    return this.auth.usuariosConPin();
  }

  @Publico()
  @Throttle(LIMITE_LOGIN)
  @RutaIngreso()
  @Post('pin')
  @HttpCode(200)
  loginPin(@Body() dto: LoginPinDto, @Headers('user-agent') ua?: string) {
    return this.auth.loginPin(dto, ua);
  }

  @Publico()
  @Throttle(LIMITE_LOGIN)
  @RutaIngreso()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginPasswordDto, @Headers('user-agent') ua?: string) {
    return this.auth.loginPassword(dto, ua);
  }

  @Publico()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Headers('user-agent') ua?: string) {
    return this.auth.refrescar(dto.refreshToken, ua);
  }

  @Publico()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.cerrarSesion(dto.refreshToken);
  }

  /** La tablet se bloqueó por inactividad: el mismo usuario vuelve con su PIN */
  @Throttle(LIMITE_LOGIN)
  @Post('desbloquear')
  @HttpCode(204)
  async desbloquear(@Body() dto: DesbloquearDto, @UsuarioActual() u: UsuarioToken) {
    await this.auth.desbloquear(u, dto.pin);
  }

  @Get('yo')
  yo(@UsuarioActual() u: UsuarioToken) {
    return u;
  }
}
