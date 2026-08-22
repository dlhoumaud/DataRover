-- CreateEnum
CREATE TYPE "ProxyStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "status" "ProxyStatus" NOT NULL DEFAULT 'active',
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "isInUse" BOOLEAN NOT NULL DEFAULT false,
    "reservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyPoolConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "purgeErrorThreshold" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyPoolConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Proxy_status_isInUse_idx" ON "Proxy"("status", "isInUse");

-- CreateIndex
CREATE UNIQUE INDEX "Proxy_host_port_key" ON "Proxy"("host", "port");
