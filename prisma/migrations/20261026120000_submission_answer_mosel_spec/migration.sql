-- A finite automaton problem can be marked against its MOSEL description instead of an answer
-- file. Submission.answerMoselSpec records which description an attempt was marked against, as
-- answerFileName does for a file, and an evaluator trial may run with no answer file.

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "answerMoselSpec" JSONB;

-- AlterTable
ALTER TABLE "EvaluatorTrial" ALTER COLUMN "answerOriginalName" DROP NOT NULL;
