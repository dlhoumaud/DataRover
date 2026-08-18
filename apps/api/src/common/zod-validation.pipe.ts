import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Generic Nest pipe that validates (and coerces/defaults) an incoming value
 * against a Zod schema, throwing a 400 with the Zod issues on failure.
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
