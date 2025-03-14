-- CreateIndex
CREATE INDEX "producerVotes_producerId_idx" ON "producerVotes"("producerId");

-- CreateIndex
CREATE INDEX "proxies_chain_idx" ON "proxies"("chain");

-- CreateIndex
CREATE INDEX "proxies_owner_idx" ON "proxies"("owner");
