-- RUBRIC: the Rubric table, AssignmentProblem.rubricId, Submission.score/rubricSnapshot and the
-- EvaluatorTrial rubric columns (see RUBRIC_LOCATIONS.md). Also Problem/EvaluatorTrial.moselSpec.

-- AlterTable
ALTER TABLE "AssignmentProblem" ADD COLUMN     "rubricId" TEXT;

-- AlterTable
ALTER TABLE "EvaluatorTrial" ADD COLUMN     "moselSpec" JSONB,
ADD COLUMN     "rubricDefinition" JSONB,
ADD COLUMN     "score" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "moselSpec" JSONB;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "rubricSnapshot" JSONB,
ADD COLUMN     "score" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rubric_ownerId_idx" ON "Rubric"("ownerId");

-- CreateIndex
CREATE INDEX "AssignmentProblem_rubricId_idx" ON "AssignmentProblem"("rubricId");

-- AddForeignKey
ALTER TABLE "AssignmentProblem" ADD CONSTRAINT "AssignmentProblem_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
