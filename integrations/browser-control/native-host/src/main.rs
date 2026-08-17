use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::io::{self, Read, Write};
use std::net::TcpStream;
#[cfg(unix)]
use std::os::unix::net::UnixStream;
#[cfg(unix)]
use std::path::PathBuf;
use std::time::Duration;

const HOST_VERSION: &str = "0.1.1";
const DEFAULT_BRIDGE_PORT: u16 = 17654;
const MAX_NATIVE_INPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_NATIVE_OUTPUT_BYTES: usize = 900 * 1024;
const MAX_HTTP_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const OFFICIAL_EXTENSION_ORIGIN: &str =
    "chrome-extension://mfnpfomihliahiheofiijbmmhfeanhpb/";
const DEVELOPMENT_EXTENSION_ORIGIN: &str =
    "chrome-extension://jcpoknmofkccjkhkgdgnlemnemfjkbmp/";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeRequest {
    id: String,
    op: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeResponse {
    id: String,
    ok: bool,
    transport: &'static str,
    host_version: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    host_bridge_transport: Option<&'static str>,
}

struct HttpRequest {
    method: &'static str,
    path: String,
    body: Option<Vec<u8>>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("wodeappx browser native host stopped: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let origin = env::args().nth(1).unwrap_or_default();
    if !origin_allowed(&origin) {
        return Err("Chrome extension origin is not allowed".to_string());
    }

    let bridge_port = env::var("WODEAPPX_BROWSER_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_BRIDGE_PORT);

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    loop {
        let Some(message) = read_native_message(&mut reader)? else {
            return Ok(());
        };
        let response = match serde_json::from_slice::<NativeRequest>(&message) {
            Ok(request) => handle_request(request, bridge_port, &origin),
            Err(error) => NativeResponse {
                id: String::new(),
                ok: false,
                transport: "native_messaging",
                host_version: HOST_VERSION,
                status: None,
                data: None,
                error: Some(format!("Invalid native message: {error}")),
                host_bridge_transport: None,
            },
        };
        write_native_response(&mut writer, &response)?;
    }
}

fn origin_allowed(origin: &str) -> bool {
    if env::var("WODEAPPX_NATIVE_HOST_ALLOW_ANY_ORIGIN").as_deref() == Ok("1") {
        return true;
    }
    matches!(
        normalize_origin(origin).as_str(),
        OFFICIAL_EXTENSION_ORIGIN | DEVELOPMENT_EXTENSION_ORIGIN
    )
}

fn normalize_origin(origin: &str) -> String {
    let trimmed = origin.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{trimmed}/")
    }
}

fn handle_request(
    request: NativeRequest,
    bridge_port: u16,
    origin: &str,
) -> NativeResponse {
    let id = request.id;
    if id.trim().is_empty() {
        return error_response(id, "Native message id is required");
    }

    if request.op == "ping" {
        return NativeResponse {
            id,
            ok: true,
            transport: "native_messaging",
            host_version: HOST_VERSION,
            status: None,
            data: Some(json!({
                "ok": true,
                "name": "wodeappx-browser-native-host",
                "version": HOST_VERSION,
            })),
            error: None,
            host_bridge_transport: None,
        };
    }

    let http_request = match map_http_request(&request.op, &request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(id, &error),
    };

    match send_http_request(http_request, bridge_port, origin) {
        Ok((status, data, bridge_transport)) if (200..300).contains(&status) => NativeResponse {
            id,
            ok: true,
            transport: "native_messaging",
            host_version: HOST_VERSION,
            status: Some(status),
            data: Some(data),
            error: None,
            host_bridge_transport: Some(bridge_transport),
        },
        Ok((status, data, bridge_transport)) => {
            let message = data
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("WodeAppX browser bridge request failed")
                .to_string();
            NativeResponse {
                id,
                ok: false,
                transport: "native_messaging",
                host_version: HOST_VERSION,
                status: Some(status),
                data: Some(data),
                error: Some(message),
                host_bridge_transport: Some(bridge_transport),
            }
        }
        Err(error) => error_response(id, &error),
    }
}

fn error_response(id: String, error: &str) -> NativeResponse {
    NativeResponse {
        id,
        ok: false,
        transport: "native_messaging",
        host_version: HOST_VERSION,
        status: None,
        data: None,
        error: Some(error.to_string()),
        host_bridge_transport: None,
    }
}

fn map_http_request(op: &str, payload: &Value) -> Result<HttpRequest, String> {
    match op {
        "health" => Ok(HttpRequest {
            method: "GET",
            path: path_with_query("/health", payload, &["token"]),
            body: None,
        }),
        "extension.connect" => post_request("/extension/connect", payload),
        "extension.command" => Ok(HttpRequest {
            method: "GET",
            path: path_with_query("/extension/command", payload, &["clientId", "token", "waitMs"]),
            body: None,
        }),
        "extension.result" => post_request("/extension/result", payload),
        "sidepanel.message" => post_request("/sidepanel/message", payload),
        _ => Err(format!("Unsupported native operation: {op}")),
    }
}

fn post_request(path: &str, payload: &Value) -> Result<HttpRequest, String> {
    let body = serde_json::to_vec(payload)
        .map_err(|error| format!("Could not encode bridge request: {error}"))?;
    Ok(HttpRequest {
        method: "POST",
        path: path.to_string(),
        body: Some(body),
    })
}

fn query_value(payload: &Value, key: &str) -> Option<String> {
    payload.get(key).and_then(|value| {
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        } else if let Some(number) = value.as_u64() {
            Some(number.to_string())
        } else {
            value.as_i64().map(|number| number.to_string())
        }
    })
}

fn path_with_query(path: &str, payload: &Value, keys: &[&str]) -> String {
    let mut pairs = Vec::new();
    for key in keys {
        if let Some(value) = query_value(payload, key) {
            pairs.push(format!("{}={}", percent_encode(key), percent_encode(&value)));
        }
    }
    if pairs.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", pairs.join("&"))
    }
}

fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn send_http_request(
    request: HttpRequest,
    bridge_port: u16,
    origin: &str,
) -> Result<(u16, Value, &'static str), String> {
    #[cfg(unix)]
    {
        let socket_path = native_socket_path();
        if let Ok(mut stream) = UnixStream::connect(&socket_path) {
            configure_unix_timeouts(&stream)?;
            let (status, data) = exchange_http(&mut stream, &request, bridge_port, origin)?;
            return Ok((status, data, "unix_socket"));
        }
    }

    let address = format!("127.0.0.1:{bridge_port}");
    let mut stream = TcpStream::connect(&address)
        .map_err(|_| "WodeAppX is not running or its browser bridge is not ready".to_string())?;
    let timeout = Some(Duration::from_secs(45));
    stream
        .set_read_timeout(timeout)
        .map_err(|error| format!("Could not configure bridge read timeout: {error}"))?;
    stream
        .set_write_timeout(timeout)
        .map_err(|error| format!("Could not configure bridge write timeout: {error}"))?;
    let (status, data) = exchange_http(&mut stream, &request, bridge_port, origin)?;
    Ok((status, data, "localhost_tcp_fallback"))
}

#[cfg(unix)]
fn native_socket_path() -> PathBuf {
    if let Ok(value) = env::var("WODEAPPX_BROWSER_NATIVE_SOCKET") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join(".wodeappx").join("browser-control.sock")
}

#[cfg(unix)]
fn configure_unix_timeouts(stream: &UnixStream) -> Result<(), String> {
    let timeout = Some(Duration::from_secs(45));
    stream
        .set_read_timeout(timeout)
        .map_err(|error| format!("Could not configure native socket read timeout: {error}"))?;
    stream
        .set_write_timeout(timeout)
        .map_err(|error| format!("Could not configure native socket write timeout: {error}"))
}

fn exchange_http<S: Read + Write>(
    stream: &mut S,
    request: &HttpRequest,
    bridge_port: u16,
    origin: &str,
) -> Result<(u16, Value), String> {
    let body = request.body.as_deref().unwrap_or_default();
    let safe_origin = normalize_origin(origin);
    let mut headers = format!(
        "{} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept: application/json\r\nConnection: close\r\n",
        request.method, request.path, bridge_port
    );
    if safe_origin.starts_with("chrome-extension://") {
        headers.push_str(&format!("Origin: {safe_origin}\r\n"));
    }
    if request.method == "POST" {
        headers.push_str("Content-Type: application/json\r\n");
        headers.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    headers.push_str("\r\n");

    stream
        .write_all(headers.as_bytes())
        .and_then(|_| stream.write_all(body))
        .and_then(|_| stream.flush())
        .map_err(|error| format!("Could not write to WodeAppX browser bridge: {error}"))?;

    let mut response = Vec::new();
    stream
        .take(MAX_HTTP_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut response)
        .map_err(|error| format!("Could not read WodeAppX browser bridge response: {error}"))?;
    if response.len() > MAX_HTTP_RESPONSE_BYTES {
        return Err("WodeAppX browser bridge response exceeded the native host limit".to_string());
    }
    parse_http_response(&response)
}

fn parse_http_response(response: &[u8]) -> Result<(u16, Value), String> {
    let header_end = find_bytes(response, b"\r\n\r\n")
        .ok_or_else(|| "Invalid HTTP response from WodeAppX browser bridge".to_string())?;
    let header_text = std::str::from_utf8(&response[..header_end])
        .map_err(|_| "WodeAppX browser bridge returned invalid HTTP headers".to_string())?;
    let mut lines = header_text.split("\r\n");
    let status_line = lines
        .next()
        .ok_or_else(|| "WodeAppX browser bridge omitted HTTP status".to_string())?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "WodeAppX browser bridge returned invalid HTTP status".to_string())?;

    let mut chunked = false;
    let mut content_length = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
        {
            chunked = true;
        }
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value.trim().parse::<usize>().ok();
        }
    }

    let raw_body = &response[header_end + 4..];
    let body = if chunked {
        decode_chunked(raw_body)?
    } else if let Some(length) = content_length {
        if raw_body.len() < length {
            return Err("WodeAppX browser bridge returned a truncated body".to_string());
        }
        raw_body[..length].to_vec()
    } else {
        raw_body.to_vec()
    };

    let data = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body)
            .map_err(|error| format!("WodeAppX browser bridge returned invalid JSON: {error}"))?
    };
    Ok((status, data))
}

