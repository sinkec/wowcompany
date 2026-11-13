//! E2E of the Rust HTTP client against the DEV Convex deployment (never prod).
//!
//! ```sh
//! WOWCOMPANY_API=https://<dev>.convex.site cargo test -p wowcompany-companion --test api_dev -- --ignored --nocapture
//! ```
//! Approval and cleanup go through the Convex CLI (`bunx convex run companion:…`), run from the repo root.

use companion_lib::api::{Api, Poll, Upload};
use std::process::Command;

fn repo_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn convex(args: &[&str]) -> String {
    let out = Command::new("bunx")
        .arg("convex")
        .args(args)
        .current_dir(repo_root())
        .env("CONVEX_TMPDIR", repo_root().join("node_modules/.convex-tmp"))
        .output()
        .expect("bunx convex");
    assert!(
        out.status.success(),
        "convex {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn synthetic_run() -> serde_json::Value {
    let text = std::fs::read_to_string(repo_root().join("crates/wowlog/tests/fixtures/synthetic_rfc.txt")).unwrap();
    let mut det = wowrun::Detector::new(wowrun::Config::default());
    let mut runs = Vec::new();
    for l in text.lines() {
        runs.extend(det.push(&wowlog::parse_line(l).unwrap()));
    }
    runs.extend(det.finish());
    let mut v = serde_json::to_value(&runs[0]).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let dur = v["durationMs"].as_i64().unwrap();
    v["startedAt"] = (now - 3_600_000).into();
    v["endedAt"] = (now - 3_600_000 + dur).into();
    v["runKey"] = format!("{:016x}", now as u64 ^ 0x5eed_cafe).into();
    v
}

#[test]
#[ignore]
fn link_and_upload_against_dev() {
    let base = std::env::var("WOWCOMPANY_API").expect("set WOWCOMPANY_API to the DEV convex.site URL");
    assert!(!base.contains("laudable-crane"), "refusing to run against production");
    let api = Api::new(&base);

    let roles = convex(&["data", "roles", "--format", "jsonLines"]);
    let user_id = roles
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .find(|r| r["role"] == "admin" || r["role"] == "member")
        .and_then(|r| r["userId"].as_str().map(str::to_string))
        .expect("a member in dev");

    let start = api.link_start("Rust E2E").expect("link start");
    assert!(start.link_url.contains("/link?code="));
    assert_eq!(api.link_poll(&start.poll_token).unwrap(), Poll::Pending);
    convex(&[
        "run",
        "companion:approveLinkAs",
        &serde_json::json!({"code": start.code, "userId": user_id}).to_string(),
    ]);
    let Poll::Approved { token } = api.link_poll(&start.poll_token).unwrap() else {
        panic!("not approved")
    };
    assert!(matches!(api.link_poll(&start.poll_token).unwrap(), Poll::Dead(ref s) if s == "claimed"));

    let run = synthetic_run().to_string();
    assert!(matches!(
        api.upload("wcc_nope_nope_nope_nope_nope", &run),
        Upload::Unauthorized(_)
    ));
    let mut bad = synthetic_run();
    bad["runKey"] = "zz".into();
    assert!(matches!(api.upload(&token, &bad.to_string()), Upload::Rejected(ref e) if e.contains("bad runKey")));

    let Upload::Ok { run_id, url, created } = api.upload(&token, &run) else {
        panic!("upload failed")
    };
    assert!(created && url.ends_with(&run_id));
    let Upload::Ok { created: again, .. } = api.upload(&token, &run) else {
        panic!("re-upload failed")
    };
    assert!(!again);

    // unreachable server → Retry
    assert!(matches!(
        Api::new("http://127.0.0.1:9").upload(&token, &run),
        Upload::Retry { .. }
    ));

    // cleanup
    convex(&[
        "run",
        "companion:deleteRun",
        &serde_json::json!({"runId": run_id}).to_string(),
    ]);
    let devices = convex(&["data", "devices", "--format", "jsonLines"]);
    for d in devices
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
    {
        if d["name"] == "Rust E2E" {
            convex(&[
                "run",
                "companion:deleteDevice",
                &serde_json::json!({"deviceId": d["_id"]}).to_string(),
            ]);
        }
    }
    assert!(
        matches!(api.upload(&token, &run), Upload::Unauthorized(_)),
        "deleted device is locked out"
    );
}
