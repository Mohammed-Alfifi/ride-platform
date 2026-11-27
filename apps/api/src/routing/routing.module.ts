import { Global, Module } from '@nestjs/common';
import { RoutingService } from './routing';

/** Road travel times for planning and arrival estimates, available everywhere. */
@Global()
@Module({ providers: [RoutingService], exports: [RoutingService] })
export class RoutingModule {}
