//! Wall-clock helpers without a date library.

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch.
pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// Formats milliseconds since the Unix epoch as `YYYY-MM-DD HH:MM:SS UTC`.
pub fn format_utc(millis: u64) -> String {
    let seconds = millis / 1000;
    let (year, month, day) = civil_from_days((seconds / 86_400) as i64);
    let in_day = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC",
        in_day / 3_600,
        in_day % 3_600 / 60,
        in_day % 60
    )
}

/// Converts days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_dates_across_leap_years_and_month_ends() {
        assert_eq!(format_utc(0), "1970-01-01 00:00:00 UTC");
        assert_eq!(format_utc(951_782_400_000), "2000-02-29 00:00:00 UTC");
        assert_eq!(format_utc(1_794_486_896_000), "2026-11-12 12:34:56 UTC");
        assert_eq!(format_utc(1_798_761_599_999), "2026-12-31 23:59:59 UTC");
    }
}
