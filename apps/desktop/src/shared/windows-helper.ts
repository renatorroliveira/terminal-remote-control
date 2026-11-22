/**
 * The bundled Windows `trcd.exe` of `arch` under the app's resources folder, which runs the app's SSH helpers and makes
 * its folders user-only on Windows (D-66, D-68).
 */
export function windowsTrcd(resources: string, arch: string): string {
    return `${resources}\\daemon\\${arch === 'arm64' ? 'windows-arm64' : 'windows-x64'}\\trcd.exe`;
}
