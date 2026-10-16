import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { RequierePermiso, UsuarioActual } from '../common/decoradores';
import { ESTADOS_ITEM_COCINA } from '../common/tipos';
import type { UsuarioToken } from '../common/tipos';
import { CocinaService } from './cocina.service';

class CambiarEstadoDto {
  @IsIn(ESTADOS_ITEM_COCINA)
  estado: (typeof ESTADOS_ITEM_COCINA)[number];
}

class FiltroCocinaDto {
  @IsOptional()
  @IsUUID()
  estacionId?: string;
}

@ApiTags('Cocina')
@Controller('cocina')
@RequierePermiso('cocina.operar')
export class CocinaController {
  constructor(private readonly cocina: CocinaService) {}

  @Get('pendientes')
  pendientes(@UsuarioActual() u: UsuarioToken, @Query() filtro: FiltroCocinaDto) {
    return this.cocina.pendientes(u, filtro.estacionId);
  }

  @Patch('items/:id')
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoDto,
    @UsuarioActual() u: UsuarioToken,
  ) {
    return this.cocina.cambiarEstado(id, dto.estado, u);
  }
}
