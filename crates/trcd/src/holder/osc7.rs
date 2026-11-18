//! Working directories reported with OSC 7 (`file://host/path`, percent-encoded).

/// Returns the path of an OSC 7 `file://` URL, or `None` for anything else.
pub fn path_from_file_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("file://")?;
    let path = &rest[rest.find('/')?..];
    percent_decode(path)
}

/// Whether a folder reported with iTerm2's `RemoteHost` (`user@host`) is on this host: none named, `localhost`, or this
/// host's name with or without its domain (OQ-6). A folder on another host, after `ssh`, must not become the session's.
pub fn reported_here(remote_host: Option<&str>) -> bool {
    let nodename = rustix::system::uname().nodename().to_string_lossy().into_owned();
    is_this_host(remote_host, &nodename)
}

fn is_this_host(remote_host: Option<&str>, nodename: &str) -> bool {
    let Some(remote) = remote_host else {
        return true;
    };
    let host = remote.rsplit_once('@').map_or(remote, |(_, host)| host);
    let short = |name: &str| name.split('.').next().unwrap_or(name).to_ascii_lowercase();
    host.eq_ignore_ascii_case("localhost") || short(host) == short(nodename)
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

    #[test]
    fn takes_a_folder_only_on_this_host_oq_6() {
        assert!(is_this_host(None, "devbox"));
        assert!(is_this_host(Some("me@devbox"), "devbox.example.com"));
        assert!(is_this_host(Some("me@DEVBOX.example.com"), "devbox"));
        assert!(is_this_host(Some("localhost"), "devbox"));
        assert!(!is_this_host(Some("me@prod-db"), "devbox"));
    }
}
