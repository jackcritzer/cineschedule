-- AlterTable
ALTER TABLE "public"."Episode" ADD COLUMN     "runtimeMin" INTEGER,
ADD COLUMN     "stillPath" TEXT;

-- AlterTable
ALTER TABLE "public"."Title" ADD COLUMN     "episodeRunTime" INTEGER,
ADD COLUMN     "networkName" TEXT,
ADD COLUMN     "providersJson" JSONB,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "tvRating" TEXT;
