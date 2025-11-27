export function testCanvasGPUAcceleration(canvas: HTMLCanvasElement): {
  isAccelerated: boolean;
  method: string;
  details: string[];
} {
  const details: string[] = [];
  let isAccelerated = false;
  let method = 'CPU渲染';

  const computedStyle = window.getComputedStyle(canvas);
  const hasWillChange = computedStyle.willChange.includes('transform') || 
                        computedStyle.willChange.includes('contents');
  const hasTransform3D = computedStyle.transform.includes('matrix3d') || 
                         computedStyle.transform.includes('translateZ');
  
  if (hasWillChange) {
    details.push(' CSS will-change已启用');
    isAccelerated = true;
    method = 'CSS硬件加速';
  } else {
    details.push(' CSS will-change未启用');
  }

  if (hasTransform3D) {
    details.push(' 3D transform已启用');
    isAccelerated = true;
    method = 'CSS 3D加速';
  } else {
    details.push(' 3D transform未启用');
  }

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const attrs = ctx.getContextAttributes();
    if (attrs) {
      if (attrs.desynchronized) {
        details.push(' desynchronized模式已启用 (真正的GPU异步渲染!)');
        isAccelerated = true;
        method = 'Canvas异步渲染 + GPU加速';
      } else {
        details.push('️ desynchronized模式未启用 (但CSS加速仍有效)');
      }

      if (attrs.alpha !== undefined) {
        details.push(` Alpha通道: ${attrs.alpha ? '启用' : '禁用'}`);
      }
      
      details.push(` 上下文属性: ${JSON.stringify(attrs)}`);
    }
  }

  const hasIsolation = computedStyle.isolation === 'isolate';
  const hasContain = computedStyle.contain !== 'none';
  if (hasIsolation || hasContain) {
    details.push(' 独立合成层已创建');
    isAccelerated = true;
  } else {
    if (hasWillChange || hasTransform3D) {
      details.push(' 通过transform/willChange创建合成层');
      isAccelerated = true;
    } else {
      details.push('️ 未明确创建独立合成层');
    }
  }

  const webglCanvas = document.createElement('canvas');
  const gl = webglCanvas.getContext('webgl') || webglCanvas.getContext('experimental-webgl');
  if (gl) {
    details.push(' WebGL可用');
    const webglContext = gl as WebGLRenderingContext;
    const debugInfo = webglContext.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = webglContext.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      details.push(` GPU: ${renderer}`);
    }
  } else {
    details.push(' WebGL不可用');
  }

  return { isAccelerated, method, details };
}

export async function benchmarkCanvasPerformance(
  canvas: HTMLCanvasElement,
  operations: number = 10000
): Promise<{
  fps: number;
  avgFrameTime: number;
  totalTime: number;
  opsPerSecond: number;
}> {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法获取Canvas上下文');
  }

  const startTime = performance.now();
  let frameCount = 0;
  const frameTimes: number[] = [];

  for (let i = 0; i < operations; i++) {
    const frameStart = performance.now();
    
    ctx.fillStyle = `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.5)`;
    ctx.fillRect(
      Math.random() * canvas.width,
      Math.random() * canvas.height,
      10,
      10
    );
    
    const frameTime = performance.now() - frameStart;
    frameTimes.push(frameTime);
    frameCount++;
  }

  const totalTime = performance.now() - startTime;
  const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const fps = 1000 / avgFrameTime;
  const opsPerSecond = (operations / totalTime) * 1000;

  return {
    fps: Math.round(fps),
    avgFrameTime: parseFloat(avgFrameTime.toFixed(3)),
    totalTime: parseFloat(totalTime.toFixed(2)),
    opsPerSecond: Math.round(opsPerSecond)
  };
}

export async function compareRenderingMethods(
  width: number = 1000,
  height: number = 1000,
  operations: number = 5000
): Promise<{
  cpu: any;
  gpu: any;
  improvement: string;
}> {
  const cpuCanvas = document.createElement('canvas');
  cpuCanvas.width = width;
  cpuCanvas.height = height;
  const cpuResult = await benchmarkCanvasPerformance(cpuCanvas, operations);

  // 测试
  const gpuCanvas = document.createElement('canvas');
  gpuCanvas.width = width;
  gpuCanvas.height = height;
  gpuCanvas.style.willChange = 'transform, contents';
  gpuCanvas.style.transform = 'translateZ(0)';
  gpuCanvas.style.backfaceVisibility = 'hidden';
  const gpuResult = await benchmarkCanvasPerformance(gpuCanvas, operations);

  const improvement = ((cpuResult.totalTime - gpuResult.totalTime) / cpuResult.totalTime * 100).toFixed(1);

  return {
    cpu: cpuResult,
    gpu: gpuResult,
    improvement: `${improvement}%`
  };
}

export function generateGPUReport(canvas: HTMLCanvasElement): string {
  const test = testCanvasGPUAcceleration(canvas);
  
  let report = '=== GPU加速状态报告 ===\n\n';
  report += `状态: ${test.isAccelerated ? ' 已启用' : ' 未启用'}\n`;
  report += `方法: ${test.method}\n\n`;
  report += '详细信息:\n';
  test.details.forEach(detail => {
    report += `  ${detail}\n`;
  });
  
  return report;
}

export class GPUMonitor {
  private canvas: HTMLCanvasElement;
  private frameCount: number = 0;
  private lastTime: number = performance.now();
  private fps: number = 0;
  private isMonitoring: boolean = false;
  private animationId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  start(callback?: (fps: number) => void): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.frameCount = 0;
    this.lastTime = performance.now();

    const monitor = () => {
      if (!this.isMonitoring) return;

      this.frameCount++;
      const currentTime = performance.now();
      const elapsed = currentTime - this.lastTime;

      if (elapsed >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / elapsed);
        this.frameCount = 0;
        this.lastTime = currentTime;

        if (callback) {
          callback(this.fps);
        }

        console.log(`[GPU监控] FPS: ${this.fps}, Canvas: ${this.canvas.width}x${this.canvas.height}`);
      }

      this.animationId = requestAnimationFrame(monitor);
    };

    this.animationId = requestAnimationFrame(monitor);
  }

  stop(): void {
    this.isMonitoring = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  getFPS(): number {
    return this.fps;
  }
}