import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }
}
