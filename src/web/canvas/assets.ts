import { getAssetUrls } from '@tldraw/assets/selfHosted';
import { CANVAS_ENGINE } from '../../shared/model';

/** Supply this as Tldraw's assetUrls when implementing the canvas component. */
export const canvasAssetUrls = getAssetUrls({
  baseUrl: `/assets/tldraw/${CANVAS_ENGINE.split('@')[1]}`,
});
