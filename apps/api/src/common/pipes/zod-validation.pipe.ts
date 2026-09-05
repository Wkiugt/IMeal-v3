import {
  PipeTransform,
  ArgumentMetadata,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema<any>) {}

  transform(value: any, _metadata: ArgumentMetadata) {
    try {
      return this.schema.parse(value);
    } catch (_error) {
      throw new BadRequestException('Validation failed');
    }
  }
}
