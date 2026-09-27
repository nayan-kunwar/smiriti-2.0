import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { disconnectPrisma, getPrismaClient } from '@smriti/infrastructure';
import type { PrismaClient } from '@prisma/client';

export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

@Injectable()
class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient = getPrismaClient();

  async onModuleDestroy(): Promise<void> {
    await disconnectPrisma();
  }
}

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: PRISMA_CLIENT,
      useFactory: (prisma: PrismaService) => prisma.client,
      inject: [PrismaService],
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule {}
