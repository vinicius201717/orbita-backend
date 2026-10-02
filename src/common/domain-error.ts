import { HttpException } from '@nestjs/common';
export class DomainError extends HttpException {
  constructor(code: string, message: string, statusCode = 409) {
    super({ statusCode, code, message }, statusCode);
  }
}
