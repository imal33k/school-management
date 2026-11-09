-- CreateTable
CREATE TABLE "AssessmentComponent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isExam" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultComponentScore" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ResultComponentScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentComponent_schoolId_idx" ON "AssessmentComponent"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentComponent_schoolId_name_key" ON "AssessmentComponent"("schoolId", "name");

-- CreateIndex
CREATE INDEX "ResultComponentScore_componentId_idx" ON "ResultComponentScore"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultComponentScore_resultId_componentId_key" ON "ResultComponentScore"("resultId", "componentId");

-- AddForeignKey
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultComponentScore" ADD CONSTRAINT "ResultComponentScore_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "Result"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultComponentScore" ADD CONSTRAINT "ResultComponentScore_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "AssessmentComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
