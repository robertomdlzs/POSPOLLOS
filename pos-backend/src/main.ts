import { config } from './config';
import { ValidationPipe } from '@nestjs/common';
import { resolve } from 'node:path';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { PREFIJO_ARCHIVOS } from './archivos/almacen';
import { PgErrorFilter } from './common/pg-error.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  // Fotos subidas: públicas, y con nombre que cambia en cada subida, así que se cachean un año
  app.useStaticAssets(resolve(config.archivosDir), { prefix: PREFIJO_ARCHIVOS, maxAge: '365d', immutable: true, index: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // descarta campos que no estén en el DTO
      forbidNonWhitelisted: true, // y si los mandan, responde 400
      transform: true,
    }),
  );
  app.useGlobalFilters(new PgErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();

  if (config.docsApi) {
    const documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('POSPOLLOS API')
        .setDescription('API del punto de venta. Salvo las rutas de ingreso, todas exigen `Authorization: Bearer <accessToken>`.')
        .setVersion(process.env.npm_package_version ?? '0.1.0')
        .addBearerAuth()
        .addSecurityRequirements('bearer')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, documento, { jsonDocumentUrl: 'api/docs/json' });
  }

  await app.listen(config.port);
  app.get(Logger).log(`POS backend escuchando en http://localhost:${config.port}/api`, 'Bootstrap');
}
bootstrap();
