import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  CreateProxySchema,
  ListProxiesQuerySchema,
  UpdateProxyConfigSchema,
  UpdateProxySchema,
  type CreateProxyDto,
  type ListProxiesQueryDto,
  type UpdateProxyConfigDto,
  type UpdateProxyDto,
} from "./dto";
import { ProxiesService } from "./proxies.service";

@Controller("proxies")
export class ProxiesController {
  constructor(private readonly proxiesService: ProxiesService) {}

  // Declared before `@Get(":id")`/`@Patch(":id")` on purpose — Nest matches routes on the same
  // HTTP verb in declaration order, so "config" would otherwise be swallowed as an `:id` value.
  @Get("config")
  getConfig() {
    return this.proxiesService.getConfig();
  }

  @Patch("config")
  updateConfig(@Body(new ZodValidationPipe(UpdateProxyConfigSchema)) body: UpdateProxyConfigDto) {
    return this.proxiesService.updateConfig(body);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateProxySchema)) body: CreateProxyDto) {
    return this.proxiesService.create(body);
  }

  @Get()
  findAll(@Query(new ZodValidationPipe(ListProxiesQuerySchema)) query: ListProxiesQueryDto) {
    return this.proxiesService.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.proxiesService.findOneOrThrow(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateProxySchema)) body: UpdateProxyDto,
  ) {
    return this.proxiesService.update(id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.proxiesService.remove(id);
  }
}
