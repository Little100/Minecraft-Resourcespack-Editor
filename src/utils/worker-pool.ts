import { logger } from './logger';

interface Task {
  id: string;
  type: string;
  data: any;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

class WorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: Task[] = [];
  private pendingTasks: Map<string, Task> = new Map();
  private workerTaskMap: Map<Worker, Set<string>> = new Map();
  private workerCount: number;
  private nextTaskId: number = 0;

  constructor(workerCount?: number) {
    const cpuCount = navigator.hardwareConcurrency || 4;
    this.workerCount = workerCount || Math.min(Math.max(cpuCount, 2), 16);
    
    this.initializeWorkers();
    
    logger.debug(`[Worker Pool] 初始化了 ${this.workerCount} 个Worker`);
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.workerCount; i++) {
      try {
        const worker = new Worker(
          new URL('../workers/image-worker.ts', import.meta.url),
          { type: 'module' }
        );
        
        worker.onmessage = (event) => this.handleWorkerMessage(worker, event);
        worker.onerror = (error) => this.handleWorkerError(worker, error);
        
        this.workers.push(worker);
        this.availableWorkers.push(worker);
      } catch (error) {
        logger.error(`[Worker Pool] 创建Worker ${i} 失败:`, error);
      }
    }
  }

  private handleWorkerMessage(worker: Worker, event: MessageEvent): void {
    const { id, type, result, error } = event.data;
    
    const task = this.pendingTasks.get(id);
    if (!task) {
      logger.warn(`[Worker Pool] 收到未知任务的响应: ${id}`);
      return;
    }
    
    this.pendingTasks.delete(id);
    const workerTasks = this.workerTaskMap.get(worker);
    if (workerTasks) workerTasks.delete(id);
    this.availableWorkers.push(worker);
    
    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(result);
    }
    
    this.processNextTask();
  }

  private handleWorkerError(worker: Worker, error: ErrorEvent): void {
    logger.error('[Worker Pool] Worker错误:', error);
    
    const workerTasks = this.workerTaskMap.get(worker);
    if (workerTasks) {
      for (const taskId of workerTasks) {
        const task = this.pendingTasks.get(taskId);
        if (task) {
          task.reject(new Error('Worker错误'));
          this.pendingTasks.delete(taskId);
        }
      }
      workerTasks.clear();
    }
    
    const index = this.workers.indexOf(worker);
    if (index > -1) {
      worker.terminate();
      
      try {
        const newWorker = new Worker(
          new URL('../workers/image-worker.ts', import.meta.url),
          { type: 'module' }
        );
        
        newWorker.onmessage = (event) => this.handleWorkerMessage(newWorker, event);
        newWorker.onerror = (error) => this.handleWorkerError(newWorker, error);
        
        this.workers[index] = newWorker;
        this.availableWorkers.push(newWorker);
      } catch (err) {
        logger.error('[Worker Pool] 重新创建Worker失败:', err);
      }
    }
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }
    
    const task = this.taskQueue.shift()!;
    const worker = this.availableWorkers.shift()!;
    
    this.pendingTasks.set(task.id, task);
    if (!this.workerTaskMap.has(worker)) {
      this.workerTaskMap.set(worker, new Set());
    }
    this.workerTaskMap.get(worker)!.add(task.id);
    
    const transfers: Transferable[] = [];
    if (task.data instanceof ImageData) {
      transfers.push(task.data.data.buffer);
    } else if (task.data?.imageData instanceof ImageData) {
      transfers.push(task.data.imageData.data.buffer);
    } else if (task.data?.buffer instanceof ArrayBuffer) {
      transfers.push(task.data.buffer);
    }

    worker.postMessage({
      id: task.id,
      type: task.type,
      data: task.data,
    }, transfers);
  }

  execute<T = any>(type: string, data: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: Task = {
        id: `task_${++this.nextTaskId}`,
        type,
        data,
        resolve,
        reject,
      };
      
      this.taskQueue.push(task);
      this.processNextTask();
    });
  }

  async executeBatch<T = any>(tasks: Array<{ type: string; data: any }>): Promise<T[]> {
    const promises = tasks.map(task => this.execute<T>(task.type, task.data));
    return Promise.all(promises);
  }

  getStats() {
    return {
      totalWorkers: this.workerCount,
      availableWorkers: this.availableWorkers.length,
      pendingTasks: this.pendingTasks.size,
      queuedTasks: this.taskQueue.length,
    };
  }

  terminate(): void {
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.pendingTasks.clear();
  }
}

let _workerPool: WorkerPool | null = null;

export function getWorkerPool(): WorkerPool {
  if (!_workerPool) {
    _workerPool = new WorkerPool();
  }
  return _workerPool;
}

export const workerPool: WorkerPool = new Proxy({} as WorkerPool, {
  get(_, prop) {
    return (getWorkerPool() as any)[prop];
  },
});

export const processImageInWorker = (imageData: ImageData) => {
  return getWorkerPool().execute('process-image', { imageData });
};

export const calculateHistogramInWorker = (imageData: ImageData) => {
  return getWorkerPool().execute('calculate-histogram', { imageData });
};

export const applyFilterInWorker = (
  imageData: ImageData,
  filterType: string,
  params: any
) => {
  return getWorkerPool().execute('apply-filter', { imageData, filterType, params });
};

export const resizeInWorker = (
  imageData: ImageData,
  width: number,
  height: number
) => {
  return getWorkerPool().execute('resize', { imageData, width, height });
};