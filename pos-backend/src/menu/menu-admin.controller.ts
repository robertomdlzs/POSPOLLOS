import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequierePermiso, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import {
  ActualizarCategoriaDto,
  ActualizarGrupoDto,
  ActualizarOpcionDto,
  ActualizarProductoDto,
  AgotadoDto,
  CrearCategoriaDto,
  CrearGrupoDto,
  CrearProductoDto,
  FiltroProductosDto,
  OpcionDto,
  OrdenDto,
  OrdenProductosDto,
  ProductoSedeDto,
} from './menu-admin.dto';
import { MenuAdminService } from './menu-admin.service';

@ApiTags('Administración del menú')
@Controller('categorias')
@RequierePermiso('menu.editar')
export class CategoriasController {
  constructor(private readonly menu: MenuAdminService) {}

  @Get()
  listar(@UsuarioActual() u: UsuarioToken) {
    return this.menu.categorias(u);
  }

  @Post()
  crear(@Body() dto: CrearCategoriaDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.crearCategoria(dto, u);
  }

  /** El orden completo de las categorías, como quedó tras arrastrar */
  @Put('orden')
  ordenar(@Body() dto: OrdenDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.ordenarCategorias(dto.ids, u);
  }

  @Patch(':id')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarCategoriaDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.actualizarCategoria(id, dto, u);
  }

  @Delete(':id')
  @HttpCode(204)
  async borrar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    await this.menu.borrarCategoria(id, u);
  }
}

@ApiTags('Administración del menú')
@Controller('productos')
export class ProductosController {
  constructor(private readonly menu: MenuAdminService) {}

  @Get()
  @RequierePermiso('menu.editar', 'menu.agotar')
  listar(@Query() f: FiltroProductosDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.productos(u, f.categoriaId);
  }

  @Post()
  @RequierePermiso('menu.editar')
  crear(@Body() dto: CrearProductoDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.crearProducto(dto, u);
  }

  @Put('orden')
  @RequierePermiso('menu.editar')
  ordenar(@Body() dto: OrdenProductosDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.ordenarProductos(dto.categoriaId, dto.ids, u);
  }

  @Get(':id')
  @RequierePermiso('menu.editar')
  obtener(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.menu.producto(id, u);
  }

  @Patch(':id')
  @RequierePermiso('menu.editar')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarProductoDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.actualizarProducto(id, dto, u);
  }

  @Delete(':id')
  @RequierePermiso('menu.editar')
  @HttpCode(204)
  async borrar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    await this.menu.borrarProducto(id, u);
  }

  /** Precio propio y si se vende en esa sede */
  @Put(':id/sedes/:sedeId')
  @RequierePermiso('menu.editar')
  enSede(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sedeId', ParseUUIDPipe) sedeId: string,
    @Body() dto: ProductoSedeDto,
    @UsuarioActual() u: UsuarioToken,
  ) {
    return this.menu.productoEnSede(id, sedeId, dto, u);
  }

  /** Agotado en la sede de la sesión; avisa a las tablets al momento */
  @Put(':id/agotado')
  @RequierePermiso('menu.agotar', 'menu.editar')
  agotar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AgotadoDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.agotar(id, dto.agotado, u);
  }
}

@ApiTags('Administración del menú')
@Controller()
@RequierePermiso('menu.editar')
export class ModificadoresController {
  constructor(private readonly menu: MenuAdminService) {}

  @Get('grupos-modificadores')
  listar(@UsuarioActual() u: UsuarioToken) {
    return this.menu.grupos(u);
  }

  @Post('grupos-modificadores')
  crear(@Body() dto: CrearGrupoDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.crearGrupo(dto, u);
  }

  @Patch('grupos-modificadores/:id')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarGrupoDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.actualizarGrupo(id, dto, u);
  }

  @Delete('grupos-modificadores/:id')
  @HttpCode(204)
  async borrar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    await this.menu.borrarGrupo(id, u);
  }

  @Post('grupos-modificadores/:id/opciones')
  agregarOpcion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OpcionDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.agregarOpcion(id, dto, u);
  }

  @Patch('modificadores/:id')
  actualizarOpcion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarOpcionDto, @UsuarioActual() u: UsuarioToken) {
    return this.menu.actualizarOpcion(id, dto, u);
  }

  /** Estaciones de la sede, para el formulario de producto (su administración llega en la 1.4.2) */
  @Get('estaciones')
  estaciones(@UsuarioActual() u: UsuarioToken) {
    return this.menu.estaciones(u);
  }
}
