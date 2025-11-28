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
  BatchDrawOptimizer
} from "../utils/gpu-canvas";
import { testCanvasGPUAcceleration, generateGPUReport } from "../utils/gpu-test";

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
  const [zoom, setZoom] = useState(100);
  const [error, setError] = useState(false);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [initialZoomSet, setInitialZoomSet] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
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
  const batchOptimizer = useRef<BatchDrawOptimizer>(new BatchDrawOptimizer());
  const gpuInfoRef = useRef<string>('');
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [persistedHistory, setPersistedHistory] = useState<any[]>([]);
  
  const [selectionMode, setSelectionMode] = useState<'rectangle' | 'magic-wand' | 'polygon'>('rectangle');
  const [selectionPath, setSelectionPath] = useState<{ x: number; y: number }[]>([]);
  const [selectionMask, setSelectionMask] = useState<boolean[][] | null>(null);
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

  // 使用useMemo缓存计算结果,减少不必要的重新计算
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

  // 使用useCallback优化鸟瞰图更新函数
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

  // 使用防抖减少鸟瞰图更新频率
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
      
      // 检查GPU支持
      const gpuSupport = checkGPUSupport();
      gpuInfoRef.current = getGPUInfo();
      console.log('[GPU加速] 支持情况:', gpuSupport);
      console.log('[GPU加速] GPU信息:', gpuInfoRef.current);
      
      // 保持原始分辨率
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      drawingCanvas.width = img.naturalWidth;
      drawingCanvas.height = img.naturalHeight;
      previewCanvas.width = img.naturalWidth;
      previewCanvas.height = img.naturalHeight;
      
      console.log(`[性能-GPU] 原始分辨率渲染: ${img.naturalWidth}x${img.naturalHeight}`);
      
      // 启用Canvas硬件加速
      enableCanvasAcceleration(canvas);
      enableCanvasAcceleration(drawingCanvas);
      enableCanvasAcceleration(previewCanvas);
      
      setTimeout(() => {
        console.log('\n' + generateGPUReport(drawingCanvas));
        const test = testCanvasGPUAcceleration(drawingCanvas);
        if (!test.isAccelerated) {
          console.warn('️ GPU加速未完全启用,性能可能受限');
        }
      }, 100);
      
      const ctx = createGPUContext(canvas);
      
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        
        ctx.drawImage(img, 0, 0);
      }
      
      // 恢复之前保存的绘图数据
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

  // 组件卸载前保存数据
  useEffect(() => {
    return () => {
      if (drawingCanvasRef.current && onSaveCanvasData) {
        const dataUrl = drawingCanvasRef.current.toDataURL('image/png');
        onSaveCanvasData(dataUrl);
      }
    };
  }, []);
