import { Module } from '@nestjs/common';
import { CocinaController } from './cocina.controller';
import { CocinaGateway } from './cocina.gateway';
import { CocinaService } from './cocina.service';

@Module({
  controllers: [CocinaController],
  providers: [CocinaGateway, CocinaService],
  exports: [CocinaGateway, CocinaService],
})
export class CocinaModule {}
