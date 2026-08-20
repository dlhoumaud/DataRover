import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Identical to apps/api/src/common/zod-validation.pipe.ts — duplicated rather than shared because
 * it's Nest-specific (implements `PipeTransform`) and `packages/shared` is deliberately
 * framework-agnostic; a two-service, ~15-line file didn't seem worth a new shared package.
 *
 * Usage: `@Body(new ZodValidationPipe(SomeSchema)) body: SomeDto`.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
