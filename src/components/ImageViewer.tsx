import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./ImageViewer.css";
import { imageCache } from "../utils/image-cache";
import { readFileBinary } from "../utils/tauri-api";
import {
  createGPUContext,
  enableCanvasAcceleration,
  checkGPUSupport,
  getGPUInfo,
} from "../utils/gpu-canvas";
import { Icon, useToast } from '@mpe/ui';
import { logger } from '../utils/logger';

interface ImageViewerProps {
  imagePath: string;
  fileName: string;
  selectedTool?: string | null;
  selectedColor?: { r: number; g: number; b: number; a: number };
  toolSize?: number;
  onColorPick?: (color: { r: number; g: number; b: number; a: number }) => void;
  onHasChanges?: (hasChanges: boolean) => void;
  savedCanvasData?: string | null;
  onSaveCanvasData?: (data: string) => void;
  onImageLoad?: (info: { width: number; height: number }) => void;
}

export default function ImageViewer({
  imagePath,
  fileName,
  selectedTool = null,
  selectedColor = { r: 0, g: 0, b: 0, a: 100 },
  toolSize: externalToolSize = 5,
  onColorPick,
  onHasChanges,
  savedCanvasData,
  onSaveCanvasData,
  onImageLoad
}: ImageViewerProps) {
  const toast = useToast();
  const [zoom, setZoom] = useState(100);
  const [error, setError] = useState(false);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [initialZoomSet, setInitialZoomSet] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const gridRenderTimeoutRef = useRef<number | null>(null);
  const [isMinimapClosing, setIsMinimapClosing] = useState(false);
  const [minimapPosition, setMinimapPosition] = useState({ x: 20, y: 20 });
  const [isMinimapManuallyHidden, setIsMinimapManuallyHidden] = useState(false);
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);
  const [minimapDragStart, setMinimapDragStart] = useState({ x: 0, y: 0 });
  const [isMinimapHovered, setIsMinimapHovered] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const toolSize = externalToolSize;
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const pendingDrawOps = useRef<Array<{x: number, y: number, tool: string}>>([]);
  const drawAnimationFrame = useRef<number | null>(null);
  const gpuInfoRef = useRef<string>('');
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [persistedHistory, setPersistedHistory] = useState<any[]>([]);
  
  const [selectionMode, setSelectionMode] = useState<'rectangle' | 'magic-wand' | 'polygon'>('rectangle');
  const [selectionPath, setSelectionPath] = useState<{ x: number; y: number }[]>([]);
  // F-PERF-05: 使用 SelectionMask (Uint8Array) 替代 boolean[][]
  const [selectionMask, setSelectionMask] = useState<{ data: Uint8Array; width: number; height: number } | null>(null);
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [isSelectingRect, setIsSelectingRect] = useState(false);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);
  const [rectEnd, setRectEnd] = useState<{ x: number; y: number } | null>(null);
  
  const contentRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const blobUrlRef = useRef<string | null>(null);  // F-BUG-04: 跟踪 blob URL 以正确清理

  const minimapSize = (() => {
    const maxSize = 200;
    let w = imageSize.width;
    let h = imageSize.height;
    if (w === 0 || h === 0) return { width: 0, height: 0 };
    
    if (w > h) {
      if (w > maxSize) {
        h = h * (maxSize / w);
        w = maxSize;
      }
    } else {
      if (h > maxSize) {
        w = w * (maxSize / h);
        h = maxSize;
      }
    }
    return { width: w, height: h };
  })();

  const needMinimap = useMemo(() => {
    if (!contentRef.current || imageSize.width === 0 || imageSize.height === 0) return false;
    const container = contentRef.current;
    const zoomScale = zoom / 100;
    const viewportW = container.clientWidth / zoomScale;
    const viewportH = container.clientHeight / zoomScale;
    return viewportW < imageSize.width || viewportH < imageSize.height;
  }, [imageSize.width, imageSize.height, zoom]);

  useEffect(() => {
    if (!needMinimap && showMinimap && !isMinimapClosing) {
      handleMinimapClose(false);
    } else if (needMinimap && !showMinimap && !isMinimapClosing && !isMinimapManuallyHidden) {
      setShowMinimap(true);
    }
  }, [needMinimap, showMinimap, isMinimapClosing, isMinimapManuallyHidden]);

  const updateMinimap = useCallback(() => {
    if (!showMinimap || !minimapCanvasRef.current || !canvasRef.current || minimapSize.width === 0) return;
    
    const minimap = minimapCanvasRef.current;
    const source = canvasRef.current;
    const drawing = drawingCanvasRef.current;
    
    minimap.width = minimapSize.width;
    minimap.height = minimapSize.height;
    
    const ctx = minimap.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, minimap.width, minimap.height);
      ctx.drawImage(source, 0, 0, minimap.width, minimap.height);
      if (drawing) {
        ctx.drawImage(drawing, 0, 0, minimap.width, minimap.height);
      }
    }
  }, [showMinimap, minimapSize.width, minimapSize.height]);

  useEffect(() => {
    const timer = setTimeout(updateMinimap, 100);
    return () => clearTimeout(timer);
  }, [updateMinimap, historyIndex, hasChanges]);

  // 初始化
  useEffect(() => {
    if (imageSrc && imageRef.current && canvasRef.current && drawingCanvasRef.current && previewCanvasRef.current) {
      const img = imageRef.current;
      const canvas = canvasRef.current;
      const drawingCanvas = drawingCanvasRef.current;
      const previewCanvas = previewCanvasRef.current;
      
      const gpuSupport = checkGPUSupport();
      gpuInfoRef.current = getGPUInfo();
      logger.debug('[GPU加速] 支持情况:', gpuSupport);
      
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      drawingCanvas.width = img.naturalWidth;
      drawingCanvas.height = img.naturalHeight;
      previewCanvas.width = img.naturalWidth;
      previewCanvas.height = img.naturalHeight;
      
      enableCanvasAcceleration(canvas);
      enableCanvasAcceleration(drawingCanvas);
      enableCanvasAcceleration(previewCanvas);
      
      // 使用优化的上下文选项
      const ctx = canvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
        willReadFrequently: false
      });
      
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
      }
      
      if (savedCanvasData && drawingCanvas) {
        const drawCtx = drawingCanvas.getContext('2d');
        if (drawCtx) {
          const tempImg = new Image();
          tempImg.onload = () => {
            drawCtx.drawImage(tempImg, 0, 0);
          };
          tempImg.src = savedCanvasData;
        }
      }
    }
  }, [imageSrc, imageSize, savedCanvasData]);

  useEffect(() => {
    return () => {
      if (drawingCanvasRef.current && onSaveCanvasData) {
        const dataUrl = drawingCanvasRef.current.toDataURL('image/png');
        onSaveCanvasData(dataUrl);
      }
      if (drawAnimationFrame.current) {
        cancelAnimationFrame(drawAnimationFrame.current);
      }
    };
  }, []);

  useEffect(() => {
    const loadImage = async () => {
      logger.debug(`[性能-图片] 开始加载: ${imagePath}`);
      const startTime = performance.now();
      
      try {
        setInitialZoomSet(false);
        setError(false);
        
        if (imagePath.startsWith('http') || imagePath.startsWith('data:')) {
          setImageSrc(imagePath);
          return;
        }
        
        const cachedImage = imageCache.get(imagePath);
        if (cachedImage) {
          logger.debug(`[性能-图片] 从缓存加载`);
          setImageSrc(cachedImage);
          const img = new Image();
          img.onload = () => {
             const size = { width: img.naturalWidth, height: img.naturalHeight };
             setImageSize(size);
             if (onImageLoad) onImageLoad(size);
          };
          img.src = cachedImage;
          return;
        }
        
        const binaryData = await readFileBinary(imagePath);
        const uint8Array = new Uint8Array(binaryData);
        const blob = new Blob([uint8Array], { type: 'image/png' });
        
        const objectUrl = URL.createObjectURL(blob);
        blobUrlRef.current = objectUrl;  // F-BUG-04: 用 ref 跟踪 blob URL
        setImageSrc(objectUrl);
        
        const img = new Image();
        img.onload = () => {
          const size = { width: img.naturalWidth, height: img.naturalHeight };
          setImageSize(size);
          if (onImageLoad) onImageLoad(size);
          
          logger.debug(`[性能-图片] 加载完成: ${size.width}x${size.height}, 耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
          
          setTimeout(() => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = reader.result as string;
              imageCache.set(imagePath, base64data);
              logger.debug(`[性能-图片] Base64缓存完成`);
            };
            reader.onerror = () => {
              logger.error('[性能-图片] Base64转换失败');
            };
            reader.readAsDataURL(blob);
          }, 100);
        };
        img.onerror = () => {
          logger.error('[性能-图片] 图片对象加载失败');
          setError(true);
        };
        img.src = objectUrl;
        
      } catch (err) {
        logger.error(`[性能-图片] 加载失败`, err);
        setError(true);
      }
    };
    
    loadImage();
    
    // 清理 (F-BUG-04: 使用 ref 避免闭包捕获过期 imageSrc)
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [imagePath]);
  
  // 自适应缩放
  useEffect(() => {
    if (imageSize.width > 0 && imageSize.height > 0 && contentRef.current && !initialZoomSet) {
      const container = contentRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      
      const availableWidth = containerWidth * 0.9;
      const availableHeight = containerHeight * 0.9;
      
      const scaleX = availableWidth / imageSize.width;
      const scaleY = availableHeight / imageSize.height;
      const scale = Math.min(scaleX, scaleY, 1);
      
      if (scale < 1) {
        const newZoom = Math.floor(scale * 100);
        setZoom(Math.max(newZoom, 1));
      } else {
        setZoom(100);
      }
      setPosition({ x: 0, y: 0 });
      setInitialZoomSet(true);
    }
  }, [imageSize, initialZoomSet]);

  // 鼠标滚轮缩放 
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (contentRef.current && contentRef.current.contains(e.target as Node)) {
        e.preventDefault();
        
        let delta: number;
        if (e.ctrlKey) {
          delta = e.deltaY > 0 ? -50 : 50;
        } else if (e.shiftKey) {
          delta = e.deltaY > 0 ? -5 : 5;
        } else {
          delta = e.deltaY > 0 ? -10 : 10;
        }
        
        setZoom((prev) => {
          const newZoom = prev + delta;
          return Math.min(Math.max(newZoom, 1), 10000);
        });
      }
    };

    const content = contentRef.current;
    if (content) {
      content.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (content) {
        content.removeEventListener('wheel', handleWheel);
      }
    };
  }, []);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 25, 10000));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 25, 1));
  const handleReset = () => {
    setZoom(100);
    setPosition({ x: 0, y: 0 });
  };

  const getCanvasCoordinates = (e: React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const drawBrush = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const alpha = selectedColor.a / 100;
    const centerColor = `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${alpha})`;
    const edgeColor = `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, 0)`;
    
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, toolSize / 2);
    gradient.addColorStop(0, centerColor);
    gradient.addColorStop(0.3, centerColor);
    gradient.addColorStop(0.7, `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${alpha * 0.5})`);
    gradient.addColorStop(1, edgeColor);
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, toolSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }, [selectedColor, toolSize]);

  const drawPencil = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const alpha = selectedColor.a / 100;
    ctx.fillStyle = `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${alpha})`;
    const halfSize = Math.floor(toolSize / 2);
    ctx.fillRect(Math.floor(x - halfSize), Math.floor(y - halfSize), toolSize, toolSize);
  }, [selectedColor, toolSize]);

  const erase = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const halfSize = Math.floor(toolSize / 2);
    const startX = Math.floor(x - halfSize);
    const startY = Math.floor(y - halfSize);
    ctx.clearRect(startX, startY, toolSize, toolSize);
    if (canvasRef.current) {
      const baseCtx = canvasRef.current.getContext('2d');
      if (baseCtx) {
        baseCtx.clearRect(startX, startY, toolSize, toolSize);
      }
    }
  }, [toolSize]);

  const magicWandSelect = (x: number, y: number, tolerance: number = 30) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!ctx) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    const startX = Math.floor(x);
    const startY = Math.floor(y);
    const startIndex = (startY * width + startX) * 4;
    const targetColor = { r: data[startIndex], g: data[startIndex + 1], b: data[startIndex + 2], a: data[startIndex + 3] };
    
    // F-PERF-05: 使用 Uint8Array 替代 boolean[][]，减少内存开销
    const mask = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    
    const isSimilar = (r: number, g: number, b: number, a: number) => {
      return Math.abs(r - targetColor.r) <= tolerance && Math.abs(g - targetColor.g) <= tolerance && Math.abs(b - targetColor.b) <= tolerance && Math.abs(a - targetColor.a) <= tolerance;
    };
    
    // F-PERF-01: 使用索引指针替代 queue.shift() (O(1) vs O(n))
    const queue: [number, number][] = [[startX, startY]];
    let queueIndex = 0;
    visited[startY * width + startX] = 1;
    
    while (queueIndex < queue.length) {
      const [cx, cy] = queue[queueIndex++];
      const index = (cy * width + cx) * 4;
      
      if (isSimilar(data[index], data[index + 1], data[index + 2], data[index + 3])) {
        mask[cy * width + cx] = 1;
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny * width + nx]) {
            visited[ny * width + nx] = 1;
            queue.push([nx, ny]);
          }
        }
      }
    }
    setSelectionMask({ data: mask, width, height });
    setIsSelectionActive(true);
  };
  
  const isPointInPolygon = (x: number, y: number, polygon: { x: number; y: number }[]) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const createPolygonMask = (polygon: { x: number; y: number }[]) => {
    if (!canvasRef.current || polygon.length < 3) return;
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isPointInPolygon(x, y, polygon)) mask[y * width + x] = 1;
      }
    }
    setSelectionMask({ data: mask, width, height });
    setIsSelectionActive(true);
  };

  const createRectangleMask = (x1: number, y1: number, x2: number, y2: number) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    const startX = Math.max(0, Math.min(Math.floor(Math.min(x1, x2)), width - 1));
    const startY = Math.max(0, Math.min(Math.floor(Math.min(y1, y2)), height - 1));
    const endX = Math.max(0, Math.min(Math.floor(Math.max(x1, x2)), width - 1));
    const endY = Math.max(0, Math.min(Math.floor(Math.max(y1, y2)), height - 1));
    const mask = new Uint8Array(width * height);
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        mask[y * width + x] = 1;
      }
    }
    setSelectionMask({ data: mask, width, height });
    setIsSelectionActive(true);
  };

  const clearSelection = () => {
    setSelectionMask(null);
    setIsSelectionActive(false);
    setSelectionPath([]);
    setRectStart(null);
    setRectEnd(null);
    setIsSelectingRect(false);
  };

  const deleteSelection = () => {
    if (!selectionMask || !drawingCanvasRef.current) return;
    const canvas = drawingCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const mw = selectionMask.width;
    for (let y = 0; y < selectionMask.height; y++) {
      for (let x = 0; x < mw; x++) {
        if (selectionMask.data[y * mw + x]) {
          const index = (y * canvas.width + x) * 4;
          data[index + 3] = 0;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    setHasChanges(true);
    saveHistory();
  };

  const fillSelection = (color: { r: number; g: number; b: number; a: number }) => {
    if (!selectionMask || !drawingCanvasRef.current) return;
    const canvas = drawingCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const mw = selectionMask.width;
    for (let y = 0; y < selectionMask.height; y++) {
      for (let x = 0; x < mw; x++) {
        if (selectionMask.data[y * mw + x]) {
          const index = (y * canvas.width + x) * 4;
          data[index] = color.r;
          data[index + 1] = color.g;
          data[index + 2] = color.b;
          data[index + 3] = Math.round(color.a * 2.55);
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    setHasChanges(true);
    saveHistory();
  };

  const pickColor = (x: number, y: number) => {
    if (!canvasRef.current || !drawingCanvasRef.current) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasRef.current.width;
    tempCanvas.height = canvasRef.current.height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!tempCtx) return;
    tempCtx.drawImage(canvasRef.current, 0, 0);
    tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
    const imageData = tempCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
    const [r, g, b, a] = imageData.data;
    if (onColorPick) onColorPick({ r, g, b, a: Math.round((a / 255) * 100) });
  };

  const saveHistoryToBackend = async () => {
    const historyEnabled = localStorage.getItem('historyEnabled') === 'true';
    if (!historyEnabled || !drawingCanvasRef.current) return;
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      const maxCount = parseInt(localStorage.getItem('maxHistoryCount') || '30');
      const dataUrl = drawingCanvasRef.current.toDataURL('image/png');
      await invoke('save_file_history', { packDir, filePath: imagePath, content: dataUrl, fileType: 'image', maxCount });
    } catch (error) {
      logger.error('保存历史记录失败:', error);
    }
  };

  const loadHistoryFromBackend = async () => {
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      const entries = await invoke<any[]>('load_file_history', { packDir, filePath: imagePath });
      setPersistedHistory(entries);
    } catch (error) {
      logger.error('加载历史记录失败:', error);
    }
  };

  const showHistoryDialog = () => {
    loadHistoryFromBackend();
    setShowHistoryList(true);
  };

  const restoreFromHistory = async (entry: any) => {
    if (!drawingCanvasRef.current) return;
    try {
      const img = new Image();
      img.onload = () => {
        const ctx = drawingCanvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, drawingCanvasRef.current!.width, drawingCanvasRef.current!.height);
          ctx.drawImage(img, 0, 0);
          setHasChanges(true);
          saveHistory();
        }
      };
      img.src = entry.content;
      setShowHistoryList(false);
    } catch (error) {
      logger.error('恢复历史记录失败:', error);
      toast({ message: '恢复失败', type: 'error' });
    }
  };

  const saveHistory = () => {
    if (!drawingCanvasRef.current) return;
    const ctx = drawingCanvasRef.current.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(imageData);
    if (newHistory.length > 50) newHistory.shift();
    else setHistoryIndex(historyIndex + 1);
    setHistory(newHistory);
  };

  const undo = useCallback(() => {
    if (historyIndex > 0 && drawingCanvasRef.current) {
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) {
        setHistoryIndex(historyIndex - 1);
        ctx.putImageData(history[historyIndex - 1], 0, 0);
        setHasChanges(true);
      }
    }
  }, [historyIndex, history]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1 && drawingCanvasRef.current) {
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) {
        setHistoryIndex(historyIndex + 1);
        ctx.putImageData(history[historyIndex + 1], 0, 0);
        setHasChanges(true);
      }
    }
  }, [historyIndex, history]);
  
  const drawSelection = () => {
    if (!previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    if (isSelectingRect && rectStart && rectEnd) {
      const x1 = Math.floor(Math.min(rectStart.x, rectEnd.x));
      const y1 = Math.floor(Math.min(rectStart.y, rectEnd.y));
      const x2 = Math.floor(Math.max(rectStart.x, rectEnd.x));
      const y2 = Math.floor(Math.max(rectStart.y, rectEnd.y));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.lineDashOffset = -Date.now() / 100;
      ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
      ctx.setLineDash([]);
    }
    
    if (selectionPath.length > 0 && !isSelectionActive) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -Date.now() / 100;
      ctx.beginPath();
      ctx.moveTo(selectionPath[0].x, selectionPath[0].y);
      for (let i = 1; i < selectionPath.length; i++) ctx.lineTo(selectionPath[i].x, selectionPath[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      selectionPath.forEach((point, index) => {
        ctx.fillStyle = index === 0 ? '#ff0000' : '#ffffff';
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
    
    if (selectionMask && isSelectionActive) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.lineDashOffset = -Date.now() / 100;
      const mw = selectionMask.width;
      const mh = selectionMask.height;
      const md = selectionMask.data;
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          if (md[y * mw + x]) {
             if (x === 0 || !md[y * mw + x - 1]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 1); ctx.stroke(); }
             if (x === mw - 1 || !md[y * mw + x + 1]) { ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + 1); ctx.stroke(); }
             if (y === 0 || !md[(y - 1) * mw + x]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y); ctx.stroke(); }
             if (y === mh - 1 || !md[(y + 1) * mw + x]) { ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y + 1); ctx.stroke(); }
          }
        }
      }
      ctx.setLineDash([]);
    }
  };

  const updatePreview = useCallback((x: number, y: number) => {
    if (!previewCanvasRef.current || !canvasRef.current) return;
    const previewCanvas = previewCanvasRef.current;
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    drawSelection();
    
    if (selectedTool === 'eraser') {
      const halfSize = Math.floor(toolSize / 2);
      const drawX = Math.floor(x - halfSize);
      const drawY = Math.floor(y - halfSize);
      for (let py = 0; py < toolSize; py++) {
        for (let px = 0; px < toolSize; px++) {
          const absX = drawX + px;
          const absY = drawY + py;
          const isLight = ((absX + absY) % 2) === 0;
          ctx.fillStyle = isLight ? '#CCCCCC' : '#999999';
          ctx.fillRect(absX, absY, 1, 1);
        }
      }
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX + 0.5, drawY + 0.5, toolSize - 1, toolSize - 1);
    } else if (selectedTool === 'brush' || selectedTool === 'pencil') {
      ctx.lineWidth = 1;
      if (selectedTool === 'pencil') {
        const halfSize = Math.floor(toolSize / 2);
        const drawX = Math.floor(x - halfSize);
        const drawY = Math.floor(y - halfSize);
        ctx.fillStyle = `rgb(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b})`;
        ctx.fillRect(drawX, drawY, toolSize, toolSize);
        if (toolSize > 2) {
          ctx.strokeStyle = `rgb(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b})`;
          ctx.strokeRect(drawX + 0.5, drawY + 0.5, toolSize - 1, toolSize - 1);
        }
      } else {
        const alpha = selectedColor.a / 100;
        const centerColor = `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${alpha})`;
        const edgeColor = `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, 0)`;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, toolSize / 2);
        gradient.addColorStop(0, centerColor);
        gradient.addColorStop(0.3, centerColor);
        gradient.addColorStop(0.7, `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${alpha * 0.5})`);
        gradient.addColorStop(1, edgeColor);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, toolSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [selectedTool, selectedColor, toolSize]);
  
  const processPendingDrawOps = useCallback(() => {
    if (pendingDrawOps.current.length === 0 || !drawingCanvasRef.current) {
      drawAnimationFrame.current = null;
      return;
    }
    
    const canvas = drawingCanvasRef.current;
    const ctx = createGPUContext(canvas);
    if (!ctx) {
      drawAnimationFrame.current = null;
      return;
    }
    
    // 获取所有待处理操作
    const ops = [...pendingDrawOps.current];
    pendingDrawOps.current = [];
    
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    
    for (const op of ops) {
      // 选区检查
      const canDraw = !selectionMask ||
        (op.y >= 0 && op.y < selectionMask.height &&
         op.x >= 0 && op.x < selectionMask.width &&
         selectionMask.data[Math.floor(op.y) * selectionMask.width + Math.floor(op.x)] !== 0);
      
      if (canDraw) {
        if (op.tool === 'brush') {
          drawBrush(ctx, op.x, op.y);
        } else if (op.tool === 'pencil') {
          drawPencil(ctx, op.x, op.y);
        } else if (op.tool === 'eraser') {
          erase(ctx, op.x, op.y);
        }
      }
    }
    
    ctx.restore();
    drawAnimationFrame.current = null;
    
    if (pendingDrawOps.current.length > 0) {
      drawAnimationFrame.current = requestAnimationFrame(processPendingDrawOps);
    }
  }, [selectionMask, drawBrush, drawPencil, erase]);

  const queueDrawOp = useCallback((x: number, y: number, tool: string) => {
    pendingDrawOps.current.push({ x, y, tool });
    
    if (drawAnimationFrame.current === null) {
      drawAnimationFrame.current = requestAnimationFrame(processPendingDrawOps);
    }
  }, [processPendingDrawOps]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2 && selectedTool === 'selection') {
      e.preventDefault();
      setSelectionMode(prev => prev === 'rectangle' ? 'magic-wand' : prev === 'magic-wand' ? 'polygon' : 'rectangle');
      return;
    }
    if (e.button === 1 || selectedTool === 'move') {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      return;
    }
    if (e.button === 0 && drawingCanvasRef.current) {
      const canvas = drawingCanvasRef.current;
      const coords = getCanvasCoordinates(e, canvas);
      if (selectedTool === 'eyedropper') { pickColor(coords.x, coords.y); return; }
      if (selectedTool === 'selection') {
        if (selectionMode === 'rectangle') { setIsSelectingRect(true); setRectStart(coords); setRectEnd(coords); }
        else if (selectionMode === 'magic-wand') { magicWandSelect(coords.x, coords.y); }
        else {
           setSelectionPath(prev => [...prev, coords]);
           if (selectionPath.length > 2) {
             const first = selectionPath[0];
             if (Math.sqrt((coords.x-first.x)**2 + (coords.y-first.y)**2) < 10) { createPolygonMask(selectionPath); setSelectionPath([]); }
           }
        }
        return;
      }
      if (['brush', 'pencil', 'eraser'].includes(selectedTool || '')) {
        setIsDrawing(true);
        setLastPoint(coords);
        setHasChanges(true);
        queueDrawOp(coords.x, coords.y, selectedTool!);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      if (!contentRef.current) return;
      const container = contentRef.current;
      const zoomScale = zoom / 100;
      const displayWidth = imageSize.width * zoomScale;
      const displayHeight = imageSize.height * zoomScale;
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      setPosition({ x: newX, y: newY }); 
      return;
    }
    if (drawingCanvasRef.current) {
      const canvas = drawingCanvasRef.current;
      const coords = getCanvasCoordinates(e, canvas);
      if (isSelectingRect && rectStart) { setRectEnd(coords); return; }
      if (isDrawing && selectedTool) {
        if (lastPoint) {
          const dx = coords.x - lastPoint.x;
          const dy = coords.y - lastPoint.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const spacing = Math.max(0.5, toolSize * 0.15);
          const steps = Math.max(1, Math.ceil(dist / spacing));
          
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = lastPoint.x + dx * t;
            const y = lastPoint.y + dy * t;
            queueDrawOp(x, y, selectedTool);
          }
        } else {
          queueDrawOp(coords.x, coords.y, selectedTool);
        }
        setLastPoint(coords);
      }
      if (['brush', 'pencil', 'eraser'].includes(selectedTool || '')) updatePreview(coords.x, coords.y);
    }
  };

  const handleMouseUp = () => {
    if (isSelectingRect && rectStart && rectEnd) { createRectangleMask(rectStart.x, rectStart.y, rectEnd.x, rectEnd.y); setIsSelectingRect(false); setRectStart(null); setRectEnd(null); }
    if (isDrawing) {
      saveHistory();
    }
    setIsDragging(false); setIsDrawing(false); setLastPoint(null);
  };
  
  const handleMouseLeave = () => {
    handleMouseUp();
    if (previewCanvasRef.current) {
        const ctx = previewCanvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
    }
  };
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey && e.shiftKey && e.key === 'Z') || (e.ctrlKey && e.key === 'y')) { e.preventDefault(); redo(); }
      else if (e.ctrlKey && e.key === 's') { e.preventDefault(); if (hasChanges) handleSave(); }
      else if (e.key === 'Delete' && isSelectionActive) { e.preventDefault(); deleteSelection(); }
      else if (e.key === 'Escape') { e.preventDefault(); clearSelection(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, hasChanges, isSelectionActive]);
  
  useEffect(() => {
     if (drawingCanvasRef.current && history.length === 0 &&
         drawingCanvasRef.current.width > 0 && drawingCanvasRef.current.height > 0) {
         const ctx = drawingCanvasRef.current.getContext('2d', { willReadFrequently: true, alpha: true });
         if (ctx) {
           setHistory([ctx.getImageData(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height)]);
           setHistoryIndex(0);
         }
     }
  }, [imageSrc]);
  
  useEffect(() => { loadHistoryFromBackend(); }, [imagePath]);
  useEffect(() => { if (onHasChanges) onHasChanges(hasChanges); }, [hasChanges]);
  
  const handleSave = async () => {
      if (!canvasRef.current || !drawingCanvasRef.current) return;
      try {
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = canvasRef.current.width;
          finalCanvas.height = canvasRef.current.height;
          const finalCtx = finalCanvas.getContext('2d');
          if (finalCtx) {
              finalCtx.drawImage(canvasRef.current, 0, 0);
              finalCtx.drawImage(drawingCanvasRef.current, 0, 0);
              const dataUrl = finalCanvas.toDataURL('image/png');
              const base64Data = dataUrl.split(',')[1];
              await invoke('save_image', { imagePath: imagePath, base64Data: base64Data });
              await saveHistoryToBackend();
              setHasChanges(false);
              toast({ message: '保存成功!', type: 'success' });
          }
      } catch (err) { logger.error('保存失败:', err); toast({ message: `保存失败: ${err}`, type: 'error' }); }
  };
  
  useEffect(() => {
    if (!isSelectionActive && selectionPath.length === 0 && !isSelectingRect) return;
    let id: number;
    const animate = () => { drawSelection(); id = requestAnimationFrame(animate); };
    id = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(id);
  }, [isSelectionActive, selectionPath, selectionMask, isSelectingRect, rectStart, rectEnd]);
  
  const handleMinimapMouseDown = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); setIsDraggingMinimap(true); setMinimapDragStart({ x: e.clientX, y: e.clientY }); };
  const resetMinimapPosition = () => setMinimapPosition({ x: 20, y: 20 });
  useEffect(() => {
    if (!isDraggingMinimap) return;
    const move = (e: MouseEvent) => {
        if (!contentRef.current) return;
        const container = contentRef.current.getBoundingClientRect();
        const dx = e.clientX - minimapDragStart.x;
        const dy = e.clientY - minimapDragStart.y;
        setMinimapPosition({ x: Math.max(20, Math.min(minimapPosition.x - dx, container.width - 220)), y: Math.max(20, Math.min(minimapPosition.y - dy, container.height - 220)) });
        setMinimapDragStart({ x: e.clientX, y: e.clientY });
    };
    const up = () => setIsDraggingMinimap(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [isDraggingMinimap, minimapDragStart, minimapPosition]);
  
  const handleMinimapClose = (isManual: boolean = true) => {
      setIsMinimapClosing(true);
      if (isManual) setIsMinimapManuallyHidden(true);
      setTimeout(() => { setShowMinimap(false); setIsMinimapClosing(false); }, 300);
  };
  
  const getToolCursor = () => {
    if (isDragging) return 'grabbing';
    if (selectedTool === 'move') return 'grab';
    if (['eyedropper', 'selection', 'brush', 'pencil', 'eraser'].includes(selectedTool || '')) return 'crosshair';
    return 'default';
  };

  useEffect(() => {
    if (!gridCanvasRef.current || !contentRef.current || !canvasRef.current || !imageSize.width || !imageSize.height) return;
    
    if (gridRenderTimeoutRef.current) {
      cancelAnimationFrame(gridRenderTimeoutRef.current);
    }
    
    gridRenderTimeoutRef.current = requestAnimationFrame(() => {
      const gridCanvas = gridCanvasRef.current;
      const container = contentRef.current;
      const imageCanvas = canvasRef.current;
      
      if (!gridCanvas || !container || !imageCanvas) return;
      
      const viewportWidth = container.clientWidth;
      const viewportHeight = container.clientHeight;
      
      if (viewportWidth === 0 || viewportHeight === 0) return;
      
      const dpr = window.devicePixelRatio || 1;
      gridCanvas.width = viewportWidth * dpr;
      gridCanvas.height = viewportHeight * dpr;
      gridCanvas.style.width = `${viewportWidth}px`;
      gridCanvas.style.height = `${viewportHeight}px`;
      
      const ctx = gridCanvas.getContext('2d', { alpha: true, desynchronized: true });
      if (!ctx) return;
      
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);

      if (zoom < 400) return;

      const imageRect = imageCanvas.getBoundingClientRect();
      const gridRect = gridCanvas.getBoundingClientRect();
      
      // 计算偏移量和实际缩放比例
      const offsetX = imageRect.left - gridRect.left;
      const offsetY = imageRect.top - gridRect.top;
      const actualScale = imageRect.width / imageSize.width;
      
      const startCol = Math.max(0, Math.floor(-offsetX / actualScale));
      const endCol = Math.min(imageSize.width, Math.ceil((viewportWidth - offsetX) / actualScale));
      const startRow = Math.max(0, Math.floor(-offsetY / actualScale));
      const endRow = Math.min(imageSize.height, Math.ceil((viewportHeight - offsetY) / actualScale));
      
      const maxLines = 500;
      const colStep = Math.max(1, Math.ceil((endCol - startCol) / maxLines));
      const rowStep = Math.max(1, Math.ceil((endRow - startRow) / maxLines));
      
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
      ctx.beginPath();
      
      for (let col = startCol; col <= endCol; col += colStep) {
        const screenX = Math.round(col * actualScale + offsetX) + 0.5;
        if (screenX >= 0 && screenX <= viewportWidth) {
          ctx.moveTo(screenX, Math.max(0, offsetY));
          ctx.lineTo(screenX, Math.min(viewportHeight, offsetY + imageRect.height));
        }
      }
      
      for (let row = startRow; row <= endRow; row += rowStep) {
        const screenY = Math.round(row * actualScale + offsetY) + 0.5;
        if (screenY >= 0 && screenY <= viewportHeight) {
          ctx.moveTo(Math.max(0, offsetX), screenY);
          ctx.lineTo(Math.min(viewportWidth, offsetX + imageRect.width), screenY);
        }
      }
      
      ctx.stroke();
    });
    
    return () => {
      if (gridRenderTimeoutRef.current) {
        cancelAnimationFrame(gridRenderTimeoutRef.current);
      }
    };
  }, [zoom, imageSize, position]);

  const scale = zoom / 100;
  const displayWidth = imageSize.width * scale;
  const displayHeight = imageSize.height * scale;

  return (
    <div className="image-viewer">
      <div className="image-viewer-header">
        <span className="image-file-name">
          {fileName}
          {hasChanges && <span className="unsaved-indicator"> ● 未保存</span>}
        </span>
        <div className="image-controls">
           {/* ... Controls (Zoom, Undo, Redo, Save) ... same as before */}
          <button className="zoom-btn" onClick={undo} disabled={historyIndex <= 0} title="撤销 (Ctrl+Z)">
            <Icon name="undo" size={16} />
          </button>
          <button className="zoom-btn" onClick={redo} disabled={historyIndex >= history.length - 1} title="重做 (Ctrl+Shift+Z)">
            <Icon name="redo" size={16} />
          </button>
          <button className="zoom-btn" onClick={showHistoryDialog} title="历史记录">
            <Icon name="clock" size={16} />
          </button>
          {hasChanges && (
            <button className="save-btn" onClick={handleSave} title="保存更改 (Ctrl+S)">
              <Icon name="save" size={16} /> 保存
            </button>
          )}
          <button className="zoom-btn" onClick={handleZoomOut} title="缩小">
            <Icon name="zoom-out" size={16} />
          </button>
          <span className="zoom-level">{zoom}%</span>
          <button className="zoom-btn" onClick={handleZoomIn} title="放大">
            <Icon name="zoom-in" size={16} />
          </button>
          <button className="zoom-btn" onClick={handleReset} title="重置">
            <Icon name="reset" size={16} />
          </button>
          <button className={`minimap-toggle ${showMinimap ? 'active' : ''}`} onClick={() => showMinimap ? handleMinimapClose(true) : (setIsMinimapManuallyHidden(false), setShowMinimap(true))} title={showMinimap ? "隐藏鸟瞰图" : "显示鸟瞰图"}>
            <Icon name="pixel-grid" size={16} />
          </button>
        </div>
      </div>
      
      <div
        className={`image-viewer-content`}
        ref={contentRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: getToolCursor(), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}
      >
        {/* 网格覆盖层 - 固定在视口，避免创建巨型Canvas */}
        <canvas
          ref={gridCanvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 10
          }}
        />
        {/* 鸟瞰图 (Preserved) */}
        {showMinimap && imageSize.width > 0 && (
          <div className={`minimap-container ${isDraggingMinimap ? 'dragging' : ''} ${isMinimapClosing ? 'closing' : ''}`} style={{ right: `${minimapPosition.x}px`, bottom: `${minimapPosition.y}px`, opacity: isDraggingMinimap ? 0.8 : 0.85, backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }} onMouseDown={(e) => e.stopPropagation()} onMouseEnter={() => setIsMinimapHovered(true)} onMouseLeave={() => setIsMinimapHovered(false)}>
             <div className={`minimap-controls ${isMinimapHovered ? 'visible' : ''}`}>
               <button className="minimap-control-btn minimap-reset-btn" onClick={(e) => { e.stopPropagation(); e.preventDefault(); resetMinimapPosition(); }} title="重置位置"><Icon name="reset" size={14} /></button>
               <button className="minimap-control-btn minimap-close-btn" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleMinimapClose(); }} title="关闭鸟瞰图"><Icon name="close" size={14} /></button>
             </div>
             <div className="minimap-drag-handle" onMouseDown={handleMinimapMouseDown} title="拖动鸟瞰图"><Icon name="drag-handle" size={16} /></div>
             <canvas ref={minimapCanvasRef} className="minimap-canvas" />
             {(() => {
                if (!contentRef.current || minimapSize.width === 0) return null;
                const container = contentRef.current;
                const scale = minimapSize.width / imageSize.width;
                const zoomScale = zoom / 100;
                const displayW = imageSize.width * zoomScale;
                const displayH = imageSize.height * zoomScale;
                const imgLeft = (container.clientWidth - displayW) / 2 + position.x;
                const imgTop = (container.clientHeight - displayH) / 2 + position.y;
                const viewportX = -imgLeft / zoomScale;
                const viewportY = -imgTop / zoomScale;
                const viewportW = container.clientWidth / zoomScale;
                const viewportH = container.clientHeight / zoomScale;
                const miniX = viewportX * scale;
                const miniY = viewportY * scale;
                const miniW = viewportW * scale;
                const miniH = viewportH * scale;
                const offsetX = (200 - minimapSize.width) / 2;
                const offsetY = (200 - minimapSize.height) / 2;
                if (viewportW >= imageSize.width && viewportH >= imageSize.height) return null;
                return <div className="minimap-viewport" style={{ left: offsetX + miniX, top: offsetY + miniY, width: miniW, height: miniH }} />;
             })()}
          </div>
        )}

        {error ? (
          <div className="image-error">
            <Icon name="report-issue" size={32} />
            <p>无法加载图片</p>
            <span className="error-path">{imagePath}</span>
          </div>
        ) : (
          imageSrc && (
            <div
              className="layers-wrapper"
              style={{
                position: 'relative',
                width: displayWidth,
                height: displayHeight,
                transform: `translate(${position.x}px, ${position.y}px)`,
                transformOrigin: 'center center',
                willChange: 'transform'
              }}
            >
              {/* 1. 背景层 (棋盘格) - 使用 CSS 背景图案，避免创建巨型 Canvas */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  backgroundImage: `
                    linear-gradient(45deg, #999999 25%, transparent 25%),
                    linear-gradient(-45deg, #999999 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #999999 75%),
                    linear-gradient(-45deg, transparent 75%, #999999 75%)
                  `,
                  backgroundSize: '32px 32px',
                  backgroundPosition: '0 0, 0 16px, 16px -16px, -16px 0px',
                  backgroundColor: '#CCCCCC',
                  imageRendering: 'pixelated',
                  zIndex: 0
                }}
              />

              {/* 2. 内容层 (图片 + 绘图) - 使用 transform: scale */}
              <div
                className="content-layer"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: imageSize.width,
                  height: imageSize.height,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  imageRendering: 'pixelated',
                  zIndex: 1
                }}
              >
                <img
                  ref={imageRef}
                  src={imageSrc}
                  alt={fileName}
                  draggable={false}
                  style={{ display: 'none' }}
                />
                <canvas
                  ref={canvasRef}
                  style={{ position: 'absolute', top: 0, left: 0, display: 'block', imageRendering: 'pixelated' }}
                />
                <canvas
                  ref={drawingCanvasRef}
                  style={{ position: 'absolute', top: 0, left: 0, display: 'block', imageRendering: 'pixelated' }}
                />
                <canvas
                  ref={previewCanvasRef}
                  style={{ position: 'absolute', top: 0, left: 0, display: 'block', imageRendering: 'pixelated', pointerEvents: 'none' }}
                />
              </div>
            </div>
          )
        )}
      </div>
      
      {showHistoryList && (
        <>
          <div className="modal-overlay" onClick={() => setShowHistoryList(false)} />
          <div className="history-list-dialog">
            <div className="dialog-header">
              <h3>历史记录</h3>
              <button className="dialog-close" onClick={() => setShowHistoryList(false)}><Icon name="close" size={16} /></button>
            </div>
            <div className="dialog-content">
              {persistedHistory.length === 0 ? (
                <div className="empty-history"><p>暂无历史记录</p></div>
              ) : (
                <div className="history-list">
                  {[...persistedHistory].reverse().map((entry, index) => (
                    <div key={index} className="history-item">
                      <div className="history-main">
                        <div className="history-info">
                          <span className="history-index">#{persistedHistory.length - index}</span>
                          <span className="history-time">{new Date(entry.timestamp).toLocaleString('zh-CN')}</span>
                        </div>
                        <div className="history-actions"><button className="btn-restore" onClick={() => restoreFromHistory(entry)}>恢复</button></div>
                      </div>
                      <div className="history-preview history-preview-image"><img src={entry.content} alt={`历史版本`} className="preview-image" /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}