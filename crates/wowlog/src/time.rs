//! Timestamps. The log uses the game client's local time without a time zone
//! (`MM/DD/YYYY HH:MM:SS.ffff`), so we keep it as "naive" milliseconds since
//! 1970-01-01 00:00 local time. Differences between events are exact; converting
//! to real UTC needs the PC's UTC offset (done by the app, not the parser).

/// Parses `11/13/2026 17:39:26.5751` (year optional: `11/13 17:39:26.575` → year 0).
pub fn parse(s: &str) -> Option<i64> {
    let (date, time) = s.trim().split_once(' ')?;
    let mut d = date.split('/');
    let month: u32 = d.next()?.parse().ok()?;
    let day: u32 = d.next()?.parse().ok()?;
    let year: i64 = match d.next() {
        Some(y) => y.parse().ok()?,
        None => 0,
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let (hms, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = hms.split(':');
    let h: i64 = t.next()?.parse().ok()?;
    let m: i64 = t.next()?.parse().ok()?;
    let sec: i64 = t.next()?.parse().ok()?;
    // Fraction has 3–4 digits in practice; normalise to milliseconds.
    let frac = frac.trim();
    if frac.is_empty() || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut ms_digits = String::from(&frac[..frac.len().min(3)]);
    while ms_digits.len() < 3 {
        ms_digits.push('0');
    }
    let ms: i64 = ms_digits.parse().ok()?;

    let days = days_from_civil(year, month, day);
    Some((((days * 24 + h) * 60 + m) * 60 + sec) * 1000 + ms)
}

/// Formats naive milliseconds back to `YYYY-MM-DD HH:MM:SS.mmm` (for CLI output).
pub fn format(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, mo, d) = civil_from_days(days);
    format!(
        "{y:04}-{mo:02}-{d:02} {:02}:{:02}:{:02}.{:03}",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

// Howard Hinnant's algorithms (proleptic Gregorian calendar).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = m as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats() {
        let t = parse("11/13/2026 17:39:26.5751").unwrap();
        assert_eq!(format(t), "2026-11-13 17:39:26.575");
        let a = parse("01/01/1970 00:00:00.000").unwrap();
        assert_eq!(a, 0);
        let b = parse("12/31/2026 23:59:59.9999").unwrap();
        let c = parse("01/01/2027 00:00:00.0000").unwrap();
        assert_eq!(c - b, 1);
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse("13/40/2026 00:00:00.0"), None);
        assert_eq!(parse("hello"), None);
    }
}
