import { Menu, type MenuItemConstructorOptions, Tray, nativeImage } from "electron";
import {
  type TrayAction,
  type TrayState,
  buildTrayMenu,
  toNativeTemplate,
  trayIconState,
} from "./trayMenu";

/** Thin Electron binding for the tray. Untested by design. */
export interface TrayIconPaths {
  /** Monochrome template image (e.g. `trayTemplate.png` + @2x). */
  template: string;
  /** Icon with the red recording dot. */
  recording: string;
}

export interface TrayController {
  update(state: TrayState): void;
  destroy(): void;
}

export function createElectronTray(
  icons: TrayIconPaths,
  initial: TrayState,
  onAction: (action: TrayAction) => void,
): TrayController {
  const templateImage = nativeImage.createFromPath(icons.template);
  templateImage.setTemplateImage(true);
  const recordingImage = nativeImage.createFromPath(icons.recording);
  const tray = new Tray(templateImage);

  const update = (state: TrayState) => {
    const icon = trayIconState(state.recording);
    tray.setImage(icon.redDot ? recordingImage : templateImage);
    tray.setToolTip(icon.tooltip);
    const template: MenuItemConstructorOptions[] = toNativeTemplate(buildTrayMenu(state), onAction);
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };
  update(initial);

  return { update, destroy: () => tray.destroy() };
}
