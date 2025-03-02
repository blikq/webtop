use axum::{response::Html, response::Json, routing::get, Router};
use humantime::format_duration;
use machine_info::Machine;
use serde_json::json;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::sync::Arc;
use sysinfo::System;
use tokio::fs;
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tracing::{debug, error, info};

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::fmt::init();

    let shared_system = Arc::new(Mutex::new(System::new_all()));
    let app = Router::new()
        .route("/", get(root_handler))
        .route("/cpu", get(cpu_handler))
        .route("/mem", get(memory_handler))
        .route("/system", get(system_handler))
        .route("/networks", get(network_handler))
        .route("/proc", get(proc_handler))
        .route("/gpu", get(gpu_handler))
        .nest_service("/static", ServeDir::new("static"))
        .with_state(shared_system.clone());

    info!("Server starting on 0.0.0.0:3000");

    let listener = match tokio::net::TcpListener::bind("0.0.0.0:3000").await {
        Ok(l) => {
            info!("Successfully bound to port 3000");
            l
        }
        Err(e) => {
            error!("Failed to bind to port 3000: {e}");
            panic!("Error {e}");
        }
    };

    match axum::serve(listener, app).await {
        Ok(()) => info!("Server exited cleanly"),
        Err(e) => {
            error!("Server encountered an error: {e}");
        }
    };
}

fn get_cpu_product_name() -> io::Result<String> {
    let file = File::open("/proc/cpuinfo")?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line?;
        if line.starts_with("model name") {
            if let Some(name) = line.split(':').nth(1) {
                return Ok(name.trim().to_string());
            }
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "CPU model name not found",
    ))
}

async fn root_handler() -> Result<Html<String>, axum::http::StatusCode> {
    debug!("Handling root request");
    (fs::read_to_string("templates/index.html").await).map_or(
        Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR),
        |content| {
            info!("Successfully served index.html");
            Ok(Html(content))
        },
    )
}

async fn cpu_handler(state: axum::extract::State<Arc<Mutex<System>>>) -> Json<serde_json::Value> {
    debug!("Handling CPU stats request");
    let mut sys = state.lock().await;
    sys.refresh_cpu_all();
    let cpu_usage = sys
        .cpus()
        .iter()
        .map(sysinfo::Cpu::cpu_usage)
        .collect::<Vec<_>>();
    drop(sys);

    let load_average = System::load_average().one;

    let product_name =
        get_cpu_product_name().unwrap_or_else(|_| "Could not get CPU Product Name".to_string());

    info!(
        "CPU stats retrieved: cpu_usage={:?}, cpu_load_average={}, cpu_product_name={}",
        cpu_usage, load_average, product_name
    );

    Json(json!({
        "cpu_usage": cpu_usage,
        "cpu_load_average": load_average,
        "cpu_product_name": product_name,
    }))
}

async fn gpu_handler() -> Json<serde_json::Value> {
    debug!("Handling gpu stats request");
    let m = Machine::new().system_info();
    Json(json!({
        "gpus": m.graphics,
    }))
}

async fn memory_handler(
    state: axum::extract::State<Arc<Mutex<System>>>,
) -> Json<serde_json::Value> {
    debug!("Handling memory stats request");
    let mut sys = state.lock().await;
    sys.refresh_memory();
    info!(
        "Memory stats retrieved: total={}, used={}, free={}",
        sys.total_memory(),
        sys.used_memory(),
        sys.free_memory()
    );

    Json(json!({
        "total_memory": sys.total_memory(),
        "used_memory": sys.used_memory(),
        "free_memory": sys.free_memory(),
        "available_memory": sys.available_memory(),
        "total_swap": sys.total_swap(),
        "used_swap": sys.used_swap(),
        "free_swap": sys.free_swap(),
    }))
}

#[allow(clippy::cast_possible_wrap)]
async fn system_handler() -> Json<serde_json::Value> {
    debug!("Handling system stats request");
    let system_info = json!({
        "name": System::name().unwrap_or_else(|| "<unknown>".to_owned()),
        "kernel_version": System::kernel_version().unwrap_or_else(|| "<unknown>".to_owned()),
        "os_version": System::os_version().unwrap_or_else(|| "<unknown>".to_owned()),
        "long_os_version": System::long_os_version().unwrap_or_else(|| "<unknown>".to_owned()),
        "distribution_id": System::distribution_id(),
        "host_name": System::host_name().unwrap_or_else(|| "<unknown>".to_owned()),
        "uptime": format_duration(std::time::Duration::new((System::uptime() as i64).try_into().unwrap_or_default(), 0)).to_string(),
    });

    info!("System stats retrieved: {:?}", system_info);
    Json(system_info)
}

async fn network_handler() -> Json<serde_json::Value> {
    debug!("Handling network stats request");
    let networks = sysinfo::Networks::new_with_refreshed_list()
        .iter()
        .map(|(name, data)| {
            json!({
                "interface_name": name,
                "received": data.total_received(),
                "transmitted": data.total_transmitted(),
            })
        })
        .collect::<Vec<_>>();

    info!("Network stats retrieved: {:?}", networks);
    Json(json!({ "networks": networks }))
}

async fn proc_handler(state: axum::extract::State<Arc<Mutex<System>>>) -> Json<serde_json::Value> {
    debug!("Handling processes stats request");
    let mut sys = state.lock().await;
    sys.refresh_all(); // Ensure the processes are updated

    let processes_info = sys
        .processes()
        .iter()
        .map(|(pid, process)| {
            json!({
                "pid": *pid.to_string(),
                "name": process.exe(),
                "memory": process.memory(),
                "cpu_usage": process.cpu_usage(),
                "run_time": process.run_time(),
                "status": format!("{:?}", process.status())
            })
        })
        .collect::<Vec<_>>();
    drop(sys);

    info!(
        "Processes stats retrieved: {} processes",
        processes_info.len()
    );
    Json(json!({
        "processes": processes_info,
    }))
}
