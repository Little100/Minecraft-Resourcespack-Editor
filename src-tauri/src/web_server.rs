use axum::Router;
use tower_http::{
    services::ServeDir,
    cors::{CorsLayer, AllowOrigin},
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::State;

#[derive(Clone)]
pub struct WebServerState {
    pub running: Arc<Mutex<bool>>,
    pub handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    pub token: Arc<Mutex<Option<String>>>,
    pub token_enabled: Arc<Mutex<bool>>,
}

impl Default for WebServerState {
    fn default() -> Self {
        Self {
            running: Arc::new(Mutex::new(false)),
            handle: Arc::new(Mutex::new(None)),
            token: Arc::new(Mutex::new(None)),
            token_enabled: Arc::new(Mutex::new(true)),
        }
    }
}

fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut result = String::with_capacity(64);
    for _ in 0..8 {
        let s = RandomState::new();
        let val = s.build_hasher().finish();
        result.push_str(&format!("{:016x}", val));
    }
    result.truncate(64);
    result
}

pub async fn start_web_server(
    port: u16,
    pack_path: String,
    bind_all: bool,
    _token: Option<String>,
    _token_enabled: bool,
) -> Result<tokio::task::JoinHandle<()>, String> {
    let serve_dir = ServeDir::new(pack_path.clone())
        .append_index_html_on_directories(true);

    let cors = if bind_all {
        CorsLayer::new()
            .allow_origin(AllowOrigin::any())
            .allow_methods([axum::http::Method::GET])
    } else {
        CorsLayer::permissive()
    };

    let app = Router::new()
        .nest_service("/", serve_dir)
        .layer(cors);

    let addr = if bind_all {
        SocketAddr::from(([0, 0, 0, 0], port))
    } else {
        SocketAddr::from(([127, 0, 0, 1], port))
    };

    println!("Starting web server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", addr, e))?;

    let handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("Server error: {}", e);
        }
    });

    Ok(handle)
}

#[tauri::command]
pub async fn start_server(
    port: u16,
    mode: String,
    state: State<'_, WebServerState>,
    app_state: State<'_, crate::commands::AppState>,
) -> Result<String, String> {
    let mut running = state.running.lock().await;
    
    if *running {
        return Err("Server is already running".to_string());
    }

    let pack_path_str = {
        let pack_path = app_state.current_pack_path.lock();
        match pack_path.as_ref() {
            Some(path) => path.to_string_lossy().to_string(),
            None => return Err("No pack loaded".to_string()),
        }
    };

    let bind_all = mode == "all";
    
    let token = if bind_all {
        let mut token_guard = state.token.lock().await;
        if token_guard.is_none() {
            *token_guard = Some(generate_token());
        }
        token_guard.clone()
    } else {
        None
    };
    
    let token_enabled = *state.token_enabled.lock().await;
    
    match start_web_server(port, pack_path_str, bind_all, token.clone(), token_enabled).await {
        Ok(handle) => {
            *state.handle.lock().await = Some(handle);
            *running = true;
            
            let addr = if bind_all {
                format!("0.0.0.0:{}", port)
            } else {
                format!("127.0.0.1:{}", port)
            };
            
            let mut msg = format!("Server started on {}", addr);
            if bind_all {
                if let Some(t) = &token {
                    if token_enabled {
                        msg.push_str(&format!(" | Access token: {}", t));
                    }
                }
            }
            
            Ok(msg)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn stop_server(state: State<'_, WebServerState>) -> Result<String, String> {
    let mut running = state.running.lock().await;
    
    if !*running {
        return Err("Server is not running".to_string());
    }

    if let Some(handle) = state.handle.lock().await.take() {
        handle.abort();
    }
    
    *running = false;
    Ok("Server stopped".to_string())
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, WebServerState>) -> Result<bool, String> {
    Ok(*state.running.lock().await)
}

#[tauri::command]
#[allow(dead_code)]
pub async fn get_server_token(state: State<'_, WebServerState>) -> Result<Option<String>, String> {
    Ok(state.token.lock().await.clone())
}

#[tauri::command]
#[allow(dead_code)]
pub async fn set_server_token(
    token: String,
    state: State<'_, WebServerState>,
) -> Result<(), String> {
    *state.token.lock().await = Some(token);
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
pub async fn set_token_enabled(
    enabled: bool,
    state: State<'_, WebServerState>,
) -> Result<(), String> {
    *state.token_enabled.lock().await = enabled;
    Ok(())
}