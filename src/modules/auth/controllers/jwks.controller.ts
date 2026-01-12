import { Controller, Get } from '@nestjs/common';
import { JwksService } from '../services';
import { Public } from '../decorators';

@Controller('.well-known')
export class JwksController {
  constructor(private readonly jwksService: JwksService) {}

  @Public()
  @Get('jwks.json')
  getJwks() {
    return this.jwksService.getJwks();
  }
}
