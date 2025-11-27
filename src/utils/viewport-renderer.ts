export interface ViewportInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface RenderRegion {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  destX: number;
  destY: number;
  destWidth: number;
  destHeight: number;
}

export function calculateViewport(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  positionX: number,
  positionY: number
): ViewportInfo {
  const scale = zoom / 100;
  
  const displayWidth = imageWidth * scale;
  const displayHeight = imageHeight * scale;
  
  const imgLeft = (containerWidth - displayWidth) / 2 + positionX;
  const imgTop = (containerHeight - displayHeight) / 2 + positionY;
  
  const viewportX = Math.max(0, -imgLeft / scale);
  const viewportY = Math.max(0, -imgTop / scale);
  const viewportWidth = Math.min(imageWidth - viewportX, containerWidth / scale);
  const viewportHeight = Math.min(imageHeight - viewportY, containerHeight / scale);
  
  return {
    x: viewportX,
    y: viewportY,
    width: viewportWidth,
    height: viewportHeight,
    scale
  };
}

export function calculateRenderRegion(
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number,
  bufferRatio: number = 0.2
): RenderRegion {
  const bufferX = viewport.width * bufferRatio;
  const bufferY = viewport.height * bufferRatio;
  
  const sourceX = Math.max(0, Math.floor(viewport.x - bufferX));
  const sourceY = Math.max(0, Math.floor(viewport.y - bufferY));
  const sourceWidth = Math.min(
    imageWidth - sourceX,
    Math.ceil(viewport.width + bufferX * 2)
  );
  const sourceHeight = Math.min(
    imageHeight - sourceY,
    Math.ceil(viewport.height + bufferY * 2)
  );
  
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destX: 0,
    destY: 0,
    destWidth: sourceWidth,
    destHeight: sourceHeight
  };
}

export function isPointInViewport(
  x: number,
  y: number,
  viewport: ViewportInfo,
  margin: number = 0
): boolean {
  return (
    x >= viewport.x - margin &&
    x <= viewport.x + viewport.width + margin &&
    y >= viewport.y - margin &&
    y <= viewport.y + viewport.height + margin
  );
}

export function filterOpsInViewport<T extends { x: number; y: number }>(
  ops: T[],
  viewport: ViewportInfo,
  toolSize: number = 0
): T[] {
  const margin = toolSize * 2;
  return ops.filter(op => isPointInViewport(op.x, op.y, viewport, margin));
}

export class ViewportRenderer {
  private lastViewport: ViewportInfo | null = null;
  private renderRegion: RenderRegion | null = null;
  private needsFullRedraw: boolean = true;
  
  shouldRedraw(
    newViewport: ViewportInfo,
    threshold: number = 0.1
  ): boolean {
    if (!this.lastViewport || this.needsFullRedraw) {
      return true;
    }
    
    const deltaX = Math.abs(newViewport.x - this.lastViewport.x);
    const deltaY = Math.abs(newViewport.y - this.lastViewport.y);
    const deltaWidth = Math.abs(newViewport.width - this.lastViewport.width);
    const deltaHeight = Math.abs(newViewport.height - this.lastViewport.height);
    const deltaScale = Math.abs(newViewport.scale - this.lastViewport.scale);
    
    return (
      deltaX > newViewport.width * threshold ||
      deltaY > newViewport.height * threshold ||
      deltaWidth > newViewport.width * threshold ||
      deltaHeight > newViewport.height * threshold ||
      deltaScale > 0.01
    );
  }
  
  updateViewport(viewport: ViewportInfo, imageWidth: number, imageHeight: number): void {
    this.lastViewport = viewport;
    this.renderRegion = calculateRenderRegion(viewport, imageWidth, imageHeight);
    this.needsFullRedraw = false;
  }
  
  getRenderRegion(): RenderRegion | null {
    return this.renderRegion;
  }
  
  markDirty(): void {
    this.needsFullRedraw = true;
  }
  
  reset(): void {
    this.lastViewport = null;
    this.renderRegion = null;
    this.needsFullRedraw = true;
  }
}

export function renderWithViewport(
  sourceCanvas: HTMLCanvasElement,
  destCanvas: HTMLCanvasElement,
  region: RenderRegion
): void {
  const ctx = destCanvas.getContext('2d');
  if (!ctx) return;
  
  if (destCanvas.width !== region.destWidth || destCanvas.height !== region.destHeight) {
    destCanvas.width = region.destWidth;
    destCanvas.height = region.destHeight;
  }
  
  ctx.clearRect(0, 0, destCanvas.width, destCanvas.height);
  ctx.drawImage(
    sourceCanvas,
    region.sourceX,
    region.sourceY,
    region.sourceWidth,
    region.sourceHeight,
    region.destX,
    region.destY,
    region.destWidth,
    region.destHeight
  );
}

export function calculatePerformanceGain(
  fullWidth: number,
  fullHeight: number,
  viewportWidth: number,
  viewportHeight: number
): {
  pixelReduction: number;
  percentageSaved: number;
  estimatedSpeedup: number;
} {
  const fullPixels = fullWidth * fullHeight;
  const viewportPixels = viewportWidth * viewportHeight;
  const pixelReduction = fullPixels - viewportPixels;
  const percentageSaved = (pixelReduction / fullPixels) * 100;
  
  const estimatedSpeedup = fullPixels / viewportPixels;
  
  return {
    pixelReduction,
    percentageSaved: parseFloat(percentageSaved.toFixed(2)),
    estimatedSpeedup: parseFloat(estimatedSpeedup.toFixed(2))
  };
}