/** One PNG image of a square icon. */
export interface IconImage {
    readonly size: number;
    readonly png: Uint8Array;
}

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
const ICON_TYPE = 1;
const BITS_PER_PIXEL = 32;
const LARGEST_STORED_SIZE = 256;

/** Packs PNG images into a Windows `.ico` file: a directory of entries, each holding its PNG as is. */
export function packIco(images: readonly IconImage[]): Uint8Array {
    const directoryBytes = HEADER_BYTES + images.length * ENTRY_BYTES;
    const total = directoryBytes + images.reduce((sum, image) => sum + image.png.byteLength, 0);
    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);
    view.setUint16(2, ICON_TYPE, true);
    view.setUint16(4, images.length, true);
    let offset = directoryBytes;
    images.forEach((image, index) => {
        writeEntry(view, HEADER_BYTES + index * ENTRY_BYTES, image, offset);
        bytes.set(image.png, offset);
        offset += image.png.byteLength;
    });
    return bytes;
}

function writeEntry(view: DataView, at: number, image: IconImage, offset: number): void {
    const stored = image.size >= LARGEST_STORED_SIZE ? 0 : image.size;
    view.setUint8(at, stored);
    view.setUint8(at + 1, stored);
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, BITS_PER_PIXEL, true);
    view.setUint32(at + 8, image.png.byteLength, true);
    view.setUint32(at + 12, offset, true);
}