useEffect(() => {
const loadImage = async () => {
  console.log(`[性能-图片]  开始加载: ${imagePath}`);
  const startTime = performance.now();
  
  try {
    setInitialZoomSet(false);
    
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
      setImageSrc(imagePath);
      const duration = (performance.now() - startTime).toFixed(2);
      console.log(`[性能-图片]  直接URL加载! 耗时: ${duration}ms`);
      return;
    }
    
    // 检查缓存
    const cacheCheckStart = performance.now();
    const cachedImage = imageCache.get(imagePath);
    const cacheCheckDuration = (performance.now() - cacheCheckStart).toFixed(2);
    
    if (cachedImage) {
      const duration = (performance.now() - startTime).toFixed(2);
      console.log(`[性能-图片] 从缓存加载!`);
      console.log(`  ├─ 缓存查询耗时: ${cacheCheckDuration}ms`);
      console.log(`  └─ 总耗时: ${duration}ms`);
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
    
    console.log(`[性能-图片]   缓存未命中，开始读取文件...`);
    
    const readStart = performance.now();
    const binaryData = await readFileBinary(imagePath);
    const readDuration = (performance.now() - readStart).toFixed(2);
    console.log(`[性能-图片]   ├─ Tauri读取耗时: ${readDuration}ms`);
    
    // 创建 Blob
    const blobStart = performance.now();
    const uint8Array = new Uint8Array(binaryData);
    const blob = new Blob([uint8Array], { type: 'image/png' });
    const objectUrl = URL.createObjectURL(blob);
    const blobDuration = (performance.now() - blobStart).toFixed(2);
    console.log(`[性能-图片]   ├─ Blob创建耗时: ${blobDuration}ms`);
    
    // 转换为 Base64并缓存
    const base64Start = performance.now();
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Duration = (performance.now() - base64Start).toFixed(2);
      console.log(`[性能-图片]   ├─ Base64转换耗时: ${base64Duration}ms`);
      
      const base64data = reader.result as string;
      imageCache.set(imagePath, base64data);
      setImageSrc(base64data);
      
      const img = new Image();
      img.onload = () => {
        const size = { width: img.naturalWidth, height: img.naturalHeight };
        setImageSize(size);
        if (onImageLoad) onImageLoad(size);
        URL.revokeObjectURL(objectUrl);
        
        const totalDuration = (performance.now() - startTime).toFixed(2);
        console.log(`[性能-图片]  加载完成!`);
        console.log(`  ├─ 图片尺寸: ${size.width}x${size.height}`);
        console.log(`  └─ 总耗时: ${totalDuration}ms`);
      };
      img.src = base64data;
    };
    reader.readAsDataURL(blob);
    
  } catch (err) {
    const duration = (performance.now() - startTime).toFixed(2);
    console.error(`[性能-图片]  加载失败! 耗时: ${duration}ms`, err);
    setError(true);
  }
};

loadImage();
}, [imagePath]);
  
  // 自适应缩放
  useEffect(() => {
    if (imageSize.width > 0 && imageSize.height > 0 && contentRef.current && !initialZoomSet) {
      const container = contentRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      
      // 计算容器可用空间
      const availableWidth = containerWidth * 0.9;
      const availableHeight = containerHeight * 0.9;
      
      // 计算缩放比例以适应容器
      const scaleX = availableWidth / imageSize.width;
      const scaleY = availableHeight / imageSize.height;
      const scale = Math.min(scaleX, scaleY, 1);
      
      // 如果图片太大自动缩小
      if (scale < 1) {
        const newZoom = Math.floor(scale * 100);
        setZoom(Math.max(newZoom, 1));
        setPosition({ x: 0, y: 0 });
      } else {
        setZoom(100);
        setPosition({ x: 0, y: 0 });
      }
      
      setInitialZoomSet(true);
    }
  }, [imageSize, initialZoomSet]);

  // 鼠标滚轮缩放 
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (contentRef.current && contentRef.current.contains(e.target as Node)) {
        e.preventDefault();
        
        // 根据键决定缩放幅度
        let delta: number;
        if (e.ctrlKey) {
          // Ctrl + 滚轮 = 大缩放
          delta = e.deltaY > 0 ? -50 : 50;
        } else if (e.shiftKey) {
          // Shift + 滚轮 = 小缩放
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

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 25, 10000));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 25, 1));
  };

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
    // 使用设置的透明度
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
    // 应用设置的透明度
    const alpha = selectedColor.a / 100;
    ctx.fillStyle = `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${alpha})`;
    
    const halfSize = Math.floor(toolSize / 2);
    ctx.fillRect(Math.floor(x - halfSize), Math.floor(y - halfSize), toolSize, toolSize);
  }, [selectedColor, toolSize]);

  // 优化的线条绘制 
  const drawLine = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, drawFunc: (ctx: CanvasRenderingContext2D, x: number, y: number) => void) => {
    const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const pixelStep = Math.max(1, toolSize / 4);
    const steps = Math.max(Math.ceil(distance / pixelStep), 1);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      drawFunc(ctx, x, y);
    }
  };

  const erase = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.clearRect(x - toolSize / 2, y - toolSize / 2, toolSize, toolSize);
    
    if (canvasRef.current) {
      const baseCtx = canvasRef.current.getContext('2d');
      if (baseCtx) {
        baseCtx.clearRect(x - toolSize / 2, y - toolSize / 2, toolSize, toolSize);
      }
    }
  }, [toolSize]);

  const magicWandSelect = (x: number, y: number, tolerance: number = 30) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    });
    if (!ctx) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    const startX = Math.floor(x);
    const startY = Math.floor(y);
    const startIndex = (startY * width + startX) * 4;
    const targetColor = {
      r: data[startIndex],
      g: data[startIndex + 1],
      b: data[startIndex + 2],
      a: data[startIndex + 3]
    };
    
    const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
    const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
    
    const isSimilar = (r: number, g: number, b: number, a: number) => {
      return Math.abs(r - targetColor.r) <= tolerance &&
             Math.abs(g - targetColor.g) <= tolerance &&
             Math.abs(b - targetColor.b) <= tolerance &&
             Math.abs(a - targetColor.a) <= tolerance;
    };
    
    const queue: [number, number][] = [[startX, startY]];
    visited[startY][startX] = true;
    
    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const index = (cy * width + cx) * 4;
      
      if (isSimilar(data[index], data[index + 1], data[index + 2], data[index + 3])) {
        mask[cy][cx] = true;
        
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
            visited[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }
      }
    }
    
    setSelectionMask(mask);
    setIsSelectionActive(true);
  };

  const isPointInPolygon = (x: number, y: number, polygon: { x: number; y: number }[]) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const createPolygonMask = (polygon: { x: number; y: number }[]) => {
    if (!canvasRef.current || polygon.length < 3) return;
    
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    
    const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isPointInPolygon(x, y, polygon)) {
          mask[y][x] = true;
        }
      }
    }
    
    setSelectionMask(mask);
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
    
    const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
    
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        mask[y][x] = true;
      }
    }
    
    setSelectionMask(mask);
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
    
    for (let y = 0; y < selectionMask.length; y++) {
      for (let x = 0; x < selectionMask[y].length; x++) {
        if (selectionMask[y][x]) {
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
    
    for (let y = 0; y < selectionMask.length; y++) {
      for (let x = 0; x < selectionMask[y].length; x++) {
        if (selectionMask[y][x]) {
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
    const tempCtx = tempCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    });
    if (!tempCtx) return;
    
    tempCtx.drawImage(canvasRef.current, 0, 0);
    tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
    
    const imageData = tempCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
    const [r, g, b, a] = imageData.data;
    
    if (onColorPick) {
      onColorPick({ r, g, b, a: Math.round((a / 255) * 100) });
    }
  };

  const saveHistoryToBackend = async () => {
    const historyEnabled = localStorage.getItem('historyEnabled') === 'true';
    if (!historyEnabled || !drawingCanvasRef.current) return;
    
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      const maxCount = parseInt(localStorage.getItem('maxHistoryCount') || '30');
      
      const dataUrl = drawingCanvasRef.current.toDataURL('image/png');
      
      await invoke('save_file_history', {
        packDir,
        filePath: imagePath,
        content: dataUrl,
        fileType: 'image',
        maxCount
      });
    } catch (error) {
      console.error('保存历史记录失败:', error);
    }
  };

  const loadHistoryFromBackend = async () => {
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      const entries = await invoke<any[]>('load_file_history', {
        packDir,
        filePath: imagePath
      });
      setPersistedHistory(entries);
    } catch (error) {
      console.error('加载历史记录失败:', error);
    }
  };

  const showHistoryDialog = () => {
    loadHistoryFromBackend();
    setShowHistoryList(true);
  };

  // 恢复历史记录
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
      console.error('恢复历史记录失败:', error);
      alert('恢复失败');
    }
  };


  // 保存历史记录
  const saveHistory = () => {
    if (!drawingCanvasRef.current) return;
    
    const ctx = drawingCanvasRef.current.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    });
    if (!ctx) return;
    
    const imageData = ctx.getImageData(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(imageData);
    
    // 限制历史记录数量为50
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }
    
    setHistory(newHistory);
  };

  // 撤销
  const undo = () => {
    if (historyIndex > 0 && drawingCanvasRef.current) {
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) {
        setHistoryIndex(historyIndex - 1);
        ctx.putImageData(history[historyIndex - 1], 0, 0);
        setHasChanges(true);
      }
    }
  };

  // 重做
  const redo = () => {
    if (historyIndex < history.length - 1 && drawingCanvasRef.current) {
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) {
        setHistoryIndex(historyIndex + 1);
        ctx.putImageData(history[historyIndex + 1], 0, 0);
        setHasChanges(true);
      }
    }
  };

  // 绘制选区可视化
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
      for (let i = 1; i < selectionPath.length; i++) {
        ctx.lineTo(selectionPath[i].x, selectionPath[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 绘制路径点
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
      
      for (let y = 0; y < selectionMask.length; y++) {
        for (let x = 0; x < selectionMask[y].length; x++) {
          if (selectionMask[y][x]) {
            if (x === 0 || !selectionMask[y][x - 1]) {
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x, y + 1);
              ctx.stroke();
            }
            if (x === selectionMask[y].length - 1 || !selectionMask[y][x + 1]) {
              ctx.beginPath();
              ctx.moveTo(x + 1, y);
              ctx.lineTo(x + 1, y + 1);
              ctx.stroke();
            }
            if (y === 0 || !selectionMask[y - 1][x]) {
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x + 1, y);
              ctx.stroke();
            }
            if (y === selectionMask.length - 1 || !selectionMask[y + 1][x]) {
              ctx.beginPath();
              ctx.moveTo(x, y + 1);
              ctx.lineTo(x + 1, y + 1);
              ctx.stroke();
            }
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
      
      // 绘制浅色方形边框
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
    if (!ctx) return;
    
    const startTime = performance.now();
    const ops = [...pendingDrawOps.current];
    pendingDrawOps.current = [];
    
    const isLargeImage = canvas.width > 4096 || canvas.height > 4096;
    console.log(`[性能-GPU绘制]  开始处理 ${ops.length} 个操作 ${isLargeImage ? '(大图片模式)' : ''}`);
    console.log(`[性能-GPU绘制]  GPU: ${gpuInfoRef.current}`);
    
    ctx.globalCompositeOperation = 'source-over';
    
    if (isLargeImage && ops.length > 10000) {
      const targetOps = 1500;
      const sampleRate = Math.max(1, Math.floor(ops.length / targetOps));
      
      const sampledOps = [ops[0]];
      for (let i = sampleRate; i < ops.length - 1; i += sampleRate) {
        sampledOps.push(ops[i]);
      }
      if (ops.length > 1) {
        sampledOps.push(ops[ops.length - 1]);
      }
      
      console.log(`[性能-GPU绘制] 智能降采样: ${ops.length} -> ${sampledOps.length} (采样率: 1/${sampleRate})`);
      
      ctx.save();
      // 使用优化的插值算法保持平滑
      for (let i = 0; i < sampledOps.length; i++) {
        const op = sampledOps[i];
        const canDraw = !selectionMask ||
          (op.y >= 0 && op.y < selectionMask.length &&
           op.x >= 0 && op.x < selectionMask[0].length &&
           selectionMask[Math.floor(op.y)][Math.floor(op.x)]);
        
        if (canDraw) {
          if (i > 0) {
            // 在采样点之间插值保持平滑和像素连续性
            const prevOp = sampledOps[i - 1];
            const distance = Math.sqrt((op.x - prevOp.x) ** 2 + (op.y - prevOp.y) ** 2);
            
            // 根据工具大小动态调整插值密度
            const pixelStep = Math.max(toolSize / 3, 2);
            const steps = Math.max(1, Math.ceil(distance / pixelStep));
            
            for (let j = 0; j <= steps; j++) {
              const t = j / steps;
              const x = prevOp.x + (op.x - prevOp.x) * t;
              const y = prevOp.y + (op.y - prevOp.y) * t;
              
              if (op.tool === 'brush') {
                drawBrush(ctx, x, y);
              } else if (op.tool === 'pencil') {
                drawPencil(ctx, x, y);
              } else if (op.tool === 'eraser') {
                erase(ctx, x, y);
              }
            }
          } else {
            // 第一个点直接绘制
            if (op.tool === 'brush') {
              drawBrush(ctx, op.x, op.y);
            } else if (op.tool === 'pencil') {
              drawPencil(ctx, op.x, op.y);
            } else if (op.tool === 'eraser') {
              erase(ctx, op.x, op.y);
            }
          }
        }
      }
      ctx.restore();
    } else {
      ctx.save();
      
      // 如果操作数很少操作之间也进行插值
      if (ops.length < 100) {
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          
          if (i > 0) {
            // 在相邻操作之间超密集插值
            const prevOp = ops[i - 1];
            const distance = Math.sqrt((op.x - prevOp.x) ** 2 + (op.y - prevOp.y) ** 2);
            // 使用极小的步长确保完全连续
            const pixelStep = Math.max(toolSize / 10, 0.3);
            const steps = Math.max(1, Math.ceil(distance / pixelStep));
            
            for (let j = 0; j <= steps; j++) {
              const t = j / steps;
              const x = prevOp.x + (op.x - prevOp.x) * t;
              const y = prevOp.y + (op.y - prevOp.y) * t;
              
              const canDraw = !selectionMask ||
                (y >= 0 && y < selectionMask.length &&
                 x >= 0 && x < selectionMask[0].length &&
                 selectionMask[Math.floor(y)][Math.floor(x)]);
              
              if (canDraw) {
                if (op.tool === 'brush') {
                  drawBrush(ctx, x, y);
                } else if (op.tool === 'pencil') {
                  drawPencil(ctx, x, y);
                } else if (op.tool === 'eraser') {
                  erase(ctx, x, y);
                }
              }
            }
          } else {
            // 第一个点直接绘制
            const canDraw = !selectionMask ||
              (op.y >= 0 && op.y < selectionMask.length &&
               op.x >= 0 && op.x < selectionMask[0].length &&
               selectionMask[Math.floor(op.y)][Math.floor(op.x)]);
            
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
        }
      } else {
        // 操作数较多时,直接绘制
        for (const op of ops) {
          const canDraw = !selectionMask ||
            (op.y >= 0 && op.y < selectionMask.length &&
             op.x >= 0 && op.x < selectionMask[0].length &&
             selectionMask[Math.floor(op.y)][Math.floor(op.x)]);
          
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
      }
      
      ctx.restore();
    }
    
    const duration = performance.now() - startTime;
    const avgTime = ops.length > 0 ? (duration / ops.length).toFixed(3) : '0.000';
    
    const attrs = ctx.getContextAttributes();
    const gpuEnabled = attrs?.desynchronized ||
                       (canvas.style.willChange === 'transform, contents') ||
                       (canvas.style.transform.includes('translateZ'));
    
    console.log(`[性能-GPU绘制]  完成! 耗时: ${duration.toFixed(2)}ms, 平均: ${avgTime}ms/op, GPU加速: ${gpuEnabled ? '是' : '否'}`);
    
    drawAnimationFrame.current = null;
  }, [selectionMask, selectedColor, drawBrush, drawPencil, erase]);
  
  const queueDrawOp = useCallback((x: number, y: number, tool: string) => {
    pendingDrawOps.current.push({ x, y, tool });
    
    if (drawAnimationFrame.current === null) {
      drawAnimationFrame.current = requestAnimationFrame(() => {
        processPendingDrawOps();
      });
    }
  }, [processPendingDrawOps]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2 && selectedTool === 'selection') {
      e.preventDefault();
      if (selectionMode === 'rectangle') {
        setSelectionMode('magic-wand');
      } else if (selectionMode === 'magic-wand') {
        setSelectionMode('polygon');
      } else {
        setSelectionMode('rectangle');
      }
      return;
    }
    
    if (e.button === 1 || selectedTool === 'move') {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
      return;
    }

    if (e.button === 0 && drawingCanvasRef.current) {
      const canvas = drawingCanvasRef.current;
      const coords = getCanvasCoordinates(e, canvas);
      
      if (selectedTool === 'eyedropper') {
        pickColor(coords.x, coords.y);
        return;
      }

      if (selectedTool === 'selection') {
        if (selectionMode === 'rectangle') {
          setIsSelectingRect(true);
          setRectStart(coords);
          setRectEnd(coords);
        } else if (selectionMode === 'magic-wand') {
          magicWandSelect(coords.x, coords.y);
        } else {
          setSelectionPath(prev => [...prev, coords]);
          
          if (selectionPath.length > 2) {
            const firstPoint = selectionPath[0];
            const distance = Math.sqrt(
              (coords.x - firstPoint.x) ** 2 + (coords.y - firstPoint.y) ** 2
            );
            if (distance < 10) {
              createPolygonMask(selectionPath);
              setSelectionPath([]);
            }
          }
        }
        return;
      }
      if (selectedTool === 'brush' || selectedTool === 'pencil' || selectedTool === 'eraser') {
        setIsDrawing(true);
        setLastPoint(coords);
        setHasChanges(true);
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
      
      const minVisibleSize = Math.min(displayWidth, displayHeight, 200);
      const maxX = container.clientWidth - minVisibleSize;
      const minX = -(displayWidth - minVisibleSize);
      const maxY = container.clientHeight - minVisibleSize;
      const minY = -(displayHeight - minVisibleSize);
      
      setPosition({
        x: Math.max(minX, Math.min(maxX, newX)),
        y: Math.max(minY, Math.min(maxY, newY))
      });
      return;
    }

    if (drawingCanvasRef.current) {
      const canvas = drawingCanvasRef.current;
      const coords = getCanvasCoordinates(e, canvas);
      
      if (isSelectingRect && rectStart) {
        setRectEnd(coords);
        return;
      }
    }
    if (isDrawing && drawingCanvasRef.current) {
      const canvas = drawingCanvasRef.current;
      const coords = getCanvasCoordinates(e, canvas);
      
      if (selectedTool) {
        const isLargeImage = canvas.width > 4096 || canvas.height > 4096;
        
        if (lastPoint) {
          const distance = Math.sqrt((coords.x - lastPoint.x) ** 2 + (coords.y - lastPoint.y) ** 2);
          
          let stepSize: number;
          if (isLargeImage) {
            stepSize = Math.max(toolSize / 6, 1);
          } else {
            stepSize = Math.max(toolSize / 10, 0.25);
          }
          
          const steps = Math.max(Math.ceil(distance / stepSize), 1);
          
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = lastPoint.x + (coords.x - lastPoint.x) * t;
            const y = lastPoint.y + (coords.y - lastPoint.y) * t;
            queueDrawOp(x, y, selectedTool);
          }
        } else {
          queueDrawOp(coords.x, coords.y, selectedTool);
        }
      }
      
      setLastPoint(coords);
    }
    
    // 更新预览
    if (drawingCanvasRef.current) {
      const canvas = drawingCanvasRef.current;
      const coords = getCanvasCoordinates(e, canvas);
      
      if (selectedTool === 'brush' || selectedTool === 'pencil' || selectedTool === 'eraser') {
        updatePreview(coords.x, coords.y);
      }
      else if (selectedTool === 'selection' && selectionMode === 'polygon' && selectionPath.length > 0) {
        if (previewCanvasRef.current) {
          const ctx = previewCanvasRef.current.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
            drawSelection();
            
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(selectionPath[selectionPath.length - 1].x, selectionPath[selectionPath.length - 1].y);
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }
  };

  const handleMouseUp = () => {
    if (isSelectingRect && rectStart && rectEnd) {
      createRectangleMask(rectStart.x, rectStart.y, rectEnd.x, rectEnd.y);
      setIsSelectingRect(false);
      setRectStart(null);
      setRectEnd(null);
    }
    
    if (isDrawing) {
      // 确保所有待处理的绘制操作完成
      if (drawAnimationFrame.current !== null) {
        clearTimeout(drawAnimationFrame.current as any);
        processPendingDrawOps();
      }
      saveHistory();
    }
    setIsDragging(false);
    setIsDrawing(false);
    setLastPoint(null);
  };

  const handleMouseLeave = () => {
    if (isSelectingRect) {
      setIsSelectingRect(false);
      setRectStart(null);
      setRectEnd(null);
    }
    
    if (isDrawing) {
      if (drawAnimationFrame.current !== null) {
        clearTimeout(drawAnimationFrame.current as any);
        processPendingDrawOps();
      }
      saveHistory();
    }
    setIsDragging(false);
    setIsDrawing(false);
    setLastPoint(null);
    
    if (previewCanvasRef.current) {
      const ctx = previewCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
      }
    }
  };

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z 撤销
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Ctrl+Shift+Z 或 Ctrl+Y 重做
      else if ((e.ctrlKey && e.shiftKey && e.key === 'Z') || (e.ctrlKey && e.key === 'y')) {
        e.preventDefault();
        redo();
      }
      // Ctrl+S 保存
      else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (hasChanges) {
          handleSave();
        }
      }
      // Delete 删除选区
      else if (e.key === 'Delete' && isSelectionActive) {
        e.preventDefault();
        deleteSelection();
      }
      // Escape 取消选区
      else if (e.key === 'Escape' && (isSelectionActive || selectionPath.length > 0)) {
        e.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, hasChanges, isSelectionActive, selectionPath]);

  // 初始化历史记录
  useEffect(() => {
    if (drawingCanvasRef.current && history.length === 0) {
      const ctx = drawingCanvasRef.current.getContext('2d', {
        willReadFrequently: true,
        alpha: true
      });
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        setHistory([imageData]);
        setHistoryIndex(0);
      }
    }
  }, [imageSrc]);

  // 组件加载时加载历史记录
  useEffect(() => {
    loadHistoryFromBackend();
  }, [imagePath]);

  useEffect(() => {
    if (onHasChanges) {
      onHasChanges(hasChanges);
    }
  }, [hasChanges]);

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
        
        await invoke('save_image', {
          imagePath: imagePath,
          base64Data: base64Data
        });
        
        await saveHistoryToBackend();
        
        setHasChanges(false);
        alert('保存成功!');
      }
    } catch (err) {
      console.error('保存失败:', err);
      alert(`保存失败: ${err}`);
    }
  };

  useEffect(() => {
    if (!isSelectionActive && selectionPath.length === 0 && !isSelectingRect) return;
    
    let animationId: number;
    const animate = () => {
      drawSelection();
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [isSelectionActive, selectionPath, selectionMask, isSelectingRect, rectStart, rectEnd]);

  const handleMinimapMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDraggingMinimap(true);
    setMinimapDragStart({
      x: e.clientX,
      y: e.clientY
    });
  };

  const resetMinimapPosition = () => {
    setMinimapPosition({ x: 20, y: 20 });
  };

  useEffect(() => {
    if (!isDraggingMinimap) return;

    const handleMinimapMouseMove = (e: MouseEvent) => {
      if (!contentRef.current) return;
      
      const container = contentRef.current.getBoundingClientRect();
      
      const deltaX = e.clientX - minimapDragStart.x;
      const deltaY = e.clientY - minimapDragStart.y;
      
      const newX = minimapPosition.x - deltaX;
      const newY = minimapPosition.y - deltaY;
      
      const maxX = container.width - 220;
      const maxY = container.height - 220;
      
      const clampedX = Math.max(20, Math.min(newX, maxX));
      const clampedY = Math.max(20, Math.min(newY, maxY));
      
      setMinimapPosition({
        x: clampedX,
        y: clampedY
      });

      setMinimapDragStart({
        x: e.clientX,
        y: e.clientY
      });
    };

    const handleMinimapMouseUp = () => {
      setIsDraggingMinimap(false);
    };

    window.addEventListener('mousemove', handleMinimapMouseMove);
    window.addEventListener('mouseup', handleMinimapMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMinimapMouseMove);
      window.removeEventListener('mouseup', handleMinimapMouseUp);
    };
  }, [isDraggingMinimap, minimapDragStart, minimapPosition]);

  const handleMinimapClose = (isManual: boolean = true) => {
    setIsMinimapClosing(true);
    if (isManual) {
      setIsMinimapManuallyHidden(true);
    }
    setTimeout(() => {
      setShowMinimap(false);
      setIsMinimapClosing(false);
    }, 300);
  };
  
  const getToolCursor = () => {
    if (isDragging) return 'grabbing';
    if (selectedTool === 'move') return 'grab';
    if (selectedTool === 'eyedropper') return 'crosshair';
    if (selectedTool === 'selection') return 'crosshair';
    if (selectedTool === 'brush' || selectedTool === 'pencil' || selectedTool === 'eraser') return 'crosshair';
    return 'default';
  };

  return (
    <div className="image-viewer">
      <div className="image-viewer-header">
        <span className="image-file-name">
          {fileName}
          {hasChanges && <span className="unsaved-indicator"> ● 未保存</span>}
        </span>
        <div className="image-controls">
          <button
            className="zoom-btn"
            onClick={undo}
            disabled={historyIndex <= 0}
            title="撤销 (Ctrl+Z)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6"></path>
              <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path>
            </svg>
          </button>
          <button
            className="zoom-btn"
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            title="重做 (Ctrl+Shift+Z)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6"></path>
              <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"></path>
            </svg>
          </button>
          <button
            className="zoom-btn"
            onClick={showHistoryDialog}
            title="历史记录"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
          {hasChanges && (
            <button className="save-btn" onClick={handleSave} title="保存更改 (Ctrl+S)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              保存
            </button>
          )}
          <button className="zoom-btn" onClick={handleZoomOut} title="缩小">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="8" y1="11" x2="14" y2="11"></line>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
          <span className="zoom-level">{zoom}%</span>
          <button className="zoom-btn" onClick={handleZoomIn} title="放大">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
          <button className="zoom-btn" onClick={handleReset} title="重置">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6"></path>
              <path d="M23 20v-6h-6"></path>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
            </svg>
          </button>
          <button
            className={`minimap-toggle ${showMinimap ? 'active' : ''}`}
            onClick={() => {
              console.log('[鸟瞰图切换按钮] 点击', { showMinimap, isMinimapManuallyHidden });
              if (showMinimap) {
                handleMinimapClose(true);
              } else {
                setIsMinimapManuallyHidden(false);
                setShowMinimap(true);
              }
            }}
            title={showMinimap ? "隐藏鸟瞰图" : "显示鸟瞰图"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <rect x="7" y="7" width="3" height="3"></rect>
            </svg>
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
        style={{ cursor: getToolCursor() }}
      >
        {/* 鸟瞰图 */}
        {showMinimap && imageSize.width > 0 && (
          <div
            className={`minimap-container ${isDraggingMinimap ? 'dragging' : ''} ${isMinimapClosing ? 'closing' : ''}`}
            style={{
              right: `${minimapPosition.x}px`,
              bottom: `${minimapPosition.y}px`,
              opacity: isDraggingMinimap ? 0.8 : 0.85,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(4px)'
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onMouseEnter={() => setIsMinimapHovered(true)}
            onMouseLeave={() => setIsMinimapHovered(false)}
          >
            {/* 控制按钮 */}
            <div className={`minimap-controls ${isMinimapHovered ? 'visible' : ''}`}>
              <button
                className="minimap-control-btn minimap-reset-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  resetMinimapPosition();
                }}
                title="重置位置"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                  <path d="M21 3v5h-5"></path>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                  <path d="M3 21v-5h5"></path>
                </svg>
              </button>
              <button
                className="minimap-control-btn minimap-close-btn"
                onClick={(e) => {
                  console.log('[鸟瞰图关闭按钮] 点击事件触发');
                  e.stopPropagation();
                  e.preventDefault();
                  handleMinimapClose();
                }}
                title="关闭鸟瞰图"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            
            {/* 拖拽手柄 */}
            <div
              className="minimap-drag-handle"
              onMouseDown={handleMinimapMouseDown}
              title="拖动鸟瞰图"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="9" r="1"></circle>
                <circle cx="9" cy="15" r="1"></circle>
                <circle cx="15" cy="9" r="1"></circle>
                <circle cx="15" cy="15" r="1"></circle>
              </svg>
            </div>
            
            <canvas ref={minimapCanvasRef} className="minimap-canvas" />
            {/* 视口框 */}
            {(() => {
              if (!contentRef.current || minimapSize.width === 0) return null;
              
              const container = contentRef.current;
              const scale = minimapSize.width / imageSize.width; // 鸟瞰图缩放比例
              const zoomScale = zoom / 100;
              
              // 图片在屏幕上的尺寸
              const displayWidth = imageSize.width * zoomScale;
              const displayHeight = imageSize.height * zoomScale;
              
              // 图片左上角相对于容器左上角的坐标
              const imgLeft = (container.clientWidth - displayWidth) / 2 + position.x;
              const imgTop = (container.clientHeight - displayHeight) / 2 + position.y;
              
              // 视口(容器)相对于图片左上角的坐标
              const viewportX = -imgLeft / zoomScale;
              const viewportY = -imgTop / zoomScale;
              const viewportW = container.clientWidth / zoomScale;
              const viewportH = container.clientHeight / zoomScale;
              
              // 转换为鸟瞰图坐标
              const miniX = viewportX * scale;
              const miniY = viewportY * scale;
              const miniW = viewportW * scale;
              const miniH = viewportH * scale;
              
              const offsetX = (200 - minimapSize.width) / 2;
              const offsetY = (200 - minimapSize.height) / 2;

              if (viewportW >= imageSize.width && viewportH >= imageSize.height) return null;

              return (
                <div
                  className="minimap-viewport"
                  style={{
                    left: offsetX + miniX,
                    top: offsetY + miniY,
                    width: miniW,
                    height: miniH,
                  }}
                />
              );
            })()}
          </div>
        )}

        {error ? (
          <div className="image-error">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <p>无法加载图片</p>
            <span className="error-path">{imagePath}</span>
          </div>
        ) : (
          <div
            className="image-container"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${zoom / 100})`,
              willChange: 'transform',
              transformStyle: 'preserve-3d',
              backfaceVisibility: 'hidden',
              isolation: 'isolate' as any
            }}
          >
            {imageSrc && (
              <div
                className="image-wrapper"
                style={{
                  position: 'relative',
                  display: 'block',
                  lineHeight: 0
                }}
              >
                {/* 透明背景棋盘格 - 1像素格子 */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundImage: `
                      linear-gradient(45deg, #CCCCCC 25%, transparent 25%),
                      linear-gradient(-45deg, #CCCCCC 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, #CCCCCC 75%),
                      linear-gradient(-45deg, transparent 75%, #CCCCCC 75%)
                    `,
                    backgroundSize: '2px 2px',
                    backgroundPosition: '0 0, 0 1px, 1px -1px, -1px 0px',
                    backgroundColor: '#999999',
                    imageRendering: 'pixelated',
                    WebkitFontSmoothing: 'none',
                    pointerEvents: 'none',
                    zIndex: 0
                  }}
                />
                <img
                  ref={imageRef}
                  src={imageSrc}
                  alt={fileName}
                  onError={() => setError(true)}
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.target as HTMLImageElement;
                    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
                  }}
                  style={{
                    display: 'none'
                  }}
                />
                {/* 基础图层Canvas */}
                <canvas
                  ref={canvasRef}
                  style={{
                    position: 'relative',
                    display: 'block',
                    verticalAlign: 'top',
                    imageRendering: 'pixelated',
                    willChange: 'transform, contents',
                    transform: 'translateZ(0)',
                    backfaceVisibility: 'hidden',
                    perspective: 1000,
                    zIndex: 1
                  }}
                />
                {/* 绘图层Canvas */}
                <canvas
                  ref={drawingCanvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    display: 'block',
                    verticalAlign: 'top',
                    imageRendering: 'pixelated',
                    willChange: 'transform, contents',
                    transform: 'translateZ(0)',
                    backfaceVisibility: 'hidden',
                    perspective: 1000,
                    zIndex: 2
                  }}
                />
                {/* 预览层Canvas */}
                <canvas
                  ref={previewCanvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    display: 'block',
                    verticalAlign: 'top',
                    imageRendering: 'pixelated',
                    pointerEvents: 'none',
                    willChange: 'transform, contents',
                    transform: 'translateZ(0)',
                    backfaceVisibility: 'hidden',
                    perspective: 1000,
                    zIndex: 3
                  }}
                />
                {/* 像素格子 - SVG线条方式,类似Photoshop */}
                {zoom > 400 && imageSize.width > 0 && imageSize.height > 0 && (
                  <svg
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      zIndex: 100
                    }}
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                    preserveAspectRatio="none"
                  >
                    {/* 绘制垂直线 */}
                    {Array.from({ length: imageSize.width + 1 }).map((_, i) => (
                      <line
                        key={`v-${i}`}
                        x1={i}
                        y1={0}
                        x2={i}
                        y2={imageSize.height}
                        stroke="rgba(0,0,0,0.2)"
                        strokeWidth="0.05"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {/* 绘制水平线 */}
                    {Array.from({ length: imageSize.height + 1 }).map((_, i) => (
                      <line
                        key={`h-${i}`}
                        x1={0}
                        y1={i}
                        x2={imageSize.width}
                        y2={i}
                        stroke="rgba(0,0,0,0.2)"
                        strokeWidth="0.05"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 历史记录列表对话框 */}
      {showHistoryList && (
        <>
          <div className="modal-overlay" onClick={() => setShowHistoryList(false)} />
          <div className="history-list-dialog">
            <div className="dialog-header">
              <h3>历史记录</h3>
              <button className="dialog-close" onClick={() => setShowHistoryList(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="dialog-content">
              {persistedHistory.length === 0 ? (
                <div className="empty-history">
                  <p>暂无历史记录</p>
                </div>
              ) : (
                <div className="history-list">
                  {[...persistedHistory].reverse().map((entry, index) => (
                    <div key={index} className="history-item">
                      <div className="history-main">
                        <div className="history-info">
                          <span className="history-index">#{persistedHistory.length - index}</span>
                          <span className="history-time">
                            {new Date(entry.timestamp).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <div className="history-actions">
                          <button
                            className="btn-restore"
                            onClick={() => restoreFromHistory(entry)}
                          >
                            恢复
                          </button>
                        </div>
                      </div>
                      {/* 添加图片预览 */}
                      <div className="history-preview history-preview-image">
                        <img
                          src={entry.content}
                          alt={`历史版本 ${persistedHistory.length - index}`}
                          className="preview-image"
                        />
                      </div>
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