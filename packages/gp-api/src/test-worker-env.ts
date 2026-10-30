// With AWS_PROFILE set, the AWS SDK skips the AWS_* keys .env.test provides
// and resolves the developer's real profile instead. CI never sets it.
delete process.env.AWS_PROFILE

// The env this worker started with. test-file-cleanup.ts imports this first,
// and a shared-modules worker evaluates it once, so this is captured before
// any file has written to process.env.
export const workerEnv = { ...process.env }