fn decode_chunked(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut cursor = 0usize;
    let mut output = Vec::new();
    loop {
        let relative_end = find_bytes(&input[cursor..], b"\r\n")
            .ok_or_else(|| "Invalid chunked response from WodeAppX browser bridge".to_string())?;
        let line_end = cursor + relative_end;
        let size_text = std::str::from_utf8(&input[cursor..line_end])
            .map_err(|_| "Invalid chunk size from WodeAppX browser bridge".to_string())?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| "Invalid chunk size from WodeAppX browser bridge".to_string())?;
        cursor = line_end + 2;
        if size == 0 {
            return Ok(output);
        }
        let chunk_end = cursor
            .checked_add(size)
            .ok_or_else(|| "Chunk size overflow from WodeAppX browser bridge".to_string())?;
        if chunk_end + 2 > input.len() || &input[chunk_end..chunk_end + 2] != b"\r\n" {
            return Err("Truncated chunked response from WodeAppX browser bridge".to_string());
        }
        output.extend_from_slice(&input[cursor..chunk_end]);
        if output.len() > MAX_HTTP_RESPONSE_BYTES {
            return Err("WodeAppX browser bridge response exceeded the native host limit".to_string());
        }
        cursor = chunk_end + 2;
    }
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn read_native_message<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, String> {
    let mut length_bytes = [0u8; 4];
    match reader.read_exact(&mut length_bytes) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(format!("Could not read native message length: {error}")),
    }
    let length = u32::from_le_bytes(length_bytes) as usize;
    if length == 0 || length > MAX_NATIVE_INPUT_BYTES {
        return Err("Native message length is outside the allowed range".to_string());
    }
    let mut message = vec![0u8; length];
    reader
        .read_exact(&mut message)
        .map_err(|error| format!("Could not read native message body: {error}"))?;
    Ok(Some(message))
}

fn write_native_response<W: Write>(
    writer: &mut W,
    response: &NativeResponse,
) -> Result<(), String> {
    let data = serde_json::to_vec(response)
        .map_err(|error| format!("Could not encode native response: {error}"))?;
    if data.len() > MAX_NATIVE_OUTPUT_BYTES {
        let fallback = serde_json::to_vec(&error_response(
            response.id.clone(),
            "Native response exceeded Chrome's message size limit",
        ))
        .map_err(|error| format!("Could not encode native size error: {error}"))?;
        return write_native_bytes(writer, &fallback);
    }
    write_native_bytes(writer, &data)
}

fn write_native_bytes<W: Write>(writer: &mut W, data: &[u8]) -> Result<(), String> {
    let length = u32::try_from(data.len())
        .map_err(|_| "Native response length overflow".to_string())?;
    writer
        .write_all(&length.to_le_bytes())
        .and_then(|_| writer.write_all(data))
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Could not write native response: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encoding_is_bounded_and_url_safe() {
        assert_eq!(percent_encode("abc-_.~"), "abc-_.~");
        assert_eq!(percent_encode("a b/中"), "a%20b%2F%E4%B8%AD");
    }

    #[test]
    fn native_routes_are_fixed() {
        let request = map_http_request(
            "extension.command",
            &json!({"clientId": "client 1", "token": "secret/token"}),
        )
        .unwrap();
        assert_eq!(request.method, "GET");
        assert_eq!(
            request.path,
            "/extension/command?clientId=client%201&token=secret%2Ftoken"
        );
        let waited = map_http_request(
            "extension.command",
            &json!({"clientId": "c", "waitMs": 20000}),
        )
        .unwrap();
        assert_eq!(waited.path, "/extension/command?clientId=c&waitMs=20000");
        assert!(map_http_request("proxy.anything", &Value::Null).is_err());
    }

    #[test]
    fn chunked_http_body_decodes() {
        assert_eq!(
            decode_chunked(b"4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n").unwrap(),
            b"Wikipedia"
        );
        assert!(decode_chunked(b"4\r\nbad").is_err());
    }

    #[test]
    fn parses_json_http_response() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}";
        let (status, data) = parse_http_response(response).unwrap();
        assert_eq!(status, 200);
        assert_eq!(data["ok"], true);
    }

    #[test]
    fn native_framing_round_trip() {
        let payload = br#"{"id":"1","op":"ping"}"#;
        let mut framed = Vec::new();
        framed.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        framed.extend_from_slice(payload);
        let mut cursor = std::io::Cursor::new(framed);
        assert_eq!(read_native_message(&mut cursor).unwrap().unwrap(), payload);
    }
}
