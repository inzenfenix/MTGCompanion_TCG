import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFile'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
});
