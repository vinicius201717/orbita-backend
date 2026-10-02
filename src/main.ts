import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  configureApp(app);
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ORBITA')
      .setDescription('Urban logistics orchestration API')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  await app.listen(config.get('PORT'), '0.0.0.0');
}
void bootstrap();
