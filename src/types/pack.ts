// 版本枚举
export enum MinecraftVersion {
  Legacy = "Legacy",
  Flattening = "Flattening",
  Components = "Components",
  NewModel = "NewModel",
  ItemsFolder = "ItemsFolder",
}

// 资源类型
export enum ResourceType {
  Texture = "Texture",
  Model = "Model",
  ItemModel = "ItemModel",
  BlockState = "BlockState",
  Sound = "Sound",
  Language = "Language",
  Font = "Font",
  Shader = "Shader",
  Other = "Other",
}

// 资源文件信息
export interface ResourceFile {
  path: string;
  relative_path: string;
  resource_type: ResourceType;
  namespace: string;
  name: string;
  size: number;
}

// 材质包信息
export interface PackInfo {
  name: string;
  version: MinecraftVersion;
  pack_format: number;
  description: string;
  resources: Record<ResourceType, ResourceFile[]>;
  namespaces: string[];
  pack_path?: string;
}

// 图片信息
export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  size_bytes: number;
  is_valid_texture: boolean;
}

// 版本描述映射
export const VERSION_DESCRIPTIONS: Record<MinecraftVersion, string> = {
  [MinecraftVersion.Legacy]: "1.6-1.12 (Legacy)",
  [MinecraftVersion.Flattening]: "1.13-1.19.3 (Flattening)",
  [MinecraftVersion.Components]: "1.19.4-1.20.4 (Components)",
  [MinecraftVersion.NewModel]: "1.20.5-1.21.3 (New Components)",
  [MinecraftVersion.ItemsFolder]: "1.21.4+ (Items Folder)",
};

export type PackSourceType = 'Zip' | 'Folder';

export interface MergeSource {
  index: number;
  name: string;
  source_path: string;
  source_type: PackSourceType;
  description: string;
  pack_format: number;
  file_count: number;
}

export interface FileConflict {
  path: string;
  source_indices: number[];
  winner_index: number;
}

export interface SourceStats {
  name: string;
  total_files: number;
  conflict_files: number;
  unique_files: number;
}

export interface MergeConflictSummary {
  conflicts: FileConflict[];
  total_conflicts: number;
  source_stats: Record<string, SourceStats>;
}

export interface MergePreview {
  sources: MergeSource[];
  conflicts: MergeConflictSummary;
  total_merged_files: number;
  priority_order: string[];
}

export interface MergeProgress {
  phase: string;
  current: number;
  total: number;
  current_file: string | null;
}

export interface MergeResult {
  output_path: string;
  total_files: number;
  conflicts_resolved: number;
  output_description: string;
  output_pack_format: number;
}

export interface MergeSourceInput {
  path: string;
  source_type: PackSourceType;
}

export interface ConflictResolution {
  path: string;
  chosen_source: string;
  winner_index?: number;
  exclude?: boolean;
}

export interface MergeConfig {
  output_dir: string;
  output_file_name: string;
  final_description: string;
  final_pack_format: number;
  conflict_resolutions: ConflictResolution[];
  blacklist_patterns?: string[];
  whitelist_patterns?: string[];
}

// 资源类型显示名称
export const RESOURCE_TYPE_NAMES: Record<ResourceType, string> = {
  [ResourceType.Texture]: "纹理",
  [ResourceType.Model]: "模型",
  [ResourceType.ItemModel]: "物品模型 (1.21.4+)",
  [ResourceType.BlockState]: "方块状态",
  [ResourceType.Sound]: "音效",
  [ResourceType.Language]: "语言文件",
  [ResourceType.Font]: "字体",
  [ResourceType.Shader]: "着色器",
  [ResourceType.Other]: "其他",
};