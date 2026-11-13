/** Sizes drawn from the small logo; larger ones use the detailed master. */
export const SMALL_LOGO_MAX_SIZE = 48;

/** The files of a macOS `.iconset` and the pixel size of each. */
export const ICONSET_ENTRIES: readonly { readonly file: string; readonly size: number }[] = [
    16, 32, 128, 256, 512,
].flatMap((points) => [
    { file: `icon_${points}x${points}.png`, size: points },
    { file: `icon_${points}x${points}@2x.png`, size: points * 2 },
]);

/** The sizes packed into the Windows `.ico`. */
export const ICO_SIZES: readonly number[] = [16, 24, 32, 48, 64, 128, 256];

/** The sizes of the Linux PNG set, named `<size>x<size>.png` as electron-builder expects. */
export const LINUX_SIZES: readonly number[] = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
