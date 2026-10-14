-- AlterEnum
-- IF NOT EXISTS: preview and local databases already took this value under
-- the migration's earlier name, 20261013170000.
ALTER TYPE "DashboardCardType" ADD VALUE IF NOT EXISTS 'civic_panel';
