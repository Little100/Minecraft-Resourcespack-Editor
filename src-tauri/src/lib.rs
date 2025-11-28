mod commands;
mod image_handler;
mod pack_parser;
mod zip_handler;
mod pack_creator;
mod history_manager;
mod version_downloader;
mod preloader;

#[cfg(feature = "web-server")]
mod web_server;

use commands::*;
use tauri::Manager;

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
        .manage(AppState::default());

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
        load_language_map,
        search_files,
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
    ])
        .setup(|app| {
            // 初始化日志系统
            init_logging();
            
            // 初始化
            let window = app.get_webview_window("main").unwrap();
            
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }
            
            // 亚克力
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                let _ = apply_acrylic(&window, Some((30, 30, 30, 125)));
            }
            
            Ok(())
        });

    builder.run(tauri::generate_context!())
        .expect("error while running tauri application");
}
