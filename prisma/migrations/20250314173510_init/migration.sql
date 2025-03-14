-- CreateTable
CREATE TABLE "producerVotes" (
    "id" SERIAL NOT NULL,
    "producerId" INTEGER NOT NULL,
    "voters" JSONB NOT NULL,

    CONSTRAINT "producerVotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxies" (
    "id" SERIAL NOT NULL,
    "owner" TEXT NOT NULL,
    "fio_address" TEXT,
    "chain" TEXT NOT NULL,
    "vote" JSONB NOT NULL,
    "delegators" JSONB NOT NULL,

    CONSTRAINT "proxies_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "producerVotes" ADD CONSTRAINT "producerVotes_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
