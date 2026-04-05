interface WorkerMessage {
  id: string;
  type: 'process-image' | 'calculate-histogram' | 'apply-filter' | 'resize';
  data: any;
}

interface WorkerResponse {
  id: string;
  type: string;
  result?: any;
  error?: string;
}

function processImageData(imageData: ImageData): ImageData {
  return imageData;
}

function calculateHistogram(imageData: ImageData): {
  r: number[];
  g: number[];
  b: number[];
  brightness: number[];
} {
  const data = imageData.data;
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const brightness = new Array(256).fill(0);
  
  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    brightness[lum]++;
  }
  
  return { r, g, b, brightness };
}

function applyFilter(imageData: ImageData, filterType: string, params: any): ImageData {
  const data = imageData.data;
  const result = new Uint8ClampedArray(data);
  
  switch (filterType) {
    case 'brightness':
      const brightness = params.value || 0;
      for (let i = 0; i < result.length; i += 4) {
        result[i] = Math.min(255, Math.max(0, result[i] + brightness));
        result[i + 1] = Math.min(255, Math.max(0, result[i + 1] + brightness));
        result[i + 2] = Math.min(255, Math.max(0, result[i + 2] + brightness));
      }
      break;
      
    case 'contrast':
      const contrast = params.value || 0;
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      for (let i = 0; i < result.length; i += 4) {
        result[i] = Math.min(255, Math.max(0, factor * (result[i] - 128) + 128));
        result[i + 1] = Math.min(255, Math.max(0, factor * (result[i + 1] - 128) + 128));
        result[i + 2] = Math.min(255, Math.max(0, factor * (result[i + 2] - 128) + 128));
      }
      break;
      
    case 'grayscale':
      for (let i = 0; i < result.length; i += 4) {
        const gray = 0.299 * result[i] + 0.587 * result[i + 1] + 0.114 * result[i + 2];
        result[i] = result[i + 1] = result[i + 2] = gray;
      }
      break;
      
    case 'invert':
      for (let i = 0; i < result.length; i += 4) {
        result[i] = 255 - result[i];
        result[i + 1] = 255 - result[i + 1];
        result[i + 2] = 255 - result[i + 2];
      }
      break;
  }
  
  return new ImageData(result, imageData.width, imageData.height);
}

function resizeNearestNeighbor(
  imageData: ImageData,
  newWidth: number,
  newHeight: number
): ImageData {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(newWidth * newHeight * 4);
  
  const xRatio = width / newWidth;
  const yRatio = height / newHeight;
  
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      
      result[dstIdx] = data[srcIdx];
      result[dstIdx + 1] = data[srcIdx + 1];
      result[dstIdx + 2] = data[srcIdx + 2];
      result[dstIdx + 3] = data[srcIdx + 3];
    }
  }
  
  return new ImageData(result, newWidth, newHeight);
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, type, data } = event.data;
  
  try {
    let result: any;
    
    switch (type) {
      case 'process-image':
        result = processImageData(data.imageData);
        break;
        
      case 'calculate-histogram':
        result = calculateHistogram(data.imageData);
        break;
        
      case 'apply-filter':
        result = applyFilter(data.imageData, data.filterType, data.params);
        break;
        
      case 'resize':
        result = resizeNearestNeighbor(data.imageData, data.width, data.height);
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    
    const response: WorkerResponse = {
      id,
      type,
      result,
    };
    
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      type,
      error: error instanceof Error ? error.message : String(error),
    };
    
    self.postMessage(response);
  }
};

export {};