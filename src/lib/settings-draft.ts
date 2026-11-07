import { createContext, useContext } from "react";
import type { AppSettings } from "@/lib/files-store";

export type SettingsDraftActions = {
  hasChanges: boolean;
  hasUnsavedChanges: boolean;
  saving: boolean;
  saveError: string;
  cancelChanges: () => void;
  saveChanges: () => Promise<void>;
};

export type SettingsExternalDraftHandlers = {
  save: () => Promise<void>;
  cancel: () => void;
};

export type SettingsDraftContextValue = {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  actions?: SettingsDraftActions;
  sectionUnlocked?: boolean;
  sectionSaving?: boolean;
  sectionVerifying?: boolean;
  unlockSection?: () => void;
  setExternalDirty?: (dirty: boolean) => void;
  setLocalDirty?: (dirty: boolean) => void;
  registerExternalDraft?: (handlers: SettingsExternalDraftHandlers | null) => void;
};

export const SettingsDraftContext = createContext<SettingsDraftContextValue | null>(null);

export function useSettingsDraftContext() {
  return useContext(SettingsDraftContext);
}
