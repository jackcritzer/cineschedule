-- CreateIndex
CREATE INDEX "Episode_titleId_airDate_idx" ON "public"."Episode"("titleId", "airDate");

-- CreateIndex
CREATE INDEX "Watchlist_titleId_idx" ON "public"."Watchlist"("titleId");
