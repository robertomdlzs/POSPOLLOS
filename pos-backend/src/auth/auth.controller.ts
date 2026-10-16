import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Publico, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { LoginPasswordDto, LoginPinDto, RefreshDto } from './auth.dto';
import { AuthService } from './auth.service';

// Límite estricto contra fuerza bruta: 10 intentos por minuto por IP
const LIMITE_LOGIN = { default: { limit: 10, ttl: 60_000 } };

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
  @Post('pin')
  @HttpCode(200)
  loginPin(@Body() dto: LoginPinDto, @Headers('user-agent') ua?: string) {
    return this.auth.loginPin(dto, ua);
  }

  @Publico()
  @Throttle(LIMITE_LOGIN)
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

  @Get('yo')
  yo(@UsuarioActual() u: UsuarioToken) {
    return u;
  }
}
