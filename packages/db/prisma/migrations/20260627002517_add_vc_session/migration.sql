-- CreateTable
CREATE TABLE "VcSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "durationSecs" INTEGER,

    CONSTRAINT "VcSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VcSession_userId_idx" ON "VcSession"("userId");

-- CreateIndex
CREATE INDEX "VcSession_joinedAt_idx" ON "VcSession"("joinedAt");

-- AddForeignKey
ALTER TABLE "VcSession" ADD CONSTRAINT "VcSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
