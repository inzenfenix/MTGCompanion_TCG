import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const PORT = Number(process.env.MTG_RUNNER_PORT ?? 4550);

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: { origin: '*' } });
  await app.listen(PORT, '127.0.0.1');
  // Electron (o cualquier consumidor) puede esperar esta línea, además del /health, para saber que ya está listo.
  // eslint-disable-next-line no-console
  console.log(`[mtg-runner-server] listening on http://127.0.0.1:${PORT}`);
}

bootstrap();
