-- CreateTable
CREATE TABLE "apiBurstCheck" (
    "id" SERIAL NOT NULL,
    "time_stamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nodeId" INTEGER NOT NULL,
    "status" BOOLEAN NOT NULL,
    "burstTarget" INTEGER NOT NULL,
    "burstResult" INTEGER NOT NULL,

    CONSTRAINT "apiBurstCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apiBurstCheck_nodeId_time_stamp_idx" ON "apiBurstCheck"("nodeId", "time_stamp");

-- AddForeignKey
ALTER TABLE "apiBurstCheck" ADD CONSTRAINT "apiBurstCheck_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "producerNodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
