-- AlterEnum
-- A canvasser or caller can now record that the voter has already cast a
-- ballot this election, the fourth answer to "Will they vote this election?".
ALTER TYPE "WillVoteAnswer" ADD VALUE 'already_voted';
