import { GoogleDriveAdapter } from "./GoogleDriveAdapter";
import { IProviderAdapter } from "./BaseProvider";
import { ProviderType } from "../../../models/MigrationJob";

export class ProviderFactory {
  static getAdapter(provider: ProviderType, accessToken: string): IProviderAdapter {
    switch (provider) {
      case ProviderType.GOOGLE_DRIVE:
        return new GoogleDriveAdapter(accessToken);
      // case ProviderType.ONEDRIVE:
      //   return new OneDriveAdapter(accessToken);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
