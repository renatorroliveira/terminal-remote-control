//! A small JSON writer, so the probe needs no crate beyond `windows`.

use std::fmt::Write;

/// A JSON object built field by field.
#[derive(Default)]
pub struct Object {
    fields: Vec<String>,
}

impl Object {
    /// Adds a string field.
    pub fn string(&mut self, name: &str, value: &str) -> &mut Self {
        self.fields.push(format!("{}:{}", quote(name), quote(value)));
        self
    }

    /// Adds a number field.
    pub fn number(&mut self, name: &str, value: f64) -> &mut Self {
        self.fields.push(format!("{}:{}", quote(name), number(value)));
        self
    }

    /// Adds a boolean field.
    pub fn boolean(&mut self, name: &str, value: bool) -> &mut Self {
        self.fields.push(format!("{}:{value}", quote(name)));
        self
    }

    /// Adds a field whose value is already JSON.
    pub fn raw(&mut self, name: &str, json: &str) -> &mut Self {
        self.fields.push(format!("{}:{json}", quote(name)));
        self
    }

    /// The object as JSON text.
    pub fn finish(&self) -> String {
        format!("{{{}}}", self.fields.join(","))
    }
}

/// A JSON array of rectangles, each `{x, y, width, height}`.
pub fn rects(values: &[[f64; 4]]) -> String {
    let items: Vec<String> = values
        .iter()
        .map(|[x, y, width, height]| {
            Object::default()
                .number("x", *x)
                .number("y", *y)
                .number("width", *width)
                .number("height", *height)
                .finish()
        })
        .collect();
    format!("[{}]", items.join(","))
}

/// A JSON string literal.
pub fn quote(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('"');
    for character in text.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            control if u32::from(control) < 0x20 => {
                let _ = write!(quoted, "\\u{:04x}", u32::from(control));
            }
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

fn number(value: f64) -> String {
    if value.is_finite() {
        format!("{value}")
    } else {
        "null".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_objects_with_escaped_strings() {
        let text = Object::default()
            .string("name", "a \"b\"\n\u{1}")
            .number("n", 1.5)
            .boolean("ok", true)
            .raw("list", &rects(&[[1.0, 2.0, 3.0, 4.0]]))
            .finish();
        assert_eq!(
            text,
            r#"{"name":"a \"b\"\n\u0001","n":1.5,"ok":true,"list":[{"x":1,"y":2,"width":3,"height":4}]}"#
        );
    }
}
