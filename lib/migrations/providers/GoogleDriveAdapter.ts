import { google, drive_v3 } from "googleapis";
import { IProviderAdapter, ProviderFile } from "./BaseProvider";
import { Readable } from "stream";

// Map Google Docs formats to standard formats
const EXPORT_MAP: Record<string, { mimeType: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "application/pdf",
    ext: ".pdf",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/pdf",
    ext: ".pdf",
  },
  "application/vnd.google-apps.drawing": {
    mimeType: "application/pdf",
    ext: ".pdf",
  },
};

export class GoogleDriveAdapter implements IProviderAdapter {
  private drive: drive_v3.Drive;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.drive = google.drive({ version: "v3", auth });
  }

  async listFiles(folderId: string = "root", pageToken?: string): Promise<{ files: ProviderFile[], nextPageToken?: string }> {
    const q = `'${folderId}' in parents and trashed = false`;
    const response = await this.drive.files.list({
      q,
      fields: "nextPageToken, files(id, name, size, mimeType)",
      pageSize: 1000,
      pageToken,
    });

    const files = (response.data.files || []).map((file) => {
      let size = Number(file.size || 0);
      let name = file.name || "Untitled";
      let mimeType = file.mimeType || "application/octet-stream";

      // If it's a Google Doc type, adjust extension and estimate size if 0
      if (EXPORT_MAP[mimeType]) {
        if (!name.endsWith(EXPORT_MAP[mimeType].ext)) {
          name += EXPORT_MAP[mimeType].ext;
        }
        mimeType = EXPORT_MAP[mimeType].mimeType;
        if (size === 0) size = 500000; // 500KB dummy size for docs to pass validation
      }

      return {
        id: file.id!,
        name,
        size,
        mimeType,
        isFolder: file.mimeType === "application/vnd.google-apps.folder",
      };
    });

    return {
      files,
      nextPageToken: response.data.nextPageToken || undefined,
    };
  }

  async getFileMetadata(fileId: string): Promise<ProviderFile> {
    const response = await this.drive.files.get({
      fileId,
      fields: "id, name, size, mimeType",
    });

    const file = response.data;
    let size = Number(file.size || 0);
    let name = file.name || "Untitled";
    let mimeType = file.mimeType || "application/octet-stream";

    if (EXPORT_MAP[mimeType]) {
      if (!name.endsWith(EXPORT_MAP[mimeType].ext)) {
        name += EXPORT_MAP[mimeType].ext;
      }
      mimeType = EXPORT_MAP[mimeType].mimeType;
      if (size === 0) size = 500000;
    }

    return {
      id: file.id!,
      name,
      size,
      mimeType,
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
    };
  }

  async downloadStream(fileId: string, _mimeType: string): Promise<Readable> {
    // First, verify the original MIME type on Google Drive to see if it's a Docs Editors file
    const metaResponse = await this.drive.files.get({
      fileId,
      fields: "mimeType",
    });
    
    const originalMimeType = metaResponse.data.mimeType;
    const isGoogleDoc = originalMimeType?.startsWith("application/vnd.google-apps.");

    if (isGoogleDoc && originalMimeType && EXPORT_MAP[originalMimeType]) {
      // Export Google Workspace documents to their mapped standard format
      const exportMimeType = EXPORT_MAP[originalMimeType].mimeType;
      const response = await this.drive.files.export(
        {
          fileId,
          mimeType: exportMimeType,
        },
        { responseType: "stream" }
      );
      return response.data;
    } else {
      // Regular binary file download
      const response = await this.drive.files.get(
        {
          fileId,
          alt: "media",
        },
        { responseType: "stream" }
      );
      return response.data;
    }
  }
}
