export type DownloadStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface DownloadProgress {
  task_id: string;
  status: DownloadStatus;
  current: number;
  total: number;
  current_file: string | null;
  speed: number;
  eta: number | null;
  error: string | null;
}

export interface DownloadTask {
  id: string;
  name: string;
  task_type: string;
  status: DownloadStatus;
  progress: DownloadProgress;
  created_at: number;
  updated_at: number;
  output_dir: string;
}
