//! Working directories reported with OSC 7 (`file://host/path`, percent-encoded).

/// Returns the path of an OSC 7 `file://` URL, or `None` for anything else.
pub fn path_from_file_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("file://")?;
    let path = &rest[rest.find('/')?..];
    percent_decode(path)
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_decodes_the_path() {
        assert_eq!(
            path_from_file_url("file://devbox/home/tester/my%20dir").as_deref(),
            Some("/home/tester/my dir")
        );
        assert_eq!(path_from_file_url("file:///tmp").as_deref(), Some("/tmp"));
    }

    #[test]
    fn rejects_other_schemes_and_bad_escapes() {
        assert_eq!(path_from_file_url("https://example.com/x"), None);
        assert_eq!(path_from_file_url("file://host/a%zz"), None);
        assert_eq!(path_from_file_url("file://host"), None);
    }
}
