export interface ElectronAPI {
  pickFile: () => Promise<string | null>;
  pickFiles: () => Promise<string[]>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
