import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
async function main() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: false });
  try {
    configureApp(app);
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('ORBITA').setVersion('1.0').addBearerAuth().build(),
    );
    writeFileSync('docs/openapi.json', JSON.stringify(document, null, 2));
    console.log(`OpenAPI exported: ${Object.keys(document.paths).length} paths`);
  } finally {
    await app.close();
  }
}
void main();
