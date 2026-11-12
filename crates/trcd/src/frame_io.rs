//! Async frame transport over any byte stream, shared by the core, the holders and the bridge.

use std::io;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use trc_protocol::frame::{Frame, FrameDecoder};

/// Reads whole frames from a stream. `next` is cancel-safe, so it can sit in a `select!`.
pub struct FrameReader<R> {
    inner: R,
    decoder: FrameDecoder,
    buffer: Box<[u8]>,
}

impl<R: AsyncRead + Unpin> FrameReader<R> {
    /// Wraps a stream.
    pub fn new(inner: R) -> Self {
        Self {
            inner,
            decoder: FrameDecoder::new(),
            buffer: vec![0; 64 * 1024].into_boxed_slice(),
        }
    }

    /// Returns the next frame, or `None` at the end of the stream.
    pub async fn next(&mut self) -> io::Result<Option<Frame>> {
        loop {
            if let Some(frame) = self
                .decoder
                .next_frame()
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
            {
                return Ok(Some(frame));
            }
            let read = self.inner.read(&mut self.buffer).await?;
            if read == 0 {
                return Ok(None);
            }
            self.decoder.push(&self.buffer[..read]);
        }
    }
}

/// Queues encoded frames for a writer task, so a slow peer never blocks the event loop that produces them.
#[derive(Clone)]
pub struct FrameSender {
    queue: mpsc::UnboundedSender<Vec<u8>>,
}

impl FrameSender {
    /// Starts a task that writes queued frames to `writer` in order until every sender is dropped or a write fails.
    /// Await the returned handle after dropping the senders to be sure every queued frame was written.
    pub fn spawn<W: AsyncWrite + Unpin + Send + 'static>(mut writer: W) -> (Self, JoinHandle<()>) {
        let (queue, mut frames) = mpsc::unbounded_channel::<Vec<u8>>();
        let handle = tokio::spawn(async move {
            while let Some(frame) = frames.recv().await {
                if writer.write_all(&frame).await.is_err() {
                    break;
                }
            }
            let _ = writer.shutdown().await;
        });
        (Self { queue }, handle)
    }

    /// Queues one encoded frame. Returns `false` when the writer has stopped.
    pub fn send(&self, frame: Vec<u8>) -> bool {
        self.queue.send(frame).is_ok()
    }
}
