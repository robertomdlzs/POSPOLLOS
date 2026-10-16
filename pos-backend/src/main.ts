import { config } from './config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PgErrorFilter } from './common/pg-error.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // descarta campos que no estén en el DTO
      forbidNonWhitelisted: true, // y si los mandan, responde 400
      transform: true,
    }),
  );
  app.useGlobalFilters(new PgErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();

  await app.listen(config.port);
  Logger.log(`POS backend escuchando en http://localhost:${config.port}/api`, 'Bootstrap');
}
bootstrap();
