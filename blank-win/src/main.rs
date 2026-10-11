#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Component, Path, PathBuf};

use std::borrow::Cow;
use wry::http::{Request, Response};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

const SCHEME: &str = "blank";
const INDEX: &str = "https://blank.localhost/index.html";

fn web_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BLANK_WEB_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent().map(|p| p.join("web"));
        if let Some(dir) = dir.filter(|d| d.is_dir()) {
            return dir;
        }
    }
    PathBuf::from("web")
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "html" | "htm" => "text/html",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn safe_join(root: &Path, request_path: &str) -> PathBuf {
    let decoded = request_path.split(['?', '#']).next().unwrap_or_default();
    let mut path = root.to_path_buf();
    for component in Path::new(decoded).components() {
        match component {
            Component::Normal(part) => {
                path.push(part);
            }
            Component::CurDir => {}
            _ => {}
        }
    }
    path
}

fn respond(web_dir: &Path, request_path: &str) -> Response<Cow<'static, [u8]>> {
    let mut path = safe_join(web_dir, request_path);
    let is_index = request_path == "/" || request_path.is_empty();
    if is_index || !path.exists() {
        path = web_dir.join("index.html");
    } else if path.is_dir() {
        path = path.join("index.html");
    }

    match std::fs::read(&path) {
        Ok(body) => {
            let mime = mime(&path);
            Response::builder()
                .header("Content-Type", mime)
                .header("Access-Control-Allow-Origin", "*")
                .body(Cow::Owned(body))
                .unwrap()
        }
        Err(_) => Response::builder()
            .status(404)
            .header("Content-Type", "text/plain")
            .body(Cow::Borrowed(b"not found" as &[u8]))
            .unwrap(),
    }
}

fn main() {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("[blank]")
        .with_inner_size(tao::dpi::LogicalSize::new(420.0, 820.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(360.0, 480.0))
        .build(&event_loop)
        .expect("failed to open window");

    let web_dir = web_dir();

    #[allow(unused_mut)]
    let mut builder = WebViewBuilder::new()
        .with_background_color((0x15, 0x15, 0x15, 0xFF))
        .with_custom_protocol(SCHEME.to_string(), {
            let web_dir = web_dir.clone();
            move |_id, request: Request<Vec<u8>>| {
                let path = request.uri().path().to_string();
                respond(&web_dir, &path)
            }
        })
        .with_url(INDEX);

    #[cfg(target_os = "windows")]
    {
        use wry::WebViewBuilderExtWindows;
        builder = builder.with_https_scheme(true);
    }

    builder
        .build(&window)
        .expect("failed to create webview");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
