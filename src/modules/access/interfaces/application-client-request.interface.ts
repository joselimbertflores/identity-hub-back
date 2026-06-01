import type { Request } from 'express';

import { Application } from '../entities';

export interface ApplicationClientRequest extends Request {
  application: Application;
}
