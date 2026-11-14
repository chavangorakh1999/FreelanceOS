-- CreateIndex
CREATE INDEX "agreements_workspaceId_expiresAt_idx" ON "agreements"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "milestones_workspaceId_dueDate_idx" ON "milestones"("workspaceId", "dueDate");

-- CreateIndex
CREATE INDEX "payments_workspaceId_receivedAt_idx" ON "payments"("workspaceId", "receivedAt");

-- CreateIndex
CREATE INDEX "proposal_versions_workspaceId_status_validUntil_idx" ON "proposal_versions"("workspaceId", "status", "validUntil");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_dueDate_idx" ON "tasks"("workspaceId", "dueDate");

