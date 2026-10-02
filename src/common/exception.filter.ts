import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message: string | string[] = 'Unexpected server error';
    if (error instanceof HttpException) {
      statusCode = error.getStatus();
      const body = error.getResponse();
      if (typeof body === 'object' && body !== null) {
        const data = body as { code?: string; message?: string | string[] };
        code = data.code ?? `HTTP_${statusCode}`;
        message = data.message ?? error.message;
      } else message = body;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        statusCode = 404;
        code = 'NOT_FOUND';
        message = 'Record not found';
      }
      if (['P2002', 'P2003', 'P2034'].includes(error.code)) {
        statusCode = 409;
        code = 'CONFLICT';
        message = 'The operation conflicts with the current state';
      }
    }
    host.switchToHttp().getResponse<Response>().status(statusCode).json({ statusCode, code, message });
  }
}
