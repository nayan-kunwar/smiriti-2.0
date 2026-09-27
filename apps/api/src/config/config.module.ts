import { Global, Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@smriti/shared';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
