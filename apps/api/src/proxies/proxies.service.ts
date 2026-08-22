import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Proxy as ProxyRow, ProxyPoolConfig as ProxyPoolConfigRow } from "@datarover/database";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateProxyDto,
  ListProxiesQueryDto,
  UpdateProxyConfigDto,
  UpdateProxyDto,
} from "./dto";

/** Matches `ProxyPoolConfig.purgeErrorThreshold`'s own `@default(5)` in `schema.prisma` — kept
 *  alongside it here only for the `create` half of the defensive upsert below, never read from
 *  otherwise (the seed already creates the singleton row on a fresh setup). */
const DEFAULT_PURGE_ERROR_THRESHOLD = 5;

export interface ProxyListResult {
  items: ProxyRow[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ProxiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProxyDto): Promise<ProxyRow> {
    await this.assertNoCollision(dto.host, dto.port);
    return this.prisma.proxy.create({ data: { host: dto.host, port: dto.port } });
  }

  async findAll(query: ListProxiesQueryDto): Promise<ProxyListResult> {
    const where = query.status !== undefined ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.proxy.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.proxy.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async findOneOrThrow(id: string): Promise<ProxyRow> {
    const proxy = await this.prisma.proxy.findUnique({ where: { id } });
    if (!proxy) {
      throw new NotFoundException(`Proxy ${id} not found`);
    }
    return proxy;
  }

  async update(id: string, dto: UpdateProxyDto): Promise<ProxyRow> {
    const current = await this.findOneOrThrow(id);
    const nextHost = dto.host ?? current.host;
    const nextPort = dto.port ?? current.port;
    if (nextHost !== current.host || nextPort !== current.port) {
      await this.assertNoCollision(nextHost, nextPort, id);
    }

    return this.prisma.proxy.update({
      where: { id },
      data: {
        ...(dto.host !== undefined ? { host: dto.host } : {}),
        ...(dto.port !== undefined ? { port: dto.port } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);
    await this.prisma.proxy.delete({ where: { id } });
  }

  /** Defensive upsert, in case the seed never ran against this database — see `schema.prisma`'s
   *  own doc comment on `ProxyPoolConfig` for why this is a single fixed-id row rather than a
   *  generic settings table. */
  async getConfig(): Promise<ProxyPoolConfigRow> {
    return this.prisma.proxyPoolConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton", purgeErrorThreshold: DEFAULT_PURGE_ERROR_THRESHOLD },
    });
  }

  async updateConfig(dto: UpdateProxyConfigDto): Promise<ProxyPoolConfigRow> {
    return this.prisma.proxyPoolConfig.upsert({
      where: { id: "singleton" },
      update: { purgeErrorThreshold: dto.purgeErrorThreshold },
      create: { id: "singleton", purgeErrorThreshold: dto.purgeErrorThreshold },
    });
  }

  /** A clear 409 ("this host:port is already registered") rather than letting Prisma's own
   *  unique-constraint violation (P2002) bubble up as an opaque 500. */
  private async assertNoCollision(host: string, port: number, excludingId?: string): Promise<void> {
    const collision = await this.prisma.proxy.findUnique({ where: { host_port: { host, port } } });
    if (collision && collision.id !== excludingId) {
      throw new ConflictException(`A proxy for ${host}:${port} already exists`);
    }
  }
}
