import { Module } from '@nestjs/common';
import { PrinterService } from './printer.service';

@Module({
  controllers: [],
  providers: [PrinterService],
  exports: [PrinterService],
})
export class PrinterModule {}
