//! The SSH helpers ssh runs for the app on Windows, where it cannot run the app's sh scripts (TECH_STACK §4.5, D-66):
//! `trcd askpass` as `SSH_ASKPASS` and `trcd known-hosts` as `KnownHostsCommand`. They behave as the scripts do,
//! writing behind the connection's nonce on standard error, which the app reads.

/// What a helper prints on standard error, and its exit status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperOutcome {
    /// The line for standard error, if any.
    pub stderr: Option<String>,
    /// The exit status.
    pub status: u8,
}

/// The value of `SSH_ASKPASS_PROMPT` for a notice, such as a security-key touch request, which needs no answer.
const NOTICE_PROMPT: &str = "none";

/// `SSH_ASKPASS` (US-1.1.3, US-1.3.2): relays a notice behind `nonce` and succeeds; refuses every prompt for a secret
/// without output, so the app never asks for a password, passphrase or PIN.
pub fn askpass(prompt: &str, prompt_kind: Option<&str>, nonce: &str) -> HelperOutcome {
    if prompt_kind == Some(NOTICE_PROMPT) {
        return HelperOutcome {
            stderr: Some(format!("{nonce} NOTICE {prompt}")),
            status: 0,
        };
    }
    HelperOutcome {
        stderr: None,
        status: 1,
    }
}

/// `KnownHostsCommand`, run as `known-hosts %I %H %t %K %f` (US-1.2): reports the presented key behind `nonce` and
/// returns no keys, so `BatchMode` refuses an unknown key and the app asks the user. The `ORDER` call carries no key
/// and is ignored.
pub fn known_hosts(args: &[String], nonce: &str) -> HelperOutcome {
    let field = |index: usize| args.get(index).map_or("", String::as_str);
    if field(0) == "ORDER" {
        return HelperOutcome {
            stderr: None,
            status: 0,
        };
    }
    HelperOutcome {
        stderr: Some(format!(
            "{nonce} HOSTKEY {} {} {} {}",
            field(1),
            field(2),
            field(3),
            field(4)
        )),
        status: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn askpass_relays_a_notice_behind_the_nonce() {
        let outcome = askpass("Confirm user presence for key ED25519-SK", Some("none"), "n0nce");
        assert_eq!(
            outcome,
            HelperOutcome {
                stderr: Some("n0nce NOTICE Confirm user presence for key ED25519-SK".into()),
                status: 0
            }
        );
    }

    #[test]
    fn askpass_refuses_every_secret_without_output() {
        for kind in [None, Some("confirm"), Some("")] {
            let outcome = askpass("Enter passphrase for key 'id':", kind, "n0nce");
            assert_eq!(
                outcome,
                HelperOutcome {
                    stderr: None,
                    status: 1
                }
            );
        }
    }

    #[test]
    fn known_hosts_reports_the_presented_key() {
        let args = strings(&["HOSTNAME", "[127.0.0.1]:2221", "ssh-ed25519", "AAAAC3", "SHA256:abc"]);
        assert_eq!(
            known_hosts(&args, "n0nce"),
            HelperOutcome {
                stderr: Some("n0nce HOSTKEY [127.0.0.1]:2221 ssh-ed25519 AAAAC3 SHA256:abc".into()),
                status: 0
            }
        );
    }

    #[test]
    fn known_hosts_ignores_the_order_call() {
        let args = strings(&["ORDER", "127.0.0.1", "NONE", "NONE", "NONE"]);
        assert_eq!(
            known_hosts(&args, "n0nce"),
            HelperOutcome {
                stderr: None,
                status: 0
            }
        );
    }

    #[test]
    fn known_hosts_fills_missing_fields_with_nothing_as_the_script_did() {
        assert_eq!(
            known_hosts(&strings(&["HOSTNAME", "host"]), "n").stderr.as_deref(),
            Some("n HOSTKEY host   ")
        );
    }
}
