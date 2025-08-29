-- CreateEnum
CREATE TYPE "public"."ReleaseType" AS ENUM ('THEATRICAL', 'DIGITAL', 'STREAMING', 'PHYSICAL');

-- CreateTable
CREATE TABLE "public"."ReleaseEvent" (
    "id" SERIAL NOT NULL,
    "titleId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "public"."ReleaseType" NOT NULL,
    "country" VARCHAR(2),
    "source" TEXT NOT NULL DEFAULT 'TMDB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Episode" (
    "id" SERIAL NOT NULL,
    "titleId" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "name" TEXT,
    "airDate" TIMESTAMP(3) NOT NULL,
    "overview" TEXT,
    "source" TEXT NOT NULL DEFAULT 'TMDB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReleaseEvent_date_idx" ON "public"."ReleaseEvent"("date");

-- CreateIndex
CREATE INDEX "ReleaseEvent_titleId_date_idx" ON "public"."ReleaseEvent"("titleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseEvent_titleId_date_type_country_key" ON "public"."ReleaseEvent"("titleId", "date", "type", "country");

-- CreateIndex
CREATE INDEX "Episode_airDate_idx" ON "public"."Episode"("airDate");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_titleId_seasonNumber_episodeNumber_key" ON "public"."Episode"("titleId", "seasonNumber", "episodeNumber");

-- AddForeignKey
ALTER TABLE "public"."ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "public"."Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Episode" ADD CONSTRAINT "Episode_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "public"."Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
