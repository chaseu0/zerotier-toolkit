use std::net::IpAddr;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;
use tokio::time::timeout;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use winapi::um::winbase::CREATE_NO_WINDOW;

const MAX_HOPS: &str = "12";
const PING_TIMEOUT: Duration = Duration::from_secs(10);
const TRACE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticResult {
    target: String,
    output: String,
    success: bool,
    exit_code: Option<i32>,
}

#[tauri::command]
pub(crate) async fn ping_ip(target: String) -> Result<DiagnosticResult, String> {
    run_diagnostic(target, DiagnosticKind::Ping).await
}

#[tauri::command]
pub(crate) async fn trace_route(target: String) -> Result<DiagnosticResult, String> {
    run_diagnostic(target, DiagnosticKind::TraceRoute).await
}

#[derive(Clone, Copy)]
enum DiagnosticKind {
    Ping,
    TraceRoute,
}

async fn run_diagnostic(target: String, kind: DiagnosticKind) -> Result<DiagnosticResult, String> {
    let address = parse_target(&target)?;
    let target = address.to_string();
    let (program, args, max_duration) = command_for(address, kind);
    let mut command = Command::new(program);
    command.args(args).kill_on_drop(true);

    #[cfg(windows)]
    command.as_std_mut().creation_flags(CREATE_NO_WINDOW);

    let output = timeout(max_duration, command.output())
        .await
        .map_err(|_| "Diagnostic timed out".to_string())?
        .map_err(|error| format!("Failed to start diagnostic command: {error}"))?;

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(stderr.trim());
    }

    Ok(DiagnosticResult {
        target,
        output: text.trim().to_string(),
        success: output.status.success(),
        exit_code: output.status.code(),
    })
}

fn parse_target(target: &str) -> Result<IpAddr, String> {
    let address = target
        .trim()
        .parse::<IpAddr>()
        .map_err(|_| "Enter a valid IPv4 or IPv6 address".to_string())?;
    if address.is_unspecified() || address.is_multicast() {
        return Err("Enter a unicast IP address".to_string());
    }
    Ok(address)
}

fn command_for(address: IpAddr, kind: DiagnosticKind) -> (&'static str, Vec<String>, Duration) {
    match kind {
        DiagnosticKind::Ping => {
            #[cfg(windows)]
            {
                return (
                    "ping.exe",
                    vec![
                        "-n".into(),
                        "4".into(),
                        "-w".into(),
                        "1000".into(),
                        address.to_string(),
                    ],
                    PING_TIMEOUT,
                );
            }
            #[cfg(target_os = "macos")]
            {
                return (
                    "/sbin/ping",
                    vec![
                        "-n".into(),
                        "-c".into(),
                        "4".into(),
                        "-W".into(),
                        "1000".into(),
                        address.to_string(),
                    ],
                    PING_TIMEOUT,
                );
            }
            #[cfg(target_os = "linux")]
            {
                return (
                    "ping",
                    vec![
                        "-n".into(),
                        "-c".into(),
                        "4".into(),
                        "-W".into(),
                        "1".into(),
                        address.to_string(),
                    ],
                    PING_TIMEOUT,
                );
            }
            #[allow(unreachable_code)]
            ("ping", vec![address.to_string()], PING_TIMEOUT)
        }
        DiagnosticKind::TraceRoute => {
            #[cfg(windows)]
            {
                let mut args = vec![
                    "-d".into(),
                    "-h".into(),
                    MAX_HOPS.into(),
                    "-w".into(),
                    "500".into(),
                ];
                if address.is_ipv6() {
                    args.push("-6".into());
                }
                args.push(address.to_string());
                return ("tracert.exe", args, TRACE_TIMEOUT);
            }
            #[cfg(target_os = "macos")]
            {
                let program = if address.is_ipv6() {
                    "/usr/sbin/traceroute6"
                } else {
                    "/usr/sbin/traceroute"
                };
                return (
                    program,
                    vec![
                        "-n".into(),
                        "-m".into(),
                        MAX_HOPS.into(),
                        "-q".into(),
                        "3".into(),
                        "-w".into(),
                        "1".into(),
                        address.to_string(),
                    ],
                    TRACE_TIMEOUT,
                );
            }
            #[cfg(target_os = "linux")]
            {
                let mut args = vec![
                    "-n".into(),
                    "-m".into(),
                    MAX_HOPS.into(),
                    "-q".into(),
                    "3".into(),
                    "-w".into(),
                    "1".into(),
                ];
                if address.is_ipv6() {
                    args.push("-6".into());
                }
                args.push(address.to_string());
                return ("traceroute", args, TRACE_TIMEOUT);
            }
            #[allow(unreachable_code)]
            (
                "traceroute",
                vec!["-n".into(), address.to_string()],
                TRACE_TIMEOUT,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_target, DiagnosticKind};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn accepts_ipv4_and_ipv6_addresses() {
        assert_eq!(
            parse_target("10.147.20.5").unwrap(),
            "10.147.20.5".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            parse_target("fd00::1").unwrap(),
            "fd00::1".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn rejects_hostnames_unspecified_and_multicast_addresses() {
        assert!(parse_target("peer.example").is_err());
        assert!(parse_target("0.0.0.0").is_err());
        assert!(parse_target("224.0.0.1").is_err());
        assert!(parse_target("::").is_err());
        assert!(parse_target("ff02::1").is_err());
    }

    #[test]
    fn trace_route_has_a_bounded_hop_count() {
        let (_, args, _) =
            super::command_for(IpAddr::V4(Ipv4Addr::LOCALHOST), DiagnosticKind::TraceRoute);
        assert!(args.iter().any(|arg| arg == "12"));
        assert!(!args
            .iter()
            .any(|arg| arg.contains(';') || arg.contains('|')));
    }

    #[test]
    fn supports_ipv6_targets_for_trace_route() {
        let (program, args, _) =
            super::command_for(IpAddr::V6(Ipv6Addr::LOCALHOST), DiagnosticKind::TraceRoute);
        #[cfg(target_os = "macos")]
        assert_eq!(program, "/usr/sbin/traceroute6");
        #[cfg(target_os = "linux")]
        assert!(args.iter().any(|arg| arg == "-6"));
        #[cfg(windows)]
        assert!(args.iter().any(|arg| arg == "-6"));
        assert_eq!(args.last().map(String::as_str), Some("::1"));
    }
}
