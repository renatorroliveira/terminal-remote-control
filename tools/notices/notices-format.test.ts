import { describe, expect, it } from 'vitest';
import { type CargoMetadata, formatNotices, isLicenseFile, npmPackages, rustPackages } from './notices-format.ts';

describe('npmPackages', () => {
    it('lists each production package once per version from pnpm licenses list, without our own', () => {
        const json = JSON.stringify({
            MIT: [
                { name: 'react', versions: ['19.2.0'], paths: ['/n/react'], license: 'MIT' },
                { name: '@trc/protocol', versions: ['0.2.0'], paths: ['/p'], license: 'MIT' },
            ],
            'Apache-2.0': [
                { name: 'a', versions: ['1.0.0', '2.0.0'], paths: ['/n/a1', '/n/a2'], license: 'Apache-2.0' },
            ],
        });
        expect(npmPackages(json)).toEqual([
            { name: 'a', version: '1.0.0', license: 'Apache-2.0', folder: '/n/a1' },
            { name: 'a', version: '2.0.0', license: 'Apache-2.0', folder: '/n/a2' },
            { name: 'react', version: '19.2.0', license: 'MIT', folder: '/n/react' },
        ]);
    });
});

describe('rustPackages', () => {
    const metadata: CargoMetadata = {
        packages: [
            {
                id: 'trcd',
                name: 'trcd',
                version: '0.2.0',
                license: 'MIT',
                manifest_path: '/w/trcd/Cargo.toml',
                source: null,
            },
            {
                id: 'tokio',
                name: 'tokio',
                version: '1.0.0',
                license: 'MIT',
                manifest_path: '/r/tokio/Cargo.toml',
                source: 'registry',
            },
            {
                id: 'cc',
                name: 'cc',
                version: '1.0.0',
                license: 'MIT',
                manifest_path: '/r/cc/Cargo.toml',
                source: 'registry',
            },
            {
                id: 'insta',
                name: 'insta',
                version: '1.0.0',
                license: 'Apache-2.0',
                manifest_path: '/r/insta/Cargo.toml',
                source: 'registry',
            },
            {
                id: 'mio',
                name: 'mio',
                version: '1.0.0',
                license: 'MIT',
                manifest_path: '/r/mio/Cargo.toml',
                source: 'registry',
            },
        ],
        resolve: {
            nodes: [
                {
                    id: 'trcd',
                    deps: [
                        { pkg: 'tokio', dep_kinds: [{ kind: null }] },
                        { pkg: 'cc', dep_kinds: [{ kind: 'build' }] },
                        { pkg: 'insta', dep_kinds: [{ kind: 'dev' }] },
                    ],
                },
                { id: 'tokio', deps: [{ pkg: 'mio', dep_kinds: [{ kind: null }] }] },
                { id: 'cc', deps: [] },
                { id: 'insta', deps: [] },
                { id: 'mio', deps: [] },
            ],
        },
    };

    it('lists the registry crates linked into the daemon: normal dependencies only, ours left out', () => {
        expect(rustPackages(metadata, 'trcd')).toEqual([
            { name: 'mio', version: '1.0.0', license: 'MIT', folder: '/r/mio' },
            { name: 'tokio', version: '1.0.0', license: 'MIT', folder: '/r/tokio' },
        ]);
    });
});

describe('isLicenseFile', () => {
    it('takes license, copying and notice files, and nothing else', () => {
        expect(['LICENSE', 'LICENSE-MIT', 'license.md', 'COPYING', 'NOTICE', 'LICENCE.txt'].every(isLicenseFile)).toBe(
            true,
        );
        expect(['README.md', 'Cargo.toml', 'src'].some(isLicenseFile)).toBe(false);
    });
});

describe('formatNotices', () => {
    it('writes each component with its license texts, in name order', () => {
        const text = formatNotices('Terminal Remote Control', [
            { name: 'b', version: '2.0.0', license: 'MIT', texts: ['MIT License\n\nCopyright B  \n'] },
            { name: 'a', version: '1.0.0', license: 'Apache-2.0', texts: [] },
        ]);
        expect(text).toBe(
            [
                'Third-party notices for Terminal Remote Control',
                '',
                'Terminal Remote Control includes the components below. Electron and Chromium',
                'come with their own notices: LICENSE.electron.txt and LICENSES.chromium.html.',
                '',
                '================================================================================',
                'a 1.0.0',
                'License: Apache-2.0',
                '',
                'The package has no license file; it is licensed under Apache-2.0.',
                '',
                '================================================================================',
                'b 2.0.0',
                'License: MIT',
                '',
                'MIT License',
                '',
                'Copyright B',
                '',
            ].join('\n'),
        );
    });
});
