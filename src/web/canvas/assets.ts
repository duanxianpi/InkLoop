import { getAssetUrls } from '@tldraw/assets/selfHosted';
import { CANVAS_ENGINE } from '../../shared/model';

/** Tldraw's assetUrls: the pinned fonts, icons and translations, served locally. */
export const canvasAssetUrls = getAssetUrls({
  baseUrl: `/assets/tldraw/${CANVAS_ENGINE.split('@')[1]}`,
});
