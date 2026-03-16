import { Readable } from "stream";

export interface ProviderFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  isFolder: boolean;
}

export interface IProviderAdapter {
  listFiles(folderId: string, pageToken?: string): Promise<{ files: ProviderFile[], nextPageToken?: string }>;
  downloadStream(fileId: string, mimeType: string): Promise<Readable>;
  getFileMetadata(fileId: string): Promise<ProviderFile>;
}
