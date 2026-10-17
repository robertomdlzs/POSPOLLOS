import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequierePermiso, UsuarioActual } from '../common/decoradores';
import { PERMISOS, TODOS_LOS_PERMISOS } from '../common/permisos';
import type { UsuarioToken } from '../common/tipos';
import {
  ActualizarRolDto,
  ActualizarUsuarioDto,
  CambiarContrasenaDto,
  CambiarPinDto,
  CrearUsuarioDto,
  FiltroUsuariosDto,
  GuardarRolDto,
  RolesUsuarioDto,
} from './usuarios.dto';
import { UsuariosService } from './usuarios.service';

@ApiTags('Usuarios')
@Controller('usuarios')
@RequierePermiso('usuario.editar')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar(@Query() f: FiltroUsuariosDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.listar(f, u);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.obtener(id, u);
  }

  @Post()
  crear(@Body() dto: CrearUsuarioDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.crear(dto, u);
  }

  /** Nombre, correo y activo/inactivo; desactivar cierra sus sesiones */
  @Patch(':id')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarUsuarioDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.actualizar(id, dto, u);
  }

  @Put(':id/pin')
  cambiarPin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CambiarPinDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.cambiarPin(id, dto.pin, u);
  }

  @Put(':id/contrasena')
  cambiarContrasena(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CambiarContrasenaDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.cambiarContrasena(id, dto.password, u);
  }

  /** Reemplaza los roles por sede; el cambio se aplica al momento */
  @Put(':id/roles')
  asignarRoles(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RolesUsuarioDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.asignarRoles(id, dto.roles, u);
  }

  @Post(':id/cerrar-sesiones')
  @HttpCode(204)
  async cerrarSesiones(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    await this.usuarios.cerrarSesiones(id, u);
  }
}

/** Sedes activas, para asignar roles y precios por sede. Pasará al módulo de salón (tarea 1.4) */
@ApiTags('Usuarios')
@Controller('sedes')
export class SedesController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @RequierePermiso('usuario.editar', 'salon.editar', 'menu.editar')
  listar(@UsuarioActual() u: UsuarioToken) {
    return this.usuarios.sedes(u);
  }
}

@ApiTags('Usuarios')
@Controller('roles')
export class RolesController {
  constructor(private readonly usuarios: UsuariosService) {}

  /** Para asignar roles basta con administrar usuarios; para editarlos, rol.editar */
  @Get()
  @RequierePermiso('usuario.editar', 'rol.editar')
  listar(@UsuarioActual() u: UsuarioToken) {
    return this.usuarios.listarRoles(u);
  }

  /** Catálogo de permisos con su grupo y descripción, para el editor de roles */
  @Get('permisos')
  @RequierePermiso('usuario.editar', 'rol.editar')
  catalogo() {
    return TODOS_LOS_PERMISOS.map((codigo) => ({ codigo, ...PERMISOS[codigo] }));
  }

  @Post()
  @RequierePermiso('rol.editar')
  crear(@Body() dto: GuardarRolDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.crearRol(dto, u);
  }

  @Patch(':id')
  @RequierePermiso('rol.editar')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarRolDto, @UsuarioActual() u: UsuarioToken) {
    return this.usuarios.actualizarRol(id, dto, u);
  }

  @Delete(':id')
  @RequierePermiso('rol.editar')
  @HttpCode(204)
  async borrar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    await this.usuarios.borrarRol(id, u);
  }
}
