-- CreateIndex
CREATE INDEX "experiment_run_experiment_type_status_idx" ON "experiment_run"("experiment_type", "status");
