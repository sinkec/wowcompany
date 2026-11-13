//! Reading whole files / streams line by line.

use crate::event::{ParseError, Record, parse_line};
use std::io::{self, BufRead};

/// A line that failed to parse (kept so callers can count / log them).
#[derive(Debug, Clone)]
pub struct BadLine {
    pub line_no: usize,
    pub error: ParseError,
}

/// Iterator over the records of a combat log stream.
///
/// * tolerant of invalid UTF-8 (lossy conversion),
/// * skips blank lines,
/// * yields `Err(BadLine)` for unparsable lines instead of stopping.
pub struct Reader<R> {
    inner: R,
    buf: Vec<u8>,
    line_no: usize,
}

impl<R: BufRead> Reader<R> {
    pub fn new(inner: R) -> Self {
        Reader {
            inner,
            buf: Vec::with_capacity(512),
            line_no: 0,
        }
    }

    /// Number of physical lines consumed so far.
    pub fn line_no(&self) -> usize {
        self.line_no
    }
}

impl<R: BufRead> Iterator for Reader<R> {
    type Item = io::Result<Result<Record, BadLine>>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            self.buf.clear();
            match self.inner.read_until(b'\n', &mut self.buf) {
                Ok(0) => return None,
                Ok(_) => {}
                Err(e) => return Some(Err(e)),
            }
            self.line_no += 1;
            let line = String::from_utf8_lossy(&self.buf);
            if line.trim().is_empty() {
                continue;
            }
            let line_no = self.line_no;
            return Some(Ok(parse_line(&line).map_err(|error| BadLine { line_no, error })));
        }
    }
}

/// Opens a file and returns a [`Reader`] over it.
pub fn open(path: impl AsRef<std::path::Path>) -> io::Result<Reader<io::BufReader<std::fs::File>>> {
    Ok(Reader::new(io::BufReader::new(std::fs::File::open(path)?)))
}
