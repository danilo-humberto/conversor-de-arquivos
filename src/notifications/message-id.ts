export function createNotificationMessageId(jobId: string): string {
  return `<conversion-${jobId}@conversor.local>`;
}
