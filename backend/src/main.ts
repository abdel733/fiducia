import "reflect-metadata";
import { config as loadEnvironmentFile } from "dotenv";
import { resolve } from "node:path";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { validateEnvironment } from "@fiducia/config";

async function bootstrap(): Promise<void> {
  loadEnvironmentFile({ path: process.env.ENV_FILE ?? resolve(__dirname, "../../.env") });
  const config = validateEnvironment();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("v1");
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));

  const openApi = new DocumentBuilder()
    .setTitle("Fiducia API")
    .setDescription("API marketplace Fiducia. OTP and storage integrations use development mocks/configuration until approved credentials are supplied.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, openApi));
  await app.listen(config.API_PORT, "0.0.0.0");
}

void bootstrap();