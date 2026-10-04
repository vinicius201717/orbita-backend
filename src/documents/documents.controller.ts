import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { DocumentOwnerDto, ReviewDocumentDto, UploadDocumentDto } from './documents.dto';
import { documentPolicy, DocumentsService, UploadedDocument } from './documents.service';
@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}
  @Get('policy') policy() {
    return documentPolicy;
  }
  @Get() @Header('Cache-Control', 'private, no-store') list(
    @CurrentActor() actor: Actor,
    @Query() query: DocumentOwnerDto,
  ) {
    return this.service.list(actor, query);
  }
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'entityType', 'entityId', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: { type: 'string', enum: ['BUSINESS', 'DRIVER'] },
        entityId: { type: 'string', format: 'uuid' },
        type: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        replacesId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: documentPolicy.maxBytes, files: 1, fields: 5, fieldSize: 1000 },
    }),
  )
  upload(
    @CurrentActor() actor: Actor,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: UploadedDocument,
  ) {
    return this.service.upload(actor, dto, file);
  }
  @Get(':id/content')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async content(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const file = await this.service.content(actor, id);
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
  @Patch(':id/review') @Roles('ADMIN') review(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.service.review(actor, id, dto);
  }
}
