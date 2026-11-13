/** Whether this is a test build: electron-vite defines it at build time, so release builds drop the P-14 seam. */
declare const __TRC_TEST_SEAM__: boolean;

/** The commit the build comes from (`3c4d86c`, `3c4d86c-dirty` or `unknown`), defined by electron-vite at build time. */
declare const __TRC_BUILD_COMMIT__: string;
