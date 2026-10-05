export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { enabledStorageRegions } = await import("@xenode/config/storage");
    enabledStorageRegions();
  }
}
