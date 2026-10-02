/** Required by R2 presigned PutObject URLs that enforce create-only writes. */
export const WRITE_ONCE_PUT_HEADERS = { "If-None-Match": "*" } as const;
