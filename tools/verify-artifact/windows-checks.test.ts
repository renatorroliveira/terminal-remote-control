import { describe, expect, it } from 'vitest';
import {
    asarPackageVersion,
    endpointProblems,
    parseWindowsProcesses,
    peMachine,
    windowsDaemonPlatform,
} from './windows-checks.ts';

function pe(machine: number): Buffer {
    const bytes = Buffer.alloc(0x100);
    bytes.write('MZ', 0, 'latin1');
    bytes.writeUInt32LE(0x80, 0x3c);
    bytes.write('PE\0\0', 0x80, 'latin1');
    bytes.writeUInt16LE(machine, 0x84);
    return bytes;
}

function asar(files: Readonly<Record<string, string>>): Buffer {
    let offset = 0;
    const entries: Record<string, { size: number; offset: string }> = {};
    for (const [name, text] of Object.entries(files)) {
        entries[name] = { size: Buffer.byteLength(text), offset: String(offset) };
        offset += Buffer.byteLength(text);
    }
    const header = Buffer.from(JSON.stringify({ files: entries }));
    const pickle = Buffer.alloc(8 + header.length);
    pickle.writeUInt32LE(4 + header.length, 0);
    pickle.writeUInt32LE(header.length, 4);
    header.copy(pickle, 8);
    const sizes = Buffer.alloc(8);
    sizes.writeUInt32LE(4, 0);
    sizes.writeUInt32LE(pickle.length, 4);
    return Buffer.concat([sizes, pickle, ...Object.values(files).map((text) => Buffer.from(text))]);
}

describe('the Windows package checks (P-87, SEC-01)', () => {
    it('reads the machine of a Windows executable, and nothing from other bytes', () => {
        expect(peMachine(pe(0x8664))).toBe('x64');
        expect(peMachine(pe(0xaa64))).toBe('arm64');
        expect(peMachine(pe(0x14c))).toBeUndefined();
        expect(peMachine(Buffer.from('not an executable'))).toBeUndefined();
        expect(windowsDaemonPlatform('arm64')).toBe('windows-arm64');
    });

    it('reads the app version from app.asar’s package.json', () => {
        const archive = asar({ 'index.js': 'x', 'package.json': JSON.stringify({ version: '0.7.0' }) });
        expect(asarPackageVersion(archive)).toBe('0.7.0');
        expect(asarPackageVersion(asar({ 'index.js': 'x' }))).toBeUndefined();
    });

    it('reads the process table PowerShell prints, one process or many', () => {
        const one = JSON.stringify({ ProcessId: 10, ParentProcessId: 1, CommandLine: 'app.exe' });
        expect(parseWindowsProcesses(one)).toEqual([{ pid: 10, ppid: 1, command: 'app.exe' }]);
        const many = JSON.stringify([
            { ProcessId: 10, ParentProcessId: 1, CommandLine: null },
            { ProcessId: 11, ParentProcessId: 10, CommandLine: 'app.exe --type=renderer' },
        ]);
        expect(parseWindowsProcesses(many).map((process) => process.command)).toEqual(['', 'app.exe --type=renderer']);
        expect(parseWindowsProcesses('')).toEqual([]);
    });

    it('lists each endpoint the app’s processes own, and none of other processes', () => {
        const endpoints = JSON.stringify([
            { LocalAddress: '127.0.0.1', LocalPort: 9222, OwningProcess: 11 },
            { LocalAddress: '0.0.0.0', LocalPort: 135, OwningProcess: 900 },
        ]);
        expect(endpointProblems(endpoints, [10, 11], 'TCP listener')).toEqual([
            'TCP listener open: process 11 on 127.0.0.1:9222',
        ]);
        expect(endpointProblems('', [10], 'UDP endpoint')).toEqual([]);
    });
});
