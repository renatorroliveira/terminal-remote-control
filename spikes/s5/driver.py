import hashlib, os, secrets, subprocess, sys, time

cfg, alias, binary, root = sys.argv[1:5]
mode = sys.argv[5] if len(sys.argv) > 5 else 'normal'
nonce = secrets.token_hex(8)
script = open(os.path.join(os.path.dirname(__file__), 'bootstrap.sh')).read()
prelude = f"nonce={nonce}\nroot={root}\n"
data = open(binary, 'rb').read()
if mode == 'corrupt':
    data_sent = data[:-1] + bytes([data[-1] ^ 1])
else:
    data_sent = data
digest = hashlib.sha256(data).hexdigest()
p = subprocess.Popen(['ssh', '-F', cfg, '-T', '-o', 'BatchMode=yes', '-o', 'UserKnownHostsFile=' + os.environ['KNOWN'], alias, 'exec /bin/sh -s'],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
t0 = time.time()
p.stdin.write((prelude + script).encode()); p.stdin.flush()

def line():
    while True:
        raw = p.stdout.readline()
        if not raw:
            return None
        text = raw.decode(errors='replace').rstrip('\n')
        if text.startswith(nonce + ' '):
            return text[len(nonce) + 1:]
        print(f'  [noise discarded] {text!r}')

hello = line(); print('  <', hello, f'({time.time()-t0:.2f}s)')
if hello is None or not hello.startswith('HELLO'):
    print('  stderr:', p.stderr.read().decode()); sys.exit(1)
if mode == 'short':
    p.stdin.write(f'UPLOAD {len(data)} {digest} 0.0.0\n'.encode() + data[: len(data) // 2]); p.stdin.close()
else:
    p.stdin.write(f'UPLOAD {len(data_sent)} {digest} 0.0.0\n'.encode() + data_sent); p.stdin.flush()
while True:
    msg = line(); print('  <', msg, f'({time.time()-t0:.2f}s)')
    if msg is None or not msg.startswith('PROGRESS'):
        break
if msg and msg.startswith('INSTALLED'):
    p.stdin.write(b'EXIT\n'); p.stdin.flush()
try:
    p.stdin.close()
except BrokenPipeError:
    pass
p.wait(timeout=20)
err = p.stderr.read().decode().strip()
print('  exit', p.returncode, ('stderr: ' + err) if err else '')
