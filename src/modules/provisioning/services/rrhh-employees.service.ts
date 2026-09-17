import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from 'src/config';
import { EmployeeSearchQueryDto } from '../dtos';

const RRHH_TIMEOUT_MS = 10_000;

export interface RrhhEmployee {
  relationKey: string;
  fullName: string;
  position: string | null;
  unit: string | null;
  area: string | null;
}

@Injectable()
export class RrhhEmployeesService {
  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  async search(query: EmployeeSearchQueryDto) {
    const url = this.buildUrl('internal/employees');
    url.searchParams.set('q', query.q);
    url.searchParams.set('page', String(query.page));
    url.searchParams.set('limit', String(query.limit));
    const result = await this.request(url);
    const pagination = this.isRecord(result) ? result.pagination : undefined;
    if (
      !this.isRecord(result) ||
      !Array.isArray(result.data) ||
      !this.isRecord(pagination) ||
      !this.isInteger(pagination.page, 1) ||
      !this.isInteger(pagination.limit, 1) ||
      !this.isInteger(pagination.total, 0) ||
      !this.isInteger(pagination.totalPages, 0)
    ) {
      throw this.unavailable();
    }

    return {
      data: result.data.map((employee: unknown) => this.selectEmployee(employee)),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: pagination.totalPages,
      },
    };
  }

  async findOne(relationKey: string): Promise<RrhhEmployee> {
    const url = this.buildUrl(`internal/employees/${encodeURIComponent(relationKey)}`);
    // RRHH's exact employee endpoint only resolves current employees; inactive employees return 404.
    return this.selectEmployee(await this.request(url, true));
  }

  private buildUrl(path: string): URL {
    const baseUrl = this.configService.get('RRHH_INTERNAL_URL', { infer: true });
    if (!baseUrl) throw this.unavailable();
    return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  }

  private async request(url: URL, exactEmployee = false): Promise<unknown> {
    const accessToken = this.configService.get('RRHH_ACCESS_TOKEN', { infer: true });
    if (!accessToken) throw this.unavailable();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'x-access-code': accessToken },
        signal: AbortSignal.timeout(RRHH_TIMEOUT_MS),
      });
    } catch {
      throw this.unavailable();
    }

    if (exactEmployee && response.status === 404) {
      throw new NotFoundException({
        code: 'RRHH_EMPLOYEE_NOT_FOUND',
        message: 'Employee is not active or was not found in RRHH.',
      });
    }
    if (response.status === 400) {
      throw new BadRequestException({
        code: 'RRHH_INVALID_REQUEST',
        message: 'RRHH rejected the employee query.',
      });
    }
    if (exactEmployee && response.status === 409) {
      throw new ConflictException({
        code: 'RRHH_EMPLOYEE_AMBIGUOUS',
        message: 'The relationKey identifies more than one employee in RRHH.',
      });
    }
    if (!response.ok) throw this.unavailable();

    try {
      return (await response.json()) as unknown;
    } catch {
      throw this.unavailable();
    }
  }

  private selectEmployee(value: unknown): RrhhEmployee {
    if (
      !this.isRecord(value) ||
      typeof value.relationKey !== 'string' ||
      !value.relationKey.trim() ||
      typeof value.fullName !== 'string' ||
      !value.fullName.trim()
    ) {
      throw this.unavailable();
    }

    return {
      relationKey: value.relationKey,
      fullName: value.fullName,
      position: this.nullableString(value.position),
      unit: this.nullableString(value.unit),
      area: this.nullableString(value.area),
    };
  }

  private nullableString(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw this.unavailable();
    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isInteger(value: unknown, minimum: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'RRHH_UNAVAILABLE',
      message: 'RRHH is temporarily unavailable. Try again later.',
    });
  }
}
