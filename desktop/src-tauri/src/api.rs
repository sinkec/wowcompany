//! HTTP client for the Convex Companion API (COMPANION.md §8.2a). Blocking (ureq),
//! called from background threads only.

use serde::Deserialize;
use std::time::Duration;
use ureq::Agent;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStart {
    pub code: String,
    pub poll_token: String,
    pub link_url: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Poll {
    Pending,
    Approved {
        token: String,
    },
    /// Denied, expired, already claimed or unknown – start over.
    Dead(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Upload {
    Ok {
        run_id: String,
        url: String,
        created: bool,
    },
    /// Network problem, 429 or 5xx – try again later (`after_ms` from Retry-After if given).
    Retry {
        after_ms: Option<i64>,
        error: String,
    },
    /// 401/403: the device is unknown or revoked – needs re-linking.
    Unauthorized(String),
    /// Other 4xx: the server will never accept this run as is.
    Rejected(String),
}

pub struct Api {
    base: String,
    agent: Agent,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: Option<String>,
}

impl Api {
    pub fn new(base: &str) -> Api {
        let agent: Agent = Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(30)))
            .http_status_as_error(false)
            .user_agent(concat!("WowCompanyCompanion/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        Api {
            base: base.trim_end_matches('/').to_string(),
            agent,
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    fn post(&self, path: &str, token: Option<&str>, body: &str) -> Result<(u16, String, Option<i64>), String> {
        let mut req = self
            .agent
            .post(format!("{}{}", self.base, path))
            .content_type("application/json");
        if let Some(t) = token {
            req = req.header("Authorization", format!("Bearer {t}"));
        }
        let mut resp = req.send(body).map_err(|e| format!("network: {e}"))?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<i64>().ok())
            .map(|s| s * 1000);
        let text = resp.body_mut().read_to_string().unwrap_or_default();
        Ok((status, text, retry_after))
    }

    fn error_text(status: u16, body: &str) -> String {
        let msg = serde_json::from_str::<ErrorBody>(body)
            .ok()
            .and_then(|b| b.error)
            .unwrap_or_else(|| {
                let b = body.trim();
                if b.is_empty() {
                    "no details".to_string()
                } else {
                    b.chars().take(200).collect()
                }
            });
        format!("{status}: {msg}")
    }

    pub fn link_start(&self, device_name: &str) -> Result<LinkStart, String> {
        let body =
            serde_json::json!({ "deviceName": device_name, "appVersion": env!("CARGO_PKG_VERSION") }).to_string();
        let (status, text, _) = self.post("/companion/link/start", None, &body)?;
        if status != 200 {
            return Err(Self::error_text(status, &text));
        }
        serde_json::from_str(&text).map_err(|e| format!("bad response: {e}"))
    }

    pub fn link_poll(&self, poll_token: &str) -> Result<Poll, String> {
        #[derive(Deserialize)]
        struct R {
            status: String,
            token: Option<String>,
        }
        let body = serde_json::json!({ "pollToken": poll_token }).to_string();
        let (status, text, _) = self.post("/companion/link/poll", None, &body)?;
        if status == 429 {
            return Ok(Poll::Pending);
        }
        if status != 200 {
            return Err(Self::error_text(status, &text));
        }
        let r: R = serde_json::from_str(&text).map_err(|e| format!("bad response: {e}"))?;
        Ok(match (r.status.as_str(), r.token) {
            ("pending", _) => Poll::Pending,
            ("approved", Some(token)) => Poll::Approved { token },
            (other, _) => Poll::Dead(other.to_string()),
        })
    }

    pub fn upload(&self, token: &str, json: &str) -> Upload {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct R {
            run_id: String,
            url: String,
            created: bool,
        }
        match self.post("/companion/runs", Some(token), json) {
            Err(e) => Upload::Retry {
                after_ms: None,
                error: e,
            },
            Ok((status @ (200 | 201), text, _)) => match serde_json::from_str::<R>(&text) {
                Ok(r) => Upload::Ok {
                    run_id: r.run_id,
                    url: r.url,
                    created: r.created,
                },
                Err(e) => Upload::Retry {
                    after_ms: None,
                    error: format!("{status}: bad response: {e}"),
                },
            },
            Ok((status @ (401 | 403), text, _)) => Upload::Unauthorized(Self::error_text(status, &text)),
            Ok((status, text, retry_after)) if status == 429 || status >= 500 => Upload::Retry {
                after_ms: retry_after,
                error: Self::error_text(status, &text),
            },
            Ok((status, text, _)) => Upload::Rejected(Self::error_text(status, &text)),
        }
    }
}
