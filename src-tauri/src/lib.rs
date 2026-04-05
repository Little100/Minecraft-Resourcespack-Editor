mod commands;
mod constants;
mod image_handler;
mod pack_parser;
mod path_security;
mod zip_handler;
mod pack_creator;
mod history_manager;
mod version_downloader;
mod preloader;
mod download_manager;
mod version_converter;
mod pack_merger;
pub use pack_merger::{
    MergeSource, MergePreview, MergeConflictSummary, MergeProgress, MergeResult,
    FileConflict, SourceStats, PackSourceType,
    MergeSourceInput, ConflictResolution, MergeConfig,
};

#[cfg(feature = "web-server")]
mod web_server;
#[cfg(target_os = "windows")]
mod force_acrylic {
    use std::sync::atomic::{AtomicIsize, Ordering};

    const GWLP_WNDPROC: i32 = -4;
    const WM_NCACTIVATE: u32 = 0x0086;

    type WNDPROC = unsafe extern "system" fn(isize, u32, usize, isize) -> isize;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowLongPtrW(hwnd: isize, n_index: i32, dw_new_long: isize) -> isize;
        fn CallWindowProcW(
            lp_prev_wnd_func: WNDPROC,
            h_wnd: isize,
            msg: u32,
            w_param: usize,
            l_param: isize,
        ) -> isize;
    }

    static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);

    unsafe extern "system" fn custom_wndproc(
        hwnd: isize,
        msg: u32,
        wparam: usize,
        lparam: isize,
    ) -> isize {
        let original: WNDPROC = std::mem::transmute(ORIGINAL_WNDPROC.load(Ordering::SeqCst));
        if msg == WM_NCACTIVATE {
            return CallWindowProcW(original, hwnd, msg, 1, lparam);
        }
        CallWindowProcW(original, hwnd, msg, wparam, lparam)
    }
    pub unsafe fn enable(hwnd: isize) {
        let original = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, custom_wndproc as isize);
        ORIGINAL_WNDPROC.store(original, Ordering::SeqCst);
    }
}

use commands::*;
use tauri::Manager;
use download_manager::DownloadManager;
use std::sync::Arc;

#[cfg(feature = "web-server")]
use web_server::{WebServerState, start_server, stop_server, get_server_status};

/// 初始化日志
fn init_logging() {
    // 获取exe目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let logs_dir = exe_dir.join("logs");
            let log_file = logs_dir.join("latest.log");
            
            // 创建logs目录
            let _ = std::fs::create_dir_all(&logs_dir);
            
            // 如果latest.log存在，删除它
            if log_file.exists() {
                let _ = std::fs::remove_file(&log_file);
            }
            
            // 写入启动日志
            use std::io::Write;
            if let Ok(mut file) = std::fs::File::create(&log_file) {
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                let _ = writeln!(file, "[{}] [INFO] 应用程序启动", timestamp);
                let _ = writeln!(file, "[{}] [INFO] 日志系统初始化完成", timestamp);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .setup(|app| {
            // 初始化日志系统
            init_logging();
            
            // 初始化下载管理器
            let download_manager = DownloadManager::new(app.handle().clone());
            app.manage(Arc::new(download_manager));
            
            // 初始化窗口
            let window = app.get_webview_window("main").unwrap();
            
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }
            
            // 亚克力效果
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                let _ = apply_acrylic(&window, Some((30, 30, 30, 125)));
                unsafe {
                    let hwnd = window.hwnd().unwrap().0 as isize;
                    force_acrylic::enable(hwnd);
                }
            }
            
            Ok(())
        });

    #[cfg(feature = "web-server")]
    {
        builder = builder.manage(WebServerState::default());
    }

    builder = builder.invoke_handler(tauri::generate_handler![
        import_pack_zip,
        import_pack_folder,
        check_pack_mcmeta,
        get_current_pack_info,
        get_current_pack_path,
        get_image_thumbnail,
        get_image_preview,
        get_image_details,
        export_pack,
        cleanup_temp,
        read_file_content,
        read_file_binary,
        write_file_content,
        create_new_file,
        create_new_folder,
        delete_file,
        rename_file,
        get_pack_mcmeta,
        update_pack_mcmeta,
        create_new_pack,
        create_item_model,
        create_block_model,
        create_multiple_item_models,
        create_multiple_block_models,
        get_system_fonts,
        get_file_tree,
        load_folder_children,
        create_transparent_png,
        save_image,
        get_minecraft_versions,
        download_minecraft_version,
        download_latest_minecraft_version,
        extract_assets_from_jar,
        download_and_extract_template,
        clear_template_cache,
        preload_folder_images,
        get_preloader_stats,
        clear_preloader_cache,
        preload_folder_aggressive,
        get_debug_info,
        open_logs_folder,
        open_folder,
        load_language_map,
        get_sound_subtitles,
        search_files,
        download_minecraft_sounds,
        download_manager::get_all_download_tasks,
        download_manager::get_download_task,
        download_manager::cancel_download_task,
        download_manager::delete_download_task,
        download_manager::clear_completed_tasks,
        read_pack_mcmeta,
        get_supported_versions,
        convert_pack_version,
        fetch_url,
        check_file_exists,
        check_temp_audio_files,
        copy_sound_file,
        read_file_as_base64,
        open_in_explorer,
        read_merge_source_file_base64,
        preview_pack_merge,
        execute_pack_merge,
        get_pack_meta_from_source,
        history_manager::save_file_history,
        history_manager::load_file_history,
        history_manager::get_history_stats,
        history_manager::clear_file_history,
        history_manager::clear_all_history,
        history_manager::get_pack_size,
        #[cfg(feature = "web-server")]
        start_server,
        #[cfg(feature = "web-server")]
        stop_server,
        #[cfg(feature = "web-server")]
        get_server_status,
    ]);

    builder.run(tauri::generate_context!())
        .expect("error while running tauri application");
}
