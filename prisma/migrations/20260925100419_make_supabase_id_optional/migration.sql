/*
  Warnings:

  - You are about to drop the column `supabaseId` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "User_supabaseId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "supabaseId";
