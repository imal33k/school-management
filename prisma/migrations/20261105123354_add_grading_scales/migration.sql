-- CreateTable
CREATE TABLE "GradeScale" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" TEXT NOT NULL,
    "gradeScaleId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION NOT NULL,
    "remark" TEXT,
    "points" DOUBLE PRECISION,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradeScale_schoolId_idx" ON "GradeScale"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeScale_schoolId_name_key" ON "GradeScale"("schoolId", "name");

-- CreateIndex
CREATE INDEX "GradeBand_gradeScaleId_idx" ON "GradeBand"("gradeScaleId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_gradeScaleId_grade_key" ON "GradeBand"("gradeScaleId", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_gradeScaleId_minScore_key" ON "GradeBand"("gradeScaleId", "minScore");

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_gradeScaleId_fkey" FOREIGN KEY ("gradeScaleId") REFERENCES "GradeScale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
