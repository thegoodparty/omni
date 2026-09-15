-- AlterEnum
-- A completed poll is a heads-up like a briefing or a community issue: the
-- results landed and there is a page to read them on. Same shape as the
-- community_issue addition, so the card table needs nothing else.
ALTER TYPE "DashboardCardType" ADD VALUE 'poll_result';
