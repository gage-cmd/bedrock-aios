import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // Local dev default distinct from Next.js's 3000; Railway always sets PORT.
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
