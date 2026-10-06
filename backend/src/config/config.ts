import { Provider } from "@nestjs/common";
import { AppConfig, validateEnvironment } from "@fiducia/config";

export const APP_CONFIG = Symbol("APP_CONFIG");
export const appConfigProvider: Provider = {
  provide: APP_CONFIG,
  useFactory: () => validateEnvironment(),
};

export type { AppConfig };