export class NonRetryableUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableUploadError";
  }
}
