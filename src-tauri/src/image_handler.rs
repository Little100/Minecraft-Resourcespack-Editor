use image::{DynamicImage, ImageFormat, RgbaImage, imageops::FilterType};
use std::path::{Path, PathBuf};
use base64::{Engine as _, engine::general_purpose};
use std::io::BufReader;
use std::fs::File;

/// 读取图片并转换为base64
#[allow(dead_code)]
pub fn image_to_base64(path: &Path) -> Result<String, String> {
    let img = image::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?;
    
    let mut buffer = Vec::new();
    let format = ImageFormat::Png;
    
    img.write_to(&mut std::io::Cursor::new(&mut buffer), format)
        .map_err(|e| format!("Failed to encode image: {}", e))?;
    
    Ok(general_purpose::STANDARD.encode(&buffer))
}

/// 获取图片尺寸
#[allow(dead_code)]
pub fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let img = image::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?;
    
    Ok((img.width(), img.height()))
}

/// 调整图片大小
#[allow(dead_code)]
pub fn resize_image(
    path: &Path,
    output_path: &Path,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let img = image::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?;
    
    let resized = img.resize_exact(
        width,
        height,
        image::imageops::FilterType::Nearest, // 使用最近邻插值保持像素风格
    );
    
    resized.save(output_path)
        .map_err(|e| format!("Failed to save resized image: {}", e))?;
    
    Ok(())
}

/// 验证图片是否为有效的纹理尺寸
pub fn validate_texture_size(width: u32, height: u32) -> bool {
    let is_power_of_two = |n: u32| n > 0 && (n & (n - 1)) == 0;
    let is_multiple_of_16 = |n: u32| n > 0 && n % 16 == 0;
    
    (is_power_of_two(width) && is_power_of_two(height)) ||
    (is_multiple_of_16(width) && is_multiple_of_16(height))
}

/// 创建缩略图
pub fn create_thumbnail(
    path: &Path,
    max_size: u32,
) -> Result<String, String> {
    let file = File::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?;
    let reader = BufReader::with_capacity(8192, file);
    
    let img = image::load(reader, image::ImageFormat::from_path(path)
        .map_err(|e| format!("Failed to detect image format: {}", e))?)
        .map_err(|e| format!("Failed to decode image: {}", e))?;
    
    let (width, height) = (img.width(), img.height());
    
    if width <= max_size && height <= max_size {
        let mut buffer = Vec::with_capacity((width * height * 4) as usize);
        img.write_to(&mut std::io::Cursor::new(&mut buffer), ImageFormat::Png)
            .map_err(|e| format!("Failed to encode image: {}", e))?;
        return Ok(general_purpose::STANDARD.encode(&buffer));
    }
    
    let scale = (max_size as f32 / width.max(height) as f32).min(1.0);
    let new_width = (width as f32 * scale) as u32;
    let new_height = (height as f32 * scale) as u32;
    
    let filter = if scale < 0.5 {
        FilterType::Lanczos3
    } else {
        FilterType::Triangle
    };
    
    let thumbnail = img.resize(new_width, new_height, filter);
    
    // 预分配缓冲区
    let mut buffer = Vec::with_capacity((new_width * new_height * 4) as usize);
    thumbnail.write_to(&mut std::io::Cursor::new(&mut buffer), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;
    
    Ok(general_purpose::STANDARD.encode(&buffer))
}

/// 图片信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub size_bytes: u64,
    pub is_valid_texture: bool,
}

/// 获取图片完整信息
pub fn get_image_info(path: &Path) -> Result<ImageInfo, String> {
    let img = image::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?;
    
    let (width, height) = (img.width(), img.height());
    let format = match img {
        DynamicImage::ImageRgba8(_) => "RGBA",
        DynamicImage::ImageRgb8(_) => "RGB",
        _ => "Other",
    }.to_string();
    
    let size_bytes = std::fs::metadata(path)
        .map(|m| m.len())
        .unwrap_or(0);
    
    let is_valid_texture = validate_texture_size(width, height);
    
    Ok(ImageInfo {
        width,
        height,
        format,
        size_bytes,
        is_valid_texture,
    })
}

/// 创建透明PNG图片
pub fn create_transparent_png(
    path: &Path,
    width: u32,
    height: u32,
) -> Result<(), String> {
    // 验证尺寸是否为2的幂次方
    let is_power_of_two = |n: u32| n > 0 && (n & (n - 1)) == 0;
    
    if !is_power_of_two(width) || !is_power_of_two(height) {
        return Err("Width and height must be powers of 2".to_string());
    }
    
    if width > 8192 || height > 8192 {
        return Err("Maximum size is 8192x8192".to_string());
    }
    
    // 创建透明图片
    let img = RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 0]));
    
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // 保存为PNG
    img.save(path)
        .map_err(|e| format!("Failed to save PNG: {}", e))?;
    
    Ok(())
}

pub async fn create_thumbnail_async(
    path: PathBuf,
    max_size: u32,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    rayon::spawn(move || {
        let result = create_thumbnail(&path, max_size);
        let _ = tx.send(result);
    });
    
    rx.await
        .map_err(|e| format!("Channel error: {}", e))?
}

#[allow(dead_code)]
pub async fn create_thumbnails_batch(
    paths: Vec<PathBuf>,
    max_size: u32,
) -> Vec<Result<(String, String), String>> {
    use rayon::prelude::*;
    
    let results: Vec<_> = paths
        .par_iter()
        .map(|path| {
            let path_str = path.to_string_lossy().to_string();
            match create_thumbnail(path, max_size) {
                Ok(data) => Ok((path_str, data)),
                Err(e) => Err(format!("{}: {}", path_str, e)),
            }
        })
        .collect();
    
    results
}